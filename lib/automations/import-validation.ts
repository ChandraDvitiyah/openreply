import { z } from "zod";
import { MAX_KEYWORDS } from "@/lib/constants";

const campaignSchema = z.object({
  postId: z.string().min(1),
  postUrl: z.string().optional().nullable(),
  keywords: z.array(z.string().min(1).max(50)).min(1).max(MAX_KEYWORDS),
  dmMessage: z.string().min(1).max(1000),
  name: z.string().max(100).optional().nullable(),
  goal: z.string().max(120).optional().nullable(),
  publicReplyMessage: z.string().max(1000).optional().nullable(),
  trackedUrl: z.string().optional().nullable(),
  wholeWordMatch: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),
});

export const importSchema = z.object({
  instagramAccountId: z.string().min(1),
  campaigns: z.array(campaignSchema).min(1).max(200),
});
