import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockPrisma,
  mockSendPrivateReply,
  mockSendPrivateReplyWithLinkButton,
  mockSendDirectMessage,
  mockSendDirectMessageWithLinkButton,
  mockSendCommentReply,
  mockDecryptToken,
  mockMatchKeywords,
  mockReserveDMSlot,
  mockQueueAdd,
  mockReserveWorkspaceDMSend,
  mockReleaseWorkspaceDMReservation,
} = vi.hoisted(() => ({
  mockPrisma: {
    automation: {
      findMany: vi.fn(),
    },
    dmLog: {
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    instagramAccount: {
      findUnique: vi.fn(),
    },
    operationalEvent: {
      create: vi.fn(),
    },
  },
  mockSendPrivateReply: vi.fn(),
  mockSendPrivateReplyWithLinkButton: vi.fn(),
  mockSendDirectMessage: vi.fn(),
  mockSendDirectMessageWithLinkButton: vi.fn(),
  mockSendCommentReply: vi.fn(),
  mockDecryptToken: vi.fn(),
  mockMatchKeywords: vi.fn(),
  mockReserveDMSlot: vi.fn(),
  mockQueueAdd: vi.fn(),
  mockReserveWorkspaceDMSend: vi.fn(),
  mockReleaseWorkspaceDMReservation: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/meta/client", () => ({
  sendPrivateReply: mockSendPrivateReply,
  sendPrivateReplyWithLinkButton: mockSendPrivateReplyWithLinkButton,
  sendPrivateReplyWithButton: vi.fn(),
  sendDirectMessage: mockSendDirectMessage,
  sendDirectMessageWithLinkButton: mockSendDirectMessageWithLinkButton,
  sendCommentReply: mockSendCommentReply,
  MetaApiError: class MetaApiError extends Error {
    code: number;
    constructor(
      code: number,
      _subcode: number | undefined,
      _fbTraceId: string | undefined,
      message: string
    ) {
      super(message);
      this.code = code;
      this.name = "MetaApiError";
    }
  },
}));

vi.mock("@/lib/meta/oauth", () => ({
  decryptToken: mockDecryptToken,
}));

vi.mock("@/lib/utils/keyword-matcher", () => ({
  matchKeywords: mockMatchKeywords,
}));

vi.mock("@/lib/utils/rate-limiter", () => ({
  reserveDMSlot: mockReserveDMSlot,
}));

vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: mockReserveWorkspaceDMSend,
  releaseWorkspaceDMReservation: mockReleaseWorkspaceDMReservation,
}));

vi.mock("@/lib/ops/worker-health", () => ({
  recordWorkerAlert: vi.fn(),
}));

vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({
    add: mockQueueAdd,
  }),
  getRedisConnection: vi.fn(),
  POSTBACK_JOB_NAME: "process-postback",
  INBOUND_DM_JOB_NAME: "process-inbound-dm",
  FACEBOOK_MESSAGE_JOB_NAME: "process-facebook-message",
  FACEBOOK_COMMENT_JOB_NAME: "process-facebook-comment",
}));

vi.mock("bullmq", () => {
  function MockWorker(_name: string, processor: unknown) {
    (global as Record<string, unknown>).__dmWorkerProcessor = processor;
    return {
      on: vi.fn(),
      close: vi.fn(),
    };
  }
  return {
    Worker: MockWorker,
  };
});

import { createDMWorker } from "../lib/queue/dm-worker";

const usagePeriodStart = new Date("2026-05-01T00:00:00.000Z");

const mockAutomation = {
  id: "auto_789",
  workspaceId: "workspace_123",
  instagramAccountId: "ig_account_row_1",
  postId: "media_101",
  keywords: ["LINK", "PRICE"],
  dmMessage: "Hey {username}! Here is the link: https://example.com",
  isActive: true,
  wholeWordMatch: true,
  matchAnyPost: false,
  matchAnyWord: false,
  openingDmEnabled: false,
  openingDmMessage: null,
  openingDmButtonLabel: null,
  linkButtonLabel: null,
  publicReplyEnabled: false,
  publicReplyMessage: null,
  publicReplyMessages: [],
  instagramAccount: {
    id: "ig_account_row_1",
    instagramId: "ig_456",
    accessToken: "encrypted_token_abc",
  },
  workspace: {
    id: "workspace_123",
  },
  trackedLinks: [],
};

