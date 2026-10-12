import 'server-only'
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env, assertS3Configured } from '@/lib/env'
import { ApiError } from '@/lib/api/errors'
import { safeStorageKey } from './validation'

export interface StorageDriver {
  put(key: string, bytes: Buffer, mimeType: string): Promise<void>
  get(key: string, maxBytes: number): Promise<Buffer>
  remove(key: string): Promise<void>
}
/** localhost生产构建验收属于本地开发；公网生产必须使用对象存储。 */
export function assertLocalAllowed() {
  const host = new URL(env.NEXT_PUBLIC_SITE_URL).hostname
  if (env.NODE_ENV === 'production' && !['localhost', '127.0.0.1', '[::1]'].includes(host))
    throw new ApiError(503, 'LOCAL_STORAGE_DISABLED', '公网生产必须使用对象存储')
}
export class LocalDriver implements StorageDriver {
  private path(key: string) {
    assertLocalAllowed()
    safeStorageKey(key)
    const root = resolve(process.cwd(), '.storage')
    const path = resolve(root, key)
    if (!path.startsWith(root + '/') && !path.startsWith(root + '\\'))
      throw new ApiError(400, 'INVALID_KEY', '无效媒体路径')
    return path
  }
  async put(key: string, bytes: Buffer) {
    const path = this.path(key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes, { flag: 'wx' })
  }
  async get(key: string, maxBytes: number) {
    const bytes = await readFile(this.path(key))
    if (bytes.length > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '媒体对象超过限制')
    return bytes
  }
  async remove(key: string) {
    try {
      await unlink(this.path(key))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
/** 公开对象写入经过校验的字节，避免直传者覆盖临时对象导致竞态。 */
export class R2Driver implements StorageDriver {
  private client: S3Client
  private bucket: string
  private privateBucket: string
  constructor() {
    assertS3Configured()
    if (!env.S3_PUBLIC_BASE_URL)
      throw new ApiError(503, 'STORAGE_UNCONFIGURED', '对象存储缺少公开地址配置')
    this.bucket = env.S3_BUCKET!
    this.privateBucket = env.S3_PRIVATE_BUCKET!
    if (this.privateBucket === this.bucket)
      throw new ApiError(503, 'STORAGE_UNCONFIGURED', '临时桶必须与公开桶隔离')
    this.client = new S3Client({
      // Supabase要求桶名置于路径；保留原类名以兼容既有S3调用入口。
      forcePathStyle: true,
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION || 'auto',
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      },
    })
  }
  private valid(key: string) {
    if (/^private\/upload\/[a-f0-9-]{36}$/.test(key)) return key
    return safeStorageKey(key)
  }
  async intent(key: string, mimeType: string, size: number, hash: string) {
    this.valid(key)
    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.privateBucket,
        Key: key,
        ContentType: mimeType,
        ContentLength: size,
        ChecksumSHA256: Buffer.from(hash, 'hex').toString('base64'),
      }),
      { expiresIn: 600, signableHeaders: new Set(['content-type', 'content-length']) },
    )
    return {
      uploadUrl,
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
        'x-amz-checksum-sha256': Buffer.from(hash, 'hex').toString('base64'),
      },
    }
  }
  async put(key: string, bytes: Buffer, mimeType: string) {
    safeStorageKey(key)
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: mimeType,
        ContentDisposition: mimeType === 'application/pdf' ? 'attachment' : 'inline',
      }),
    )
  }
  async get(key: string, maxBytes: number) {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: key.startsWith('private/') ? this.privateBucket : this.bucket,
        Key: this.valid(key),
      }),
    )
    if ((result.ContentLength || 0) > maxBytes) {
      await result.Body?.transformToWebStream().cancel()
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '对象超过限制')
    }
    if (!result.Body) throw new ApiError(404, 'NOT_FOUND', '媒体对象不存在')
    const chunks: Buffer[] = []
    let size = 0
    for await (const part of result.Body as AsyncIterable<Uint8Array>) {
      size += part.length
      if (size > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '对象超过限制')
      chunks.push(Buffer.from(part))
    }
    return Buffer.concat(chunks)
  }
  async remove(key: string) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: key.startsWith('private/') ? this.privateBucket : this.bucket,
        Key: this.valid(key),
      }),
    )
  }
  publicUrl(key: string) {
    return `${env.S3_PUBLIC_BASE_URL!.replace(/\/$/, '')}/${safeStorageKey(key)}`
  }
}
export function storageDriver(): StorageDriver {
  return env.STORAGE_DRIVER === 's3' ? new R2Driver() : new LocalDriver()
}
