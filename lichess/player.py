import asyncio
import chess
import chess.engine

from steg.crypto import encrypt
from steg.quality import (
    capacity_bits,
    get_sorted_moves,
    ENCODING_BITS,
    PREAMBLE_MOVES,
    PREAMBLE_LENGTH,
)
from lichess.api import (
    create_ai_game,
    make_move,
    stream_game,
    resign_game,
    challenge_user,
    stream_account_events,
)

STOCKFISH_PATH = "stockfish"


def _bytes_to_bits(data: bytes) -> str:
    return "".join(f"{b:08b}" for b in data)


async def _open_engine():
    try:
        _, engine = await chess.engine.popen_uci(STOCKFISH_PATH)
        return engine
    except Exception:
        return None  # Stockfish not installed — skip quality ranking


async def _rank_candidates(
    engine, board: chess.Board, candidates: list[chess.Move]
) -> list[chess.Move]:
    if not engine or len(candidates) <= 1:
        return candidates
    try:
        multipv = min(20, sum(1 for _ in board.legal_moves))
        info_list = await asyncio.wait_for(
            engine.analyse(board, chess.engine.Limit(time=0.1), multipv=multipv),
            timeout=2.0,
        )
        if isinstance(info_list, dict):
            info_list = [info_list]
        scored: dict[chess.Move, int] = {}
        for info in info_list:
            pv = info.get("pv", [])
            if pv:
                scored[pv[0]] = info["score"].relative.score(mate_score=100_000) or 0
        return sorted(candidates, key=lambda m: -(scored.get(m, -99_999)))
    except Exception:
        return candidates


# ─── StegSession ─────────────────────────────────────────────────────────────

class StegSession:
    def __init__(self, all_bits: str):
        self.all_bits = all_bits
        self.bit_index = 0
        self.board = chess.Board()
        self._white_move_count = 0

    @property
    def preamble_done(self) -> bool:
        return self._white_move_count >= PREAMBLE_LENGTH

    @property
    def is_done(self) -> bool:
        return self.preamble_done and self.bit_index >= len(self.all_bits)

    @property
    def progress(self) -> float:
        if not self.preamble_done:
            return 0.0
        if not self.all_bits:
            return 1.0
        return self.bit_index / len(self.all_bits)

    def record_white_move(self):
        self._white_move_count += 1

    async def next_encoding_move(self, engine) -> dict | None:
        # Play fixed preamble moves before encoding begins
        if not self.preamble_done:
            uci = PREAMBLE_MOVES[self._white_move_count]
            move = chess.Move.from_uci(uci)
            return {"san": self.board.san(move), "uci": uci}

        if self.is_done:
            return None

        moves = get_sorted_moves(self.board)
        if not moves or self.board.is_game_over():
            return None

        move_bits = capacity_bits(len(moves))

        if move_bits == 0:
            # Only one legal move — forced, encode 0 bits
            m = next((mv for mv in moves if not self.board.is_capture(mv)), moves[0])
            return {"san": self.board.san(m), "uci": m.uci()}

        patterns = 1 << move_bits
        remaining = len(self.all_bits) - self.bit_index
        bits_to_use = min(move_bits, remaining)
        b = int(
            self.all_bits[self.bit_index : self.bit_index + bits_to_use].ljust(
                move_bits, "0"
            ),
            2,
        )

        # All indices b, b+patterns, b+2*patterns … decode to the same bits
        candidates = []
        for idx in range(b, len(moves), patterns):
            m = moves[idx]
            temp = self.board.copy()
            temp.push(m)
            if not temp.is_checkmate():
                candidates.append(m)
        if not candidates:
            candidates = [moves[b]]

        # Prefer non-captures — avoids material swings that cause early resignation
        non_captures = [m for m in candidates if not self.board.is_capture(m)]
        if non_captures:
            candidates = non_captures

        # Let Stockfish pick the highest-quality candidate
        candidates = await _rank_candidates(engine, self.board, candidates)

        chosen = candidates[0]
        self.bit_index += bits_to_use
        return {"san": self.board.san(chosen), "uci": chosen.uci()}


