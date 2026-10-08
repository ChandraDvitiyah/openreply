import { z } from "zod";
import { MAX_KEYWORDS } from "@/lib/constants";

export const createAutomationSchema = z
  .object({
    name: z.string().min(1).max(100),
    // Which trigger this campaign uses. Defaults to the original comment-to-DM
    // behaviour; DM_AUTORESPONDER replies to inbound DMs instead;
    // COMMENT_TO_COMMENT only posts a public reply (no DM, opening DM, or link).
    type: z
      .enum(["COMMENT_TO_DM", "DM_AUTORESPONDER", "COMMENT_TO_COMMENT"])
      .optional()
      .default("COMMENT_TO_DM"),
    goal: z.string().min(1).max(120).optional().nullable(),
    instagramAccountId: z.string().min(1).optional().nullable(),
    postId: z.string().min(1).optional().nullable(),
    postUrl: z.string().url().optional().nullable(),
    pendingNextReel: z.boolean().optional().default(false),
    matchAnyPost: z.boolean().optional().default(false),
    autoAddNewReels: z.boolean().optional().default(false),
    keywords: z
      .array(z.string().min(1).max(50))
      .max(MAX_KEYWORDS)
      .optional()
      .default([]),
    matchAnyWord: z.boolean().optional().default(false),
    // A comment-to-comment campaign carries no DM, so the DM text is optional
    // and only required for the other types (enforced by the refine below).
    dmMessage: z.string().max(1000).optional().default(""),
    dmMessages: z
      .array(z.string().max(1000))
      .max(10)
      .optional()
      .default([]),
    openingDmEnabled: z.boolean().optional().default(false),
    openingDmMessage: z.string().max(1000).optional().nullable(),
    openingDmButtonLabel: z.string().max(64).optional().nullable(),
    linkButtonLabel: z.string().max(20).optional().nullable(),
    publicReplyEnabled: z.boolean().optional().default(false),
    publicReplyMessage: z.string().max(1000).optional().nullable(),
    publicReplyMessages: z
      .array(z.string().max(1000))
      .max(10)
      .optional()
      .default([]),
    // Empty string means "no tracked link"; a URL sets one.
    trackedDestinationUrl: z
      .union([z.string().url(), z.literal("")])
      .optional()
      .nullable(),
    isActive: z.boolean().optional().default(true),
    wholeWordMatch: z.boolean().optional().default(true),
  })
  // A comment-to-DM campaign must target a specific post, any post, or the next
  // reel. DM auto-responders have no post trigger, so this rule doesn't apply.
  .refine(
    (d) =>
      d.type === "DM_AUTORESPONDER" ||
      d.matchAnyPost ||
      d.pendingNextReel ||
      d.autoAddNewReels ||
      Boolean(d.postId),
    { message: "Choose which post(s) trigger the campaign", path: ["postId"] }
  )
  // And it must match either specific words or any word.
  .refine((d) => d.matchAnyWord || d.keywords.length >= 1, {
    message: "Add at least one keyword, or match any word",
    path: ["keywords"],
  })
  // Every type except comment-to-comment delivers a DM, so it needs DM text.
  .refine(
    (d) =>
      d.type === "COMMENT_TO_COMMENT" ||
      d.dmMessage.trim().length > 0 ||
      d.dmMessages.some((m) => m.trim().length > 0),
    { message: "Add the DM message", path: ["dmMessage"] }
  )
  // A comment-to-comment campaign's only delivery is the public reply, so it
  // needs an enabled public reply with at least one message.
  .refine(
    (d) =>
      d.type !== "COMMENT_TO_COMMENT" ||
      Boolean(d.publicReplyMessage?.trim()) ||
      d.publicReplyMessages.some((m) => m.trim().length > 0),
    { message: "Add a public reply message", path: ["publicReplyMessages"] }
  )
  // An opening DM needs both a message and a button label.
  .refine(
    (d) =>
      !d.openingDmEnabled ||
      (Boolean(d.openingDmMessage?.trim()) &&
        Boolean(d.openingDmButtonLabel?.trim())),
    { message: "Opening DM needs a message and a button label", path: ["openingDmMessage"] }
  );

export const updateAutomationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z
    .enum(["COMMENT_TO_DM", "DM_AUTORESPONDER", "COMMENT_TO_COMMENT"])
    .optional(),
  goal: z.string().min(1).max(120).optional().nullable(),
  postId: z.string().min(1).optional().nullable(),
  postUrl: z.string().url().optional().nullable(),
  pendingNextReel: z.boolean().optional(),
  matchAnyPost: z.boolean().optional(),
  autoAddNewReels: z.boolean().optional(),
  keywords: z.array(z.string().min(1).max(50)).max(MAX_KEYWORDS).optional(),
  matchAnyWord: z.boolean().optional(),
  // Empty is allowed so a comment-to-comment campaign (which has no DM) can
  // clear the text; the client always sends real DM text for the other types.
  dmMessage: z.string().max(1000).optional(),
  dmMessages: z.array(z.string().max(1000)).max(10).optional(),
  openingDmEnabled: z.boolean().optional(),
  openingDmMessage: z.string().max(1000).optional().nullable(),
  openingDmButtonLabel: z.string().max(64).optional().nullable(),
  linkButtonLabel: z.string().max(20).optional().nullable(),
  publicReplyEnabled: z.boolean().optional(),
  publicReplyMessage: z.string().max(1000).optional().nullable(),
  publicReplyMessages: z.array(z.string().max(1000)).max(10).optional(),
  isActive: z.boolean().optional(),
  wholeWordMatch: z.boolean().optional(),
  reportShareEnabled: z.boolean().optional(),
  // Empty string clears the tracked link; a URL updates/creates it; undefined
  // leaves it unchanged.
  trackedDestinationUrl: z
    .union([z.string().url(), z.literal("")])
    .optional()
    .nullable(),
});
