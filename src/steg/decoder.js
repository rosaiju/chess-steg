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

const ENCODING_BITS = 3;
const ENCODING_PATTERNS = 1 << ENCODING_BITS; // 8

// Get sorted legal moves (same canonical order as encoder)
function getSortedMoves(chess) {
  return chess.moves({ verbose: false }).sort();
}

// Quality sort — must mirror player.js exactly
const PIECE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
function moveScore(m) {
  let s = 0;
  if (m.captured) s += PIECE_VAL[m.captured] * 100;
  if (m.promotion) s += PIECE_VAL[m.promotion] * 50;
  if ((m.piece === "r" || m.piece === "q") && m.from[1] === m.to[1] && m.from[1] === "1") s -= 40;
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
export async function decodeFromGameId(gameId, password) {
  const moves = await fetchGameMoves(gameId);
  return decodeFromMoves(moves, password);
}

export async function decodeFromMoves(allMoves, password) {
  const chess = new Chess();
  let allBits = "";

  for (let i = 0; i < allMoves.length; i++) {
    const isWhite = i % 2 === 0;
    const uciMove = allMoves[i]; // Lichess returns UCI (e.g. "e2e4")

    if (isWhite) {
      let verboseMoves = getSortedVerboseMoves(chess);
      // Mirror encoder: exclude king moves unless forced
      const nonKing = verboseMoves.filter((m) => m.piece !== "k");
      if (nonKing.length > 0) verboseMoves = nonKing;

      if (verboseMoves.length >= ENCODING_PATTERNS) {
        const moveIndex = verboseMoves.findIndex(
          (m) => m.from + m.to + (m.promotion || "") === uciMove
        );
        if (moveIndex === -1) throw new Error(`Illegal White move: ${uciMove}`);
        allBits += (moveIndex % ENCODING_PATTERNS).toString(2).padStart(ENCODING_BITS, "0");
      }
      // If < ENCODING_PATTERNS moves: forced/no-encode move, extract 0 bits
    }

    // chess.js accepts UCI-style objects; parse from/to from the UCI string
    const from = uciMove.slice(0, 2);
    const to = uciMove.slice(2, 4);
    const promotion = uciMove.length === 5 ? uciMove[4] : undefined;
    chess.move({ from, to, promotion });

    // Early exit once we have enough bits
    if (allBits.length >= 32) {
      const cipherByteLen = parseInt(allBits.slice(0, 32), 2);
      if (allBits.length >= 32 + cipherByteLen * 8) break;
    }
  }

  return finishDecode(allBits, password);
}

async function finishDecode(allBits, password) {
  if (allBits.length < 32) throw new Error("Too few moves to contain a message.");
  const cipherByteLen = parseInt(allBits.slice(0, 32), 2);
  const cipherBits = allBits.slice(32, 32 + cipherByteLen * 8);
  if (cipherBits.length < cipherByteLen * 8) throw new Error("Not enough moves to decode the full message.");
  const cipherBytes = bitsToBytes(cipherBits);
  const cipherB64 = btoa(String.fromCharCode(...cipherBytes));
  return await decrypt(cipherB64, password);
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
