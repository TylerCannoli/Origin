import { NextResponse } from "next/server";
import { handle } from "@/lib/api/errors";
import { storage, verifyStorageSignature } from "@/lib/storage";
import { env } from "@/lib/env";

type Ctx = { params: Promise<{ key: string[] }> };

const MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  m4b: "audio/mp4",
  m4a: "audio/mp4",
  webm: "audio/webm",
  ogg: "audio/ogg",
  wav: "audio/wav",
  txt: "text/plain",
  pdf: "application/pdf",
};

/** Serves files from the local storage provider using the HMAC-signed URLs it issues. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { key: parts } = await params;
  if (env.storageProvider !== "local") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const key = parts.map(decodeURIComponent).join("/");
  const url = new URL(req.url);
  const expires = Number(url.searchParams.get("expires"));
  const sig = url.searchParams.get("sig") ?? "";
  if (!verifyStorageSignature(key, expires, sig)) return NextResponse.json({ error: "Link expired or invalid" }, { status: 403 });
  const provider = storage();
  if (!(await provider.exists(key))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = await provider.get(key);
  const ext = key.split(".").pop() ?? "";
  const body = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  return new Response(body, {
    headers: {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "content-length": String(data.length),
      "cache-control": "private, max-age=3600",
      "accept-ranges": "bytes",
    },
  });
});