# ─── Main entry point (async generator — yields events for the UI) ────────────

async def play_encoded_game(plaintext: str, password: str, opponent_username: str | None = None):
    cipher_bytes = encrypt(plaintext, password)
    all_bits = f"{len(cipher_bytes):08b}" + _bytes_to_bits(cipher_bytes)

    session = StegSession(all_bits)
    engine = await _open_engine()

    try:
        game_id: str | None = None

        if opponent_username:
            yield {"type": "challenging", "opponent": opponent_username}
            result = await challenge_user(opponent_username)
            game_id = (result.get("challenge") or result)["id"]
            yield {
                "type": "waiting",
                "gameId": game_id,
                "opponent": opponent_username,
                "url": f"https://lichess.org/{game_id}",
            }

            accept_result = "declined"
            try:
                async with asyncio.timeout(120):
                    async for event in stream_account_events():
                        if (
                            event.get("type") == "gameStart"
                            and event.get("game", {}).get("gameId") == game_id
                        ):
                            accept_result = "accepted"
                            break
                        if event.get("type") == "challengeDeclined":
                            break
            except TimeoutError:
                yield {"type": "timeout"}
                return

            if accept_result != "accepted":
                yield {"type": "declined", "opponent": opponent_username}
                return

            yield {"type": "started", "gameId": game_id, "url": f"https://lichess.org/{game_id}"}

        else:
            yield {"type": "creating"}
            game = await create_ai_game("white", 1)
            game_id = game["id"]
            yield {"type": "created", "gameId": game_id, "url": f"https://lichess.org/{game_id}"}

        white_moves: list[str] = []

        async for event in stream_game(game_id):
            if event["type"] not in ("gameFull", "gameState"):
                continue

            state = event.get("state", event) if event["type"] == "gameFull" else event
            server_moves = [m for m in state.get("moves", "").split() if m]

            # Rebuild board from server's authoritative move list
            rebuilt = chess.Board()
            for uci in server_moves:
                rebuilt.push(chess.Move.from_uci(uci))
            session.board = rebuilt

            if server_moves:
                yield {"type": "fen", "fen": rebuilt.fen()}

            is_white_turn = rebuilt.turn == chess.WHITE

            if is_white_turn and not rebuilt.is_game_over():
                if not session.is_done:
                    move = await session.next_encoding_move(engine)
                    if not move:
                        break

                    await make_move(game_id, move["uci"])
                    white_moves.append(move["san"])
                    session.record_white_move()
                    rebuilt.push(chess.Move.from_uci(move["uci"]))

                    yield {
                        "type": "move",
                        "move": move["san"],
                        "fen": rebuilt.fen(),
                        "moveNum": len(white_moves),
                        "progress": min(session.progress, 1.0),
                        "gameId": game_id,
                    }

                    if session.is_done:
                        yield {
                            "type": "encoded",
                            "gameId": game_id,
                            "url": f"https://lichess.org/{game_id}",
                            "whiteMoves": list(white_moves),
                        }
                else:
                    try:
                        await resign_game(game_id)
                    except Exception:
                        pass
                    yield {
                        "type": "done",
                        "status": "resign",
                        "gameId": game_id,
                        "url": f"https://lichess.org/{game_id}",
                        "whiteMoves": white_moves,
                    }
                    break

            elif not is_white_turn:
                yield {"type": "ai_thinking"}

            status = state.get("status")
            if status and status not in ("created", "started"):
                if not session.is_done:
                    yield {
                        "type": "incomplete",
                        "gameId": game_id,
                        "url": f"https://lichess.org/{game_id}",
                        "whiteMoves": white_moves,
                    }
                else:
                    yield {
                        "type": "done",
                        "status": status,
                        "gameId": game_id,
                        "url": f"https://lichess.org/{game_id}",
                        "whiteMoves": white_moves,
                    }
                break

    finally:
        if engine:
            try:
                await engine.quit()
            except Exception:
                pass
