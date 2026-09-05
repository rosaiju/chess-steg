import { Chess } from "chess.js";
import { decrypt } from "./crypto.js";
import { fetchGameMoves } from "../lichess/api.js";

// Convert a bit string back to a Uint8Array
function bitsToBytes(bits) {
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

// How many bits were encoded in a position with numMoves legal moves
// Must mirror encoder exactly
function capacityBits(numMoves) {
  return Math.max(0, Math.floor(Math.log2(numMoves)));
}

const ENCODING_BITS = 4;
const ENCODING_PATTERNS = 1 << ENCODING_BITS; // 16
const PREAMBLE_LENGTH = 4; // must match PREAMBLE_MOVES.length in player.js

// Get sorted legal moves (same canonical order as encoder)
function getSortedMoves(chess) {
  return chess.moves({ verbose: false }).sort();
}

// Quality sort — must mirror player.js exactly
const PIECE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
function moveScore(m) {
  let s = 0;
  if (m.captured) s -= PIECE_VAL[m.captured] * 100; // captures LAST — must mirror player.js
  if (m.promotion) s += PIECE_VAL[m.promotion] * 50;
  if ((m.piece === "r" || m.piece === "q") && m.from[1] === m.to[1] && m.from[1] === "1") s -= 40;
  // Deprioritize non-castling king moves; castling flags are "k" (kingside) and "q" (queenside)
  if (m.piece === "k" && !m.flags.includes("k") && !m.flags.includes("q")) s -= 200;
  return s;
}
function qualitySort(a, b) {
  const diff = moveScore(b) - moveScore(a);
  if (diff !== 0) return diff;
  const uciA = a.from + a.to + (a.promotion || "");
  const uciB = b.from + b.to + (b.promotion || "");
  return uciA.localeCompare(uciB);
}

// Get verbose moves in quality order (must mirror player.js canonical order)
function getSortedVerboseMoves(chess) {
  return chess.moves({ verbose: true }).sort(qualitySort);
}

// Decode a full game (both colors) — extracts bits only from White's moves.
// Use this when the game was played vs Lichess AI.
export async function decodeFromGameId(gameId, password, onMove) {
  const moves = await fetchGameMoves(gameId);
  return decodeFromMoves(moves, password, onMove);
}

export async function decodeFromMoves(allMoves, password, onMove = () => {}) {
  const chess = new Chess();
  let allBits = "";
  let whiteMove = 0;
  let whiteMoveTotal = 0; // includes preamble moves

  for (let i = 0; i < allMoves.length; i++) {
    const isWhite = i % 2 === 0;
    const uciMove = allMoves[i]; // Lichess returns UCI (e.g. "e2e4")

    if (isWhite) {
      whiteMoveTotal++;
      if (whiteMoveTotal > PREAMBLE_LENGTH) {
        // Only decode after preamble — mirrors player.js exactly
        let verboseMoves = getSortedVerboseMoves(chess);

        // Variable capacity — mirrors player.js exactly:
        // floor(log2(n)) bits capped at ENCODING_BITS; 1 move → 0 bits (forced).
        const moveBits = Math.min(ENCODING_BITS, Math.floor(Math.log2(verboseMoves.length)));
        if (moveBits > 0) {
          const PATTERNS = 1 << moveBits;
          const moveIndex = verboseMoves.findIndex(
            (m) => m.from + m.to + (m.promotion || "") === uciMove
          );
          if (moveIndex === -1) throw new Error(`Illegal White move: ${uciMove}`);
          const encoded = moveIndex % PATTERNS;
          const bits = encoded.toString(2).padStart(moveBits, "0");
          allBits += bits;
          whiteMove++;
          onMove({ moveNum: whiteMove, uci: uciMove, index: encoded, bits });
        }
        // moveBits === 0: single forced move, extract 0 bits
      }
      // else: preamble move — play it on the board but extract 0 bits
    }

    // chess.js accepts UCI-style objects; parse from/to from the UCI string
    const from = uciMove.slice(0, 2);
    const to = uciMove.slice(2, 4);
    const promotion = uciMove.length === 5 ? uciMove[4] : undefined;
    chess.move({ from, to, promotion });

    // Early exit once we have enough bits
    if (allBits.length >= 8) {
      const cipherByteLen = parseInt(allBits.slice(0, 8), 2);
      if (allBits.length >= 8 + cipherByteLen * 8) break;
    }
  }

  return finishDecode(allBits, password);
}

async function finishDecode(allBits, password) {
  if (allBits.length < 8) throw new Error("Too few moves to contain a message.");
  const cipherByteLen = parseInt(allBits.slice(0, 8), 2);
  const cipherBits = allBits.slice(8, 8 + cipherByteLen * 8);
  if (cipherBits.length < cipherByteLen * 8) throw new Error("Not enough moves to decode the full message.");
  const cipherBytes = bitsToBytes(cipherBits);
  const cipherB64 = btoa(String.fromCharCode(...cipherBytes));
  try {
    return await decrypt(cipherB64, password);
  } catch {
    throw new Error("Wrong password or game URL");
  }
}

// Decode a list of SAN moves back into the plaintext message (single-player, for tests)
export async function decodeMessage(moves, password) {
  const chess = new Chess();
  let allBits = "";

  for (const move of moves) {
    const legalMoves = getSortedMoves(chess);
    const cap = capacityBits(legalMoves.length);

    if (cap > 0) {
      const moveIndex = legalMoves.indexOf(move);
      if (moveIndex === -1) {
        throw new Error(`Illegal move in sequence: ${move}`);
      }
      allBits += moveIndex.toString(2).padStart(cap, "0");
    }

    chess.move(move);
  }

  return finishDecode(allBits, password);
}
