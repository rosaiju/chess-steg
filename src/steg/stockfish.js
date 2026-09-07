// Thin UCI wrapper around the Stockfish Web Worker.
// Singleton engine — initialized once, reused for every move.

let worker = null;
let initResolve = null;
const initPromise = Promise.race([
  new Promise((r) => { initResolve = r; }),
  new Promise((_, rej) => setTimeout(() => rej(new Error("Stockfish init timeout")), 5000)),
]);
let queryResolve = null;
let scores = null; // Map<uci, bestCpSeen>

function ensureWorker() {
  if (worker) return;
  worker = new Worker("/stockfish.js");
  worker.onmessage = ({ data }) => {
    const line = typeof data === "string" ? data : String(data);

    // Engine ready
    if (line === "uciok") {
      initResolve?.();
      return;
    }

    if (!queryResolve) return;

    // Parse ranked moves from MultiPV info lines:
    // "info depth N ... multipv K score cp 30 ... pv e2e4 ..."
    if (line.startsWith("info") && line.includes(" pv ") && line.includes("score")) {
      const pvMatch = line.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/);
      const cpMatch = line.match(/score cp (-?\d+)/);
      const mateMatch = line.match(/score mate (-?\d+)/);
      if (pvMatch) {
        const uci = pvMatch[1];
        const score = mateMatch
          ? parseInt(mateMatch[1]) > 0 ? 1e6 : -1e6
          : cpMatch ? parseInt(cpMatch[1]) : 0;
        // Keep the highest score seen for each move (deepest iteration)
        if (!scores.has(uci) || score > scores.get(uci)) {
          scores.set(uci, score);
        }
      }
    }

    // Analysis complete
    if (line.startsWith("bestmove")) {
      const result = new Map(scores);
      queryResolve(result);
      queryResolve = null;
      scores = null;
    }
  };
  worker.postMessage("uci");
}

// Given a FEN and a list of candidate UCI moves, picks the one whose
// resulting position is closest to 0cp (most balanced — prevents snowballing).
export async function pickBalanced(fen, candidates) {
  if (candidates.length <= 1) return candidates[0] ?? null;

  ensureWorker();
  try { await initPromise; } catch { return candidates[0]; }

  return Promise.race([
    new Promise((resolve) => {
      scores = new Map();
      queryResolve = (results) => {
        const best = [...candidates].sort((a, b) => {
          const sa = Math.abs(results.get(a) ?? 99999);
          const sb = Math.abs(results.get(b) ?? 99999);
          return sa - sb; // ascending |score| → closest to 0 first
        });
        resolve(best[0]);
      };
      worker.postMessage("setoption name MultiPV value 20");
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage("go movetime 100");
    }),
    new Promise((resolve) => setTimeout(() => resolve(candidates[0]), 2000)),
  ]);
}

// Given a FEN and a list of candidate UCI moves, returns them sorted by
// Stockfish centipawn score — best move first.
// Falls back to input order for moves Stockfish didn't rank.
export async function rankCandidates(fen, candidates) {
  if (candidates.length <= 1) return [...candidates];

  ensureWorker();
  try { await initPromise; } catch { return [...candidates]; }

  return Promise.race([
    new Promise((resolve) => {
      scores = new Map();
      queryResolve = (results) => {
        const ranked = [...candidates].sort((a, b) => {
          const sa = results.get(a) ?? -99999;
          const sb = results.get(b) ?? -99999;
          return sb - sa;
        });
        resolve(ranked);
      };

      // Ask for top 20 moves so most/all candidates get scored
      worker.postMessage("setoption name MultiPV value 20");
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage("go movetime 100"); // 100ms — fast enough for a live game
    }),
    new Promise((resolve) => setTimeout(() => resolve([...candidates]), 2000)),
  ]);
}
