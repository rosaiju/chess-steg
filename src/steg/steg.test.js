import { describe, it, expect } from "vitest";
import { encodeMessage } from "./encoder.js";
import { decodeMessage } from "./decoder.js";

describe("Chess Steganography", () => {
  it("round-trips a short message", async () => {
    const message = "HELLO DR WANG";
    const password = "secret123";
    const { moves } = await encodeMessage(message, password);
    const decoded = await decodeMessage(moves, password);
    expect(decoded).toBe(message);
  });

  it("round-trips a longer message", async () => {
    const message = "This is a secret message hidden in chess moves!";
    const password = "demo-key-2026";
    const { moves } = await encodeMessage(message, password);
    const decoded = await decodeMessage(moves, password);
    expect(decoded).toBe(message);
  });

  it("fails to decode with wrong password", async () => {
    const { moves } = await encodeMessage("secret", "correct-password");
    await expect(decodeMessage(moves, "wrong-password")).rejects.toThrow();
  });
});
