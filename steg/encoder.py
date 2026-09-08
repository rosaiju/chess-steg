# Simple encoder — alphabetical SAN sort, used for unit tests only.
# The real Lichess encoder lives in lichess/player.py (quality sort + Stockfish).

import math
import chess
from steg.crypto import encrypt


def _bytes_to_bits(data: bytes) -> str:
    return "".join(f"{b:08b}" for b in data)


def _capacity_bits(n: int) -> int:
    if n < 2:
        return 0
    return int(math.log2(n))


def _sorted_san_moves(board: chess.Board) -> list[str]:
    return sorted(board.san(m) for m in board.legal_moves)


def encode_message(plaintext: str, password: str) -> dict:
    cipher_bytes = encrypt(plaintext, password)
    cipher_bits = _bytes_to_bits(cipher_bytes)
    len_bits = f"{len(cipher_bytes):08b}"
    all_bits = len_bits + cipher_bits

    board = chess.Board()
    encoded_moves: list[str] = []
    bit_index = 0

    while bit_index < len(all_bits):
        legal = _sorted_san_moves(board)
        if not legal or board.is_game_over():
            raise RuntimeError(
                f"Game ended at bit {bit_index}/{len(all_bits)}. Message too long."
            )

        cap = _capacity_bits(len(legal))
        if cap == 0:
            board.push_san(legal[0])
            encoded_moves.append(legal[0])
            continue

        remaining = len(all_bits) - bit_index
        bits_to_use = min(cap, remaining)
        chunk = all_bits[bit_index : bit_index + bits_to_use].ljust(cap, "0")
        move_index = int(chunk, 2)

        chosen = legal[move_index]
        board.push_san(chosen)
        encoded_moves.append(chosen)
        bit_index += bits_to_use

    return {"moves": encoded_moves, "pgn": board.epd()}
