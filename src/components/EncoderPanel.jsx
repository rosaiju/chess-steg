import { useState, useRef, useEffect } from "react";
import { Chessboard } from "react-chessboard";
import { playEncodedGame } from "../lichess/player.js";

const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export default function EncoderPanel() {
  const [message, setMessage] = useState("HELLO WANG");
  const [password, setPassword] = useState("");
  const [opponent, setOpponent] = useState("");
  const [status, setStatus] = useState("idle"); // idle | running | encoded | done | error
  const [log, setLog] = useState([]);
  const [fen, setFen] = useState(INITIAL_FEN);
  const [gameUrl, setGameUrl] = useState("");
  const [progress, setProgress] = useState(0);
  const [currentMove, setCurrentMove] = useState(null); // { san, moveNum }
  const [aiThinking, setAiThinking] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
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

  const isActive = status === "running" || status === "encoded";

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
      await playEncodedGame(message, password, opponent.trim() || null, (event) => {
        if (event.type === "challenging") {
          addLog(`Challenging ${event.opponent}…`);
        } else if (event.type === "waiting") {
          addLog(`Waiting for ${event.opponent} to accept…`);
          setGameUrl(event.url);
        } else if (event.type === "started") {
          addLog(`${event.opponent ? event.opponent + " accepted!" : "Game started!"} Encoding message into moves…`);
          setGameUrl(event.url);
        } else if (event.type === "declined") {
          addLog(`Challenge declined by ${event.opponent}.`);
          setStatus("error");
        } else if (event.type === "creating") {
          addLog("Creating game vs Lichess AI…");
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
        } else if (event.type === "encoded") {
          setCurrentMove(null);
          setAiThinking(false);
          addLog(`✓ Message encoded in ${event.whiteMoves.length} White moves. Keep playing until the game ends.`);
          setGameUrl(event.url);
          setStatus("encoded");
        } else if (event.type === "incomplete") {
          setCurrentMove(null);
          setAiThinking(false);
          addLog("Game ended before encoding was complete — opponent resigned too early. The message cannot be decoded.");
          setGameUrl(event.url);
          setStatus("error");
        } else if (event.type === "timeout") {
          addLog("Challenge timed out — opponent did not accept.");
          setStatus("error");
        } else if (event.type === "done") {
          setCurrentMove(null);
          setAiThinking(false);
          addLog(`✓ Message fully encoded. Game resigned — paste the URL into the decoder.`);
          addLog(`Game URL: ${event.url}`);
          setGameUrl(event.url);
          setStatus("done");
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
          disabled={isActive}
          placeholder="Type your secret message…"
        />
        {message && (
          <div style={{ fontSize: "0.78rem", color: "#888", marginTop: "4px" }}>
            {(() => {
              const bits = 8 + (message.length + 4) * 8;
              const moves = Math.ceil(bits / 4);
              return `${message.length} chars → ${bits} bits → ${moves} White moves`;
            })()}
          </div>
        )}
      </div>

      <div className="field">
        <label>Encryption Key</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isActive}
          placeholder="Shared secret key"
        />
      </div>

      <div className="field">
        <label>Opponent Username <span style={{ opacity: 0.55, fontWeight: 400 }}>(optional — blank = AI)</span></label>
        <input
          value={opponent}
          onChange={(e) => setOpponent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && message.trim() && password.trim() && !isActive) handleEncode();
          }}
          disabled={isActive}
          placeholder="Lichess username"
        />
      </div>

      <button
        onClick={handleEncode}
        disabled={isActive || !message.trim() || !password.trim()}
        className="btn-primary"
      >
        {status === "running" ? `Encoding… ${progress}%` : status === "encoded" ? "Waiting for game to end…" : "Encode & Play"}
      </button>

      {isActive && (
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      )}

      {status === "encoded" && (
        <div style={{
          background: "#1a472a",
          color: "#fff",
          borderRadius: "8px",
          padding: "14px 20px",
          margin: "12px 0",
          fontSize: "0.95rem",
        }}>
          ✓ Message encoded — finish the game, then decode with the URL below.
        </div>
      )}

      {status === "done" && (
        <div style={{
          background: "#1a3a5c",
          color: "#fff",
          borderRadius: "8px",
          padding: "14px 20px",
          margin: "12px 0",
          fontSize: "0.95rem",
        }}>
          Game over — paste the URL into the decoder to reveal the hidden message.
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
          Waiting for opponent…
        </div>
      )}

      <div className="board-wrap">
        <Chessboard position={fen} arePiecesDraggable={false} boardWidth={boardWidth} />
      </div>

      {gameUrl && (
        <div className="game-link" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <a href={gameUrl} target="_blank" rel="noreferrer">
            View on Lichess →
          </a>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(gameUrl);
              setCopiedUrl(true);
              setTimeout(() => setCopiedUrl(false), 1500);
            }}
            style={{ padding: "4px 12px", fontSize: "0.85rem" }}
          >
            {copiedUrl ? "Copied!" : "Copy URL"}
          </button>
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
