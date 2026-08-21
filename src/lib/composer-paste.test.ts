import { describe, expect, it } from "vitest";
import {
  LONG_PASTE_MAX_BYTES,
  pastedTextBytes,
  pastedTextFile,
  shouldAttachPastedText,
} from "./composer-paste";

describe("composer paste extraction", () => {
  it("leaves ordinary prose in the composer", () => {
    expect(shouldAttachPastedText("A short note\nwith two lines.")).toBe(false);
  });

  it("extracts long prose or tall logs", () => {
    expect(shouldAttachPastedText("x".repeat(901))).toBe(true);
    expect(shouldAttachPastedText(Array.from({ length: 13 }, (_, index) => `line ${index}`).join("\n"))).toBe(true);
  });

  it("measures UTF-8 bytes and creates a plain-text upload", async () => {
    expect(pastedTextBytes("€")).toBe(3);
    expect(pastedTextBytes("x".repeat(LONG_PASTE_MAX_BYTES))).toBe(LONG_PASTE_MAX_BYTES);
    const file = pastedTextFile("hello", 2);
    expect(file.name).toBe("pasted-text-2.txt");
    expect(file.type).toBe("text/plain;charset=utf-8");
    expect(await file.text()).toBe("hello");
  });
});
