import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
// CLI 安全边界用真实文件系统验证，数据库演练另行记录。
import {
  localConnection,
  safeLocation,
  verifyBundle,
  makeManifest,
} from '../../scripts/local-backup.mjs'
const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'site-backup-'))
  roots.push(root)
  await mkdir(path.join(root, '.backups'))
  await mkdir(path.join(root, '.restore-test'))
  return root
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
test('拒绝远程数据库及非隔离恢复名', () => {
  expect(() => localConnection('postgresql://dev:secret@example.com:15432/personal_site')).toThrow()
  expect(() =>
    localConnection('postgresql://dev:secret@localhost:15432/personal_site', 'personal_site'),
  ).toThrow()
  expect(() =>
    localConnection('postgresql://dev:secret@localhost:15432/personal_site', 'another'),
  ).toThrow()
  expect(
    localConnection('postgresql://dev:secret@localhost:15432/personal_site', 'drill_restore_test')
      .target,
  ).toBe('drill_restore_test')
})
test('拒绝目录逃逸、已有恢复目录与符号链接', async () => {
  const root = await fixture()
  await expect(safeLocation(root, '.backups', '../escape')).rejects.toThrow()
  await mkdir(path.join(root, '.restore-test', 'used'))
  await expect(safeLocation(root, '.restore-test', 'used', true)).rejects.toThrow()
  await symlink(path.join(root, '.restore-test'), path.join(root, '.backups', 'link'), 'junction')
  await expect(safeLocation(root, '.backups', 'link')).rejects.toThrow()
})
test('清单校验发现损坏、额外文件及恶意路径，保持原文件', async () => {
  const root = await fixture()
  const dir = path.join(root, '.backups', 'good')
  await mkdir(dir)
  await writeFile(path.join(dir, 'database.dump'), 'PGDMP real fixture')
  await mkdir(path.join(dir, 'media'))
  await writeFile(path.join(dir, 'media', 'image.bin'), 'image')
  const manifest = await makeManifest(dir, {
    sourceDatabase: 'personal_site',
    tables: { Article: 3 },
    foreignKeys: 2,
  })
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
  expect((await verifyBundle(dir)).tables.Article).toBe(3)
  await writeFile(path.join(dir, 'media', 'image.bin'), 'bad')
  await expect(verifyBundle(dir)).rejects.toThrow()
  await writeFile(path.join(dir, 'media', 'image.bin'), 'image')
  await writeFile(path.join(dir, 'extra'), 'x')
  await expect(verifyBundle(dir)).rejects.toThrow()
  manifest.files[0].path = '../escape'
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
  await expect(verifyBundle(dir)).rejects.toThrow()
})

test('备份中的媒体符号链接不能通过校验', async () => {
  const root = await fixture()
  const dir = path.join(root, '.backups', 'linked')
  await mkdir(dir)
  await writeFile(path.join(dir, 'database.dump'), 'PGDMP fixture')
  const manifest = await makeManifest(dir, {
    sourceDatabase: 'personal_site',
    tables: { Article: 0 },
    foreignKeys: 0,
  })
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
  await symlink(path.join(root, '.restore-test'), path.join(dir, 'media'), 'junction')
  await expect(verifyBundle(dir)).rejects.toThrow('SYMLINK_REJECTED')
})
