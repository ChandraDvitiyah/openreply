import { z } from "zod";

export const facebookAutomationSchema = z.object({
  facebookPageId: z.string().min(1),
  type: z.enum(["MESSENGER_AUTORESPONDER", "COMMENT_TO_MESSAGE"]),
  name: z.string().trim().min(1).max(100),
  postId: z.string().trim().max(200).optional().nullable(),
  matchAnyPost: z.boolean().default(true),
  keywords: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  matchAnyWord: z.boolean().default(false),
  replyMessage: z.string().trim().min(1).max(2000),
  wholeWordMatch: z.boolean().default(true),
  isActive: z.boolean().default(true),
});
