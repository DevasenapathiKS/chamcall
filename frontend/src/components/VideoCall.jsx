import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";

/**
 * Google Meet-like VideoCall component
 * - Pre-join: preview camera/mic, select devices, toggle on/off
 * - In-call: video grid, controls bar, screen share, keyboard shortcuts
 */
export default function VideoCall({ roomId, userId, userName, token, signalingUrl, iceServers, backendUrl }) {
  // Refs for video elements - these persist across renders
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  
  // WebRTC and Socket refs
  const pcRef = useRef(null);
  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenTrackRef = useRef(null);
  const iceCandidatesQueue = useRef([]);

  // UI state
  const [phase, setPhase] = useState("prejoin"); // "prejoin" | "incall"
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [isSharing, setIsSharing] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false);
  const [peerName, setPeerName] = useState("");

  // Device selection
  const [devices, setDevices] = useState({ audio: [], video: [] });
  const [selectedAudioId, setSelectedAudioId] = useState("");
  const [selectedVideoId, setSelectedVideoId] = useState("");

  // Connection states
  const [connectionState, setConnectionState] = useState("");
  const [iceState, setIceState] = useState("");

  // Remote media state
  const [remoteAudio, setRemoteAudio] = useState(true);
  const [remoteVideo, setRemoteVideo] = useState(true);
  const [remoteSharing, setRemoteSharing] = useState(false);

  // ─────────────────────────────────────────────────────────────
  // Emit events to parent window (for iframe embedding)
  // ─────────────────────────────────────────────────────────────
  const emitToParent = useCallback((event, payload = {}) => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: "chamcall", event, payload }, "*");
    }
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Stop all tracks in a stream
  // ─────────────────────────────────────────────────────────────
  const stopStream = useCallback((stream) => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Attach stream to video element
  // ─────────────────────────────────────────────────────────────
  const attachStreamToVideo = useCallback((videoRef, stream) => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Get available devices
  // ─────────────────────────────────────────────────────────────
  const refreshDevices = useCallback(async () => {
    try {
      const deviceList = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        audio: deviceList.filter((d) => d.kind === "audioinput"),
        video: deviceList.filter((d) => d.kind === "videoinput")
      });
    } catch (err) {
      console.error("Failed to enumerate devices", err);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Get user media
  // ─────────────────────────────────────────────────────────────
  const getLocalStream = useCallback(async () => {
    const constraints = {
      audio: selectedAudioId ? { deviceId: { exact: selectedAudioId } } : true,
      video: selectedVideoId
        ? { deviceId: { exact: selectedVideoId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } }
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      return stream;
    } catch (err) {
      setError("Camera/microphone access denied. Please allow permissions.");
      throw err;
    }
  }, [selectedAudioId, selectedVideoId]);

  // ─────────────────────────────────────────────────────────────
  // Start preview (pre-join phase)
  // ─────────────────────────────────────────────────────────────
  const startPreview = useCallback(async () => {
    try {
      // Stop existing stream
      if (localStreamRef.current) {
        stopStream(localStreamRef.current);
      }

      const stream = await getLocalStream();
      localStreamRef.current = stream;

      // Apply toggle states
      stream.getAudioTracks().forEach((t) => (t.enabled = audioEnabled));
      stream.getVideoTracks().forEach((t) => (t.enabled = videoEnabled));

      // Attach to video element
      attachStreamToVideo(localVideoRef, stream);
      setError("");
    } catch (err) {
      console.error("Preview error:", err);
      setError(err.message || "Failed to access camera/microphone");
    }
  }, [getLocalStream, stopStream, attachStreamToVideo, audioEnabled, videoEnabled]);

  // ─────────────────────────────────────────────────────────────
  // Toggle audio
  // ─────────────────────────────────────────────────────────────
  const toggleAudio = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const newState = !audioEnabled;
    stream.getAudioTracks().forEach((t) => (t.enabled = newState));
    setAudioEnabled(newState);

    if (socketRef.current?.connected) {
      socketRef.current.emit("user-media-updated", { audio: newState, video: videoEnabled });
    }
  }, [audioEnabled, videoEnabled]);

  // ─────────────────────────────────────────────────────────────
  // Toggle video
  // ─────────────────────────────────────────────────────────────
  const toggleVideo = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const newState = !videoEnabled;
    stream.getVideoTracks().forEach((t) => (t.enabled = newState));
    setVideoEnabled(newState);

    if (socketRef.current?.connected) {
      socketRef.current.emit("user-media-updated", { audio: audioEnabled, video: newState });
    }
  }, [audioEnabled, videoEnabled]);

  // ─────────────────────────────────────────────────────────────
  // Create RTCPeerConnection
  // ─────────────────────────────────────────────────────────────
  const createPeerConnection = useCallback(() => {
    console.log("Creating peer connection with ICE servers:", iceServers);
    
    const pc = new RTCPeerConnection({ 
      iceServers: iceServers || [{ urls: "stun:stun.l.google.com:19302" }]
    });

    // Add local tracks
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => {
        console.log("Adding track to peer connection:", track.kind);
        pc.addTrack(track, stream);
      });
    }

    // Handle remote track
    pc.ontrack = (event) => {
      console.log("Received remote track:", event.track.kind);
      const [remoteStream] = event.streams;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      setPeerConnected(true);
    };

    // ICE candidate
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("Sending ICE candidate");
        socketRef.current?.emit("ice-candidate", event.candidate);
      }
    };

    // Connection state
    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState);
      setConnectionState(pc.connectionState);
      if (pc.connectionState === "connected") {
        setStatus("in-call");
      } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        setStatus("reconnecting");
      }
    };

    // ICE connection state
    pc.oniceconnectionstatechange = () => {
      console.log("ICE connection state:", pc.iceConnectionState);
      setIceState(pc.iceConnectionState);
    };

    // ICE gathering state
    pc.onicegatheringstatechange = () => {
      console.log("ICE gathering state:", pc.iceGatheringState);
    };

    return pc;
  }, [iceServers]);

  // ─────────────────────────────────────────────────────────────
  // Process queued ICE candidates
  // ─────────────────────────────────────────────────────────────
  const processIceCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) return;

    while (iceCandidatesQueue.current.length > 0) {
      const candidate = iceCandidatesQueue.current.shift();
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("Added queued ICE candidate");
      } catch (err) {
        console.error("Failed to add queued ICE candidate:", err);
      }
    }
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Join the call
  // ─────────────────────────────────────────────────────────────
  const joinCall = useCallback(async () => {
    try {
      setError("");
      setStatus("connecting");

      // Ensure local stream exists
      let stream = localStreamRef.current;
      if (!stream) {
        stream = await getLocalStream();
        localStreamRef.current = stream;
        stream.getAudioTracks().forEach((t) => (t.enabled = audioEnabled));
        stream.getVideoTracks().forEach((t) => (t.enabled = videoEnabled));
      }

      // Create peer connection BEFORE connecting socket
      const pc = createPeerConnection();
      pcRef.current = pc;

      // Connect to signaling server
      // Use backendUrl as the Socket.IO server URL (more reliable than signalingUrl)
      const socketUrl = backendUrl || signalingUrl;
      console.log("Connecting to signaling server:", socketUrl);
      console.log("Token:", token ? token.substring(0, 20) + "..." : "NO TOKEN");
      
      const socket = io(socketUrl, {
        transports: ["polling", "websocket"],
        auth: { token },
        upgrade: true
      });
      socketRef.current = socket;

      // Socket connected
      socket.on("connect", () => {
        console.log("Socket connected, socket ID:", socket.id);
        setStatus("waiting");
        emitToParent("call.connected", { roomId, userId });
      });

      // Connection error
      socket.on("connect_error", (err) => {
        console.error("Socket connect error:", err);
        setError("Failed to connect: " + err.message);
        setStatus("error");
        emitToParent("call.failed", { roomId, reason: err.message });
      });

      // Another user joined - create and send offer
      socket.on("user-joined", async ({ userId: peerId, name }) => {
        console.log("User joined:", peerId, name);
        if (peerId === userId) {
          console.log("Ignoring own join event");
          return;
        }

        setPeerName(name || "Guest");
        emitToParent("user.joined", { roomId, userId: peerId });

        try {
          // Create offer
          console.log("Creating offer...");
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          console.log("Sending offer to peer");
          socket.emit("webrtc-offer", pc.localDescription);
        } catch (err) {
          console.error("Failed to create offer:", err);
          setError("Failed to initiate call");
        }
      });

      // Received offer - create answer
      socket.on("webrtc-offer", async ({ from, payload }) => {
        console.log("Received offer from:", from);
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload));
          console.log("Remote description set (offer)");
          
          // Process any queued ICE candidates
          await processIceCandidates();

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          console.log("Sending answer");
          socket.emit("webrtc-answer", pc.localDescription);
        } catch (err) {
          console.error("Failed to handle offer:", err);
        }
      });

      // Received answer
      socket.on("webrtc-answer", async ({ from, payload }) => {
        console.log("Received answer from:", from);
        try {
          if (!pc.currentRemoteDescription) {
            await pc.setRemoteDescription(new RTCSessionDescription(payload));
            console.log("Remote description set (answer)");
            
            // Process any queued ICE candidates
            await processIceCandidates();
          }
        } catch (err) {
          console.error("Failed to handle answer:", err);
        }
      });

      // Received ICE candidate
      socket.on("ice-candidate", async ({ from, payload }) => {
        console.log("Received ICE candidate from:", from);
        try {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(payload));
            console.log("Added ICE candidate");
          } else {
            // Queue candidates until remote description is set
            console.log("Queueing ICE candidate");
            iceCandidatesQueue.current.push(payload);
          }
        } catch (err) {
          console.error("Failed to add ICE candidate:", err);
        }
      });

      // User left
      socket.on("user-left", ({ userId: peerId }) => {
        console.log("User left:", peerId);
        if (peerId === userId) return;

        setPeerConnected(false);
        setPeerName("");
        setStatus("waiting");
        emitToParent("user.left", { roomId, userId: peerId });

        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = null;
        }
      });

      // Media state updates
      socket.on("user-media-updated", ({ userId: peerId, audio, video }) => {
        if (peerId === userId) return;
        setRemoteAudio(audio);
        setRemoteVideo(video);
      });

      socket.on("screen-share-started", ({ userId: peerId }) => {
        if (peerId === userId) return;
        setRemoteSharing(true);
      });

      socket.on("screen-share-stopped", ({ userId: peerId }) => {
        if (peerId === userId) return;
        setRemoteSharing(false);
      });

      // Transition to in-call
      setPhase("incall");

    } catch (err) {
      console.error("Join call error:", err);
      setError(err.message || "Failed to join call");
      setStatus("error");
    }
  }, [
    getLocalStream,
    createPeerConnection,
    processIceCandidates,
    signalingUrl,
    token,
    roomId,
    userId,
    audioEnabled,
    videoEnabled,
    emitToParent
  ]);

  // ─────────────────────────────────────────────────────────────
  // Leave the call
  // ─────────────────────────────────────────────────────────────
  const leaveCall = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      stopStream(localStreamRef.current);
      localStreamRef.current = null;
    }

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    iceCandidatesQueue.current = [];
    setPhase("prejoin");
    setStatus("ended");
    setPeerConnected(false);
    setPeerName("");
    setError("");
    emitToParent("call.ended", { roomId, userId });
  }, [stopStream, roomId, userId, emitToParent]);

  // ─────────────────────────────────────────────────────────────
  // Screen share
  // ─────────────────────────────────────────────────────────────
  const toggleScreenShare = useCallback(async () => {
    if (isSharing) {
      // Stop sharing
      const originalVideoTrack = localStreamRef.current?.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === "video");

      if (sender && originalVideoTrack) {
        await sender.replaceTrack(originalVideoTrack);
      }

      if (screenTrackRef.current) {
        screenTrackRef.current.stop();
        screenTrackRef.current = null;
      }

      setIsSharing(false);
      socketRef.current?.emit("screen-share-stopped");
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = displayStream.getVideoTracks()[0];
      screenTrackRef.current = screenTrack;

      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === "video");
      if (sender) {
        await sender.replaceTrack(screenTrack);
      }

      setIsSharing(true);
      socketRef.current?.emit("screen-share-started");

      screenTrack.onended = () => {
        toggleScreenShare();
      };
    } catch (err) {
      if (err.name !== "NotAllowedError") {
        setError("Screen share failed: " + err.message);
      }
    }
  }, [isSharing]);

  // ─────────────────────────────────────────────────────────────
  // Effects
  // ─────────────────────────────────────────────────────────────

  // Initialize preview on mount
  useEffect(() => {
    refreshDevices();
    startPreview();

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
      if (pcRef.current) pcRef.current.close();
      stopStream(localStreamRef.current);
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-attach local video when phase changes to incall
  useEffect(() => {
    if (phase === "incall" && localStreamRef.current && localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [phase]);

  // Restart preview when device selection changes (prejoin only)
  useEffect(() => {
    if (phase === "prejoin" && (selectedAudioId || selectedVideoId)) {
      startPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAudioId, selectedVideoId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (phase !== "incall") return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;

      if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        toggleAudio();
      }
      if (e.key.toLowerCase() === "v") {
        e.preventDefault();
        toggleVideo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, toggleAudio, toggleVideo]);

  // ─────────────────────────────────────────────────────────────
  // UI Helpers
  // ─────────────────────────────────────────────────────────────
  const getInitials = (name) => {
    if (!name) return "?";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  // ─────────────────────────────────────────────────────────────
  // Render: Pre-join screen
  // ─────────────────────────────────────────────────────────────
  const renderPrejoin = () => (
    <div className="prejoin-container">
      <div className="prejoin-card">
        <h2>Ready to join?</h2>
        <p className="room-info">Room: {roomId}</p>

        {error && <div className="error-banner">{error}</div>}

        <div className="preview-section">
          <div className="video-preview">
            <video 
              ref={localVideoRef} 
              autoPlay 
              muted 
              playsInline 
              style={{ display: videoEnabled ? "block" : "none" }}
            />
            {!videoEnabled && (
              <div className="avatar-placeholder">
                <div className="avatar">{getInitials(userName)}</div>
                <p>Camera is off</p>
              </div>
            )}
          </div>

          <div className="preview-controls">
            <button
              className={`control-btn ${!audioEnabled ? "off" : ""}`}
              onClick={toggleAudio}
              title={audioEnabled ? "Mute (M)" : "Unmute (M)"}
            >
              {audioEnabled ? "🎤" : "🔇"}
            </button>
            <button
              className={`control-btn ${!videoEnabled ? "off" : ""}`}
              onClick={toggleVideo}
              title={videoEnabled ? "Turn off camera (V)" : "Turn on camera (V)"}
            >
              {videoEnabled ? "📹" : "📷"}
            </button>
          </div>
        </div>

        <div className="device-selection">
          <div className="device-row">
            <label>Microphone</label>
            <select value={selectedAudioId} onChange={(e) => setSelectedAudioId(e.target.value)}>
              <option value="">Default</option>
              {devices.audio.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </div>
          <div className="device-row">
            <label>Camera</label>
            <select value={selectedVideoId} onChange={(e) => setSelectedVideoId(e.target.value)}>
              <option value="">Default</option>
              {devices.video.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button className="join-btn" onClick={joinCall}>
          Join now
        </button>

        <p className="hint">Joining as {userName}</p>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  // Render: In-call screen
  // ─────────────────────────────────────────────────────────────
  const renderInCall = () => (
    <div className="incall-container">
      {/* Header */}
      <div className="call-header">
        <span className="room-name">{roomId}</span>
        <span className="call-status">
          {status === "waiting" && "Waiting for others..."}
          {status === "in-call" && `Connected${peerName ? ` with ${peerName}` : ""}`}
          {status === "reconnecting" && "Reconnecting..."}
          {status === "connecting" && "Connecting..."}
        </span>
        <span className="connection-info">
          {connectionState && `Conn: ${connectionState}`} {iceState && `| ICE: ${iceState}`}
        </span>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Video grid */}
      <div className="video-grid">
        {/* Remote video (main) */}
        <div className="video-tile main-video">
          <video 
            ref={remoteVideoRef} 
            autoPlay 
            playsInline 
            style={{ display: peerConnected && remoteVideo ? "block" : "none" }}
          />
          {(!peerConnected || !remoteVideo) && (
            <div className="avatar-placeholder large">
              <div className="avatar">{peerConnected ? getInitials(peerName) : "?"}</div>
              <p>
                {!peerConnected
                  ? "Waiting for participant..."
                  : remoteSharing
                  ? "Screen sharing"
                  : "Camera is off"}
              </p>
            </div>
          )}
          {peerConnected && (
            <div className="video-label">
              {peerName || "Guest"}
              {!remoteAudio && " 🔇"}
              {remoteSharing && " 📺"}
            </div>
          )}
        </div>

        {/* Local video (pip) */}
        <div className="video-tile pip-video">
          <video 
            ref={localVideoRef} 
            autoPlay 
            muted 
            playsInline 
            style={{ display: videoEnabled && !isSharing ? "block" : "none" }}
          />
          {(!videoEnabled || isSharing) && (
            <div className="avatar-placeholder small">
              <div className="avatar small">{getInitials(userName)}</div>
            </div>
          )}
          <div className="video-label">
            You {!audioEnabled && "🔇"} {isSharing && "📺"}
          </div>
        </div>
      </div>

      {/* Controls bar */}
      <div className="controls-bar">
        <button
          className={`control-btn large ${!audioEnabled ? "off" : ""}`}
          onClick={toggleAudio}
          title="Toggle microphone (M)"
        >
          {audioEnabled ? "🎤" : "🔇"}
          <span>{audioEnabled ? "Mute" : "Unmute"}</span>
        </button>

        <button
          className={`control-btn large ${!videoEnabled ? "off" : ""}`}
          onClick={toggleVideo}
          title="Toggle camera (V)"
        >
          {videoEnabled ? "📹" : "📷"}
          <span>{videoEnabled ? "Stop video" : "Start video"}</span>
        </button>

        <button
          className={`control-btn large ${isSharing ? "active" : ""}`}
          onClick={toggleScreenShare}
          title="Share screen"
        >
          📺
          <span>{isSharing ? "Stop share" : "Share"}</span>
        </button>

        <button className="control-btn large end-call" onClick={leaveCall} title="Leave call">
          📞
          <span>Leave</span>
        </button>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  // Main render
  // ─────────────────────────────────────────────────────────────
  return <div className="video-call">{phase === "prejoin" ? renderPrejoin() : renderInCall()}</div>;
}
