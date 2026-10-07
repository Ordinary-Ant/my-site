-- 只修复仍完整等于旧seed的配置，后台已修改的顺序或其他字段保持不变。
UPDATE "modules"
SET "config" = jsonb_set("config", '{home,order}', '4'::jsonb), "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'log' AND "config" = '{"pageSize":10,"intro":"记录每天发生的事，以及偶尔的顿悟","emptyText":"还没有日志","home":{"enabled":true,"limit":5,"order":3},"defaultView":"list","types":{"DAILY":true,"EVENT":true,"SUMMARY":true}}'::jsonb;

UPDATE "modules"
SET "config" = jsonb_set("config", '{home,order}', '3'::jsonb), "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'article' AND "config" = '{"pageSize":10,"intro":"认真写的一些东西","emptyText":"还没有文章","home":{"enabled":true,"limit":5,"order":4},"showToc":true,"showViewCount":true,"relatedCount":3}'::jsonb;
