import { randomUUID, createHash } from "node:crypto";
import {
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export class StorageError extends Error {}

export function schedulerStorageConfigured() {
  return Boolean(
    process.env.B2_APPLICATION_KEY_ID &&
    process.env.B2_APPLICATION_KEY &&
    process.env.B2_BUCKET_ID,
  );
}
type BucketConnection = {
  bucketName: string;
  downloadUrl: string;
  client: S3Client;
  private: boolean;
};
let cached: {
  identity: string;
  expiresAt: number;
  connection: Promise<BucketConnection>;
} | null = null;

async function storageJson(url: string, init: RequestInit) {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch {
    // B2 responses may contain authorization tokens. Never expose raw errors.
    throw new StorageError(
      "Backblaze storage could not be authorized. Ask your administrator to check its application key, bucket ID and listBuckets/writeFiles permissions.",
    );
  }
}
function backblazeHost(value: unknown, pattern: RegExp) {
  if (typeof value !== "string")
    throw new StorageError("Invalid Backblaze endpoint.");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !pattern.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new StorageError("Invalid Backblaze endpoint.");
  return url.origin;
}
async function connectBucket(): Promise<BucketConnection> {
  const keyId = process.env.B2_APPLICATION_KEY_ID!;
  const applicationKey = process.env.B2_APPLICATION_KEY!;
  const bucketId = process.env.B2_BUCKET_ID!;
  const auth = await storageJson(
    "https://api.backblazeb2.com/b2api/v4/b2_authorize_account",
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${applicationKey}`).toString("base64")}`,
      },
    },
  );
  const info = auth.apiInfo?.storageApi;
  const apiUrl = backblazeHost(info?.apiUrl, /^api\d*\.backblazeb2\.com$/);
  const downloadUrl = backblazeHost(
    info?.downloadUrl,
    /^f\d+\.backblazeb2\.com$/,
  );
  const endpoint = backblazeHost(
    info?.s3ApiUrl,
    /^s3\.[a-z0-9-]+\.backblazeb2\.com$/,
  );
  if (!auth.authorizationToken || !auth.accountId)
    throw new StorageError("Invalid Backblaze authorization response.");
  const { buckets } = await storageJson(`${apiUrl}/b2api/v4/b2_list_buckets`, {
    method: "POST",
    headers: {
      Authorization: auth.authorizationToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ accountId: auth.accountId, bucketId }),
  });
  const bucket = Array.isArray(buckets)
    ? buckets.find((item) => item.bucketId === bucketId)
    : undefined;
  if (!bucket || !/^[a-zA-Z0-9-]{6,63}$/.test(bucket.bucketName))
    throw new StorageError("The configured Backblaze bucket was not found.");
  if (!["allPublic", "allPrivate"].includes(bucket.bucketType))
    throw new StorageError(
      "Choose a standard private or public Backblaze media bucket.",
    );
  if (!info.allowed?.capabilities?.includes("writeFiles"))
    throw new StorageError(
      "The Backblaze application key needs writeFiles permission.",
    );
  if (
    bucket.bucketType === "allPrivate" &&
    !info.allowed?.capabilities?.includes("readFiles")
  )
    throw new StorageError(
      "The Backblaze application key needs readFiles permission for private media.",
    );
  if (
    info.allowed?.namePrefix &&
    !"scheduler/".startsWith(info.allowed.namePrefix)
  )
    throw new StorageError(
      "The Backblaze application key must allow the scheduler/ file prefix.",
    );
  return {
    bucketName: bucket.bucketName,
    downloadUrl,
    private: bucket.bucketType === "allPrivate",
    client: new S3Client({
      endpoint,
      region: new URL(endpoint).hostname.split(".")[1],
      forcePathStyle: true,
      credentials: { accessKeyId: keyId, secretAccessKey: applicationKey },
      requestChecksumCalculation: "WHEN_REQUIRED",
      requestHandler: { requestTimeout: 30_000, connectionTimeout: 10_000 },
    }),
  };
}

export function isBackblazeMediaUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      /^f\d+\.backblazeb2\.com$/.test(url.hostname) &&
      url.pathname.startsWith("/file/")
    );
  } catch {
    return false;
  }
}

