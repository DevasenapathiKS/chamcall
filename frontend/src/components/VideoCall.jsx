import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

export default function VideoCall({ roomId, userId, userName, token, signalingUrl, iceServers }) {
  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const pcRef = useRef(null);
  const socketRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  function emitToParent(event, payload = {}) {
    if (window?.parent) {
      window.parent.postMessage({ source: "chamcall", event, payload }, "*");
    }
  }

  useEffect(() => {
    let mounted = true;
    async function setup() {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      if (!mounted) return;
      localVideo.current.srcObject = stream;
      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        remoteVideo.current.srcObject = remoteStream;
      };
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current.emit("ice-candidate", event.candidate);
        }
      };

      const socket = io(signalingUrl, {
        path: "/ws",
        transports: ["websocket"],
        auth: { token }
      });
      socketRef.current = socket;
      socket.on("connect", () => {
        setStatus("connected");
        emitToParent("call.connected", { roomId, userId });
      });
      socket.on("user-joined", async ({ userId: peerId }) => {
        emitToParent("user.joined", { roomId, userId: peerId });
        if (peerId === userId) return;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("webrtc-offer", offer);
      });
      socket.on("webrtc-offer", async ({ payload }) => {
        if (!pc.currentRemoteDescription) await pc.setRemoteDescription(payload);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("webrtc-answer", answer);
      });
      socket.on("webrtc-answer", async ({ payload }) => {
        if (!pc.currentRemoteDescription) await pc.setRemoteDescription(payload);
      });
      socket.on("ice-candidate", async ({ payload }) => {
        try {
          await pc.addIceCandidate(payload);
        } catch (err) {
          console.error("ICE add error", err);
        }
      });
      socket.on("user-left", ({ userId: peerId }) => {
        setStatus("peer-left");
        emitToParent("user.left", { roomId, userId: peerId });
      });
      socket.on("connect_error", (err) => {
        setError(err.message);
        emitToParent("call.failed", { roomId, reason: err.message });
      });
    }
    setup();
    return () => {
      mounted = false;
      socketRef.current?.disconnect();
      pcRef.current?.close();
      const tracks = localVideo.current?.srcObject?.getTracks();
      tracks?.forEach((t) => t.stop());
      emitToParent("call.ended", { roomId, userId });
    };
  }, [token, signalingUrl, iceServers, userId]);

  return (
    <div>
      <p>Status: {status} | Room {roomId} | You: {userName}</p>
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}
      <div className="video-grid">
        <div>
          <p>You</p>
          <video ref={localVideo} autoPlay muted playsInline />
        </div>
        <div>
          <p>Peer</p>
          <video ref={remoteVideo} autoPlay playsInline />
        </div>
      </div>
    </div>
  );
}

