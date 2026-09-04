import { Chess } from "chess.js";
import { decrypt } from "./crypto.js";

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

// Decode a list of SAN moves back into the plaintext message
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

  // Read 32-bit header = ciphertext byte length
  if (allBits.length < 32) {
    throw new Error("Too few moves to contain a message.");
  }
  const cipherByteLen = parseInt(allBits.slice(0, 32), 2);
  const cipherBits = allBits.slice(32, 32 + cipherByteLen * 8);

  if (cipherBits.length < cipherByteLen * 8) {
    throw new Error("Not enough moves to decode the full message.");
  }

  // Reconstruct ciphertext bytes → base64 → decrypt
  const cipherBytes = bitsToBytes(cipherBits);
  const cipherB64 = btoa(String.fromCharCode(...cipherBytes));
  return await decrypt(cipherB64, password);
}
