import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import { dirname, resolve, sep } from 'node:path'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
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
  /** Uploads a file from disk without holding it all in memory (videos). */
  putFile(key: string, path: string, contentType: string): Promise<void>
  /** Size in bytes, or null when missing. */
  size(key: string): Promise<number | null>
  /** Bytes start..end inclusive, as a stream (for HTTP Range requests). */
  stream(key: string, start: number, end: number): Promise<Readable>
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

  async putFile(key: string, path: string) {
    const target = this.pathFor(key)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(path, target)
  }

  async size(key: string) {
    try {
      return (await stat(this.pathFor(key))).size
    } catch {
      return null
    }
  }

  async stream(key: string, start: number, end: number) {
    return createReadStream(this.pathFor(key), { start, end })
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

  async putFile(key: string, path: string, contentType: string) {
    const { size } = await stat(path)
    await this.client.send(
      new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: createReadStream(path), ContentLength: size, ContentType: contentType }),
    )
  }

  async size(key: string) {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
      return out.ContentLength ?? null
    } catch {
      return null
    }
  }

  async stream(key: string, start: number, end: number) {
    const out = await this.client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Range: `bytes=${start}-${end}` }))
    return out.Body as Readable
  }
}

export const storage: Storage = env.STORAGE_BACKEND === 's3' ? new S3Storage() : new LocalStorage()
