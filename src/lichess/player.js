import { Chess } from "chess.js";
import { encrypt } from "../steg/crypto.js";
import { rankCandidates } from "../steg/stockfish.js";
import { createAIGame, makeMove, streamGame, challengeUser, streamAccountEvents, resignGame } from "./api.js";

function bytesToBits(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(2).padStart(8, "0"))
    .join("");
}

function capacityBits(numMoves) {
  return Math.max(0, Math.floor(Math.log2(numMoves)));
}

const ENCODING_BITS = 4;
const ENCODING_PATTERNS = 1 << ENCODING_BITS; // 16

// Deterministic quality sort — used by both encoder and decoder.
// Better moves get lower indices so the encoding prefers them statistically.
const PIECE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
function moveScore(m) {
  let s = 0;
  if (m.captured) s -= PIECE_VAL[m.captured] * 100;  // captures LAST — quiet moves encode first
  if (m.promotion) s += PIECE_VAL[m.promotion] * 50; // promotions near front
  // Penalise rook/queen shuffles along the back rank (they keep appearing at index 0)
  if ((m.piece === "r" || m.piece === "q") && m.from[1] === m.to[1] && m.from[1] === "1") s -= 40;
  // Deprioritize non-castling king moves; castling flags are "k" (kingside) and "q" (queenside)
  if (m.piece === "k" && !m.flags.includes("k") && !m.flags.includes("q")) s -= 200;
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

  // Pick the next White move that encodes the next bits chunk.
  // Uses Stockfish to choose the best-looking move within the encoding equivalence class.
  // Returns { san, uci } — san for display, uci for Lichess API
  async nextEncodingMove() {
    if (this.isDone) return null;
    let verboseMoves = this.chess.moves({ verbose: true });
    if (verboseMoves.length === 0 || this.chess.isGameOver()) return null;

    // Quality sort determines the INDEX MAPPING — decoder mirrors this exactly.
    // Stockfish only picks WHICH candidate within the equivalence class to play.
    verboseMoves.sort(qualitySort);

    // Variable-capacity encoding: floor(log2(n)) bits, capped at ENCODING_BITS.
    // Encoding always progresses regardless of how many moves are available.
    // 1 move → 0 bits (forced); 2–3 → 1 bit; 4–7 → 2 bits; 8–15 → 3 bits; 16+ → 4 bits.
    const moveBits = Math.min(ENCODING_BITS, Math.floor(Math.log2(verboseMoves.length)));

    if (moveBits === 0) {
      // Only 1 legal non-king move — forced, encode 0 bits. Prefer non-capture.
      const m = verboseMoves.find((mv) => !mv.captured) ?? verboseMoves[0];
      return { san: m.san, uci: m.from + m.to + (m.promotion || "") };
    }

    const PATTERNS = 1 << moveBits; // 2, 4, 8, or 16

    const remaining = this.allBits.length - this.bitIndex;
    const bitsToUse = Math.min(moveBits, remaining);
    const b = parseInt(
      this.allBits.slice(this.bitIndex, this.bitIndex + bitsToUse).padEnd(moveBits, "0"),
      2
    );

    // Collect all valid candidates: indices b, b+PATTERNS, b+2*PATTERNS, …
    // (skip any that accidentally deliver checkmate mid-encoding)
    let candidates = [];
    for (let idx = b; idx < verboseMoves.length; idx += PATTERNS) {
      const m = verboseMoves[idx];
      const temp = new Chess(this.chess.fen());
      temp.move(m.san);
      if (!temp.isCheckmate()) candidates.push(m);
    }
    if (candidates.length === 0) candidates.push(verboseMoves[b]); // extremely rare fallback

    // Prefer non-captures — captures create material imbalance and cause early resignation.
    // The decoder accepts any candidate at index b, b+PATTERNS, … (all decode to the same bits).
    const nonCaptures = candidates.filter((m) => !m.captured);
    if (nonCaptures.length > 0) candidates = nonCaptures;

    // Use Stockfish to pick the highest-quality candidate
    let chosen;
    if (candidates.length === 1) {
      chosen = candidates[0];
    } else {
      const candidateUCIs = candidates.map((m) => m.from + m.to + (m.promotion || ""));
      const ranked = await rankCandidates(this.chess.fen(), candidateUCIs);
      chosen = candidates.find((m) => m.from + m.to + (m.promotion || "") === ranked[0]) ?? candidates[0];
    }

    this.bitIndex += bitsToUse;
    return { san: chosen.san, uci: chosen.from + chosen.to + (chosen.promotion || "") };
  }
}

