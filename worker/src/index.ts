type UserRow = {
  id: string;
  encrypted_data: string | null;
  name: string | null;
  contact_name: string | null;
  contact_method: string | null;
  note: string | null;
  period: string;
  last_checkin: string;
  created_at: string;
};

type SecureUserRow = Pick<UserRow, "id" | "encrypted_data" | "period" | "last_checkin" | "created_at">;

type AdminUser = {
  id: string;
  name: string;
  contact_name: string;
  contact_method: string;
  note: string;
  period: string;
  last_checkin: string;
  created_at: string;
  is_overdue: boolean;
  overdue_duration: string;
};

type JsonRequest = {
  id?: string;
  encrypted_data?: string;
  period?: string;
};

type SosPayload = {
  name?: string;
  contact_name?: string;
  contact_method?: string;
  note?: string;
};

// Secret bindings are not declared in wrangler.jsonc, so they are augmented
// here while the platform bindings continue to come from wrangler types.
type AppEnv = Env & {
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
};

const PERIODS = new Set(["24h", "48h", "72h", "1w"]);
const JSON_HEADERS = {
  "content-type": "application/json; charset=UTF-8",
  "cache-control": "no-store",
};
const SESSION_COOKIE = "admin_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_ENCRYPTED_DATA_CHARS = 60 * 1024;

class RequestInputError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const appEnv = env as AppEnv;

    try {
      if (url.pathname === "/api/register") return handleRegister(request, appEnv);
      if (url.pathname === "/api/login") return handleLogin(request, appEnv);
      if (url.pathname === "/api/checkin") return handleCheckin(request, appEnv);
      if (url.pathname === "/api/update_period") return handleUpdatePeriod(request, appEnv);
      if (url.pathname === "/api/delete") return handleDelete(request, appEnv);
      if (url.pathname === "/api/sos") return handleSos(request, appEnv);
      if (url.pathname === "/api/admin/users") return handleAdminUsers(request, appEnv);
      if (url.pathname === "/baby") return handleBaby(request, appEnv);

      return appEnv.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof RequestInputError) return textError(error.message, error.status);
      console.error(JSON.stringify({ event: "request_error", path: url.pathname, error: String(error) }));
      return textError("服务器内部错误", 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function handleRegister(request: Request, env: AppEnv): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();

  const req = await readJson<JsonRequest>(request);
  if (!isHashId(req.id) || !isEncryptedData(req.encrypted_data) || !req.period || !PERIODS.has(req.period)) {
    return textError("注册数据不完整", 400);
  }

  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO users
        (id, encrypted_data, period, last_checkin, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(req.id, req.encrypted_data, req.period, now, now)
      .run();
  } catch {
    return textError("User already exists or database error", 409);
  }

  return json({ status: "success" }, 201);
}

async function handleLogin(request: Request, env: AppEnv): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();

  const req = await readJson<JsonRequest>(request);
  if (!isHashId(req.id)) return textError("User not found", 404);

  const row = await env.DB.prepare(
    `SELECT id, encrypted_data, period, last_checkin, created_at
     FROM users WHERE id = ?`,
  )
    .bind(req.id)
    .first<SecureUserRow>();

  if (!row) return textError("User not found", 404);
  if (!row.encrypted_data) return textError("此账户需要重新注册安全密钥", 410);
  return json(toSecureUserResponse(row));
}

async function handleCheckin(request: Request, env: AppEnv): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  const req = await readJson<JsonRequest>(request);
  if (!isHashId(req.id)) return textError("User not found", 404);

  const now = new Date().toISOString();
  const result = await env.DB.prepare("UPDATE users SET last_checkin = ? WHERE id = ?")
    .bind(now, req.id)
    .run();

  if (result.meta.changes !== 1) return textError("User not found", 404);
  return json({ status: "success", time: now });
}

