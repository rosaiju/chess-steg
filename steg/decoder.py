import math
import chess
from steg.crypto import decrypt
from steg.quality import get_sorted_moves, capacity_bits, PREAMBLE_LENGTH


# ─── Shared helpers ──────────────────────────────────────────────────────────

def _bytes_to_bits(data: bytes) -> str:
    return "".join(f"{b:08b}" for b in data)


def _bits_to_bytes(bits: str) -> bytes:
    return bytes(int(bits[i : i + 8], 2) for i in range(0, len(bits) - 7, 8))


def _finish_decode(all_bits: str, password: str) -> str:
    if len(all_bits) < 8:
        raise ValueError("Too few moves to contain a message.")
    cipher_byte_len = int(all_bits[:8], 2)
    cipher_bits = all_bits[8 : 8 + cipher_byte_len * 8]
    if len(cipher_bits) < cipher_byte_len * 8:
        raise ValueError("Not enough moves to decode the full message.")
    cipher_bytes = _bits_to_bytes(cipher_bits)
    try:
        return decrypt(cipher_bytes, password)
    except Exception:
        raise ValueError("Wrong password or game URL")


# ─── Simple decoder (alphabetical SAN sort — matches encoder.py, for tests) ──

def _simple_capacity(n: int) -> int:
    if n < 2:
        return 0
    return int(math.log2(n))


def _sorted_san_moves(board: chess.Board) -> list[str]:
    return sorted(board.san(m) for m in board.legal_moves)


def decode_message(moves: list[str], password: str) -> str:
    """Decode SAN move list encoded with encoder.py (alphabetical sort)."""
    board = chess.Board()
    all_bits = ""

    for san in moves:
        legal = _sorted_san_moves(board)
        cap = _simple_capacity(len(legal))
        if cap > 0:
            idx = legal.index(san)
            all_bits += f"{idx:0{cap}b}"
        board.push_san(san)

    return _finish_decode(all_bits, password)


# ─── Lichess decoder (quality sort — matches lichess/player.py exactly) ───────

async def decode_from_game_id(game_id: str, password: str, on_move=None) -> str:
    from lichess.api import fetch_game_moves
    moves = await fetch_game_moves(game_id)
    return await decode_from_moves(moves, password, on_move)


async def decode_from_moves(all_moves: list[str], password: str, on_move=None) -> str:
    """Decode UCI move list fetched from the Lichess Board API stream."""
    board = chess.Board()
    all_bits = ""
    white_move = 0
    white_move_total = 0

    for i, uci in enumerate(all_moves):
        is_white = i % 2 == 0

        if is_white:
            white_move_total += 1
            if white_move_total > PREAMBLE_LENGTH:
                sorted_moves = get_sorted_moves(board)
                move_bits = capacity_bits(len(sorted_moves))

                if move_bits > 0:
                    patterns = 1 << move_bits
                    move_obj = chess.Move.from_uci(uci)
                    move_index = next(
                        (j for j, m in enumerate(sorted_moves) if m == move_obj), -1
                    )
                    if move_index == -1:
                        raise ValueError(f"Illegal White move: {uci}")

                    encoded = move_index % patterns
                    bits = f"{encoded:0{move_bits}b}"
                    all_bits += bits
                    white_move += 1

                    if on_move:
                        on_move({
                            "move_num": white_move,
                            "uci": uci,
                            "index": encoded,
                            "bits": bits,
                        })

        board.push(chess.Move.from_uci(uci))

        # Early exit once we have enough bits
        if len(all_bits) >= 8:
            cipher_byte_len = int(all_bits[:8], 2)
            if len(all_bits) >= 8 + cipher_byte_len * 8:
                break

    return _finish_decode(all_bits, password)
