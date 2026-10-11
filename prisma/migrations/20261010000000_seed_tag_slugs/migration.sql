-- 仅修复精确匹配旧seed默认名/slug的记录；保留ID/关联，不覆盖同名自定义slug。
DO $$
DECLARE
  item RECORD;
  chosen TEXT;
  suffix INTEGER;
  repaired TEXT[] := ARRAY[]::TEXT[];
BEGIN
  FOR item IN
    SELECT t.id, defaults.slug AS preferred
    FROM tags t
    JOIN (VALUES ('性能', 'performance'), ('工程化', 'engineering'), ('重构', 'refactoring'))
      AS defaults(name, slug) ON t.name = defaults.name AND t.slug = defaults.name
    ORDER BY t.id FOR UPDATE OF t
  LOOP
    chosen := item.preferred;
    suffix := 0;
    WHILE EXISTS (SELECT 1 FROM tags WHERE slug = chosen AND id <> item.id) LOOP
      suffix := suffix + 1;
      chosen := item.preferred || '-seed-' || suffix::TEXT;
    END LOOP;
    UPDATE tags SET slug = chosen, revision = revision + 1 WHERE id = item.id;
    repaired := array_append(repaired, item.id);
  END LOOP;
  -- 旧编辑快照不能在迁移后静默覆盖标签关系；每篇内容只递增一次。
  UPDATE articles SET revision = revision + 1, "updatedAt" = NOW()
    WHERE id IN (SELECT "A" FROM "_ArticleTags" WHERE "B" = ANY(repaired));
  UPDATE logs SET revision = revision + 1, "updatedAt" = NOW()
    WHERE id IN (SELECT "A" FROM "_LogTags" WHERE "B" = ANY(repaired));
  UPDATE projects SET revision = revision + 1, "updatedAt" = NOW()
    WHERE id IN (SELECT "A" FROM "_ProjectTags" WHERE "B" = ANY(repaired));
END $$;
