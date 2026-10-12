import { expect, test, vi } from 'vitest'

vi.mock('@/lib/env', () => ({
  env: {
    STORAGE_DRIVER: 's3',
    S3_ENDPOINT: 'https://example.storage.supabase.co/storage/v1/s3',
    S3_REGION: 'ap-southeast-1',
    S3_BUCKET: 'my-site-media',
    S3_PRIVATE_BUCKET: 'my-site-upload-private',
    S3_ACCESS_KEY_ID: 'test-access',
    S3_SECRET_ACCESS_KEY: 'test-secret',
    S3_PUBLIC_BASE_URL: 'https://example.supabase.co/storage/v1/object/public/my-site-media',
  },
  assertS3Configured() {},
}))
import { R2Driver } from '@/lib/storage/drivers'

test('Supabase签名保留存储域名和API前缀，桶名置于路径且签署校验和', async () => {
  const intent = await new R2Driver().intent(
    'private/upload/12345678-1234-1234-1234-123456789abc',
    'image/png',
    12,
    'a'.repeat(64),
  )
  const url = new URL(intent.uploadUrl)
  expect(url.hostname).toBe('example.storage.supabase.co')
  expect(url.pathname).toBe(
    '/storage/v1/s3/my-site-upload-private/private/upload/12345678-1234-1234-1234-123456789abc',
  )
  expect(url.searchParams.get('X-Amz-Expires')).toBe('600')
  expect(intent.headers['x-amz-checksum-sha256']).toBe(
    Buffer.from('a'.repeat(64), 'hex').toString('base64'),
  )
})
