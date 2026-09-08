# AES-256-GCM encryption — matches the JS Web Crypto implementation exactly.
# IV is derived from the password (not transmitted), saving 12 bytes.
# Tag length is 32 bits (4 bytes) to match JS tagLength: 32.

from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend

TAG_BYTES = 4  # 32-bit tag — matches JS


def _derive_key(password: str) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"chess-steg-key",
        iterations=100_000,
    )
    return kdf.derive(password.encode("utf-8"))


def _derive_iv(password: str) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=12,
        salt=b"chess-steg-iv",
        iterations=1_000,
    )
    return kdf.derive(password.encode("utf-8"))


def encrypt(plaintext: str, password: str) -> bytes:
    key = _derive_key(password)
    iv = _derive_iv(password)
    encryptor = Cipher(
        algorithms.AES(key),
        modes.GCM(iv, min_tag_length=TAG_BYTES),
        backend=default_backend(),
    ).encryptor()
    ct = encryptor.update(plaintext.encode("utf-8")) + encryptor.finalize()
    return ct + encryptor.tag[:TAG_BYTES]


def decrypt(ciphertext: bytes, password: str) -> str:
    key = _derive_key(password)
    iv = _derive_iv(password)
    tag = ciphertext[-TAG_BYTES:]
    ct = ciphertext[:-TAG_BYTES]
    decryptor = Cipher(
        algorithms.AES(key),
        modes.GCM(iv, tag=tag, min_tag_length=TAG_BYTES),
        backend=default_backend(),
    ).decryptor()
    return (decryptor.update(ct) + decryptor.finalize()).decode("utf-8")
