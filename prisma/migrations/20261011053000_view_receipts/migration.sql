-- 保留旧路径统计，稳定身份避免改路径后分裂阅读量。
ALTER TABLE "daily_stats" ADD COLUMN "resource" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "daily_stats" ADD COLUMN "contentId" TEXT;
UPDATE "daily_stats" SET "contentId" = "path";
ALTER TABLE "daily_stats" ALTER COLUMN "contentId" SET NOT NULL;
DROP INDEX "daily_stats_date_path_key";
CREATE UNIQUE INDEX "daily_stats_date_resource_contentId_key" ON "daily_stats"("date", "resource", "contentId");
CREATE TABLE "view_receipts" (
  "resource" TEXT NOT NULL,
  "contentId" TEXT NOT NULL,
  "visitorHash" TEXT NOT NULL,
  "windowExpiresAt" TIMESTAMP(3) NOT NULL,
  "countedDate" DATE NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "view_receipts_pkey" PRIMARY KEY ("resource", "contentId", "visitorHash")
);
CREATE INDEX "view_receipts_updatedAt_idx" ON "view_receipts"("updatedAt");
