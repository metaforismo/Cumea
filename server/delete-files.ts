import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";

export interface DeletionFile {
  path: string;
  label: string;
}

interface StagedFile extends DeletionFile {
  stagedPath: string;
}

export interface DeletionFileOperations {
  unlink: typeof unlinkSync;
}

export interface StagedFileDeletion {
  /** Permanently remove the quarantined bytes after metadata commits. */
  purge: () => void;
  /** Put every byte still in quarantine back at its original path. */
  rollback: () => void;
}

/** Finalize already-committed deletion quarantines independently.
 *
 * Once metadata no longer contains the bot, rollback is no longer a valid
 * outcome. A failed purge is retained as private staging garbage for later
 * maintenance; it must not prevent the remaining quarantines from purging or
 * tempt the caller to resurrect records whose bytes may already be gone. */
export function purgeCommittedFileDeletions(
  deletions: Array<StagedFileDeletion | null>,
  onError: (error: unknown) => void,
): void {
  for (const deletion of deletions) {
    if (!deletion) continue;
    try {
      deletion.purge();
    } catch (error) {
      onError(error);
    }
  }
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code;
}

function failure(message: string, cause: unknown): Error {
  return Object.assign(new Error(message), { status: 500, cause });
}

function removeEmptyDirectory(path: string): void {
  try {
    rmdirSync(path);
  } catch (error) {
    if (errno(error) !== "ENOENT") throw error;
  }
}

/**
 * Move files into a same-volume quarantine without deleting bytes.
 *
 * Record commits can safely run after this returns: any failure can rename
 * the quarantined files back. Expected deletion targets must be regular files;
 * directories and symlinks fail closed rather than being moved recursively.
 */
export function stageFilesForDeletion(
  candidates: DeletionFile[],
  operations: DeletionFileOperations = { unlink: unlinkSync },
): StagedFileDeletion {
  const unique = [...new Map(candidates.map((candidate) => [candidate.path, candidate])).values()];
  if (!unique.length) return { purge() {}, rollback() {} };

  const root = join(DATA_DIR, ".delete-staging");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const quarantine = mkdtempSync(join(root, "bot-"));
  const staged: StagedFile[] = [];

  try {
    for (const [index, candidate] of unique.entries()) {
      let stat;
      try {
        stat = lstatSync(candidate.path);
      } catch (error) {
        if (errno(error) === "ENOENT") continue;
        throw failure(`could not inspect bot ${candidate.label}`, error);
      }
      if (!stat.isFile()) {
        throw failure(`could not stage bot ${candidate.label}`, new Error("deletion target is not a regular file"));
      }
      const stagedPath = join(quarantine, `${index}.bin`);
      try {
        renameSync(candidate.path, stagedPath);
      } catch (error) {
        throw failure(`could not stage bot ${candidate.label}`, error);
      }
      staged.push({ ...candidate, stagedPath });
    }
  } catch (error) {
    const restoreErrors: unknown[] = [];
    for (const entry of [...staged].reverse()) {
      try {
        renameSync(entry.stagedPath, entry.path);
      } catch (restoreError) {
        restoreErrors.push(restoreError);
      }
    }
    try {
      removeEmptyDirectory(quarantine);
    } catch (cleanupError) {
      restoreErrors.push(cleanupError);
    }
    if (restoreErrors.length) {
      throw failure("could not stage bot files and restore the original files", new AggregateError([error, ...restoreErrors]));
    }
    throw error;
  }

  let settled = false;
  return {
    purge: () => {
      if (settled) return;
      try {
        for (const entry of staged) operations.unlink(entry.stagedPath);
        removeEmptyDirectory(quarantine);
        settled = true;
      } catch (error) {
        throw failure("could not finalize bot file deletion", error);
      }
    },
    rollback: () => {
      if (settled) return;
      const restoreErrors: unknown[] = [];
      for (const entry of [...staged].reverse()) {
        try {
          renameSync(entry.stagedPath, entry.path);
        } catch (error) {
          // A previous purge step may already have removed this file. Keep
          // restoring every remaining entry, then report the incomplete undo.
          restoreErrors.push(error);
        }
      }
      try {
        removeEmptyDirectory(quarantine);
      } catch (error) {
        restoreErrors.push(error);
      }
      if (restoreErrors.length) {
        throw failure("could not restore all bot files after deletion failed", new AggregateError(restoreErrors));
      }
      settled = true;
    },
  };
}
