import { useState } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import { playEncodedGame } from "../lichess/player.js";

const INITIAL_FEN = new Chess().fen();

export default function EncoderPanel() {
  const [message, setMessage] = useState("HELLO DR WANG");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("idle"); // idle | running | done | error
  const [log, setLog] = useState([]);
  const [fen, setFen] = useState(INITIAL_FEN);
  const [gameUrl, setGameUrl] = useState("");
  const [progress, setProgress] = useState(0);

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

    const chess = new Chess();

    try {
      await playEncodedGame(message, password, (event) => {
        if (event.type === "creating") {
          addLog("Creating game vs Lichess AI...");
        } else if (event.type === "created") {
          addLog(`Game created: ${event.url}`);
          setGameUrl(event.url);
        } else if (event.type === "move") {
          chess.move(event.move);
          setFen(chess.fen());
          setProgress(Math.round(event.progress * 100));
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

      <div className="board-wrap">
        <Chessboard position={fen} arePiecesDraggable={false} boardWidth={320} />
      </div>

      {gameUrl && (
        <div className="game-link">
          <a href={gameUrl} target="_blank" rel="noreferrer">
            View on Lichess →
          </a>
        </div>
      )}

      <div className="log">
        {log.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}
