import { forbidden, handle, json, notFound } from "@/lib/api/errors";
import { getSessionUser } from "@/lib/auth/server";
import { getProject } from "@/lib/db/projects";
import { listAudio } from "@/lib/db/audio";
import { rateLimit, clientIp } from "@/lib/api/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

/** (public if visibility='public_listen') Stream/download links for the finished audiobook. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  await rateLimit(`listen:${clientIp(req)}`, 120, 60);
  const project = await getProject(id);
  if (!project) throw notFound("Project");
  const user = await getSessionUser(req);
  const isOwner = user?.id === project.owner_id;
  if (project.visibility !== "public_listen" && !isOwner) throw forbidden("This audiobook is private");
  const audio = await listAudio(id, 6 * 3600);
  return json({
    project: { id: project.id, title: project.title },
    chapters: audio.chapters.filter((c) => c.render).map((c) => ({ title: c.chapter.title, order_index: c.chapter.order_index, url: c.render!.url, duration_ms: c.render!.duration_ms })),
    book: { mp3: audio.book.mp3 ? { url: audio.book.mp3.url, duration_ms: audio.book.mp3.duration_ms, chapter_markers: audio.book.mp3.chapter_markers } : null, m4b: audio.book.m4b ? { url: audio.book.m4b.url } : null },
    total_duration_ms: audio.total_duration_ms,
  });
});
