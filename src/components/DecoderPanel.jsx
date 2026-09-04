import { useState } from "react";
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

  async function handleDecode() {
    if (!gameInput.trim() || !password.trim()) return;
    setStatus("running");
    setDecoded("");
    setError("");

    try {
      const gameId = parseGameId(gameInput);
      const plaintext = await decodeFromGameId(gameId, password);
      setDecoded(plaintext);
      setStatus("done");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }

  return (
    <div className="panel">
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
        <Chessboard position={fen} arePiecesDraggable={false} boardWidth={320} />
      </div>

      {status === "done" && (
        <div className="decoded-message">
          <label>Hidden Message</label>
          <div className="message-reveal">{decoded}</div>
        </div>
      )}

      {status === "error" && (
        <div className="error-box">{error}</div>
      )}
    </div>
  );
}
