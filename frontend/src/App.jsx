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
  const [meetingId, setMeetingId] = useState("");
  const [userId, setUserId] = useState("user-" + Math.random().toString(16).slice(2, 6));
  const [userName, setUserName] = useState("Guest");
  const [joinData, setJoinData] = useState(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("simple"); // simple or advanced
  const [meetingTitle, setMeetingTitle] = useState("");
  const [autoJoinPending, setAutoJoinPending] = useState(false);
  const [autoRecording, setAutoRecording] = useState(false);
  const [userRole, setUserRole] = useState("participant"); // interviewer, candidate, participant

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
    
    // Check if we're on a direct meeting URL (/meet/abc-1234-xyz?name=John&recording=true)
    const path = window.location.pathname;
    const meetMatch = path.match(/^\/meet\/([a-z]{3}-\d{4}-[a-z]{3})$/);
    if (meetMatch) {
      setMeetingId(meetMatch[1]);
      
      // Parse URL query parameters
      const params = new URLSearchParams(window.location.search);
      
      // Get interviewer/participant name from URL
      const nameFromUrl = params.get("name");
      if (nameFromUrl) {
        setUserName(decodeURIComponent(nameFromUrl));
      }
      
      // Get recording preference from URL
      const recordingFromUrl = params.get("recording");
      if (recordingFromUrl === "true") {
        setAutoRecording(true);
      }
      
      // Get role from URL (interviewer/candidate)
      const roleFromUrl = params.get("role");
      if (roleFromUrl) {
        setUserRole(roleFromUrl);
      }
      
      setAutoJoinPending(true);
    }
  }, []);

  // Auto-join when coming from a direct meeting URL
  useEffect(() => {
    if (autoJoinPending && meetingId && !loadingConfig) {
      setAutoJoinPending(false);
      joinMeetingWithId(meetingId);
    }
  }, [autoJoinPending, meetingId, loadingConfig]);

  // Create a new meeting using the new Meetings API
  async function createMeeting() {
    setError("");
    try {
      const res = await fetch(`${backendUrl}/api/meetings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-App-Id": appId,
          "X-App-Key": appSecret
        },
        body: JSON.stringify({ 
          createdBy: userId,
          title: meetingTitle || "Video Meeting"
        })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setMeetingId(data.meetingId);
      // Auto-copy meeting link to clipboard
      navigator.clipboard?.writeText(data.meetingUrl);
    } catch (err) {
      setError(err.message);
    }
  }

  // Join meeting using the new Meetings API (no JWT required when disabled)
  async function joinMeetingWithId(id) {
    const targetId = id || meetingId;
    
    setError("");
    if (!targetId) {
      setError("Meeting ID required");
      return;
    }
    
    // Validate meeting ID format
    if (!/^[a-z]{3}-\d{4}-[a-z]{3}$/.test(targetId)) {
      setError("Invalid meeting ID format (expected: abc-1234-xyz)");
      return;
    }
    
    try {
      const res = await fetch(`${backendUrl}/api/meetings/${targetId}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ userId, name: userName })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setJoinData(data);
    } catch (err) {
      setError(err.message);
    }
  }

  // Wrapper for button clicks (uses state)
  function joinMeeting() {
    joinMeetingWithId(meetingId);
  }

  // Legacy: Create room using old API
  async function createRoomLegacy() {
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
      setMeetingId(data.roomId);
    } catch (err) {
      setError(err.message);
    }
  }

  // Legacy: Join room using old API
  async function joinRoomLegacy() {
    setError("");
    if (!meetingId) {
      setError("Room ID required");
      return;
    }
    try {
      const res = await fetch(`${backendUrl}/api/v1/rooms/${meetingId}/join`, {
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

  function leaveCall() {
    setJoinData(null);
    setMeetingId("");
  }

  if (joinData) {
    return (
      <div className="app">
        <VideoCall
          backendUrl={backendUrl}
          roomId={meetingId}
          userId={userId}
          token={joinData.token}
          iceServers={joinData.iceServers}
          signalingUrl={joinData.signalingUrl}
          userName={userName}
          onLeave={leaveCall}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎥 ChamCall</h1>
        <p className="tagline">Self-hosted video meetings for teams</p>
      </header>

      <div className="mode-toggle">
        <button 
          className={mode === "simple" ? "active" : ""} 
          onClick={() => setMode("simple")}
        >
          Simple Mode
        </button>
        <button 
          className={mode === "advanced" ? "active" : ""} 
          onClick={() => setMode("advanced")}
        >
          Advanced Mode
        </button>
      </div>

      {mode === "simple" ? (
        <div className="panel main-panel">
          <h3>Start or Join a Meeting</h3>
          
          <div className="form-group">
            <label>Your Name</label>
            <input 
              value={userName} 
              onChange={(e) => setUserName(e.target.value)} 
              placeholder="Enter your name"
            />
          </div>

          <div className="form-group">
            <label>Meeting Title (optional)</label>
            <input 
              value={meetingTitle} 
              onChange={(e) => setMeetingTitle(e.target.value)} 
              placeholder="e.g., Team Standup"
            />
          </div>

          <button className="btn-primary btn-large" onClick={createMeeting}>
            🚀 Create New Meeting
          </button>

          <div className="divider">
            <span>or</span>
          </div>

          <div className="form-group">
            <label>Meeting ID</label>
            <input 
              value={meetingId} 
              onChange={(e) => setMeetingId(e.target.value.toLowerCase())} 
              placeholder="abc-1234-xyz"
            />
          </div>

          <button className="btn-secondary btn-large" onClick={joinMeeting}>
            📞 Join Meeting
          </button>

          {error && <p className="error-message">{error}</p>}

          {meetingId && (
            <div className="meeting-link-box">
              <p>Share this meeting link:</p>
              <code>{backendUrl}/meet/{meetingId}</code>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="panel">
            <h3>Configuration</h3>
            {loadingConfig && <p>Loading config...</p>}
            <div className="form-group">
              <label>Backend URL</label>
              <input value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} />
            </div>
            <div className="form-group">
              <label>App ID</label>
              <input value={appId} onChange={(e) => setAppId(e.target.value)} />
            </div>
            <div className="form-group">
              <label>App Secret</label>
              <input 
                type="password"
                value={appSecret} 
                onChange={(e) => setAppSecret(e.target.value)} 
              />
            </div>
          </div>

          <div className="panel">
            <h3>Meeting (New API)</h3>
            <div className="form-group">
              <label>User ID</label>
              <input value={userId} onChange={(e) => setUserId(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Name</label>
              <input value={userName} onChange={(e) => setUserName(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Meeting Title</label>
              <input value={meetingTitle} onChange={(e) => setMeetingTitle(e.target.value)} />
            </div>
            <div className="button-row">
              <button onClick={createMeeting}>Create Meeting</button>
              <input
                placeholder="abc-1234-xyz"
                value={meetingId}
                onChange={(e) => setMeetingId(e.target.value.toLowerCase())}
              />
              <button onClick={joinMeeting}>Join Meeting</button>
            </div>
            {error && <p className="error-message">{error}</p>}
          </div>

          <div className="panel">
            <h3>Legacy Room (Old API)</h3>
            <div className="button-row">
              <button onClick={createRoomLegacy}>Create Room (Legacy)</button>
              <button onClick={joinRoomLegacy}>Join Room (Legacy)</button>
            </div>
          </div>

          <div className="panel">
            <h3>API Reference</h3>
            <p><strong>Create Meeting:</strong> POST /api/meetings</p>
            <p><strong>Join Meeting:</strong> POST /api/meetings/:meetingId/join</p>
            <p><strong>Get Status:</strong> GET /api/meetings/:meetingId/status</p>
            <p><strong>Meeting URL:</strong> {backendUrl}/meet/{meetingId || "{meetingId}"}</p>
          </div>
        </>
      )}
    </div>
  );
}

