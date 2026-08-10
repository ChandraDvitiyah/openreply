type FacebookWebhookEntry = {
  id?: string;
  messaging?: Array<{
    sender?: { id?: string };
    recipient?: { id?: string };
    message?: { mid?: string; text?: string; is_echo?: boolean };
  }>;
  changes?: Array<{
    field?: string;
    value?: {
      item?: string;
      verb?: string;
      comment_id?: string;
      post_id?: string;
      message?: string;
      from?: { id?: string; name?: string };
    };
  }>;
};

type FacebookWebhookPayload = {
  object?: string;
  entry?: FacebookWebhookEntry[];
};

export type FacebookMessageEvent = {
  pageId: string;
  senderId: string;
  messageId: string;
  messageText: string;
};

export type FacebookCommentEvent = {
  pageId: string;
  senderId: string;
  senderName?: string;
  commentId: string;
  commentText: string;
  postId: string;
};

export function parseFacebookMessageEvents(
  payload: FacebookWebhookPayload
): FacebookMessageEvent[] {
  if (payload.object !== "page") return [];
  const events: FacebookMessageEvent[] = [];
  for (const entry of payload.entry ?? []) {
    if (!entry.id) continue;
    for (const messaging of entry.messaging ?? []) {
      const message = messaging.message;
      const senderId = messaging.sender?.id;
      if (
        !senderId ||
        senderId === entry.id ||
        !message?.mid ||
        !message.text ||
        message.is_echo
      ) {
        continue;
      }
      events.push({
        pageId: entry.id,
        senderId,
        messageId: message.mid,
        messageText: message.text,
      });
    }
  }
  return events;
}

export function parseFacebookCommentEvents(
  payload: FacebookWebhookPayload
): FacebookCommentEvent[] {
  if (payload.object !== "page") return [];
  const events: FacebookCommentEvent[] = [];
  for (const entry of payload.entry ?? []) {
    if (!entry.id) continue;
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (
        change.field !== "feed" ||
        value?.item !== "comment" ||
        value.verb !== "add" ||
        !value.comment_id ||
        !value.post_id ||
        !value.from?.id ||
        value.from.id === entry.id
      ) {
        continue;
      }
      events.push({
        pageId: entry.id,
        senderId: value.from.id,
        senderName: value.from.name,
        commentId: value.comment_id,
        commentText: value.message ?? "",
        postId: value.post_id,
      });
    }
  }
  return events;
}
