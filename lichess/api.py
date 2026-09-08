import json
import os
import re

import httpx

BASE = "https://lichess.org"
TOKEN = os.environ.get("LICHESS_TOKEN") or os.environ.get("VITE_LICHESS_TOKEN", "")


def _auth() -> dict:
    return {"Authorization": f"Bearer {TOKEN}"}


async def create_ai_game(color: str = "white", level: int = 1) -> dict:
    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"{BASE}/api/challenge/ai",
            headers={**_auth(), "Content-Type": "application/x-www-form-urlencoded"},
            data={"level": level, "color": color, "days": 3},
        )
        res.raise_for_status()
        return res.json()


async def make_move(game_id: str, move: str) -> bool:
    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"{BASE}/api/board/game/{game_id}/move/{move}",
            headers=_auth(),
        )
        if not res.is_success:
            raise RuntimeError(f"Move failed ({move}): {res.status_code} {res.text}")
        return True


async def stream_game(game_id: str):
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "GET", f"{BASE}/api/board/game/stream/{game_id}", headers=_auth()
        ) as res:
            res.raise_for_status()
            async for line in res.aiter_lines():
                if line.strip():
                    yield json.loads(line)


async def fetch_game_moves(game_id: str) -> list[str]:
    async for event in stream_game(game_id):
        if event["type"] == "gameFull":
            moves = event.get("state", {}).get("moves", "")
            return [m for m in moves.split() if m]
        if event["type"] == "gameState":
            moves = event.get("moves", "")
            return [m for m in moves.split() if m]
    return []


async def resign_game(game_id: str) -> bool:
    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"{BASE}/api/board/game/{game_id}/resign", headers=_auth()
        )
        return res.is_success


async def challenge_user(username: str) -> dict:
    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"{BASE}/api/challenge/{username}",
            headers={**_auth(), "Content-Type": "application/x-www-form-urlencoded"},
            data={
                "rated": "false",
                "clock.limit": 900,
                "clock.increment": 10,
                "color": "white",
            },
        )
        res.raise_for_status()
        return res.json()


async def stream_account_events():
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "GET", f"{BASE}/api/stream/event", headers=_auth()
        ) as res:
            res.raise_for_status()
            async for line in res.aiter_lines():
                if line.strip():
                    yield json.loads(line)


def parse_game_id(input_str: str) -> str:
    trimmed = input_str.strip()
    match = re.search(r"lichess\.org/([a-zA-Z0-9]{8})", trimmed)
    if match:
        return match.group(1)
    if re.fullmatch(r"[a-zA-Z0-9]{8}", trimmed):
        return trimmed
    raise ValueError("Invalid Lichess URL or game ID")
