import { describe, expect, it } from "vitest";
import {
  parseFacebookCommentEvents,
  parseFacebookMessageEvents,
} from "@/lib/meta/facebook-webhook";

describe("Facebook Page webhooks", () => {
  it("parses an inbound Messenger message and ignores echoes", () => {
    const events = parseFacebookMessageEvents({
      object: "page",
      entry: [
        {
          id: "page-1",
          messaging: [
            {
              sender: { id: "person-1" },
              recipient: { id: "page-1" },
              message: { mid: "message-1", text: "PRICE please" },
            },
            {
              sender: { id: "page-1" },
              recipient: { id: "person-1" },
              message: { mid: "message-2", text: "Our reply", is_echo: true },
            },
          ],
        },
      ],
    });

    expect(events).toEqual([
      {
        pageId: "page-1",
        senderId: "person-1",
        messageId: "message-1",
        messageText: "PRICE please",
      },
    ]);
  });

  it("parses a newly added Page post comment", () => {
    const events = parseFacebookCommentEvents({
      object: "page",
      entry: [
        {
          id: "page-1",
          changes: [
            {
              field: "feed",
              value: {
                item: "comment",
                verb: "add",
                comment_id: "comment-1",
                post_id: "page-1_post-1",
                message: "Send the LINK",
                from: { id: "person-1", name: "Maya" },
              },
            },
          ],
        },
      ],
    });

    expect(events).toEqual([
      {
        pageId: "page-1",
        senderId: "person-1",
        senderName: "Maya",
        commentId: "comment-1",
        commentText: "Send the LINK",
        postId: "page-1_post-1",
      },
    ]);
  });

  it("ignores Instagram payloads", () => {
    expect(parseFacebookMessageEvents({ object: "instagram", entry: [] })).toEqual([]);
    expect(parseFacebookCommentEvents({ object: "instagram", entry: [] })).toEqual([]);
  });
});
