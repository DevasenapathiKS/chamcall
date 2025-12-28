import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { io } from "socket.io-client";

/**
 * Google Meet-like VideoCall component (Optimized)
 * - Pre-join: preview camera/mic, select devices, toggle on/off
 * - In-call: video grid, controls bar, screen share, keyboard shortcuts
 */
export default function VideoCall({ roomId, userId, userName, token, signalingUrl, iceServers, backendUrl, onLeave }) {
  // ═══════════════════════════════════════════════════════════════
  // REFS - Mutable values that don't trigger re-renders
  // ═══════════════════════════════════════════════════════════════
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenTrackRef = useRef(null);
  const iceCandidatesQueue = useRef([]);
  const isUnmountedRef = useRef(false);
  
  // Recording refs
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordingCanvasRef = useRef(null);
  const recordingStreamRef = useRef(null);

  // ═══════════════════════════════════════════════════════════════
  // STATE - Only values that need to trigger re-renders
  // ═══════════════════════════════════════════════════════════════
  const [phase, setPhase] = useState("prejoin");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  
  // Media state
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [isSharing, setIsSharing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  
  // Connection state
  const [peerConnected, setPeerConnected] = useState(false);
  const [peerName, setPeerName] = useState("");
  const [connectionState, setConnectionState] = useState("");
  const [iceState, setIceState] = useState("");
  
  // Remote state
  const [remoteAudio, setRemoteAudio] = useState(true);
  const [remoteVideo, setRemoteVideo] = useState(true);
  const [remoteSharing, setRemoteSharing] = useState(false);
  
  // Devices
  const [devices, setDevices] = useState({ audio: [], video: [] });
  const [selectedAudioId, setSelectedAudioId] = useState("");
  const [selectedVideoId, setSelectedVideoId] = useState("");

  // ═══════════════════════════════════════════════════════════════
  // MEMOIZED VALUES
  // ═══════════════════════════════════════════════════════════════
  const socketUrl = useMemo(() => backendUrl || signalingUrl, [backendUrl, signalingUrl]);
  
  const authPayload = useMemo(() => 
    token ? { token } : { meetingId: roomId, userId, name: userName },
    [token, roomId, userId, userName]
  );

  const defaultIceServers = useMemo(() => 
    iceServers || [{ urls: "stun:stun.l.google.com:19302" }],
    [iceServers]
  );

  // ═══════════════════════════════════════════════════════════════
  // UTILITY FUNCTIONS (stable references)
  // ═══════════════════════════════════════════════════════════════
  const emitToParent = useCallback((event, payload = {}) => {
    if (window.parent !== window) {
      window.parent.postMessage({ source: "chamcall", event, payload }, "*");
    }
  }, []);

  const stopAllTracks = useCallback((stream) => {
    stream?.getTracks().forEach(track => track.stop());
  }, []);

  const getInitials = useCallback((name) => {
    if (!name) return "?";
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  }, []);

  const formatDuration = useCallback((seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // DEVICE ENUMERATION
  // ═══════════════════════════════════════════════════════════════
  const refreshDevices = useCallback(async () => {
    try {
      const deviceList = await navigator.mediaDevices.enumerateDevices();
      if (isUnmountedRef.current) return;
      setDevices({
        audio: deviceList.filter(d => d.kind === "audioinput"),
        video: deviceList.filter(d => d.kind === "videoinput")
      });
    } catch (err) {
      console.error("Failed to enumerate devices:", err);
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // MEDIA ACQUISITION
  // ═══════════════════════════════════════════════════════════════
  const acquireMedia = useCallback(async (wantAudio, wantVideo, audioId, videoId) => {
    const constraints = {
      audio: wantAudio ? (audioId ? { deviceId: { exact: audioId } } : true) : false,
      video: wantVideo ? {
        ...(videoId ? { deviceId: { exact: videoId } } : {}),
        width: { ideal: 1280 },
        height: { ideal: 720 }
      } : false
    };

    if (!constraints.audio && !constraints.video) {
      return new MediaStream();
    }

    return navigator.mediaDevices.getUserMedia(constraints);
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // PREVIEW MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  const startPreview = useCallback(async () => {
    try {
      // Clean up existing stream
      if (localStreamRef.current) {
        stopAllTracks(localStreamRef.current);
        localStreamRef.current = null;
      }

      const stream = await acquireMedia(audioEnabled, videoEnabled, selectedAudioId, selectedVideoId);
      if (isUnmountedRef.current) {
        stopAllTracks(stream);
        return;
      }

      localStreamRef.current = stream;
      
      if (localVideoRef.current && videoEnabled) {
        localVideoRef.current.srcObject = stream;
      }
      
      setError("");
    } catch (err) {
      console.error("Preview error:", err);
      if (!isUnmountedRef.current) {
        setError(err.message || "Failed to access camera/microphone");
      }
    }
  }, [acquireMedia, stopAllTracks, audioEnabled, videoEnabled, selectedAudioId, selectedVideoId]);

  // ═══════════════════════════════════════════════════════════════
  // AUDIO TOGGLE (simple - just enable/disable track)
  // ═══════════════════════════════════════════════════════════════
  const toggleAudio = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const newState = !audioEnabled;
    stream.getAudioTracks().forEach(t => t.enabled = newState);
    setAudioEnabled(newState);

    socketRef.current?.emit("user-media-updated", { audio: newState, video: videoEnabled });
  }, [audioEnabled, videoEnabled]);

  // ═══════════════════════════════════════════════════════════════
  // VIDEO TOGGLE (optimized - UI updates instantly)
  // ═══════════════════════════════════════════════════════════════
  const toggleVideo = useCallback(() => {
    const newState = !videoEnabled;
    
    // Update UI immediately for instant feedback
    setVideoEnabled(newState);
    socketRef.current?.emit("user-media-updated", { audio: audioEnabled, video: newState });
console.log("toggleVideo", newState);
    if (!newState) {
      // TURNING OFF - stop camera (fast operation)
      const stream = localStreamRef.current;
      if (stream) {
        stream.getVideoTracks().forEach(t => {
          t.stop();
          stream.removeTrack(t);
        });
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      
      // Update peer connection in background
      const videoSender = pcRef.current?.getSenders().find(s => s.track?.kind === "video");
      if (videoSender) videoSender.replaceTrack(null).catch(() => {});
      console.log("toggleVideo", newState);
    } else {
      // TURNING ON - acquire camera in background (async, non-blocking)
      const videoConstraints = selectedVideoId
        ? { deviceId: { exact: selectedVideoId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } };

      navigator.mediaDevices.getUserMedia({ video: videoConstraints })
        .then(newStream => {
          if (isUnmountedRef.current) {
            stopAllTracks(newStream);
            return;
          }

          const newVideoTrack = newStream.getVideoTracks()[0];
          const stream = localStreamRef.current;

          // Add to existing stream or use new one
          if (stream) {
            stream.addTrack(newVideoTrack);
          } else {
            localStreamRef.current = newStream;
          }

          // Update video element
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStreamRef.current;
          }

          // Update peer connection
          const videoSender = pcRef.current?.getSenders().find(s => s.track?.kind === "video" || !s.track);
          if (videoSender) {
            videoSender.replaceTrack(newVideoTrack).catch(console.error);
          } else if (pcRef.current && localStreamRef.current) {
            pcRef.current.addTrack(newVideoTrack, localStreamRef.current);
          }
        })
        .catch(err => {
          console.error("Failed to restart camera:", err);
          if (!isUnmountedRef.current) {
            setVideoEnabled(false); // Revert state on failure
            setError("Failed to access camera");
          }
        });
    }
  }, [audioEnabled, videoEnabled, selectedVideoId, stopAllTracks]);

  // ═══════════════════════════════════════════════════════════════
  // PEER CONNECTION FACTORY
  // ═══════════════════════════════════════════════════════════════
  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: defaultIceServers });

    // Add local tracks
    localStreamRef.current?.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current);
    });

    // Handle remote tracks
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      setPeerConnected(true);
    };

    // ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit("ice-candidate", event.candidate);
      }
    };

    // Connection state changes
    pc.onconnectionstatechange = () => {
      if (isUnmountedRef.current) return;
      setConnectionState(pc.connectionState);
      if (pc.connectionState === "connected") setStatus("in-call");
      else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") setStatus("reconnecting");
    };

    pc.oniceconnectionstatechange = () => {
      if (!isUnmountedRef.current) setIceState(pc.iceConnectionState);
    };

    return pc;
  }, [defaultIceServers]);

  // ═══════════════════════════════════════════════════════════════
  // ICE CANDIDATE QUEUE PROCESSING
  // ═══════════════════════════════════════════════════════════════
  const processQueuedCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc?.remoteDescription) return;

    while (iceCandidatesQueue.current.length > 0) {
      const candidate = iceCandidatesQueue.current.shift();
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error("Failed to add ICE candidate:", err);
      }
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // JOIN CALL
  // ═══════════════════════════════════════════════════════════════
  const joinCall = useCallback(async () => {
    try {
      setError("");
      setStatus("connecting");

      // Ensure we have media
      if (!localStreamRef.current || localStreamRef.current.getTracks().length === 0) {
        const stream = await acquireMedia(audioEnabled, videoEnabled, selectedAudioId, selectedVideoId);
        if (isUnmountedRef.current) {
          stopAllTracks(stream);
          return;
        }
        localStreamRef.current = stream;
      }

      // Create peer connection
      const pc = createPeerConnection();
      pcRef.current = pc;

      // Connect to signaling
      const socket = io(socketUrl, {
        transports: ["polling", "websocket"],
        auth: authPayload,
        upgrade: true
      });
      socketRef.current = socket;

      // Socket events
      socket.on("connect", () => {
        if (isUnmountedRef.current) return;
        setStatus("waiting");
        emitToParent("call.connected", { roomId, userId });
      });

      socket.on("connect_error", (err) => {
        if (isUnmountedRef.current) return;
        setError("Failed to connect: " + err.message);
        setStatus("error");
        emitToParent("call.failed", { roomId, reason: err.message });
      });

      socket.on("user-joined", async ({ userId: peerId, name }) => {
        if (peerId === userId || isUnmountedRef.current) return;
        
        setPeerName(name || "Guest");
        emitToParent("user.joined", { roomId, userId: peerId });

        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("webrtc-offer", pc.localDescription);
        } catch (err) {
          console.error("Failed to create offer:", err);
        }
      });

      socket.on("webrtc-offer", async ({ from, payload }) => {
        if (isUnmountedRef.current) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload));
          await processQueuedCandidates();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("webrtc-answer", pc.localDescription);
        } catch (err) {
          console.error("Failed to handle offer:", err);
        }
      });

      socket.on("webrtc-answer", async ({ from, payload }) => {
        if (isUnmountedRef.current || pc.currentRemoteDescription) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload));
          await processQueuedCandidates();
        } catch (err) {
          console.error("Failed to handle answer:", err);
        }
      });

      socket.on("ice-candidate", async ({ from, payload }) => {
        if (isUnmountedRef.current) return;
        if (pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload));
          } catch (err) {
            console.error("Failed to add ICE candidate:", err);
          }
        } else {
          iceCandidatesQueue.current.push(payload);
        }
      });

      socket.on("user-left", ({ userId: peerId }) => {
        if (peerId === userId || isUnmountedRef.current) return;
        setPeerConnected(false);
        setPeerName("");
        setStatus("waiting");
        emitToParent("user.left", { roomId, userId: peerId });
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      });

      socket.on("user-media-updated", ({ userId: peerId, audio, video }) => {
        if (peerId === userId || isUnmountedRef.current) return;
        setRemoteAudio(audio);
        setRemoteVideo(video);
      });

      socket.on("screen-share-started", ({ userId: peerId }) => {
        if (peerId !== userId && !isUnmountedRef.current) setRemoteSharing(true);
      });

      socket.on("screen-share-stopped", ({ userId: peerId }) => {
        if (peerId !== userId && !isUnmountedRef.current) setRemoteSharing(false);
      });

      setPhase("incall");
    } catch (err) {
      console.error("Join call error:", err);
      if (!isUnmountedRef.current) {
        setError(err.message || "Failed to join call");
        setStatus("error");
      }
    }
  }, [
    acquireMedia, createPeerConnection, processQueuedCandidates, stopAllTracks,
    socketUrl, authPayload, roomId, userId, audioEnabled, videoEnabled,
    selectedAudioId, selectedVideoId, emitToParent
  ]);

  // ═══════════════════════════════════════════════════════════════
  // LEAVE CALL
  // ═══════════════════════════════════════════════════════════════
  const leaveCall = useCallback(() => {
    // Stop recording if active
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    if (recordingStreamRef.current) {
      recordingStreamRef.current.getTracks().forEach(t => t.stop());
      recordingStreamRef.current = null;
    }
    setIsRecording(false);
    setRecordingDuration(0);

    socketRef.current?.disconnect();
    socketRef.current = null;

    pcRef.current?.close();
    pcRef.current = null;

    stopAllTracks(localStreamRef.current);
    localStreamRef.current = null;

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    iceCandidatesQueue.current = [];
    
    setPhase("prejoin");
    setStatus("ended");
    setPeerConnected(false);
    setPeerName("");
    setError("");
    setVideoEnabled(true);
    setAudioEnabled(true);
    
    emitToParent("call.ended", { roomId, userId });
    onLeave?.();
  }, [stopAllTracks, roomId, userId, emitToParent, onLeave]);

  // ═══════════════════════════════════════════════════════════════
  // SCREEN SHARE
  // ═══════════════════════════════════════════════════════════════
  const toggleScreenShare = useCallback(async () => {
    if (isSharing) {
      // Stop sharing
      const videoTrack = localStreamRef.current?.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === "video");
      
      if (sender && videoTrack) {
        await sender.replaceTrack(videoTrack);
      }
      
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
      setIsSharing(false);
      socketRef.current?.emit("screen-share-stopped");
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = displayStream.getVideoTracks()[0];
      screenTrackRef.current = screenTrack;

      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(screenTrack);

      setIsSharing(true);
      socketRef.current?.emit("screen-share-started");

      screenTrack.onended = () => {
        if (!isUnmountedRef.current) toggleScreenShare();
      };
    } catch (err) {
      if (err.name !== "NotAllowedError") {
        setError("Screen share failed: " + err.message);
      }
    }
  }, [isSharing]);

  // ═══════════════════════════════════════════════════════════════
  // RECORDING
  // ═══════════════════════════════════════════════════════════════
  
  const startRecording = useCallback(() => {
    try {
      // Create a canvas to combine local and remote video
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext("2d");
      recordingCanvasRef.current = canvas;

      // Get audio tracks from both streams
      const audioTracks = [];
      const localAudio = localStreamRef.current?.getAudioTracks()[0];
      const remoteStream = remoteVideoRef.current?.srcObject;
      const remoteAudioTrack = remoteStream?.getAudioTracks()[0];
      
      if (localAudio) audioTracks.push(localAudio);
      if (remoteAudioTrack) audioTracks.push(remoteAudioTrack);

      // Create audio context to mix audio tracks
      let audioDestination = null;
      if (audioTracks.length > 0) {
        const audioContext = new AudioContext();
        audioDestination = audioContext.createMediaStreamDestination();
        
        audioTracks.forEach(track => {
          const source = audioContext.createMediaStreamSource(new MediaStream([track]));
          source.connect(audioDestination);
        });
      }

      // Draw video frames to canvas
      let animationId;
      const drawFrame = () => {
        if (!recordingCanvasRef.current) return;
        
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw remote video (main - larger)
        const remoteVideo = remoteVideoRef.current;
        if (remoteVideo && remoteVideo.srcObject && remoteVideo.videoWidth > 0) {
          ctx.drawImage(remoteVideo, 0, 0, canvas.width, canvas.height);
        }

        // Draw local video (PIP - smaller, bottom right)
        const localVideo = localVideoRef.current;
        if (localVideo && localVideo.srcObject && localVideo.videoWidth > 0) {
          const pipWidth = 240;
          const pipHeight = 180;
          const pipX = canvas.width - pipWidth - 20;
          const pipY = canvas.height - pipHeight - 20;
          
          // Draw border
          ctx.strokeStyle = "#4285f4";
          ctx.lineWidth = 3;
          ctx.strokeRect(pipX - 2, pipY - 2, pipWidth + 4, pipHeight + 4);
          
          // Draw video
          ctx.drawImage(localVideo, pipX, pipY, pipWidth, pipHeight);
        }

        // Draw recording indicator
        ctx.fillStyle = "#ea4335";
        ctx.beginPath();
        ctx.arc(30, 30, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "16px Arial";
        ctx.fillText("REC", 50, 36);

        animationId = requestAnimationFrame(drawFrame);
      };
      drawFrame();

      // Create combined stream from canvas + audio
      const canvasStream = canvas.captureStream(30); // 30 FPS
      const combinedTracks = [...canvasStream.getVideoTracks()];
      
      if (audioDestination) {
        combinedTracks.push(...audioDestination.stream.getAudioTracks());
      }
      
      const combinedStream = new MediaStream(combinedTracks);
      recordingStreamRef.current = combinedStream;

      // Setup MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "video/mp4";

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 2500000 // 2.5 Mbps
      });

      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        cancelAnimationFrame(animationId);
        recordingCanvasRef.current = null;

        // Create downloadable file
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `chamcall-recording-${roomId}-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        recordedChunksRef.current = [];
      };

      mediaRecorder.start(1000); // Collect data every second
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setRecordingDuration(0);

      // Notify others
      socketRef.current?.emit("recording-started", { userId });

    } catch (err) {
      console.error("Failed to start recording:", err);
      setError("Failed to start recording: " + err.message);
    }
  }, [roomId, userId]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }

    if (recordingStreamRef.current) {
      recordingStreamRef.current.getTracks().forEach(t => t.stop());
      recordingStreamRef.current = null;
    }

    setIsRecording(false);
    setRecordingDuration(0);

    // Notify others
    socketRef.current?.emit("recording-stopped", { userId });
  }, [userId]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // ═══════════════════════════════════════════════════════════════
  // EFFECTS
  // ═══════════════════════════════════════════════════════════════
  
  // Initialize on mount
  useEffect(() => {
    isUnmountedRef.current = false;
    refreshDevices();
    startPreview();

    return () => {
      isUnmountedRef.current = true;
      socketRef.current?.disconnect();
      pcRef.current?.close();
      stopAllTracks(localStreamRef.current);
    };
  }, []); // Empty deps - run once on mount

  // Re-attach video when entering call
  useEffect(() => {
    if (phase === "incall" && localStreamRef.current && localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [phase]);

  // Device selection changes (prejoin only)
  useEffect(() => {
    if (phase === "prejoin") {
      startPreview();
    }
  }, [selectedAudioId, selectedVideoId]); // Only on device change

  // Recording duration timer
  useEffect(() => {
    if (!isRecording) return;
    
    const interval = setInterval(() => {
      setRecordingDuration(d => d + 1);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isRecording]);

  // Keyboard shortcuts (in-call only)
  useEffect(() => {
    if (phase !== "incall") return;

    const handleKeyDown = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      
      const key = e.key.toLowerCase();
      if (key === "m") { e.preventDefault(); toggleAudio(); }
      if (key === "v") { e.preventDefault(); toggleVideo(); }
      if (key === "r") { e.preventDefault(); toggleRecording(); }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, toggleAudio, toggleVideo, toggleRecording]);

  // ═══════════════════════════════════════════════════════════════
  // RENDER: PRE-JOIN
  // ═══════════════════════════════════════════════════════════════
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
            <select value={selectedAudioId} onChange={e => setSelectedAudioId(e.target.value)}>
              <option value="">Default</option>
              {devices.audio.map(d => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </div>
          <div className="device-row">
            <label>Camera</label>
            <select value={selectedVideoId} onChange={e => setSelectedVideoId(e.target.value)}>
              <option value="">Default</option>
              {devices.video.map(d => (
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

  // ═══════════════════════════════════════════════════════════════
  // RENDER: IN-CALL
  // ═══════════════════════════════════════════════════════════════
  const renderInCall = () => (
    <div className="incall-container">
      <div className="call-header">
        <div className="header-left">
          <span className="room-name">{roomId}</span>
          {isRecording && (
            <span className="recording-indicator">
              <span className="rec-dot"></span>
              REC {formatDuration(recordingDuration)}
            </span>
          )}
        </div>
        <span className="call-status">
          {status === "waiting" && "Waiting for others..."}
          {status === "in-call" && `Connected${peerName ? ` with ${peerName}` : ""}`}
          {status === "reconnecting" && "Reconnecting..."}
          {status === "connecting" && "Connecting..."}
        </span>
        <span className="connection-info">
          {connectionState && `Conn: ${connectionState}`}
          {iceState && ` | ICE: ${iceState}`}
        </span>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="video-grid">
        {/* Remote video */}
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
                {!peerConnected ? "Waiting for participant..." : remoteSharing ? "Screen sharing" : "Camera is off"}
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

        {/* Local video (PIP) */}
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

        <button
          className={`control-btn large ${isRecording ? "recording" : ""}`}
          onClick={toggleRecording}
          title="Record call (R)"
        >
          {isRecording ? "⏹️" : "⏺️"}
          <span>{isRecording ? `Stop (${formatDuration(recordingDuration)})` : "Record"}</span>
        </button>

        <button className="control-btn large end-call" onClick={leaveCall} title="Leave call">
          📞
          <span>Leave</span>
        </button>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="video-call">
      {phase === "prejoin" ? renderPrejoin() : renderInCall()}
    </div>
  );
}
