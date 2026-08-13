/**
 * Resolve a capture, then commit it only if the caller's poller generation is
 * still current. The check deliberately runs after the asynchronous capture:
 * bot deletion or poller replacement can happen while the VM is responding.
 */
export async function commitCaptureIfCurrent(capture, isCurrent, commit) {
    const value = await capture();
    if (!isCurrent())
        return false;
    commit(value);
    return true;
}
