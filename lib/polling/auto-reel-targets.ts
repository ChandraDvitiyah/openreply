import { prisma } from "@/lib/db/client";
import { getUserMedia, type InstagramMedia } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";

export type AutoReelSyncResult = {
  campaignsChecked: number;
  reelsAttached: number;
  failedAccounts: string[];
};

function isReel(media: InstagramMedia) {
  return media.media_product_type === "REELS";
}

/**
 * Materialize every newly published reel for persistent "future reels" campaigns.
 * The worker calls this before comment reconciliation, so missed webhooks are
 * picked up on the same polling cycle after the reel target is attached.
 */
export async function syncAutoReelTargets(): Promise<AutoReelSyncResult> {
  const campaigns = await prisma.automation.findMany({
    where: {
      autoAddNewReels: true,
      isActive: true,
      type: { in: ["COMMENT_TO_DM", "COMMENT_TO_COMMENT"] },
    },
    include: {
      instagramAccount: true,
      mediaTargets: { select: { mediaId: true } },
    },
  });

  const byAccount = new Map<
    string,
    { account: (typeof campaigns)[number]["instagramAccount"]; campaigns: typeof campaigns }
  >();
  for (const campaign of campaigns) {
    const current = byAccount.get(campaign.instagramAccountId);
    if (current) current.campaigns.push(campaign);
    else {
      byAccount.set(campaign.instagramAccountId, {
        account: campaign.instagramAccount,
        campaigns: [campaign],
      });
    }
  }

  let reelsAttached = 0;
  const failedAccounts: string[] = [];

  for (const { account, campaigns: accountCampaigns } of byAccount.values()) {
    let reels: InstagramMedia[];
    try {
      const token = decryptToken(account.accessToken);
      reels = (await getUserMedia(token, 50)).filter(isReel);
    } catch (error) {
      failedAccounts.push(account.id);
      console.error("[auto-reels] media fetch failed", account.id, error);
      continue;
    }

    for (const campaign of accountCampaigns) {
      const since = campaign.autoAddReelsSince ?? campaign.createdAt;
      const known = new Set(campaign.mediaTargets.map((target) => target.mediaId));
      const fresh = reels.filter(
        (reel) => new Date(reel.timestamp) >= since && !known.has(reel.id)
      );
      if (fresh.length === 0) continue;

      const result = await prisma.automationMedia.createMany({
        data: fresh.map((reel) => ({
          automationId: campaign.id,
          mediaId: reel.id,
          mediaUrl: reel.permalink ?? null,
          publishedAt: new Date(reel.timestamp),
        })),
      });
      reelsAttached += result.count;
    }
  }

  return {
    campaignsChecked: campaigns.length,
    reelsAttached,
    failedAccounts,
  };
}
