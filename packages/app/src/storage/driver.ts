/**
 * ファイルストレージのプラガブル IF(docs/DECISIONS.md「コンテンツ」)。
 * 実体は R2。Docker 版ではファイルシステム/S3 実装に差し替える。
 * インスタンス設定(FILE_UPLOADS=1)で有効化し、容量上限を持つ。
 */

export interface StoredFile {
  body: ReadableStream;
  contentType: string;
  size: number;
}

export interface StorageDriver {
  readonly name: string;
  put(key: string, data: ArrayBuffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
  delete(key: string): Promise<void>;
}

/** R2 実装 */
export class R2StorageDriver implements StorageDriver {
  readonly name = 'r2';

  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, data: ArrayBuffer, contentType: string): Promise<void> {
    await this.bucket.put(key, data, { httpMetadata: { contentType } });
  }

  async get(key: string): Promise<StoredFile | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    return {
      body: object.body,
      contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
      size: object.size,
    };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}

/** アップロード設定。FILE_UPLOADS=1 で有効、MAX_UPLOAD_MB(既定5)まで */
export function getUploadConfig(env: Env): { enabled: boolean; maxBytes: number } {
  const enabled = env.FILE_UPLOADS === '1' && !!env.FILES;
  const maxMb = Number.parseInt(env.MAX_UPLOAD_MB ?? '5', 10);
  return {
    enabled,
    maxBytes: (Number.isNaN(maxMb) ? 5 : maxMb) * 1024 * 1024,
  };
}

export function getStorage(env: Env): StorageDriver | null {
  if (!env.FILES) return null;
  return new R2StorageDriver(env.FILES);
}

/** アップロードを許可する画像 MIME と拡張子 */
export const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export type ImageUploadError = 'uploads_disabled' | 'no_file' | 'too_large' | 'bad_type';

export type ImageUploadResult =
  | { ok: true; url: string }
  | { ok: false; error: ImageUploadError };

/**
 * 画像アップロードを検証して保存し、公開 URL(/files/…)を返す共通処理。
 * prefix はキーの名前空間(例: `thumbnails/<eventId>`、`avatars/<actorId>`)。
 * prevUrl が自ホスティングなら保存後に削除する。
 */
export async function saveImageUpload(
  env: Env,
  prefix: string,
  file: unknown,
  prevUrl?: string | null,
): Promise<ImageUploadResult> {
  const { enabled, maxBytes } = getUploadConfig(env);
  const storage = getStorage(env);
  if (!enabled || !storage) return { ok: false, error: 'uploads_disabled' };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'no_file' };
  if (file.size > maxBytes) return { ok: false, error: 'too_large' };
  const ext = IMAGE_TYPES[file.type];
  if (!ext) return { ok: false, error: 'bad_type' };

  const { ulid } = await import('../lib/ulid');
  const key = `${prefix}/${ulid()}.${ext}`;
  await storage.put(key, await file.arrayBuffer(), file.type);

  if (prevUrl?.startsWith('/files/')) {
    await storage.delete(prevUrl.replace(/^\/files\//, '')).catch(() => undefined);
  }
  return { ok: true, url: `/files/${key}` };
}