async function handleUpdatePeriod(request: Request, env: AppEnv): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  const req = await readJson<JsonRequest>(request);
  if (!isHashId(req.id) || !req.period || !PERIODS.has(req.period)) {
    return textError("Invalid period", 400);
  }

  const result = await env.DB.prepare("UPDATE users SET period = ? WHERE id = ?")
    .bind(req.period, req.id)
    .run();
  if (result.meta.changes !== 1) return textError("User not found", 404);
  return json({ status: "success" });
}

async function handleDelete(request: Request, env: AppEnv): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  const req = await readJson<JsonRequest>(request);
  if (!isHashId(req.id)) return textError("User not found", 404);

  const result = await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(req.id).run();
  if (result.meta.changes !== 1) return textError("User not found", 404);
  return json({ status: "deleted" });
}

async function handleSos(request: Request, env: AppEnv): Promise<Response> {
  let payload: SosPayload;
  if (request.method === "GET") {
    const url = new URL(request.url);
    payload = {
      name: url.searchParams.get("name") ?? "",
      contact_name: url.searchParams.get("contact_name") ?? "",
      contact_method: url.searchParams.get("contact_method") ?? "",
      note: url.searchParams.get("note") ?? "",
    };
  } else if (request.method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      payload = await readJson<SosPayload>(request);
    } else {
      const form = await request.formData();
      payload = {
        name: String(form.get("name") ?? ""),
        contact_name: String(form.get("contact_name") ?? ""),
        contact_method: String(form.get("contact_method") ?? ""),
        note: String(form.get("note") ?? ""),
      };
    }
  } else {
    return methodNotAllowed();
  }

  if (!payload.name || !payload.contact_name || !payload.contact_method) {
    return textError("Missing required fields: name, contact_name, contact_method", 400);
  }

  const id = `api_${crypto.randomUUID()}`;
  const now = new Date();
  await env.DB.prepare(
    `INSERT INTO users
      (id, encrypted_data, name, contact_name, contact_method, note, period, last_checkin, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      payload.name,
      payload.contact_name,
      payload.contact_method,
      payload.note ?? "",
      "ALERT",
      new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      now.toISOString(),
    )
    .run();

  return json({ status: "success", id }, 201);
}

async function handleBaby(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("action") === "logout") {
    return redirect("/baby", clearSessionCookie(url.protocol === "https:"));
  }

  if (request.method === "POST") {
    const form = await request.formData();
    const action = String(form.get("action") ?? "");

    if (action === "login") {
      const username = String(form.get("username") ?? "");
      const password = String(form.get("password") ?? "");
      if (!(await validAdminCredentials(username, password, env))) {
        return redirect("/baby?error=1");
      }
      const cookie = await createSessionCookie(env.SESSION_SECRET, new URL(request.url).protocol === "https:");
      return redirect("/baby", cookie);
    }

    if (action === "delete" && (await hasValidSession(request, env.SESSION_SECRET))) {
      const id = String(form.get("id") ?? "");
      if (isUserId(id)) await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
      return redirect("/baby");
    }

    return textError("未授权", 401);
  }

  const response = await env.ASSETS.fetch(new Request(new URL("/admin.html", request.url)));
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "no-store" },
  });
}

async function handleAdminUsers(request: Request, env: AppEnv): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed();
  if (!(await hasValidSession(request, env.SESSION_SECRET))) return textError("未授权", 401);

  const result = await env.DB.prepare(
    `SELECT id, name, contact_name, contact_method, note, period, last_checkin, created_at
     FROM users ORDER BY created_at DESC`,
  )
    .all<UserRow>();

  const users: AdminUser[] = result.results.map((row: UserRow) => {
    const [isOverdue, overdueDuration] = checkOverdue(row.last_checkin, row.period);
    const triggered = row.period === "ALERT";
    return {
      id: row.id,
      name: triggered ? row.name ?? "" : "触发前不可见",
      contact_name: triggered ? row.contact_name ?? "" : "触发前不可见",
      contact_method: triggered ? row.contact_method ?? "" : "触发前不可见",
      note: triggered ? row.note ?? "" : "触发前不可见",
      period: row.period,
      last_checkin: row.last_checkin,
      created_at: row.created_at,
      is_overdue: isOverdue,
      overdue_duration: overdueDuration,
    };
  });

  return json({ users });
}

function toSecureUserResponse(row: SecureUserRow) {
  return {
    id: row.id,
    encrypted_data: row.encrypted_data,
    period: row.period,
    last_checkin: row.last_checkin,
    created_at: row.created_at,
  };
}

function checkOverdue(lastCheckin: string, period: string): [boolean, string] {
  if (period === "ALERT") return [true, "外部触发"];

  const durations: Record<string, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "48h": 48 * 60 * 60 * 1000,
    "72h": 72 * 60 * 60 * 1000,
    "1w": 7 * 24 * 60 * 60 * 1000,
  };
  const elapsed = Date.now() - Date.parse(lastCheckin);
  const overdue = elapsed - (durations[period] ?? durations["24h"]);
  if (overdue <= 0) return [false, ""];

  const hours = Math.floor(overdue / (60 * 60 * 1000));
  const minutes = Math.floor(overdue / (60 * 1000)) % 60;
  return [true, `${hours}h ${minutes}m`];
}

async function readJson<T>(request: Request): Promise<T> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) throw new RequestInputError("request body too large", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new RequestInputError("request body too large", 413);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RequestInputError("Invalid JSON", 400);
  }
}

async function validAdminCredentials(username: string, password: string, env: AppEnv): Promise<boolean> {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) return false;
  return (
    (await safeSecretEqual(username, env.ADMIN_USERNAME, env.SESSION_SECRET)) &&
    (await safeSecretEqual(password, env.ADMIN_PASSWORD, env.SESSION_SECRET))
  );
}

async function safeSecretEqual(input: string, expected: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const expectedSignature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expected));
  return crypto.subtle.verify("HMAC", key, expectedSignature, new TextEncoder().encode(input));
}

async function createSessionCookie(secret: string | undefined, secure: boolean): Promise<string> {
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  const payload = `${Date.now() + SESSION_TTL_SECONDS * 1000}:admin`;
  const signature = await sign(payload, secret);
  const token = `${base64Url(payload)}.${base64UrlBytes(signature)}`;
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax`;
}

