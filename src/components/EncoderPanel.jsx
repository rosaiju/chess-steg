import { useState, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
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
  const logRef = useRef(null);

  // Auto-scroll log to bottom on new entries
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

    try {
      await playEncodedGame(message, password, (event) => {
        if (event.type === "creating") {
          addLog("Creating game vs Lichess AI...");
        } else if (event.type === "created") {
          addLog(`Game created: ${event.url}`);
          setGameUrl(event.url);
        } else if (event.type === "fen") {
          flushSync(() => setFen(event.fen));
        } else if (event.type === "move") {
          flushSync(() => {
            setFen(event.fen);
            setProgress(Math.round(event.progress * 100));
          });
          addLog(`Move ${event.moveNum}: ${event.move} (${Math.round(event.progress * 100)}%)`);
        } else if (event.type === "done") {
          addLog(`Done! All bits encoded in ${event.whiteMoves.length} White moves.`);
          addLog(`Game URL: ${event.url}`);
          setGameUrl(event.url);
          setStatus("done");
        } else if (event.type === "ended") {
          addLog(`Game ended unexpectedly: ${event.status}`);
          setStatus("error");
        }
      });
    } catch (err) {
      addLog(`Error: ${err.message}`);
      setStatus("error");
    }
  }

  return (
    <div className="panel">
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

      {gameUrl && status === "running" ? (
        <iframe
          src={`https://lichess.org/embed/game/${gameUrl.split("/").pop()}?theme=brown&bg=dark`}
          width="100%"
          height="360"
          style={{ border: "none", borderRadius: "8px" }}
          title="Live game"
        />
      ) : (
        <div className="board-wrap">
          <Chessboard position={fen} arePiecesDraggable={false} boardWidth={320} />
        </div>
      )}

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
