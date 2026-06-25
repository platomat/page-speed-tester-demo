import type { Env, RunPayload } from "./env";
import {
  handleBootstrap,
  handleLogin,
  handleLogout,
  handleMe,
  handleSetupStatus,
  getCurrentUser,
} from "./auth";
import { corsHeaders, json } from "./http";
import {
  createProject,
  createProjectUrl,
  deleteProject,
  deleteProjectUrl,
  getMetrics,
  getReportJson,
  getReports,
  deleteReports,
  insertRun,
  internalProjectUrls,
  listProjectUrls,
  listProjects,
  triggerProject,
  triggerProjectUrl,
  publicTriggerProject,
  updateProject,
  updateProjectUrl,
} from "./projects";
import {
  publicShareAnnotations,
  publicShareMetrics,
  publicShareProject,
  publicShareReportJson,
  publicShareReports,
} from "./share";
import {
  createAnnotation,
  deleteAnnotation,
  listAnnotations,
  updateAnnotation,
} from "./annotations";
import { runScheduledProjects } from "./scheduler";
import {
  getRunStatus,
  registerRunCompleted,
  registerRunStarted,
  resetRunStatus,
} from "./run-status";
import {
  assignUserProject,
  createUser,
  listUserProjects,
  listUsers,
  unassignUserProject,
} from "./users";
import { getSettings, updateSettings } from "./settings";
import {
  getUpstreamStatus,
  registerUpstreamSyncResult,
  syncUpstream,
} from "./github-sync";

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(request, env) });
  }

  const publicTriggerMatch = path.match(/^\/api\/public\/trigger\/([^/]+)$/);
  if (publicTriggerMatch && method === "GET") {
    return publicTriggerProject(request, env, decodeURIComponent(publicTriggerMatch[1]));
  }

  if (path === "/api/public/share/report" && method === "GET") {
    return publicShareReportJson(request, env);
  }

  const publicShareMatch = path.match(/^\/api\/public\/share\/([^/]+)$/);
  if (publicShareMatch && method === "GET") {
    return publicShareProject(request, env, decodeURIComponent(publicShareMatch[1]));
  }

  const publicShareMetricsMatch = path.match(/^\/api\/public\/share\/([^/]+)\/metrics$/);
  if (publicShareMetricsMatch && method === "GET") {
    return publicShareMetrics(request, env, decodeURIComponent(publicShareMetricsMatch[1]));
  }

  const publicShareReportsMatch = path.match(/^\/api\/public\/share\/([^/]+)\/reports$/);
  if (publicShareReportsMatch && method === "GET") {
    return publicShareReports(request, env, decodeURIComponent(publicShareReportsMatch[1]));
  }

  const publicShareAnnotationsMatch = path.match(
    /^\/api\/public\/share\/([^/]+)\/annotations$/
  );
  if (publicShareAnnotationsMatch && method === "GET") {
    return publicShareAnnotations(
      request,
      env,
      decodeURIComponent(publicShareAnnotationsMatch[1])
    );
  }

  // Auth
  if (path === "/api/auth/bootstrap" && method === "POST") {
    return handleBootstrap(request, env);
  }
  if (path === "/api/auth/login" && method === "POST") {
    return handleLogin(request, env);
  }
  if (path === "/api/auth/logout" && method === "POST") {
    return handleLogout(request, env);
  }
  if (path === "/api/auth/me" && method === "GET") {
    return handleMe(request, env);
  }
  if (path === "/api/auth/setup" && method === "GET") {
    return handleSetupStatus(request, env);
  }

  if (path === "/api/settings" && method === "GET") {
    return getSettings(request, env);
  }
  if (path === "/api/settings" && method === "PATCH") {
    return updateSettings(request, env);
  }

  if (path === "/api/github/upstream-status" && method === "GET") {
    return getUpstreamStatus(request, env);
  }
  if (path === "/api/github/sync-upstream" && method === "POST") {
    return syncUpstream(request, env);
  }

  const user = await getCurrentUser(request, env);

  // Projects
  if (path === "/api/projects" && method === "GET") {
    if (!user) return json(request, env, { error: "Unauthorized" }, 401);
    return listProjects(request, env, user);
  }
  if (path === "/api/projects" && method === "POST") {
    return createProject(request, env);
  }

  const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1]);
    if (method === "PATCH") return updateProject(request, env, projectId);
    if (method === "DELETE") return deleteProject(request, env, projectId);
  }

  const runStatusMatch = path.match(/^\/api\/projects\/([^/]+)\/run-status$/);
  if (runStatusMatch && method === "GET") {
    if (!user) return json(request, env, { error: "Unauthorized" }, 401);
    return getRunStatus(request, env, user, decodeURIComponent(runStatusMatch[1]));
  }
  if (runStatusMatch && method === "DELETE") {
    if (!user) return json(request, env, { error: "Unauthorized" }, 401);
    return resetRunStatus(request, env, user, decodeURIComponent(runStatusMatch[1]));
  }

  const triggerMatch = path.match(/^\/api\/projects\/([^/]+)\/trigger$/);
  if (triggerMatch && method === "POST") {
    return triggerProject(request, env, decodeURIComponent(triggerMatch[1]));
  }

  const urlTriggerMatch = path.match(/^\/api\/projects\/([^/]+)\/urls\/([^/]+)\/trigger$/);
  if (urlTriggerMatch && method === "POST") {
    return triggerProjectUrl(
      request,
      env,
      decodeURIComponent(urlTriggerMatch[1]),
      decodeURIComponent(urlTriggerMatch[2])
    );
  }

  const urlsMatch = path.match(/^\/api\/projects\/([^/]+)\/urls$/);
  if (urlsMatch) {
    const projectId = decodeURIComponent(urlsMatch[1]);
    if (method === "GET") {
      if (!user) return json(request, env, { error: "Unauthorized" }, 401);
      return listProjectUrls(request, env, projectId, user);
    }
    if (method === "POST") return createProjectUrl(request, env, projectId);
  }

  const urlItemMatch = path.match(/^\/api\/projects\/([^/]+)\/urls\/([^/]+)$/);
  if (urlItemMatch) {
    const projectId = decodeURIComponent(urlItemMatch[1]);
    const urlId = decodeURIComponent(urlItemMatch[2]);
    if (method === "PATCH") return updateProjectUrl(request, env, projectId, urlId);
    if (method === "DELETE") return deleteProjectUrl(request, env, projectId, urlId);
  }

  const annotationsMatch = path.match(/^\/api\/projects\/([^/]+)\/annotations$/);
  if (annotationsMatch) {
    if (!user) return json(request, env, { error: "Unauthorized" }, 401);
    const projectId = decodeURIComponent(annotationsMatch[1]);
    if (method === "GET") return listAnnotations(request, env, user, projectId);
    if (method === "POST") return createAnnotation(request, env, user, projectId);
  }

  const annotationItemMatch = path.match(
    /^\/api\/projects\/([^/]+)\/annotations\/([^/]+)$/
  );
  if (annotationItemMatch) {
    if (!user) return json(request, env, { error: "Unauthorized" }, 401);
    const projectId = decodeURIComponent(annotationItemMatch[1]);
    const annotationId = decodeURIComponent(annotationItemMatch[2]);
    if (method === "PATCH") {
      return updateAnnotation(request, env, user, projectId, annotationId);
    }
    if (method === "DELETE") {
      return deleteAnnotation(request, env, user, projectId, annotationId);
    }
  }

  const internalMatch = path.match(/^\/api\/internal\/projects\/([^/]+)\/urls$/);
  if (internalMatch && method === "GET") {
    return internalProjectUrls(request, env, decodeURIComponent(internalMatch[1]));
  }

  if (path === "/api/internal/runs/started" && method === "POST") {
    return registerRunStarted(request, env);
  }
  if (path === "/api/internal/runs/completed" && method === "POST") {
    return registerRunCompleted(request, env);
  }
  if (path === "/api/internal/upstream-sync/result" && method === "POST") {
    return registerUpstreamSyncResult(request, env);
  }

  // Users (admin)
  if (path === "/api/users" && method === "GET") return listUsers(request, env);
  if (path === "/api/users" && method === "POST") return createUser(request, env);

  const userProjectsMatch = path.match(/^\/api\/users\/([^/]+)\/projects$/);
  if (userProjectsMatch) {
    const userId = decodeURIComponent(userProjectsMatch[1]);
    if (method === "GET") return listUserProjects(request, env, userId);
    if (method === "POST") return assignUserProject(request, env, userId);
  }

  const userProjectMatch = path.match(/^\/api\/users\/([^/]+)\/projects\/([^/]+)$/);
  if (userProjectMatch && method === "DELETE") {
    return unassignUserProject(
      request,
      env,
      decodeURIComponent(userProjectMatch[1]),
      decodeURIComponent(userProjectMatch[2])
    );
  }

  // Metrics & reports (auth required)
  if (path === "/api/metrics" && method === "GET") {
    if (!user) return json(request, env, { error: "Unauthorized" }, 401);
    const projectId = url.searchParams.get("project_id");
    const urlId = url.searchParams.get("url_id");
    const strategy = url.searchParams.get("strategy") ?? "desktop";
    if (!projectId || !urlId) {
      return json(request, env, { error: "project_id and url_id required" }, 400);
    }
    return getMetrics(request, env, user, projectId, urlId, strategy);
  }

  if (path === "/api/reports" && method === "GET") {
    const reportKey = url.searchParams.get("key");
    if (reportKey) {
      if (!user) return json(request, env, { error: "Unauthorized" }, 401);
      return getReportJson(request, env, user, reportKey);
    }
    if (!user) return json(request, env, { error: "Unauthorized" }, 401);
    const projectId = url.searchParams.get("project_id");
    const urlId = url.searchParams.get("url_id");
    if (!projectId || !urlId) {
      return json(request, env, { error: "project_id and url_id required" }, 400);
    }
    return getReports(request, env, user, projectId, urlId);
  }

  if (path === "/api/reports" && method === "DELETE") {
    if (!user) return json(request, env, { error: "Unauthorized" }, 401);
    return deleteReports(request, env, user);
  }

  const reportFileMatch = path.match(/^\/api\/reports\/([^/]+)\/([^/]+)$/);
  if (reportFileMatch && method === "GET") {
    if (!user) return json(request, env, { error: "Unauthorized" }, 401);
    const projectId = decodeURIComponent(reportFileMatch[1]);
    const filename = decodeURIComponent(reportFileMatch[2]);
    return getReportJson(request, env, user, `reports/${projectId}/${filename}`);
  }

  if (path === "/api/runs" && method === "POST") {
    const payload = (await request.json()) as RunPayload;
    return insertRun(request, env, payload);
  }

  if (path === "/" || path === "/health") {
    return json(request, env, { status: "ok", service: "page-speed-tester" });
  }

  return json(request, env, { error: "Not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return json(request, env, { error: message }, 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledProjects(env));
  },
};
