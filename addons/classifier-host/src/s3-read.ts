import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { NodeHttpHandler } from '@aws-sdk/node-http-handler'
import { slackLog } from './utils/slackLog'
import { HeadObjectInfo } from './types'

const endpoint = process.env.AWS_ENDPOINT_URL_S3

const s3Client = new S3Client({
  ...(endpoint ? { endpoint } : {}),
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 30_000,
    requestTimeout: 600_000,
  }),
  maxAttempts: 3,
  forcePathStyle: true,
})

const AWS_INPUT_BUCKET = process.env.AWS_INPUT_BUCKET as string

if (!AWS_INPUT_BUCKET) {
  throw new Error('AWS_INPUT_BUCKET is not configured')
}

export class MissingObjectError extends Error {
  constructor(public readonly txid: string, message = `Object not found: ${txid}`) {
    super(message)
    this.name = 'MissingObjectError'
  }
}

export class FatalS3AccessError extends Error {
  constructor(
    public readonly txid: string,
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'FatalS3AccessError'
  }
}

const getStatusCode = (error: unknown): number | undefined => {
  const value = error as { $metadata?: { httpStatusCode?: number } }
  return value.$metadata?.httpStatusCode
}

const getErrorName = (error: unknown): string => {
  const value = error as { name?: string }
  return value.name ?? 'Error'
}

const isMissingError = (error: unknown) => {
  const statusCode = getStatusCode(error)
  const name = getErrorName(error)
  return statusCode === 404 || name === 'NoSuchKey' || name === 'NotFound'
}

const isForbiddenError = (error: unknown) => {
  const statusCode = getStatusCode(error)
  const name = getErrorName(error)
  return statusCode === 403 || name === 'Forbidden' || name === 'AccessDenied'
}

const isRetryableSocketReset = (error: unknown) => {
  const value = error as { code?: string; name?: string; message?: string }
  return value.code === 'ECONNRESET' || value.name === 'ECONNRESET' || value.message?.includes('ECONNRESET') === true
}

const throwMappedS3Error = async (txid: string, error: unknown): Promise<never> => {
  if (isMissingError(error)) {
    throw new MissingObjectError(txid)
  }

  if (isForbiddenError(error)) {
    const statusCode = getStatusCode(error)
    const name = getErrorName(error)
    const message = (error as Error).message
    await slackLog('classifier-host', txid, `fatal s3 access error ${name}(${statusCode ?? 'unknown'}) ${message}`)
    throw new FatalS3AccessError(
      txid,
      `Fatal S3 access error for ${txid}: ${name}(${statusCode ?? 'unknown'}) ${message}`,
      statusCode,
      error,
    )
  }

  throw error
}

const toNodeReadable = (body: unknown): Readable => {
  if (!body) throw new Error('GetObject returned empty body')
  if (body instanceof Readable) return body

  const maybePipe = body as Readable
  if (typeof maybePipe.pipe === 'function') return maybePipe

  throw new Error('Unsupported GetObject body type')
}

export const s3HeadObject = async (txid: string): Promise<HeadObjectInfo> => {
  try {
    const head = await s3Client.send(new HeadObjectCommand({
      Bucket: AWS_INPUT_BUCKET,
      Key: txid,
    }))

    return {
      contentType: head.ContentType ?? 'application/octet-stream',
      contentLength: Number(head.ContentLength ?? 0),
    }
  } catch (error) {
    return throwMappedS3Error(txid, error)
  }
}

export const s3GetBuffer = async (txid: string): Promise<Buffer> => {
  try {
    const output = await s3Client.send(new GetObjectCommand({
      Bucket: AWS_INPUT_BUCKET,
      Key: txid,
    }))

    const body = toNodeReadable(output.Body)
    const chunks: Buffer[] = []
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  } catch (error) {
    return throwMappedS3Error(txid, error)
  }
}

export const s3DownloadToFile = async (txid: string, targetPath: string): Promise<void> => {
  await mkdir(path.dirname(targetPath), { recursive: true })

  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const output = await s3Client.send(new GetObjectCommand({
        Bucket: AWS_INPUT_BUCKET,
        Key: txid,
      }))

      const input = toNodeReadable(output.Body)
      const outFile = createWriteStream(targetPath)
      await pipeline(input, outFile)
      return
    } catch (error) {
      if (isMissingError(error) || isForbiddenError(error)) {
        await throwMappedS3Error(txid, error)
      }

      lastError = error
      if (attempt < 3 && isRetryableSocketReset(error)) {
        continue
      }
      throw error
    }
  }

  if (lastError) {
    throw lastError
  }
}