// Build bits payload from plaintext + password
async function buildBits(plaintext, password) {
  const cipherB64 = await encrypt(plaintext, password);
  const cipherBytes = Uint8Array.from(atob(cipherB64), (c) => c.charCodeAt(0));
  const lenBits = cipherBytes.length.toString(2).padStart(8, "0");
  return lenBits + bytesToBits(cipherBytes);
}

// Play the full encoded game on Lichess vs a human or AI (level 1 fallback).
// Calls onEvent({ type, ... }) for UI updates.
export async function playEncodedGame(plaintext, password, opponentUsername, onEvent = () => {}) {
  const allBits = await buildBits(plaintext, password);
  const session = new StegSession(allBits);

  let gameId;
  if (opponentUsername) {
    onEvent({ type: "challenging", opponent: opponentUsername });
    const result = await challengeUser(opponentUsername);
    gameId = (result.challenge ?? result).id;
    onEvent({ type: "waiting", gameId, opponent: opponentUsername, url: `https://lichess.org/${gameId}` });

    const acceptResult = await Promise.race([
      (async () => {
        for await (const event of streamAccountEvents()) {
          if (event.type === "gameStart" && event.game?.gameId === gameId) return "accepted";
          if (event.type === "challengeDeclined") return "declined";
        }
        return "declined";
      })(),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 2 * 60 * 1000)),
    ]);
    if (acceptResult === "timeout") {
      onEvent({ type: "timeout" });
      return;
    }
    if (acceptResult === "declined") {
      onEvent({ type: "declined", opponent: opponentUsername });
      return;
    }
    onEvent({ type: "started", gameId, url: `https://lichess.org/${gameId}` });
  } else {
    // AI fallback for solo testing
    onEvent({ type: "creating" });
    const game = await createAIGame("white", 1);
    gameId = game.id;
    onEvent({ type: "created", gameId, url: `https://lichess.org/${gameId}` });
  }

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

    if (serverMoves.length > 0) {
      onEvent({ type: "fen", fen: rebuilt.fen() });
    }

    const isWhiteTurn = rebuilt.turn() === "w";

    if (isWhiteTurn && !rebuilt.isGameOver()) {
      let move;
      if (!session.isDone) {
        // Still encoding — pick a steganographic move (Stockfish-ranked)
        move = await session.nextEncodingMove();
        if (!move) break;
        if (session.isDone) {
          // Just encoded the last bit — notify UI
          onEvent({ type: "encoded", gameId, url: `https://lichess.org/${gameId}`, whiteMoves: [...whiteMoves] });
        }
      } else {
        // Encoding done — resign immediately so the game is archived and decodable
        try { await resignGame(gameId); } catch { /* ignore — game may already be over */ }
        onEvent({ type: "done", status: "resign", gameId, url: `https://lichess.org/${gameId}`, whiteMoves });
        break;
      }

      await makeMove(gameId, move.uci);
      whiteMoves.push(move.san);
      rebuilt.move({ from: move.uci.slice(0, 2), to: move.uci.slice(2, 4), promotion: move.uci[4] || undefined });

      onEvent({
        type: "move",
        move: move.san,
        fen: rebuilt.fen(),
        moveNum: whiteMoves.length,
        progress: Math.min(session.progress, 1),
        gameId,
      });
    } else if (!isWhiteTurn) {
      onEvent({ type: "ai_thinking" });
    }

    // Break only when game ends naturally
    if (state.status && !["created", "started"].includes(state.status)) {
      if (!session.isDone) {
        onEvent({ type: "incomplete", gameId, url: `https://lichess.org/${gameId}`, whiteMoves });
      } else {
        onEvent({ type: "done", status: state.status, gameId, url: `https://lichess.org/${gameId}`, whiteMoves });
      }
      break;
    }
  }

  return { gameId, url: `https://lichess.org/${gameId}`, whiteMoves };
}
