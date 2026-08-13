import { describe, expect, it, vi } from "vitest";

import { purgeCommittedFileDeletions } from "./delete-files.ts";

describe("committed deletion purge", () => {
  it("never rolls records back after purge starts and continues past a failed quarantine", () => {
    const first = { purge: vi.fn(() => { throw new Error("disk failure"); }), rollback: vi.fn() };
    const second = { purge: vi.fn(), rollback: vi.fn() };
    const errors: unknown[] = [];

    purgeCommittedFileDeletions([first, second], (error) => errors.push(error));

    expect(first.purge).toHaveBeenCalledOnce();
    expect(second.purge).toHaveBeenCalledOnce();
    expect(first.rollback).not.toHaveBeenCalled();
    expect(second.rollback).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
  });
});
