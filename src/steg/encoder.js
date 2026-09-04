import { Chess } from "chess.js";
import { encrypt } from "./crypto.js";

// Convert a Uint8Array of bytes to a string of bits ("01001101...")
function bytesToBits(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(2).padStart(8, "0"))
    .join("");
}

// How many bits we can safely encode given n legal moves
// e.g. 20 moves → floor(log2(20)) = 4 bits (index 0-15 fits within 20)
function capacityBits(numMoves) {
  return Math.max(0, Math.floor(Math.log2(numMoves)));
}

// Get sorted legal moves in a position (canonical alphabetical order)
function getSortedMoves(chess) {
  return chess.moves({ verbose: false }).sort();
}

// Encode a message into a list of SAN moves using steganography
export async function encodeMessage(plaintext, password) {
  // 1. AES-encrypt the message
  const cipherB64 = await encrypt(plaintext, password);

  // 2. Convert full encrypted blob (iv + ciphertext) to bits
  const cipherBytes = Uint8Array.from(atob(cipherB64), (c) => c.charCodeAt(0));
  const cipherBits = bytesToBits(cipherBytes);

  // 3. Prepend 32-bit header = ciphertext byte length (so decoder knows when to stop)
  const lenBits = cipherBytes.length.toString(2).padStart(32, "0");
  const allBits = lenBits + cipherBits;

  // 4. Walk through the game, picking moves that encode our bits
  const chess = new Chess();
  const encodedMoves = [];
  let bitIndex = 0;

  while (bitIndex < allBits.length) {
    const legalMoves = getSortedMoves(chess);

    if (legalMoves.length === 0 || chess.isGameOver()) {
      throw new Error(
        `Game ended at bit ${bitIndex}/${allBits.length}. Message too long for one game.`
      );
    }

    const cap = capacityBits(legalMoves.length);

    if (cap === 0) {
      // Only 1 legal move — forced, can't encode bits here
      chess.move(legalMoves[0]);
      encodedMoves.push(legalMoves[0]);
      continue;
    }

    const remaining = allBits.length - bitIndex;
    const bitsToUse = Math.min(cap, remaining);

    // Take bitsToUse bits, right-pad to `cap` bits to get the move index
    const chunk = allBits.slice(bitIndex, bitIndex + bitsToUse).padEnd(cap, "0");
    const moveIndex = parseInt(chunk, 2); // always < 2^cap ≤ legalMoves.length

    const chosen = legalMoves[moveIndex];
    chess.move(chosen);
    encodedMoves.push(chosen);
    bitIndex += bitsToUse;
  }

  return {
    moves: encodedMoves,
    pgn: chess.pgn(),
  };
}