const mockJobData = {
  instagramAccountId: "ig_456",
  commentId: "comment_555",
  commentText: "I want the LINK!",
  commenterId: "commenter_999",
  commenterName: "commenter_user",
  mediaId: "media_101",
};

function getProcessor(): (job: {
  data: typeof mockJobData;
  id: string;
  attemptsMade: number;
}) => Promise<void> {
  createDMWorker();
  return (global as Record<string, unknown>).__dmWorkerProcessor as (job: {
    data: typeof mockJobData;
    id: string;
    attemptsMade: number;
  }) => Promise<void>;
}

function createMockJob(data = mockJobData) {
  return {
    data,
    id: "job_001",
    attemptsMade: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockPrisma.automation.findMany.mockResolvedValue([mockAutomation]);
  mockPrisma.dmLog.findUnique.mockResolvedValue(null);
  mockPrisma.dmLog.create.mockResolvedValue({});
  mockPrisma.dmLog.upsert.mockResolvedValue({});
  mockPrisma.dmLog.update.mockResolvedValue({});
  mockPrisma.instagramAccount.findUnique.mockResolvedValue({
    workspaceId: "workspace_123",
  });
  mockPrisma.operationalEvent.create.mockResolvedValue({});
  mockDecryptToken.mockReturnValue("decrypted_token");
  mockMatchKeywords.mockReturnValue({ matched: true, matchedKeyword: "LINK" });
  mockReserveWorkspaceDMSend.mockResolvedValue({
    allowed: true,
    reserved: true,
    remaining: 100,
    limit: 2000,
    periodStart: usagePeriodStart,
  });
  mockReserveDMSlot.mockResolvedValue({
    allowed: true,
    currentCount: 11,
    remainingDMs: 179,
    shouldRequeue: false,
    requeueDelayMs: 0,
    shouldSkip: false,
    reserved: true,
  });
  mockReleaseWorkspaceDMReservation.mockResolvedValue({ count: 1 });
  mockSendPrivateReply.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_001",
  });
  mockSendPrivateReplyWithLinkButton.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_002",
  });
  mockSendDirectMessage.mockResolvedValue({
    recipient_id: "dm_sender_1",
    message_id: "msg_003",
  });
  mockSendDirectMessageWithLinkButton.mockResolvedValue({
    recipient_id: "dm_sender_1",
    message_id: "msg_004",
  });
  mockSendCommentReply.mockResolvedValue({ id: "comment_reply_1" });
});

