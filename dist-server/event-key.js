/** Scope provider-native item/request IDs to their Cumea thread. */
export function threadEventPrefix(threadId) {
    return `${threadId.length}:${threadId}:`;
}
export function threadEventKey(threadId, nativeId) {
    return `${threadEventPrefix(threadId)}${nativeId}`;
}
