import { useState, useRef, useEffect } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import { decodeFromGameId } from "../steg/decoder.js";
import { parseGameId } from "../lichess/api.js";

const INITIAL_FEN = new Chess().fen();

export default function DecoderPanel() {
  const [gameInput, setGameInput] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("idle"); // idle | running | done | error
  const [decoded, setDecoded] = useState("");
  const [error, setError] = useState("");
  const [fen, setFen] = useState(INITIAL_FEN);
  const [log, setLog] = useState([]);
  const [copiedMsg, setCopiedMsg] = useState(false);
  const panelRef = useRef(null);
  const logRef = useRef(null);
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

  async function handleDecode() {
    if (!gameInput.trim() || !password.trim()) return;
    setStatus("running");
    setDecoded("");
    setError("");
    setLog([]);

    try {
      const gameId = parseGameId(gameInput);
      addLog(`Fetching game ${gameId}…`);
      const plaintext = await decodeFromGameId(gameId, password, ({ moveNum, uci, index, bits }) => {
        addLog(`Move ${moveNum} (${uci}): index ${index} → ${bits}`);
      });
      setDecoded(plaintext);
      setStatus("done");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && gameInput.trim() && password.trim() && status !== "running") {
      handleDecode();
    }
  }

  async function copyDecoded() {
    await navigator.clipboard.writeText(decoded);
    setCopiedMsg(true);
    setTimeout(() => setCopiedMsg(false), 1500);
  }

  return (
    <div className="panel" ref={panelRef}>
      <h2>Decoder</h2>

      <div className="field">
        <label>Lichess Game URL or ID</label>
        <input
          value={gameInput}
          onChange={(e) => setGameInput(e.target.value)}
          disabled={status === "running"}
          placeholder="https://lichess.org/xxxxxxxx"
        />
      </div>

      <div className="field">
        <label>Encryption Key</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={status === "running"}
          placeholder="Shared secret key"
        />
      </div>

      <button
        onClick={handleDecode}
        disabled={status === "running" || !gameInput.trim() || !password.trim()}
        className="btn-primary"
      >
        {status === "running" ? "Decoding…" : "Decode"}
      </button>

      <div className="board-wrap">
        <Chessboard position={fen} arePiecesDraggable={false} boardWidth={boardWidth} />
      </div>

      {status === "done" && (
        <div className="decoded-message">
          <label>Hidden Message</label>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div className="message-reveal">{decoded}</div>
            <button
              onClick={copyDecoded}
              style={{ padding: "4px 12px", fontSize: "0.85rem", whiteSpace: "nowrap" }}
            >
              {copiedMsg ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="error-box">{error}</div>
      )}

      {log.length > 0 && (
        <div className="log" ref={logRef}>
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
