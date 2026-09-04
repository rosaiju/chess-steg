import { useState, useRef, useEffect } from "react";
import { Chessboard } from "react-chessboard";
import { playEncodedGame } from "../lichess/player.js";

const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export default function EncoderPanel() {
  const [message, setMessage] = useState("HELLO DR WANG");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("idle"); // idle | running | done | error
  const [log, setLog] = useState([]);
  const [fen, setFen] = useState(INITIAL_FEN);
  const [gameUrl, setGameUrl] = useState("");
  const [progress, setProgress] = useState(0);
  const [currentMove, setCurrentMove] = useState(null); // { san, moveNum } — what SenseRobot must play next
  const [aiThinking, setAiThinking] = useState(false);
  const logRef = useRef(null);
  const panelRef = useRef(null);
  const [boardWidth, setBoardWidth] = useState(320);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoardWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  function addLog(line) {
    setLog((prev) => [...prev, line]);
  }

  async function handleEncode() {
    if (!message.trim() || !password.trim()) return;
    setStatus("running");
    setLog([]);
    setFen(INITIAL_FEN);
    setGameUrl("");
    setProgress(0);
    setCurrentMove(null);
    setAiThinking(false);

    try {
      await playEncodedGame(message, password, (event) => {
        if (event.type === "creating") {
          addLog("Creating game vs Lichess AI...");
        } else if (event.type === "created") {
          addLog(`Game created: ${event.url}`);
          setGameUrl(event.url);
        } else if (event.type === "ai_thinking") {
          setCurrentMove(null);
          setAiThinking(true);
        } else if (event.type === "fen") {
          setFen(event.fen);
        } else if (event.type === "move") {
          setCurrentMove({ san: event.move, moveNum: event.moveNum });
          setAiThinking(false);
          setFen(event.fen);
          setProgress(Math.round(event.progress * 100));
          addLog(`Move ${event.moveNum}: ${event.move} (${Math.round(event.progress * 100)}%)`);
        } else if (event.type === "done") {
          setCurrentMove(null);
          setAiThinking(false);
          addLog(`Done! All bits encoded in ${event.whiteMoves.length} White moves.`);
          addLog(`Game URL: ${event.url}`);
          setGameUrl(event.url);
          setStatus("done");
        } else if (event.type === "ended") {
          addLog(`Game ended: ${event.status}`);
          setStatus("error");
        }
      });
    } catch (err) {
      addLog(`Error: ${err.message}`);
      setStatus("error");
    }
  }

  return (
    <div className="panel" ref={panelRef}>
      <h2>Encoder</h2>

      <div className="field">
        <label>Secret Message</label>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={status === "running"}
          placeholder="Type your secret message..."
        />
      </div>

      <div className="field">
        <label>Encryption Key</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={status === "running"}
          placeholder="Shared secret key"
        />
      </div>

      <button
        onClick={handleEncode}
        disabled={status === "running" || !message.trim() || !password.trim()}
        className="btn-primary"
      >
        {status === "running" ? `Encoding… ${progress}%` : "Encode & Play"}
      </button>

      {status === "running" && (
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      )}

      {currentMove && (
        <div style={{
          background: "#1a472a",
          color: "#fff",
          borderRadius: "8px",
          padding: "14px 20px",
          margin: "12px 0",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          fontSize: "1.1rem",
        }}>
          <span style={{ opacity: 0.75, fontSize: "0.85rem" }}>Move {currentMove.moveNum} — White played:</span>
          <span style={{ fontWeight: "700", fontSize: "1.5rem", letterSpacing: "0.04em" }}>{currentMove.san}</span>
        </div>
      )}
      {aiThinking && (
        <div style={{
          background: "#2a2a3a",
          color: "#aaa",
          borderRadius: "8px",
          padding: "10px 20px",
          margin: "12px 0",
          fontSize: "0.9rem",
        }}>
          AI thinking…
        </div>
      )}

      <div className="board-wrap">
        <Chessboard position={fen} arePiecesDraggable={false} boardWidth={boardWidth} />
      </div>

      {gameUrl && (
        <div className="game-link">
          <a href={gameUrl} target="_blank" rel="noreferrer">
            View on Lichess →
          </a>
        </div>
      )}

      <div className="log" ref={logRef}>
        {log.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}
