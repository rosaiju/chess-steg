const BASE = "https://lichess.org";
const TOKEN = import.meta.env.VITE_LICHESS_TOKEN;

const authHeaders = {
  Authorization: `Bearer ${TOKEN}`,
};

// Challenge Lichess AI (level 1 = weakest)
export async function createAIGame(color = "white", level = 1) {
  const res = await fetch(`${BASE}/api/challenge/ai`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ level, color, days: 3 }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create game: ${res.status} ${text}`);
  }
  return res.json();
}

// Make a move in a game
export async function makeMove(gameId, move) {
  const res = await fetch(`${BASE}/api/board/game/${gameId}/move/${move}`, {
    method: "POST",
    headers: authHeaders,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Move failed (${move}): ${res.status} ${text}`);
  }
  return true;
}

// Stream game events as an async generator (NDJSON)
export async function* streamGame(gameId) {
  const res = await fetch(`${BASE}/api/board/game/stream/${gameId}`, {
    headers: authHeaders,
  });
  if (!res.ok) throw new Error(`Stream failed: ${res.status}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line);
    }
  }
}

// Fetch all moves for a completed/ongoing game, returned as UCI strings (e.g. "e2e4").
// Uses the Board API stream — same endpoint as encoding, CORS guaranteed.
// The gameFull event always arrives first with the full move history.
export async function fetchGameMoves(gameId) {
  for await (const event of streamGame(gameId)) {
    if (event.type === "gameFull") {
      return (event.state?.moves ?? "").split(" ").filter(Boolean);
    }
    if (event.type === "gameState") {
      return (event.moves ?? "").split(" ").filter(Boolean);
    }
  }
  return [];
}

// Extract gameId from a lichess.org URL or bare ID
export function parseGameId(input) {
  const trimmed = input.trim();
  const match = trimmed.match(/lichess\.org\/([a-zA-Z0-9]{8})/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9]{8}$/.test(trimmed)) return trimmed;
  throw new Error("Invalid Lichess URL or game ID");
}
