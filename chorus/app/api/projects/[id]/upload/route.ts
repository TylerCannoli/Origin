import path from "node:path";
import { badRequest, handle, json } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { getOwnedProject, touchProject } from "@/lib/db/projects";
import { storage, storageKeys } from "@/lib/storage";
import { bullEnqueuer } from "@/lib/queue";
import { startPipeline } from "@/lib/pipeline/start";
import { MAX_UPLOAD_BYTES, SUPPORTED_UPLOAD_EXTENSIONS, pasteUploadSchema, type UploadExtension } from "@/lib/validation/schemas";
import { rateLimit } from "@/lib/api/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

function extensionOf(name: string): UploadExtension {
  const ext = path.extname(name).replace(".", "").toLowerCase();
  if (!(SUPPORTED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
    throw badRequest(`Unsupported file type ".${ext || "?"}". Upload a .txt, .md, .docx, .epub or .pdf file.`);
  }
  return ext as UploadExtension;
}

/**
 * Accepts either multipart/form-data (file + rights_attested) or JSON {text, rights_attested}.
 * Stores the source, records the attestation, and enqueues the ingest job.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser(req);
  await rateLimit(`upload:${user.id}`, 20, 3600);
  const project = await getOwnedProject(id, user.id);
  if (project.status === "processing") throw badRequest("This project is still processing. Wait for it to finish before uploading again.");

  const contentType = req.headers.get("content-type") ?? "";
  let bytes: Buffer;
  let filename: string;
  let kind: string;
  let title: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    const attested = form.get("rights_attested");
    if (!(file instanceof File)) throw badRequest("Choose a manuscript file to upload");
    if (attested !== "true" && attested !== "on") throw badRequest("You must confirm you have the rights to this text");
    if (file.size === 0) throw badRequest("That file is empty");
    if (file.size > MAX_UPLOAD_BYTES) throw badRequest(`Files must be under ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`);
    kind = extensionOf(file.name);
    if (kind === "md") kind = "txt";
    filename = `manuscript.${kind}`;
    bytes = Buffer.from(await file.arrayBuffer());
    const t = form.get("title");
    if (typeof t === "string" && t.trim()) title = t.trim().slice(0, 200);
  } else {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw badRequest("Send a file (multipart/form-data) or JSON with a text field");
    }
    const parsed = pasteUploadSchema.parse(body);
    if (parsed.text.trim().length === 0) throw badRequest("Paste some text first");
    if (Buffer.byteLength(parsed.text) > MAX_UPLOAD_BYTES) throw badRequest("That text is too large to process");
    kind = "paste";
    filename = "manuscript.txt";
    bytes = Buffer.from(parsed.text, "utf8");
    title = parsed.title;
  }

  const key = storageKeys.source(id, filename);
  await storage().put(key, bytes, kind === "pdf" ? "application/pdf" : kind === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : kind === "epub" ? "application/epub+zip" : "text/plain");

  await touchProject(id, { source_file_url: key, source_kind: kind, rights_attested: true, ...(title ? { title } : {}) });
  const runs = await startPipeline(id, bullEnqueuer, { force: true });
  return json({ ok: true, source_file_url: key, pipeline: runs }, { status: 202 });
});
