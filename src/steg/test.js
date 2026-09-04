// Quick round-trip test (run with: node --experimental-vm-modules src/steg/test.js)
// Since we use ES modules + Web Crypto, run in browser console or via Vite test

import { encodeMessage } from "./encoder.js";
import { decodeMessage } from "./decoder.js";

async function test() {
  const message = "HELLO DR WANG";
  const password = "secret123";

  console.log("Encoding:", message);
  const { moves, pgn } = await encodeMessage(message, password);
  console.log("Moves generated:", moves.length);
  console.log("PGN:", pgn);

  console.log("Decoding...");
  const decoded = await decodeMessage(moves, password);
  console.log("Decoded:", decoded);

  if (decoded === message) {
    console.log("✅ Round-trip SUCCESS");
  } else {
    console.error("❌ MISMATCH:", decoded, "!=", message);
  }
}

test().catch(console.error);