describe("DM Worker — Full Pipeline", () => {
  it("should send a private reply for a matching comment", async () => {
    const processor = getProcessor();

    await processor(createMockJob());

    expect(mockPrisma.automation.findMany).toHaveBeenCalledWith({
      where: {
        type: { in: ["COMMENT_TO_DM", "COMMENT_TO_COMMENT"] },
        OR: [
          { postId: "media_101" },
          { matchAnyPost: true },
          {
            autoAddNewReels: true,
            mediaTargets: { some: { mediaId: "media_101" } },
          },
        ],
        isActive: true,
        instagramAccount: { instagramId: "ig_456" },
      },
      include: {
        instagramAccount: true,
        workspace: true,
        trackedLinks: {
          select: {
            slug: true,
            destinationUrl: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    expect(mockMatchKeywords).toHaveBeenCalledWith(
      "I want the LINK!",
      ["LINK", "PRICE"],
      true
    );
    expect(mockReserveWorkspaceDMSend).toHaveBeenCalledWith("workspace_123");
    expect(mockReserveDMSlot).toHaveBeenCalledWith("ig_456", 0);
    expect(mockDecryptToken).toHaveBeenCalledWith("encrypted_token_abc");
    expect(mockSendPrivateReply).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      "Hey commenter_user! Here is the link: https://example.com"
    );
    expect(mockReleaseWorkspaceDMReservation).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith({
      where: {
        automationId_commentId: {
          automationId: "auto_789",
          commentId: "comment_555",
        },
      },
      data: expect.objectContaining({ status: "SENT" }),
    });
  });

  it("should skip when no automations match the media", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    const processor = getProcessor();

    await processor(createMockJob());

    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.upsert).not.toHaveBeenCalled();
  });

  it("should skip when keywords do not match", async () => {
    mockMatchKeywords.mockReturnValue({ matched: false, matchedKeyword: null });
    const processor = getProcessor();

    await processor(createMockJob());

    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
  });

  it("should skip duplicate comments already sent", async () => {
    mockPrisma.dmLog.findUnique.mockResolvedValue({
      id: "existing_log",
      status: "SENT",
    });
    const processor = getProcessor();

    await processor(createMockJob());

    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
  });

  it("should skip when monthly plan limit is reached", async () => {
    mockReserveWorkspaceDMSend.mockResolvedValue({
      allowed: false,
      reserved: false,
      remaining: 0,
      limit: 100,
      periodStart: usagePeriodStart,
    });

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockReserveDMSlot).not.toHaveBeenCalled();
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SKIPPED_PLAN_LIMIT" }),
      })
    );
  });

  it("should requeue and release monthly usage when rate limited", async () => {
    mockReserveDMSlot.mockResolvedValue({
      allowed: false,
      currentCount: 190,
      remainingDMs: 0,
      shouldRequeue: true,
      requeueDelayMs: 1800000,
      shouldSkip: false,
      reserved: false,
    });

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockReleaseWorkspaceDMReservation).toHaveBeenCalledWith(
      "workspace_123",
      usagePeriodStart
    );
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-comment",
      expect.objectContaining({
        commentId: "comment_555",
        requeueAttempt: 1,
      }),
      expect.objectContaining({
        delay: 1800000,
        jobId: "comment_ig_456_comment_555_retry_1",
      })
    );
  });

  it("should skip with SKIPPED_RATE_LIMIT after max requeue attempts", async () => {
    mockReserveDMSlot.mockResolvedValue({
      allowed: false,
      currentCount: 190,
      remainingDMs: 0,
      shouldRequeue: false,
      requeueDelayMs: 0,
      shouldSkip: true,
      reserved: false,
    });

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockReleaseWorkspaceDMReservation).toHaveBeenCalledWith(
      "workspace_123",
      usagePeriodStart
    );
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SKIPPED_RATE_LIMIT" }),
      })
    );
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
  });

  it("should log FAILED, release usage, and re-throw when private reply sending fails", async () => {
    const error = new Error("API Error");
    mockSendPrivateReply.mockRejectedValue(error);

    const processor = getProcessor();

    await expect(processor(createMockJob())).rejects.toThrow("API Error");
    expect(mockReleaseWorkspaceDMReservation).toHaveBeenCalledWith(
      "workspace_123",
      usagePeriodStart
    );
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith({
      where: {
        automationId_commentId: {
          automationId: "auto_789",
          commentId: "comment_555",
        },
      },
      data: expect.objectContaining({
        status: "FAILED",
        errorMessage: "API Error",
      }),
    });
  });

  it("should handle missing access token", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...mockAutomation,
        instagramAccount: {
          ...mockAutomation.instagramAccount,
          accessToken: null,
        },
      },
    ]);

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        }),
      })
    );
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
  });

  it("should use 'there' when commenter name is not available", async () => {
    const processor = getProcessor();
    const jobDataWithoutName = {
      instagramAccountId: mockJobData.instagramAccountId,
      commentId: mockJobData.commentId,
      commentText: mockJobData.commentText,
      commenterId: mockJobData.commenterId,
      mediaId: mockJobData.mediaId,
    };

    await processor(createMockJob(jobDataWithoutName as typeof mockJobData));

    expect(mockSendPrivateReply).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      "Hey there! Here is the link: https://example.com"
    );
  });

  it("should deliver tracked links as a web_url button", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...mockAutomation,
        dmMessage: "Hey {username}! Here is the offer: {link}",
        linkButtonLabel: "Get offer",
        trackedLinks: [
          {
            slug: "abc123",
            destinationUrl: "https://example.com",
          },
        ],
      },
    ]);

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockSendPrivateReplyWithLinkButton).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      "Hey commenter_user! Here is the offer:",
      "Get offer",
      "http://localhost:3000/r/abc123"
    );
  });
});

