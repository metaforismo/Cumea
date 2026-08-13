/**
 * Resolve a capture, then commit it only if the caller's poller generation is
 * still current. The check deliberately runs after the asynchronous capture:
 * bot deletion or poller replacement can happen while the VM is responding.
 */
export async function commitCaptureIfCurrent<T>(
  capture: () => Promise<T>,
  isCurrent: () => boolean,
  commit: (value: T) => void,
): Promise<boolean> {
  const value = await capture();
  if (!isCurrent()) return false;
  commit(value);
  return true;
}
