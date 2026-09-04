import { Chess } from "chess.js";
import { encrypt } from "../steg/crypto.js";
import { createAIGame, makeMove, streamGame } from "./api.js";

function bytesToBits(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(2).padStart(8, "0"))
    .join("");
}

function capacityBits(numMoves) {
  return Math.max(0, Math.floor(Math.log2(numMoves)));
}

// Stateful encoding session — works incrementally as the game progresses.
// Encodes bits into White's moves; Black (AI) plays freely.
class StegSession {
  constructor(allBits) {
    this.allBits = allBits;
    this.bitIndex = 0;
    this.chess = new Chess();
  }

  get isDone() {
    return this.bitIndex >= this.allBits.length;
  }

  get progress() {
    return this.allBits.length === 0
      ? 1
      : this.bitIndex / this.allBits.length;
  }

  // Apply any move (White or Black) — accepts SAN or UCI ("e2e4")
  applyMove(move) {
    if (/^[a-h][1-8][a-h][1-8][qrbnQRBN]?$/.test(move)) {
      const from = move.slice(0, 2);
      const to = move.slice(2, 4);
      const promotion = move.length === 5 ? move[4] : undefined;
      this.chess.move({ from, to, promotion });
    } else {
      this.chess.move(move);
    }
  }

  // Pick the next White move that encodes the next bits chunk
  // Returns { san, uci } — san for display, uci for Lichess API
  nextEncodingMove() {
    if (this.isDone) return null;
    let verboseMoves = this.chess.moves({ verbose: true });
    if (verboseMoves.length === 0 || this.chess.isGameOver()) return null;

    // Avoid king moves to keep White's king safe (unless forced)
    const nonKing = verboseMoves.filter((m) => m.piece !== "k");
    if (nonKing.length > 0) verboseMoves = nonKing;

    // Sort by UCI for canonical order (consistent with decoder)
    verboseMoves.sort((a, b) => {
      const uciA = a.from + a.to + (a.promotion || "");
      const uciB = b.from + b.to + (b.promotion || "");
      return uciA.localeCompare(uciB);
    });

    const cap = capacityBits(verboseMoves.length);
    if (cap === 0) {
      const m = verboseMoves[0];
      return { san: m.san, uci: m.from + m.to + (m.promotion || "") };
    }

    const remaining = this.allBits.length - this.bitIndex;
    const bitsToUse = Math.min(cap, remaining);
    const chunk = this.allBits
      .slice(this.bitIndex, this.bitIndex + bitsToUse)
      .padEnd(cap, "0");
    const moveIndex = parseInt(chunk, 2);

    this.bitIndex += bitsToUse;
    const m = verboseMoves[moveIndex];
    return { san: m.san, uci: m.from + m.to + (m.promotion || "") };
  }
}

// Build bits payload from plaintext + password
async function buildBits(plaintext, password) {
  const cipherB64 = await encrypt(plaintext, password);
  const cipherBytes = Uint8Array.from(atob(cipherB64), (c) => c.charCodeAt(0));
  const lenBits = cipherBytes.length.toString(2).padStart(32, "0");
  return lenBits + bytesToBits(cipherBytes);
}

// Play the full encoded game on Lichess vs AI.
// Calls onEvent({ type, move?, gameId?, progress?, status }) for UI updates.
export async function playEncodedGame(plaintext, password, onEvent = () => {}) {
  const allBits = await buildBits(plaintext, password);
  const session = new StegSession(allBits);

  onEvent({ type: "creating" });
  const game = await createAIGame("white", 1);
  const gameId = game.id;
  onEvent({ type: "created", gameId, url: `https://lichess.org/${gameId}` });

  const whiteMoves = [];

  for await (const event of streamGame(gameId)) {
    if (event.type !== "gameFull" && event.type !== "gameState") continue;

    const state = event.type === "gameFull" ? event.state : event;
    const serverMoves = state.moves ? state.moves.split(" ").filter(Boolean) : [];

    // Always rebuild board from server's authoritative move list
    const rebuilt = new Chess();
    for (const uci of serverMoves) {
      rebuilt.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
    }
    session.chess = rebuilt;

    // Keep board in sync after every server event (shows Black's moves too)
    if (serverMoves.length > 0) {
      onEvent({ type: "fen", fen: rebuilt.fen() });
    }

    const isWhiteTurn = rebuilt.turn() === "w";

    if (isWhiteTurn && !session.isDone && !rebuilt.isGameOver()) {
      const move = session.nextEncodingMove();
      if (!move) break;

      await makeMove(gameId, move.uci);
      whiteMoves.push(move.san);

      // Apply our move to rebuilt so we can send the updated FEN for display
      rebuilt.move({ from: move.uci.slice(0, 2), to: move.uci.slice(2, 4), promotion: move.uci[4] || undefined });

      onEvent({
        type: "move",
        move: move.san,
        fen: rebuilt.fen(),
        moveNum: whiteMoves.length,
        progress: session.progress,
        gameId,
      });
    }

    if (session.isDone) {
      onEvent({ type: "done", gameId, url: `https://lichess.org/${gameId}`, whiteMoves });
      break;
    }

    if (state.status && !["created", "started"].includes(state.status)) {
      onEvent({ type: "ended", status: state.status });
      break;
    }
  }

  return { gameId, url: `https://lichess.org/${gameId}`, whiteMoves };
}
