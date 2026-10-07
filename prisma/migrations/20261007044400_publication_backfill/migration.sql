-- 补齐已有已发布记录的时间，不改草稿、未来计划或已有发布时间。
UPDATE "logs" SET "publishedAt" = "logDate" WHERE "status" = 'PUBLISHED' AND "publishedAt" IS NULL;
UPDATE "projects" SET "publishedAt" = "createdAt" WHERE "status" = 'PUBLISHED' AND "publishedAt" IS NULL;