describe("DM Worker — Comment to Comment", () => {
  const commentOnly = {
    ...mockAutomation,
    type: "COMMENT_TO_COMMENT" as const,
    publicReplyEnabled: true,
    publicReplyMessages: ["Thanks for the comment!"],
    publicReplyMessage: null,
    // A comment-to-comment campaign has no DM.
    dmMessage: "",
    dmMessages: [],
  };

  beforeEach(() => {
    mockPrisma.automation.findMany.mockResolvedValue([commentOnly]);
  });

  it("posts the public reply and never sends a DM", async () => {
    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockSendCommentReply).toHaveBeenCalledWith(
      "decrypted_token",
      "comment_555",
      "Thanks for the comment!"
    );
    // No DM leg: no quota/rate-limit reservation and no private reply.
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
    expect(mockReserveDMSlot).not.toHaveBeenCalled();
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    // The log is marked SENT off the back of the public reply.
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          publicReplySentAt: expect.any(Date),
          status: "SENT",
        }),
      })
    );
  });

  it("skips once the public reply has already been posted", async () => {
    mockPrisma.dmLog.findUnique.mockResolvedValue({
      id: "existing_log",
      status: "SENT",
      publicReplySentAt: new Date(),
    });
    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockSendCommentReply).not.toHaveBeenCalled();
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
  });

  it("marks the log FAILED and re-throws when the public reply fails", async () => {
    const error = new Error("Reply API Error");
    mockSendCommentReply.mockRejectedValue(error);

    const processor = getProcessor();
    await expect(processor(createMockJob())).rejects.toThrow("Reply API Error");

    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          publicReplyError: "Reply API Error",
        }),
      })
    );
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
  });
});

describe("DM Worker — DM Auto-Responder", () => {
  const inboundJobData = {
    instagramAccountId: "ig_456",
    senderId: "dm_sender_1",
    messageId: "mid_abc",
    messageText: "can I get the LINK?",
  };

  const autoresponder = {
    ...mockAutomation,
    type: "DM_AUTORESPONDER" as const,
    postId: null,
    matchAnyPost: false,
    dmMessage: "Sure! Here you go: https://example.com",
  };

  function createInboundJob(data = inboundJobData) {
    return {
      data,
      id: "job_dm_001",
      name: "process-inbound-dm",
      attemptsMade: 0,
    };
  }

  function getInboundProcessor(): (job: ReturnType<typeof createInboundJob>) => Promise<void> {
    createDMWorker();
    return (global as Record<string, unknown>).__dmWorkerProcessor as (
      job: ReturnType<typeof createInboundJob>
    ) => Promise<void>;
  }

  beforeEach(() => {
    mockPrisma.automation.findMany.mockResolvedValue([autoresponder]);
  });

  it("queries only DM_AUTORESPONDER campaigns and replies to the sender", async () => {
    const processor = getInboundProcessor();
    await processor(createInboundJob());

    expect(mockPrisma.automation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: "DM_AUTORESPONDER",
          isActive: true,
          instagramAccount: { instagramId: "ig_456" },
        }),
      })
    );
    expect(mockMatchKeywords).toHaveBeenCalledWith(
      "can I get the LINK?",
      ["LINK", "PRICE"],
      true
    );
    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "dm_sender_1",
      "Sure! Here you go: https://example.com"
    );
    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          automationId_commentId: {
            automationId: "auto_789",
            commentId: "dm:mid_abc",
          },
        },
        update: expect.objectContaining({ status: "SENT" }),
      })
    );
  });

  it("skips a message that was already responded to", async () => {
    mockPrisma.dmLog.findUnique.mockResolvedValue({
      id: "existing",
      status: "SENT",
    });
    const processor = getInboundProcessor();
    await processor(createInboundJob());

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
  });

  it("does not reply when keywords do not match", async () => {
    mockMatchKeywords.mockReturnValue({ matched: false, matchedKeyword: null });
    const processor = getInboundProcessor();
    await processor(createInboundJob());

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
  });

  it("delivers a tracked link as a web_url button", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...autoresponder,
        dmMessage: "Grab it here: {link}",
        linkButtonLabel: "Open",
        trackedLinks: [{ slug: "xyz789", destinationUrl: "https://example.com" }],
      },
    ]);
    const processor = getInboundProcessor();
    await processor(createInboundJob());

    expect(mockSendDirectMessageWithLinkButton).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "dm_sender_1",
      "Grab it here:",
      "Open",
      "http://localhost:3000/r/xyz789"
    );
  });

  it("skips with SKIPPED_PLAN_LIMIT when the monthly limit is reached", async () => {
    mockReserveWorkspaceDMSend.mockResolvedValue({
      allowed: false,
      reserved: false,
      remaining: 0,
      limit: 100,
      periodStart: usagePeriodStart,
    });
    const processor = getInboundProcessor();
    await processor(createInboundJob());

    expect(mockReserveDMSlot).not.toHaveBeenCalled();
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "SKIPPED_PLAN_LIMIT" }),
      })
    );
  });
});