function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax`;
}

async function hasValidSession(request: Request, secret: string | undefined): Promise<boolean> {
  if (!secret) return false;
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return false;
  const [encodedPayload, encodedSignature] = token.split(".");
  if (!encodedPayload || !encodedSignature) return false;

  try {
    const payload = decodeBase64Url(encodedPayload);
    const [expiresAt, subject] = payload.split(":");
    if (subject !== "admin" || Number(expiresAt) < Date.now()) return false;
    const signature = decodeBase64UrlBytes(encodedSignature);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(payload));
  } catch {
    return false;
  }
}

async function sign(value: string, secret: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
}

function getCookie(request: Request, name: string): string | undefined {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

function base64Url(value: string): string {
  return base64UrlBytes(new TextEncoder().encode(value).buffer);
}

function base64UrlBytes(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  return new TextDecoder().decode(decodeBase64UrlBytes(value));
}

function decodeBase64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function isHashId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isEncryptedData(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_ENCRYPTED_DATA_CHARS &&
    /^[0-9a-f]{24}:[0-9a-f]+$/i.test(value)
  );
}

function isUserId(value: string): boolean {
  return isHashId(value) || /^api_[0-9a-z-]+$/i.test(value);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function textError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=UTF-8", "cache-control": "no-store" },
  });
}

function methodNotAllowed(): Response {
  return textError("Method not allowed", 405);
}

function redirect(location: string, setCookie?: string): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  if (setCookie) headers.set("set-cookie", setCookie);
  return new Response(null, { status: 303, headers });
}
