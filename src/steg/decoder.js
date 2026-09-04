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

// Get sorted legal moves (same canonical order as encoder)
function getSortedMoves(chess) {
  return chess.moves({ verbose: false }).sort();
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
    const legalMoves = getSortedMoves(chess);
    const isWhite = i % 2 === 0;

    if (isWhite) {
      const cap = capacityBits(legalMoves.length);
      if (cap > 0) {
        const moveIndex = legalMoves.indexOf(allMoves[i]);
        if (moveIndex === -1) throw new Error(`Illegal White move: ${allMoves[i]}`);
        allBits += moveIndex.toString(2).padStart(cap, "0");
      }
    }

    chess.move(allMoves[i]);

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
