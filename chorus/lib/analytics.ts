import { db } from "@/lib/db/client";

export type AnalyticsEvent =
  | "project_created"
  | "manuscript_uploaded"
  | "invite_created"
  | "recording_uploaded"
  | "recordings_claimed"
  | "render_requested"
  | "listen_viewed"
  | "character_merged"
  | "cue_reassigned";

/** Fire-and-forget event logging. Never throws; analytics must not break a request. */
export async function track(event: AnalyticsEvent, opts: { projectId?: string | null; userId?: string | null; props?: Record<string, unknown> } = {}) {
  try {
    await db()`insert into analytics_events (project_id, user_id, event, props) values (${opts.projectId ?? null}, ${opts.userId ?? null}, ${event}, ${db().json((opts.props ?? {}) as never)})`;
  } catch (err) {
    console.warn("[analytics] failed to record event", event, err instanceof Error ? err.message : err);
  }
}
