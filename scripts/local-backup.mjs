import fs from 'node:fs/promises'
import { createReadStream, openSync, closeSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}$/
function ensure(condition, code) {
  if (!condition) throw new Error(code)
}

/** 连接只用于本机固定 Docker 策略，凭据绝不写入清单或错误。 */
export function localConnection(value, target) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('INVALID_LOCAL_DATABASE')
  }
  const database = decodeURIComponent(url.pathname.slice(1))
  ensure(
    ['postgres:', 'postgresql:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      (url.port || '5432') === '15432',
    'LOCAL_DOCKER_15432_REQUIRED',
  )
  ensure(['personal_site', 'personal_site_test'].includes(database), 'SOURCE_DATABASE_REJECTED')
  if (target !== undefined)
    ensure(
      /^[a-z][a-z0-9_]{0,48}_restore_test$/.test(target) && target !== database,
      'ISOLATED_RESTORE_NAME_REQUIRED',
    )
  return {
    database,
    target,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  }
}

/** 从真实工作区逐层检查，拒绝 junction/symlink 与已存在目标。 */
export async function safeLocation(root, area, name, fresh = false) {
  ensure(
    ['.backups', '.restore-test'].includes(area) && namePattern.test(name),
    'UNSAFE_BACKUP_PATH',
  )
  const canonical = await fs.realpath(root)
  let current = canonical
  for (const segment of [area, name]) {
    current = path.join(current, segment)
    try {
      ensure(!(await fs.lstat(current)).isSymbolicLink(), 'SYMLINK_REJECTED')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  if (fresh) {
    try {
      await fs.lstat(current)
      throw new Error('TARGET_ALREADY_EXISTS')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return current
}
async function filesUnder(root, relative = '') {
  const files = []
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const file = path.join(relative, entry.name)
    ensure(!entry.isSymbolicLink(), 'SYMLINK_REJECTED')
    if (entry.isDirectory()) files.push(...(await filesUnder(root, file)))
    else {
      ensure(entry.isFile(), 'SPECIAL_FILE_REJECTED')
      files.push(file.split(path.sep).join('/'))
    }
  }
  return files.sort()
}
async function checksum(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
export async function makeManifest(dir, metadata) {
  const files = []
  for (const relative of await filesUnder(dir)) {
    if (relative === 'manifest.json') continue
    const file = path.join(dir, relative)
    files.push({ path: relative, size: (await fs.stat(file)).size, sha256: await checksum(file) })
  }
  return { version: 1, postgresMajor: 16, createdAt: new Date().toISOString(), ...metadata, files }
}
export async function verifyBundle(dir) {
  ensure(!(await fs.lstat(dir)).isSymbolicLink(), 'SYMLINK_REJECTED')
  const manifestPath = path.join(dir, 'manifest.json')
  ensure(!(await fs.lstat(manifestPath)).isSymbolicLink(), 'SYMLINK_REJECTED')
  const data = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  ensure(
    data.version === 1 &&
      data.postgresMajor === 16 &&
      ['personal_site', 'personal_site_test'].includes(data.sourceDatabase),
    'INVALID_MANIFEST',
  )
  ensure(
    data.tables &&
      Object.keys(data.tables).length > 0 &&
      Object.values(data.tables).every((n) => Number.isSafeInteger(n) && n >= 0) &&
      Number.isSafeInteger(data.foreignKeys) &&
      data.foreignKeys >= 0,
    'INVALID_TABLE_COUNTS',
  )
  ensure(
    Array.isArray(data.files) && data.files.some((file) => file.path === 'database.dump'),
    'DUMP_REQUIRED',
  )
  const seen = new Set()
  for (const file of data.files) {
    ensure(
      typeof file.path === 'string' &&
        !seen.has(file.path) &&
        (file.path === 'database.dump' || file.path.startsWith('media/')) &&
        !file.path.includes('\\') &&
        file.path
          .split('/')
          .every((part) => part && part !== '.' && part !== '..' && !part.includes(':')),
      'UNSAFE_MANIFEST_PATH',
    )
    seen.add(file.path)
    ensure(
      Number.isSafeInteger(file.size) && file.size >= 0 && /^[a-f0-9]{64}$/.test(file.sha256),
      'INVALID_FILE_HASH',
    )
  }
  const actual = (await filesUnder(dir)).filter((file) => file !== 'manifest.json')
  ensure(JSON.stringify(actual) === JSON.stringify([...seen].sort()), 'BUNDLE_FILE_SET_CHANGED')
  for (const file of data.files)
    ensure(
      (await fs.stat(path.join(dir, file.path))).size === file.size &&
        (await checksum(path.join(dir, file.path))) === file.sha256,
      'BUNDLE_CHECKSUM_MISMATCH',
    )
  return data
}

function processEnv(connection) {
  return {
    ...process.env,
    PGPASSWORD: connection.password,
    PGUSER: connection.user,
    PGHOST: '127.0.0.1',
    PGPORT: '5432',
    PGCONNECT_TIMEOUT: '5',
  }
}
function dockerArgs(tool, args) {
  return [
    'exec',
    '-i',
    '-e',
    'PGPASSWORD',
    '-e',
    'PGUSER',
    '-e',
    'PGHOST',
    '-e',
    'PGPORT',
    '-e',
    'PGCONNECT_TIMEOUT',
    'personal-site-db',
    tool,
    ...args,
  ]
}
/** 二进制输出直接写文件描述符，避免 PowerShell 文本管道损坏备份。 */
async function run(connection, tool, args, { input, output, capture = true } = {}) {
  const fd = output ? openSync(output, 'wx', 0o600) : undefined
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn('docker', dockerArgs(tool, args), {
        env: processEnv(connection),
        stdio: ['pipe', fd ?? 'pipe', 'pipe'],
        windowsHide: true,
      })
      let result = ''
      const timer = setTimeout(() => child.kill(), 120_000)
      child.stdout?.on('data', (chunk) => {
        if (capture) result += chunk.toString()
      })
      child.stderr.on('data', () => {}) // 原始 PG 错误可能含 SQL/正文，只返回固定码。
      child.on('error', () => {
        clearTimeout(timer)
        reject(new Error('DOCKER_COMMAND_FAILED'))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve(result.trim())
        else reject(new Error('DATABASE_COMMAND_FAILED'))
      })
      child.stdin.on('error', () => {})
      if (input) {
        const stream = createReadStream(input)
        stream.on('error', () => {
          child.kill()
          reject(new Error('BACKUP_INPUT_READ_FAILED'))
        })
        stream.pipe(child.stdin)
      } else child.stdin.end()
    })
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
async function query(connection, database, sql) {
  return run(connection, 'psql', [
    '-X',
    '-A',
    '-t',
    '-w',
    '-v',
    'ON_ERROR_STOP=1',
    '-d',
    database,
    '-c',
    sql,
  ])
}
const countsSql = `SELECT json_build_object('tables', (SELECT json_object_agg(c.relname, ((xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1])::text::bigint) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'), 'foreignKeys', (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='f' AND c.convalidated));`
async function snapshot(connection) {
  const child = spawn(
    'docker',
    dockerArgs('psql', [
      '-X',
      '-A',
      '-t',
      '-w',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-d',
      connection.database,
    ]),
    { env: processEnv(connection), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  )
  const lines = []
  const pending = []
  let ended = false
  child.stderr.on('data', () => {})
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (line.trim()) {
      const waiter = pending.shift()
      if (waiter) waiter.resolve(line)
      else lines.push(line)
    }
  })
  const fail = () => {
    ended = true
    for (const waiter of pending.splice(0)) waiter.reject(new Error('SNAPSHOT_SESSION_FAILED'))
  }
  child.on('error', fail)
  child.on('close', fail)
  child.stdin.on('error', () => {})
  const timer = setTimeout(() => child.kill(), 120_000)
  const next = () =>
    lines.length
      ? Promise.resolve(lines.shift())
      : ended
        ? Promise.reject(new Error('SNAPSHOT_SESSION_FAILED'))
        : new Promise((resolve, reject) => pending.push({ resolve, reject }))
  child.stdin.write(
    `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n${countsSql}\n`,
  )
  try {
    return {
      id: await next(),
      counts: JSON.parse(await next()),
      close() {
        clearTimeout(timer)
        child.stdin.end('ROLLBACK;\n\\q\n')
      },
    }
  } catch (error) {
    clearTimeout(timer)
    child.kill()
    throw error
  }
}
async function checkDocker(connection) {
  const version = await query(connection, connection.database, 'SHOW server_version_num')
  ensure(Number(version) >= 160000 && Number(version) < 170000, 'POSTGRES_16_REQUIRED')
  const ports = await new Promise((resolve, reject) => {
    const child = spawn('docker', ['port', 'personal-site-db', '5432/tcp'], { windowsHide: true })
    let result = ''
    child.stdout.on('data', (chunk) => {
      result += chunk
    })
    child.stderr.on('data', () => {})
    child.on('error', () => reject(new Error('DOCKER_PORT_CHECK_FAILED')))
    child.on('close', (code) =>
      code === 0 ? resolve(result) : reject(new Error('DOCKER_PORT_CHECK_FAILED')),
    )
  })
  ensure(
    String(ports)
      .split(/\r?\n/)
      .some((line) => /:15432$/.test(line.trim())),
    'DOCKER_PORT_MISMATCH',
  )
}
async function copyMedia(source, destination) {
  await fs.mkdir(destination, { recursive: true })
  try {
    ensure(!(await fs.lstat(source)).isSymbolicLink(), 'SYMLINK_REJECTED')
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  for (const file of await filesUnder(source)) {
    const from = path.join(source, file)
    const to = path.join(destination, file)
    await fs.mkdir(path.dirname(to), { recursive: true })
    const before = await checksum(from)
    await fs.copyFile(from, to)
    ensure(
      (await checksum(from)) === before && (await checksum(to)) === before,
      'MEDIA_CHANGED_DURING_BACKUP',
    )
  }
}
export async function main(command, env = process.env) {
  if (command === '--help' || command === undefined) {
    console.log(
      'node scripts/local-backup.mjs backup|restore\nDATABASE_URL=localhost:15432/personal_site[_test] (required)\nBACKUP_NAME=safe-name (required for restore; optional for backup)\nRESTORE_DATABASE_NAME=unique_restore_test (required for restore)\nOutput: ignored .backups/<name> and .restore-test/<name>; local Docker PG16 only.',
    )
    return
  }
  ensure(['backup', 'restore'].includes(command), 'INVALID_COMMAND')
  const connection = localConnection(
    env.DATABASE_URL,
    command === 'restore' ? env.RESTORE_DATABASE_NAME : undefined,
  )
  if (command === 'restore') ensure(connection.target, 'RESTORE_DATABASE_NAME_REQUIRED')
  const name =
    env.BACKUP_NAME || (command === 'backup' ? new Date().toISOString().replace(/[^0-9]/g, '') : '')
  const bundle = await safeLocation(workspace, '.backups', name, command === 'backup')
  if (command === 'backup') {
    await checkDocker(connection)
    await fs.mkdir(bundle, { recursive: true, mode: 0o700 })
    const held = await snapshot(connection)
    try {
      await run(
        connection,
        'pg_dump',
        ['-w', '-Fc', '--snapshot', held.id, '-d', connection.database],
        { output: path.join(bundle, 'database.dump') },
      )
    } finally {
      held.close()
    }
    try {
      ensure(
        !(await fs.lstat(path.join(workspace, '.storage'))).isSymbolicLink(),
        'SYMLINK_REJECTED',
      )
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await copyMedia(path.join(workspace, '.storage', 'media'), path.join(bundle, 'media'))
    const manifest = await makeManifest(bundle, {
      sourceDatabase: connection.database,
      ...held.counts,
    })
    await fs.writeFile(path.join(bundle, 'manifest.json'), JSON.stringify(manifest, null, 2), {
      flag: 'wx',
      mode: 0o600,
    })
    await verifyBundle(bundle)
    console.log(`LOCAL_BACKUP_VERIFIED .backups/${name}`)
  } else {
    // 全部哈希校验必须发生在创建目标库/媒体目录之前。
    const manifest = await verifyBundle(bundle)
    ensure(connection.target !== manifest.sourceDatabase, 'SOURCE_DATABASE_REJECTED')
    const target = await safeLocation(workspace, '.restore-test', name, true)
    await checkDocker(connection)
    ensure(
      (await query(
        connection,
        'postgres',
        `SELECT count(*) FROM pg_database WHERE datname='${connection.target}'`,
      )) === '0',
      'DATABASE_ALREADY_EXISTS',
    )
    await fs.mkdir(target, { recursive: true, mode: 0o700 })
    await run(connection, 'createdb', ['-w', '--template=template0', connection.target])
    // 不使用 --clean/--create，也绝不 DROP；失败现场保留供排查。
    await run(
      connection,
      'pg_restore',
      ['-w', '--exit-on-error', '--single-transaction', '-d', connection.target],
      { input: path.join(bundle, 'database.dump'), capture: false },
    )
    const restored = JSON.parse(await query(connection, connection.target, countsSql))
    ensure(
      JSON.stringify(Object.entries(restored.tables).sort()) ===
        JSON.stringify(Object.entries(manifest.tables).sort()) &&
        restored.foreignKeys === manifest.foreignKeys,
      'RESTORED_DATABASE_MISMATCH',
    )
    await copyMedia(path.join(bundle, 'media'), path.join(target, 'media'))
    const restoredFiles = await filesUnder(path.join(target, 'media'))
    const expectedFiles = manifest.files.filter((file) => file.path.startsWith('media/'))
    ensure(restoredFiles.length === expectedFiles.length, 'RESTORED_MEDIA_MISMATCH')
    for (const file of expectedFiles)
      ensure(
        (await checksum(path.join(target, file.path))) === file.sha256,
        'RESTORED_MEDIA_MISMATCH',
      )
    await fs.writeFile(
      path.join(target, 'verification.json'),
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          backup: name,
          database: connection.target,
          tables: restored.tables,
          validatedForeignKeys: restored.foreignKeys,
          mediaFiles: restoredFiles.length,
        },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    )
    console.log(`LOCAL_RESTORE_VERIFIED .restore-test/${name}/verification.json`)
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((error) => {
    console.error(
      /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'LOCAL_BACKUP_OPERATION_FAILED',
    )
    process.exitCode = 1
  })
}
