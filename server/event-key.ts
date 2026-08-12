/** Scope provider-native item/request IDs to their Cumea thread. */
export function threadEventPrefix(threadId: string): string {
  return `${threadId.length}:${threadId}:`;
}

export function threadEventKey(threadId: string, nativeId: string): string {
  return `${threadEventPrefix(threadId)}${nativeId}`;
}
