import fs from "node:fs/promises";
import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export interface StorageProvider {
  /** Stores bytes under `key`, returns the key. */
  put(key: string, data: Buffer | Uint8Array, contentType: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Returns a URL a browser can fetch for a limited time. */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** Removes everything under a key prefix (best effort). */
  deletePrefix(prefix: string): Promise<void>;
}

function safeKey(key: string): string {
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return normalized;
}

export function signStorageKey(key: string, expires: number): string {
  return createHmac("sha256", env.secret).update(`${key}:${expires}`).digest("hex");
}

export function verifyStorageSignature(key: string, expires: number, sig: string): boolean {
  if (!Number.isFinite(expires) || expires < Date.now() / 1000) return false;
  const expected = signStorageKey(key, expires);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Filesystem-backed provider for local development and tests. Served via /api/storage/[...key]. */
export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly root: string) {}
  private resolve(key: string) {
    return path.join(this.root, safeKey(key));
  }
  async put(key: string, data: Buffer | Uint8Array, _contentType?: string) {
    void _contentType;
    const file = this.resolve(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
    return safeKey(key);
  }
  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }
  async exists(key: string) {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
  async deletePrefix(prefix: string) {
    await fs.rm(this.resolve(prefix), { recursive: true, force: true });
  }
  async signedUrl(key: string, expiresInSeconds = 3600) {
    const k = safeKey(key);
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const sig = signStorageKey(k, expires);
    return `${env.appUrl}/api/storage/${k.split("/").map(encodeURIComponent).join("/")}?expires=${expires}&sig=${sig}`;
  }
}

export class SupabaseStorageProvider implements StorageProvider {
  private client;
  constructor(url: string, serviceRoleKey: string, private readonly bucket: string) {
    this.client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }
  async put(key: string, data: Buffer | Uint8Array, contentType: string) {
    const k = safeKey(key);
    const { error } = await this.client.storage.from(this.bucket).upload(k, data, { contentType, upsert: true });
    if (error) throw new Error(`Storage upload failed for ${k}: ${error.message}`);
    return k;
  }
  async get(key: string) {
    const { data, error } = await this.client.storage.from(this.bucket).download(safeKey(key));
    if (error || !data) throw new Error(`Storage download failed for ${key}: ${error?.message ?? "no data"}`);
    return Buffer.from(await data.arrayBuffer());
  }
  async exists(key: string) {
    const k = safeKey(key);
    const dir = path.posix.dirname(k);
    const base = path.posix.basename(k);
    const { data } = await this.client.storage.from(this.bucket).list(dir, { search: base, limit: 1 });
    return !!data?.some((f) => f.name === base);
  }
  async delete(key: string) {
    await this.client.storage.from(this.bucket).remove([safeKey(key)]);
  }
  async deletePrefix(prefix: string) {
    const root = safeKey(prefix);
    const walk = async (dir: string): Promise<string[]> => {
      const out: string[] = [];
      let offset = 0;
      for (;;) {
        const { data } = await this.client.storage.from(this.bucket).list(dir, { limit: 1000, offset });
        if (!data || data.length === 0) break;
        for (const entry of data) {
          const full = `${dir}/${entry.name}`;
          if (entry.id === null) out.push(...(await walk(full)));
          else out.push(full);
        }
        if (data.length < 1000) break;
        offset += data.length;
      }
      return out;
    };
    const files = await walk(root);
    for (let i = 0; i < files.length; i += 100) await this.client.storage.from(this.bucket).remove(files.slice(i, i + 100));
  }
  async signedUrl(key: string, expiresInSeconds = 3600) {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(safeKey(key), expiresInSeconds);
    if (error || !data) throw new Error(`Could not sign URL for ${key}: ${error?.message ?? "unknown"}`);
    return data.signedUrl;
  }
}

let cached: StorageProvider | null = null;
export function storage(): StorageProvider {
  if (cached) return cached;
  if (env.storageProvider === "supabase") {
    const cfg = env.supabase;
    if (!cfg?.serviceRoleKey) throw new Error("CHORUS_STORAGE=supabase requires SUPABASE_SERVICE_ROLE_KEY");
    cached = new SupabaseStorageProvider(cfg.url, cfg.serviceRoleKey, cfg.bucket);
  } else {
    cached = new LocalStorageProvider(path.resolve(env.localStorageDir));
  }
  return cached;
}

/** Test hook: swap the provider. */
export function __setStorageForTests(p: StorageProvider | null) {
  cached = p;
}

export const storageKeys = {
  source: (projectId: string, filename: string) => `projects/${projectId}/source/${filename}`,
  recording: (projectId: string, cueId: string, recordingId: string, ext: string) =>
    `projects/${projectId}/recordings/${cueId}/${recordingId}.${ext}`,
  ttsCache: (projectId: string, hash: string) => `projects/${projectId}/tts/${hash}.mp3`,
  chapterRender: (projectId: string, chapterId: string, version: string) =>
    `projects/${projectId}/renders/chapters/${chapterId}-${version}.mp3`,
  bookRender: (projectId: string, version: string, ext: "mp3" | "m4b") => `projects/${projectId}/renders/book-${version}.${ext}`,
  audition: (voiceId: string, hash: string) => `auditions/${voiceId}/${hash}.mp3`,
};
