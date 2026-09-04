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

  // Apply any move (White or Black) to advance board position
  applyMove(san) {
    this.chess.move(san);
  }

  // Pick the next White move that encodes the next bits chunk
  nextEncodingMove() {
    if (this.isDone) return null;
    const legalMoves = this.chess.moves({ verbose: false }).sort();
    if (legalMoves.length === 0 || this.chess.isGameOver()) return null;

    const cap = capacityBits(legalMoves.length);
    if (cap === 0) {
      // Only 1 legal move — forced, can't encode
      return legalMoves[0];
    }

    const remaining = this.allBits.length - this.bitIndex;
    const bitsToUse = Math.min(cap, remaining);
    const chunk = this.allBits
      .slice(this.bitIndex, this.bitIndex + bitsToUse)
      .padEnd(cap, "0");
    const moveIndex = parseInt(chunk, 2);

    this.bitIndex += bitsToUse;
    return legalMoves[moveIndex];
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

    // Sync board: apply any moves the server already knows about
    const serverMoves = state.moves ? state.moves.split(" ").filter(Boolean) : [];
    const localMoveCount = session.chess.history().length;
    for (let i = localMoveCount; i < serverMoves.length; i++) {
      session.applyMove(serverMoves[i]);
    }

    const isWhiteTurn = session.chess.turn() === "w";

    if (isWhiteTurn && !session.isDone && !session.chess.isGameOver()) {
      const move = session.nextEncodingMove();
      if (!move) break;

      await makeMove(gameId, move);
      session.applyMove(move);
      whiteMoves.push(move);

      onEvent({
        type: "move",
        move,
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
