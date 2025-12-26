import { useEffect, useState } from "react";
import VideoCall from "./components/VideoCall.jsx";

const defaultConfig = {
  backendUrl: "https://vc.valliams.com"
};

export default function App() {
  const [config, setConfig] = useState(defaultConfig);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [backendUrl, setBackendUrl] = useState(defaultConfig.backendUrl);
  const [appId, setAppId] = useState("demo-app");
  const [appSecret, setAppSecret] = useState("demo-secret");
  const [roomId, setRoomId] = useState("");
  const [userId, setUserId] = useState("user-" + Math.random().toString(16).slice(2, 6));
  const [userName, setUserName] = useState("Guest");
  const [joinData, setJoinData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchConfig() {
      try {
        const res = await fetch("/config.json");
        if (res.ok) {
          const data = await res.json();
          setConfig({ ...defaultConfig, ...data });
          setBackendUrl(data.backendUrl || defaultConfig.backendUrl);
        }
      } catch (_err) {
        // ignore; use defaults
      } finally {
        setLoadingConfig(false);
      }
    }
    fetchConfig();
  }, []);

  async function createRoom() {
    setError("");
    try {
      const res = await fetch(`${backendUrl}/api/v1/rooms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-App-Id": appId,
          "X-App-Key": appSecret
        },
        body: JSON.stringify({ createdBy: userId })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setRoomId(data.roomId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function joinRoom() {
    setError("");
    if (!roomId) {
      setError("Room ID required");
      return;
    }
    try {
      const res = await fetch(`${backendUrl}/api/v1/rooms/${roomId}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-App-Id": appId,
          "X-App-Key": appSecret
        },
        body: JSON.stringify({ userId, name: userName })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setJoinData(data);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="app">
      <h1>ChamCall</h1>
      <div className="panel">
        <h3>Config</h3>
        {loadingConfig ? <p>Loading config...</p> : null}
        <label>Backend URL</label>
        <input value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} />
        <label>App ID</label>
        <input value={appId} onChange={(e) => setAppId(e.target.value)} />
        <label>App Secret</label>
        <input value={appSecret} onChange={(e) => setAppSecret(e.target.value)} />
      </div>

      <div className="panel">
        <h3>Create / Join</h3>
        <label>User ID</label>
        <input value={userId} onChange={(e) => setUserId(e.target.value)} />
        <label>Name</label>
        <input value={userName} onChange={(e) => setUserName(e.target.value)} />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={createRoom}>Create room</button>
          <input
            placeholder="roomId"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            style={{ flex: 1 }}
          />
          <button onClick={joinRoom}>Join room</button>
        </div>
        {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}
      </div>

      {joinData ? (
        <div className="panel">
          <h3>Call</h3>
          <VideoCall
            backendUrl={backendUrl}
            roomId={roomId}
            userId={userId}
            token={joinData.token}
            iceServers={joinData.iceServers}
            signalingUrl={joinData.signalingUrl}
            userName={userName}
          />
        </div>
      ) : null}

      <div className="panel">
        <h3>Embedding</h3>
        <p>Iframe: https://vc.valliams.com/embed?roomId={roomId}&token={joinData.token}&userId={userId}</p>
        <p>React: &lt;VideoCall roomId token userId backendUrl /&gt;</p>
      </div>
    </div>
  );
}