// Store stable references; authorize downloads only for a preview or when due.
export async function schedulerMediaUrl(
  workspaceId: string,
  value: string,
  expiresIn = 86400,
) {
  if (!isBackblazeMediaUrl(value)) return value;
  if (!schedulerStorageConfigured()) {
    // Public URLs hosted by somebody else remain usable without our storage.
    if (
      process.env.B2_BUCKET_NAME &&
      new URL(value).pathname.startsWith(`/file/${process.env.B2_BUCKET_NAME}/`)
    )
      throw new StorageError(
        "Configure the Backblaze connection to access workspace media.",
      );
    return value;
  }
  const storage = await connection();
  const url = new URL(value);
  if (!url.pathname.startsWith(`/file/${storage.bucketName}/`)) return value;
  const prefix = `/file/${storage.bucketName}/scheduler/${workspaceId}/`;
  if (
    url.protocol !== "https:" ||
    url.origin !== storage.downloadUrl ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(prefix)
  )
    throw new StorageError(
      "This media file does not belong to your workspace.",
    );
  const key = url.pathname.slice(`/file/${storage.bucketName}/`.length);
  if (
    !/^scheduler\/[a-zA-Z0-9_-]+\/[a-f0-9-]+\.(jpg|png|gif|bmp|tiff|mp4|mov)$/.test(
      key,
    )
  )
    throw new StorageError("Invalid workspace media reference.");
  if (!storage.private) return value;
  return getSignedUrl(
    storage.client,
    new GetObjectCommand({ Bucket: storage.bucketName, Key: key }),
    { expiresIn },
  );
}
async function connection() {
  if (!schedulerStorageConfigured())
    throw new StorageError(
      "File uploads need Backblaze storage configuration. You can use a public HTTPS media URL.",
    );
  const identity = [
    process.env.B2_APPLICATION_KEY_ID,
    process.env.B2_APPLICATION_KEY,
    process.env.B2_BUCKET_ID,
  ].join(":");
  if (
    !cached ||
    cached.identity !== identity ||
    cached.expiresAt < Date.now()
  ) {
    const entry = {
      identity,
      expiresAt: Date.now() + 60 * 60_000,
      connection: connectBucket(),
    };
    cached = entry;
    entry.connection.catch(() => {
      if (cached === entry) cached = null;
    });
  }
  return cached.connection;
}
const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};
export async function createSchedulerUpload(
  workspaceId: string,
  contentType: string,
  size: number,
) {
  if (
    !/^[a-zA-Z0-9_-]+$/.test(workspaceId) ||
    !extensions[contentType] ||
    !Number.isSafeInteger(size) ||
    size <= 0
  )
    throw new StorageError("Invalid upload metadata.");
  const { client, bucketName, downloadUrl } = await connection();
  const key = `scheduler/${workspaceId}/${randomUUID()}.${extensions[contentType]}`;
  const expiresIn = 15 * 60;
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
      ContentLength: size,
    }),
    { expiresIn, signableHeaders: new Set(["content-type", "content-length"]) },
  );
  return {
    uploadUrl,
    mediaUrl: `${downloadUrl}/file/${bucketName}/${key}`,
    headers: { "Content-Type": contentType },
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

export async function schedulerStorageBucketName() {
  return (await connection()).bucketName;
}

// Server-side ingestion for agent files. Stream in bounded parts rather than
// buffering entire videos. Incomplete multipart uploads are never published.
export async function storeSchedulerMedia(
  workspaceId: string, contentType: string, source: AsyncIterable<Uint8Array>,
  limit: number, signal: AbortSignal, expectedSize?: number,
  options: { objectId?: string; beforeUpload?: (url: string) => Promise<void> } = {},
) {
  if (!/^[a-zA-Z0-9_-]+$/.test(workspaceId) || !extensions[contentType])
    throw new StorageError("Invalid upload metadata.");
  const { client, bucketName, downloadUrl } = await connection();
  const objectId = options.objectId ?? randomUUID();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(objectId))
    throw new StorageError("Invalid upload identifier.");
  const key = `scheduler/${workspaceId}/${objectId}.${extensions[contentType]}`;
  const hash = createHash("sha256");
  const partSize = 8 * 1024 ** 2;
  const parts: { PartNumber: number; ETag: string }[] = [];
  let pending: Buffer[] = [], pendingSize = 0, size = 0, uploadId: string | undefined;
  async function uploadPart() {
    signal.throwIfAborted();
    if (!uploadId) {
      const created = await client.send(new CreateMultipartUploadCommand({
        Bucket: bucketName, Key: key, ContentType: contentType,
      }), { abortSignal: signal });
      uploadId = created.UploadId;
      if (!uploadId) throw new StorageError("Storage did not start the file upload.");
    }
    const body = Buffer.concat(pending, pendingSize);
    pending = []; pendingSize = 0;
    const PartNumber = parts.length + 1;
    const uploaded = await client.send(new UploadPartCommand({
      Bucket: bucketName, Key: key, UploadId: uploadId, PartNumber,
      Body: body, ContentLength: body.length,
    }), { abortSignal: signal });
    if (!uploaded.ETag) throw new StorageError("Storage did not confirm the file part.");
    parts.push({ PartNumber, ETag: uploaded.ETag });
  }
  try {
    await options.beforeUpload?.(`${downloadUrl}/file/${bucketName}/${key}`);
    for await (const chunk of source) {
      signal.throwIfAborted();
      size += chunk.byteLength;
      if (size > limit) throw new StorageError("The file exceeds the size limit for this post type.");
      hash.update(chunk);
      // Split even an unusually large incoming chunk into bounded parts.
      for (let offset = 0; offset < chunk.byteLength;) {
        const length = Math.min(partSize - pendingSize, chunk.byteLength - offset);
        pending.push(Buffer.from(chunk.buffer, chunk.byteOffset + offset, length));
        pendingSize += length; offset += length;
        if (pendingSize === partSize) await uploadPart();
      }
    }
    if (!size || (expectedSize !== undefined && size !== expectedSize))
      throw new StorageError("The file download was empty or incomplete. Retry with a fresh file attachment.");
    if (uploadId) {
      if (pendingSize) await uploadPart();
      await client.send(new CompleteMultipartUploadCommand({
        Bucket: bucketName, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts },
      }), { abortSignal: signal });
      uploadId = undefined;
    } else {
      await client.send(new PutObjectCommand({
        Bucket: bucketName, Key: key, ContentType: contentType,
        ContentLength: size, Body: Buffer.concat(pending, pendingSize),
      }), { abortSignal: signal });
    }
    return { mediaUrl: `${downloadUrl}/file/${bucketName}/${key}`, contentType, size,
      sha256: hash.digest("hex"), uploaded: true as const };
  } catch (error) {
    if (uploadId) {
      await client.send(new AbortMultipartUploadCommand({
        Bucket: bucketName, Key: key, UploadId: uploadId,
      }), { abortSignal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    }
    // Never expose provider responses, signed URLs or keys in tool errors.
    if (error instanceof StorageError) throw error;
    throw new StorageError(signal.aborted
      ? "The upload timed out. Retry with a fresh file attachment."
      : "Storage could not complete the file upload. Please retry.");
  }
}
export function ownsSchedulerMedia(
  workspaceId: string,
  value: string,
  bucketName = process.env.B2_BUCKET_NAME,
) {
  if (!bucketName || !isBackblazeMediaUrl(value)) return false;
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname.startsWith(`/file/${bucketName}/scheduler/${workspaceId}/`) &&
    /^scheduler\/[a-zA-Z0-9_-]+\/[a-f0-9-]+\.(jpg|png|gif|bmp|tiff|mp4|mov)$/.test(
      url.pathname.slice(`/file/${bucketName}/`.length),
    )
  );
}
export async function deleteSchedulerMedia(workspaceId: string, value: string) {
  const storage = await connection();
  if (!ownsSchedulerMedia(workspaceId, value, storage.bucketName))
    throw new StorageError(
      "Only workspace-owned scheduler files can be removed.",
    );
  const url = new URL(value);
  if (
    url.origin !== storage.downloadUrl ||
    !url.pathname.startsWith(`/file/${storage.bucketName}/`)
  )
    throw new StorageError("Storage ownership could not be verified.");
  const key = url.pathname.slice(`/file/${storage.bucketName}/`.length);
  // B2 is versioned: an unversioned DELETE hides a file and retains the bytes.
  // Remove versions of this exact object only, never every key in its prefix.
  for (let page = 0; page < 20; page++) {
    const versions = await storage.client.send(
      new ListObjectVersionsCommand({
        Bucket: storage.bucketName,
        Prefix: key,
        MaxKeys: 1000,
      }),
    );
    const matching = [
      ...(versions.Versions ?? []),
      ...(versions.DeleteMarkers ?? []),
    ].filter((item) => item.Key === key && item.VersionId);
    if (!matching.length) return;
    for (const version of matching)
      await storage.client.send(
        new DeleteObjectCommand({
          Bucket: storage.bucketName,
          Key: key,
          VersionId: version.VersionId,
        }),
      );
  }
  throw new StorageError(
    "More media versions remain; cleanup will continue on the next attempt.",
  );
}
