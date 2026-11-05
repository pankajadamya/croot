import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { env } from './env.js'

/**
 * Object storage for media. Keys are tenant-prefixed (`org/<orgId>/...`) so a tenant's media can be
 * exported, migrated or deleted as a unit. Nothing in storage is publicly readable: every byte is
 * served through the app, which checks consent and approval on each request.
 */
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer | null>
  remove(key: string): Promise<void>
}

class LocalStorage implements Storage {
  private root = resolve(env.LOCAL_STORAGE_DIR)

  private pathFor(key: string): string {
    const full = resolve(this.root, key)
    if (!full.startsWith(this.root + sep)) throw new Error('Invalid storage key')
    return full
  }

  async put(key: string, body: Buffer) {
    const path = this.pathFor(key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, body)
  }

  async get(key: string) {
    try {
      return await readFile(this.pathFor(key))
    } catch {
      return null
    }
  }

  async remove(key: string) {
    await rm(this.pathFor(key), { force: true })
  }
}

class S3Storage implements Storage {
  private client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  })

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }))
  }

  async get(key: string) {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
      const bytes = await out.Body?.transformToByteArray()
      return bytes ? Buffer.from(bytes) : null
    } catch {
      return null
    }
  }

  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
  }
}

export const storage: Storage = env.STORAGE_BACKEND === 's3' ? new S3Storage() : new LocalStorage()
