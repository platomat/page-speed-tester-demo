import type { Annotation, Env, User } from "./env";
import { requireProjectAccess } from "./access";
import { json } from "./http";

const MAX_LABEL_LENGTH = 200;
const MAX_LINK_LENGTH = 2000;

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_LINK_LENGTH) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function listAnnotations(
  request: Request,
  env: Env,
  user: User,
  projectId: string
): Promise<Response> {
  const access = await requireProjectAccess(request, env, user, projectId);
  if (access instanceof Response) return access;
  const { results } = await env.DB.prepare(
    `SELECT id, project_id, annotated_at, label, link, created_at, created_by
     FROM annotations WHERE project_id = ? ORDER BY annotated_at ASC`
  )
    .bind(projectId)
    .all<Annotation>();
  return json(request, env, { project_id: projectId, annotations: results ?? [] });
}

export async function createAnnotation(
  request: Request,
  env: Env,
  user: User,
  projectId: string
): Promise<Response> {
  const access = await requireProjectAccess(request, env, user, projectId);
  if (access instanceof Response) return access;

  const body = (await request.json().catch(() => ({}))) as {
    annotated_at?: string;
    label?: string;
    link?: string;
  };

  const annotatedAt = normalizeTimestamp(body.annotated_at);
  if (!annotatedAt) {
    return json(request, env, { error: "Valid annotated_at timestamp required" }, 400);
  }
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) {
    return json(request, env, { error: "Label required" }, 400);
  }
  if (label.length > MAX_LABEL_LENGTH) {
    return json(request, env, { error: `Label too long (max ${MAX_LABEL_LENGTH})` }, 400);
  }
  const link = normalizeLink(body.link);
  if (body.link && !link) {
    return json(request, env, { error: "Link must be a valid http(s) URL" }, 400);
  }

  const createdAt = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO annotations (project_id, annotated_at, label, link, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(projectId, annotatedAt, label, link, createdAt, user.username)
    .run();

  const annotation: Annotation = {
    id: Number(result.meta.last_row_id),
    project_id: projectId,
    annotated_at: annotatedAt,
    label,
    link,
    created_at: createdAt,
    created_by: user.username,
  };
  return json(request, env, { annotation }, 201);
}

export async function deleteAnnotation(
  request: Request,
  env: Env,
  user: User,
  projectId: string,
  annotationId: string
): Promise<Response> {
  const access = await requireProjectAccess(request, env, user, projectId);
  if (access instanceof Response) return access;

  const id = Number(annotationId);
  if (!Number.isInteger(id) || id <= 0) {
    return json(request, env, { error: "Invalid annotation id" }, 400);
  }
  const existing = await env.DB.prepare(
    `SELECT id FROM annotations WHERE id = ? AND project_id = ?`
  )
    .bind(id, projectId)
    .first();
  if (!existing) {
    return json(request, env, { error: "Annotation not found" }, 404);
  }
  await env.DB.prepare(`DELETE FROM annotations WHERE id = ? AND project_id = ?`)
    .bind(id, projectId)
    .run();
  return json(request, env, { status: "ok", deleted: id });
}

/** Read-only annotations for public share viewers (no created_by leak). */
export async function listShareAnnotations(
  env: Env,
  projectId: string
): Promise<Array<Pick<Annotation, "id" | "annotated_at" | "label" | "link">>> {
  const { results } = await env.DB.prepare(
    `SELECT id, annotated_at, label, link
     FROM annotations WHERE project_id = ? ORDER BY annotated_at ASC`
  )
    .bind(projectId)
    .all<Pick<Annotation, "id" | "annotated_at" | "label" | "link">>();
  return results ?? [];
}
