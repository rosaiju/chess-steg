import { Chess } from "chess.js";
import { encrypt } from "../steg/crypto.js";
import { createAIGame, streamGame } from "./api.js";

function bytesToBits(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(2).padStart(8, "0"))
    .join("");
}

function capacityBits(numMoves) {
  return Math.max(0, Math.floor(Math.log2(numMoves)));
}

const ENCODING_BITS = 3;
const ENCODING_PATTERNS = 1 << ENCODING_BITS; // 8

// Deterministic quality sort — used by both encoder and decoder.
// Better moves get lower indices so the encoding prefers them statistically.
const PIECE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
function moveScore(m) {
  let s = 0;
  if (m.captured) s += PIECE_VAL[m.captured] * 100;  // captures first
  if (m.promotion) s += PIECE_VAL[m.promotion] * 50; // promotions
  // Penalise rook/queen shuffles along the back rank (they keep appearing at index 0)
  if ((m.piece === "r" || m.piece === "q") && m.from[1] === m.to[1] && m.from[1] === "1") s -= 40;
  return s;
}
function qualitySort(a, b) {
  const diff = moveScore(b) - moveScore(a); // descending score
  if (diff !== 0) return diff;
  const uciA = a.from + a.to + (a.promotion || "");
  const uciB = b.from + b.to + (b.promotion || "");
  return uciA.localeCompare(uciB); // tiebreak by UCI for determinism
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

    // Sort by quality first (better moves at low indices), UCI as tiebreak.
    // Deterministic — decoder must mirror this exactly.
    verboseMoves.sort(qualitySort);

    // Fallback: fewer than ENCODING_PATTERNS moves — play best, encode 0 bits
    if (verboseMoves.length < ENCODING_PATTERNS) {
      const m = verboseMoves[0];
      return { san: m.san, uci: m.from + m.to + (m.promotion || "") };
    }

    // Modular encoding: bits = moveIndex % ENCODING_PATTERNS
    // Multiple moves encode the same pattern; pick the best-quality one.
    const remaining = this.allBits.length - this.bitIndex;
    const bitsToUse = Math.min(ENCODING_BITS, remaining);
    const b = parseInt(
      this.allBits.slice(this.bitIndex, this.bitIndex + bitsToUse).padEnd(ENCODING_BITS, "0"),
      2
    );

    // Walk candidates: indices b, b+8, b+16, … — pick first non-mating move
    let chosen = null;
    for (let idx = b; idx < verboseMoves.length; idx += ENCODING_PATTERNS) {
      const m = verboseMoves[idx];
      // Skip if this move accidentally delivers checkmate (need more moves to finish encoding)
      const temp = new Chess(this.chess.fen());
      temp.move(m.san);
      if (temp.isCheckmate()) continue;
      chosen = m;
      break;
    }
    // Fallback: all candidates checkmate — extremely rare, just play the first candidate
    if (!chosen) chosen = verboseMoves[b];

    this.bitIndex += bitsToUse;
    return { san: chosen.san, uci: chosen.from + chosen.to + (chosen.promotion || "") };
  }
}

// Build bits payload from plaintext + password
async function buildBits(plaintext, password) {
  const cipherB64 = await encrypt(plaintext, password);
  const cipherBytes = Uint8Array.from(atob(cipherB64), (c) => c.charCodeAt(0));
  const lenBits = cipherBytes.length.toString(2).padStart(32, "0");
  return lenBits + bytesToBits(cipherBytes);
}

// Play the full encoded game on Lichess vs AI (level 1).
// Calls onEvent({ type, ... }) for UI updates.
export async function playEncodedGame(plaintext, password, onEvent = () => {}) {
  const allBits = await buildBits(plaintext, password);
  const session = new StegSession(allBits);

  onEvent({ type: "creating" });
  const game = await createAIGame("white", 1);
  const gameId = game.id;
  onEvent({ type: "created", gameId, url: `https://lichess.org/${gameId}` });

  const whiteMoves = [];
  // The move SenseRobot has been instructed to play but hasn't been confirmed by server yet
  let pendingMove = null;

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

    if (serverMoves.length > 0) {
      onEvent({ type: "fen", fen: rebuilt.fen() });
    }

    if (state.status && !["created", "started"].includes(state.status)) {
      onEvent({ type: "ended", status: state.status });
      break;
    }

    // White's moves sit at even indices (0, 2, 4, …) in serverMoves.
    // Check whether the server has confirmed the pending White move.
    const expectedWhiteMoveIdx = whiteMoves.length * 2;
    if (pendingMove && serverMoves.length > expectedWhiteMoveIdx) {
      const actualUci = serverMoves[expectedWhiteMoveIdx];
      if (actualUci === pendingMove.uci) {
        whiteMoves.push(pendingMove.san);
        onEvent({
          type: "move",
          move: pendingMove.san,
          fen: rebuilt.fen(),
          moveNum: whiteMoves.length,
          progress: session.progress,
          gameId,
        });
        pendingMove = null;
      } else {
        // Robot played a different move — encoding is out of sync
        onEvent({ type: "wrong_move", expected: pendingMove.san, actual: actualUci });
        break;
      }
    }

    if (session.isDone) {
      onEvent({ type: "done", gameId, url: `https://lichess.org/${gameId}`, whiteMoves });
      break;
    }

    const isWhiteTurn = rebuilt.turn() === "w";

    if (isWhiteTurn && !pendingMove && !rebuilt.isGameOver()) {
      // Compute the encoded move and tell SenseRobot to play it physically
      const move = session.nextEncodingMove();
      if (!move) break;
      pendingMove = move;
      onEvent({ type: "play_this", move: move.san, uci: move.uci, moveNum: whiteMoves.length + 1 });
    } else if (!isWhiteTurn) {
      onEvent({ type: "ai_thinking" });
    }
  }

  return { gameId, url: `https://lichess.org/${gameId}`, whiteMoves };
}
