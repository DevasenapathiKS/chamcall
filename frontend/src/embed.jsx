import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import VideoCall from "./components/VideoCall.jsx";
import "./styles.css";

function EmbedApp() {
  const params = new URLSearchParams(window.location.search);
  const [backendUrl, setBackendUrl] = useState(params.get("backendUrl") || "https://vc.valliams.com");
  const [roomId, setRoomId] = useState(params.get("roomId") || "");
  const [token, setToken] = useState(params.get("token") || "");
  const [userId, setUserId] = useState(params.get("userId") || "guest");
  const [userName] = useState(params.get("name") || "Guest");
  const [iceServers, setIceServers] = useState([]);
  const [signalingUrl, setSignalingUrl] = useState(params.get("signalingUrl") || "");
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchTurnIfNeeded() {
      if (!token || !backendUrl) return;
      try {
        const res = await fetch(`${backendUrl}/api/v1/turn/credentials`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setIceServers(data.iceServers);
          if (!signalingUrl) setSignalingUrl(`${backendUrl.replace("http", "ws")}/ws`);
        }
      } catch (err) {
        setError(err.message);
      }
    }
    fetchTurnIfNeeded();
  }, [backendUrl, token, signalingUrl]);

  if (!roomId || !token) {
    return (
      <div className="app">
        <p>roomId and token are required query params.</p>
        {error && <p style={{ color: "#f87171" }}>{error}</p>}
      </div>
    );
  }

  return (
    <div className="app">
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}
      <VideoCall
        backendUrl={backendUrl}
        roomId={roomId}
        userId={userId}
        userName={userName}
        token={token}
        iceServers={iceServers}
        signalingUrl={signalingUrl || `${backendUrl.replace("http", "ws")}/ws`}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <EmbedApp />
  </React.StrictMode>
);

