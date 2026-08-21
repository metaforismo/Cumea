import type { Message } from "@/state/store";

export interface PendingRequest {
  message: Message;
  requestId: string;
  requestType: "permission" | "question";
}

/**
 * Live provider requests on the visible conversation branch, oldest first.
 *
 * This is presentation ordering only. The server remains authoritative for
 * whether a response is current, allowed, and safe to remember.
 */
export function pendingRequests(messages: Message[]): PendingRequest[] {
  return messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => (
      message.kind === "options"
      && Boolean(message.card?.requestId)
      && !message.card?.answered
      && !message.card?.dismissed
    ))
    .sort((left, right) => left.message.at - right.message.at || left.index - right.index)
    .map(({ message }) => ({
      message,
      requestId: message.card!.requestId!,
      requestType: message.card!.requestType === "permission" ? "permission" : "question",
    }));
}

