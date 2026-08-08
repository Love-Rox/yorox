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
