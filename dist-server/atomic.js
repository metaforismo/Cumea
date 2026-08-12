import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync, } from "node:fs";
import { dirname } from "node:path";
function syncParentDirectory(path) {
    let fd = null;
    try {
        fd = openSync(dirname(path), "r");
        fsyncSync(fd);
    }
    catch {
        // Directory fsync is not supported by every filesystem (notably on
        // Windows). The file itself has already been flushed and renamed.
    }
    finally {
        if (fd !== null) {
            try {
                closeSync(fd);
            }
            catch { }
        }
    }
}
/**
 * Replace a file without exposing a partially-written destination.
 *
 * The temporary file is unique even across concurrent writes in one
 * process, every byte is written explicitly, the file is flushed before
 * rename, and failed writes clean up their temporary file.
 */
export function writeFileAtomic(path, data, options = {}) {
    const mode = options.mode ?? 0o600;
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
    let fd = null;
    let renamed = false;
    try {
        fd = openSync(temp, "wx", mode);
        let offset = 0;
        while (offset < bytes.length) {
            const written = writeSync(fd, bytes, offset, bytes.length - offset);
            if (written <= 0)
                throw new Error(`atomic write made no progress for ${path}`);
            offset += written;
        }
        try {
            chmodSync(temp, mode);
        }
        catch (error) {
            if (process.platform !== "win32")
                throw error;
        }
        fsyncSync(fd);
        closeSync(fd);
        fd = null;
        renameSync(temp, path);
        renamed = true;
        syncParentDirectory(path);
    }
    catch (error) {
        if (fd !== null) {
            try {
                closeSync(fd);
            }
            catch { }
        }
        if (!renamed) {
            try {
                unlinkSync(temp);
            }
            catch { }
        }
        throw error;
    }
}
