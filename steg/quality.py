# Shared move-quality sort used by BOTH the encoder (player.py) and decoder (decoder.py).
# Both sides must use this exact same ordering or bits will be extracted incorrectly.

import math
import chess

ENCODING_BITS = 5          # max bits per move (2^5 = 32 candidates)
PREAMBLE_LENGTH = 1        # number of fixed opening moves before encoding starts
PREAMBLE_MOVES = ["e2e4"]  # fixed preamble — decoder skips these

PIECE_VAL = {"p": 1, "n": 3, "b": 3, "r": 5, "q": 9}


def capacity_bits(n: int) -> int:
    """How many bits we can encode given n legal moves: floor(log2(n)), capped at ENCODING_BITS."""
    if n < 2:
        return 0
    return min(ENCODING_BITS, int(math.log2(n)))


def move_score(board: chess.Board, move: chess.Move) -> int:
    """Higher score = better move = lower list index after descending sort."""
    piece = board.piece_at(move.from_square)
    if piece is None:
        return 0

    captured = board.piece_at(move.to_square)
    s = 0

    # Captures go to the END of the list (low index = preferred encoding slots)
    if captured:
        s -= PIECE_VAL.get(captured.symbol().lower(), 0) * 100

    if move.promotion:
        s += PIECE_VAL.get(chess.piece_symbol(move.promotion), 0) * 50

    sym = piece.symbol().lower()
    from_rank = chess.square_rank(move.from_square)
    to_rank = chess.square_rank(move.to_square)

    # Rook/queen shuffling along the back rank
    if sym in ("r", "q") and from_rank == to_rank == 0:
        s -= 40

    # Non-castling king moves are extremely penalised
    if sym == "k" and not board.is_castling(move):
        s -= 10_000

    # Rim knights
    if sym == "n" and chess.square_file(move.to_square) in (0, 7):
        s -= 150

    # Pieces retreating to back rank
    if sym in ("n", "b", "q") and to_rank == 0:
        s -= 100

    return s


def quality_sort_key(board: chess.Board, move: chess.Move):
    """Sort key: descending score, then UCI for deterministic tiebreak."""
    return (-move_score(board, move), move.uci())


def get_sorted_moves(board: chess.Board) -> list[chess.Move]:
    """Return legal moves sorted by quality. Excludes non-castling king moves when possible."""
    moves = list(board.legal_moves)
    moves.sort(key=lambda m: quality_sort_key(board, m))

    def is_non_castling_king(m: chess.Move) -> bool:
        p = board.piece_at(m.from_square)
        return p is not None and p.piece_type == chess.KING and not board.is_castling(m)

    non_king = [m for m in moves if not is_non_castling_king(m)]
    return non_king if non_king else moves
