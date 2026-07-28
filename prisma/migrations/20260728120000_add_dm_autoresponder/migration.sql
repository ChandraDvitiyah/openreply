-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('COMMENT_TO_DM', 'DM_AUTORESPONDER');

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN "type" "CampaignType" NOT NULL DEFAULT 'COMMENT_TO_DM';
