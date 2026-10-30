import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(appDir, "public");
const dataDir = path.join(appDir, "data");
const cardsPath = path.join(dataDir, "cards.json");
const authPath = path.join(dataDir, "auth.json");

await loadDotEnv();

const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const port = Number(process.env.PORT) || 3000;
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
const appOrigin = new URL(process.env.APP_ORIGIN || `http://localhost:${port}`).origin;
const googleAuth = new OAuth2Client(googleClientId || undefined);
const sessionCookieName = "askboard_session";
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const secureCookies = appOrigin.startsWith("https://");

async function loadDotEnv() {
  try {
    const contents = await readFile(path.join(appDir, ".env"), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      if (process.env[match[1]] !== undefined) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function readCards() {
  try {
    return JSON.parse(await readFile(cardsPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readAuthData() {
  try {
    const data = JSON.parse(await readFile(authPath, "utf8"));
    return {
      users: Array.isArray(data.users) ? data.users : [],
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
    };
  } catch (error) {
    if (error.code === "ENOENT") return { users: [], sessions: [] };
    throw error;
  }
}

async function saveAuthData(data) {
  await mkdir(dataDir, { recursive: true });
  const temporaryPath = `${authPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, authPath);
}

let authMutationQueue = Promise.resolve();
function updateAuth(updater) {
  const operation = authMutationQueue.then(async () => {
    const data = await readAuthData();
    const result = await updater(data);
    await saveAuthData(data);
    return result;
  });
  authMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

let writeQueue = Promise.resolve();
function saveCards(cards) {
  writeQueue = writeQueue.then(async () => {
    await mkdir(dataDir, { recursive: true });
    const temporaryPath = `${cardsPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(cards, null, 2)}\n`, "utf8");
    await rename(temporaryPath, cardsPath);
  });
  return writeQueue;
}

let mutationQueue = Promise.resolve();
function updateCards(updater) {
  const operation = mutationQueue.then(async () => {
    const cards = await readCards();
    const result = await updater(cards);
    await saveCards(cards);
    return result;
  });
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 24_000) throw Object.assign(new Error("That request is too long."), { status: 413 });
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw Object.assign(new Error("Please send a valid request."), { status: 400 });
  }
}

async function readForm(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 24_000) throw Object.assign(new Error("That request is too long."), { status: 413 });
  }
  return new URLSearchParams(body);
}

function getCookie(request, name) {
  for (const item of (request.headers.cookie || "").split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(item.slice(separator + 1).trim()); } catch { return ""; }
    }
  }
  return "";
}

function sessionHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function cookieHeader(name, value, maxAge) {
  const secure = secureCookies ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function setSessionCookie(response, token) {
  response.setHeader("Set-Cookie", cookieHeader(sessionCookieName, token, Math.floor(sessionLifetimeMs / 1000)));
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", cookieHeader(sessionCookieName, "", 0));
}

function sameOriginRequest(request) {
  return request.headers.origin === appOrigin;
}

async function getCurrentUser(request) {
  const token = getCookie(request, sessionCookieName);
  if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) return null;
  const data = await readAuthData();
  const hash = sessionHash(token);
  const session = data.sessions.find((item) => item.tokenHash === hash && Date.parse(item.expiresAt) > Date.now());
  if (!session) return null;
  return data.users.find((item) => item.googleSub === session.googleSub) || null;
}

function publicUser(user) {
  return user ? { name: user.name, email: user.email, picture: user.picture } : null;
}

function redirectAfterLogin(response, error = "") {
  const location = error ? `/?login_error=${encodeURIComponent(error)}` : "/";
  response.writeHead(303, { Location: location, "Cache-Control": "no-store" });
  response.end();
}

function getTextOutput(result) {
  const candidate = result.candidates?.[0];
  return (candidate?.content?.parts || [])
    .map((part) => part.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseNote(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const noteStart = lines.findIndex((line) => /^(?:note|answer)\s*:/i.test(line));
  let note = noteStart >= 0
    ? lines.slice(noteStart).join(" ").replace(/^(?:note|answer)\s*:\s*/i, "")
    : lines.filter((line) => !/^title\s*:/i.test(line)).join(" ");
  note = note.replace(/\s+/g, " ").trim();
  if (!note) note = text.trim();
  return note.slice(0, 720);
}

async function askGemini(question) {
  if (!process.env.GEMINI_API_KEY) {
    throw Object.assign(new Error("The AI note service is not configured yet. Add its API key in .env."), { status: 503 });
  }
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: [
        "You are a concise, thoughtful assistant. Write a useful note about the user's topic or question in 40 to 75 words.",
        "Return only the note as plain text. Do not create or suggest a title.",
      ].join(" ") }] },
      contents: [{ parts: [{ text: question }] }],
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (result.error?.message || "The AI note service could not respond right now.").replace(/\bGemini\b/gi, "AI service");
    const error = new Error(detail);
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  const output = getTextOutput(result);
  if (!output) throw Object.assign(new Error("The AI note service returned an empty result. Please try again."), { status: 502 });
  return parseNote(output);
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function serveStatic(requestPath, response) {
  let decoded;
  try { decoded = decodeURIComponent(requestPath); } catch { decoded = "/"; }
  const requestedPath = decoded === "/" ? "/index.html" : decoded;
  const filePath = path.resolve(publicDir, `.${requestedPath}`);
  if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    let file = await readFile(filePath);
    if (path.extname(filePath) === ".html") {
      const html = file.toString("utf8")
        .replaceAll("__GOOGLE_CLIENT_ID__", escapeHtmlAttribute(googleClientId))
        .replaceAll("__GOOGLE_LOGIN_URI__", escapeHtmlAttribute(`${appOrigin}/auth/google`));
      file = Buffer.from(html);
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(file);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

function escapeHtmlAttribute(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { configured: Boolean(process.env.GEMINI_API_KEY), model });
    }
    if (request.method === "GET" && url.pathname === "/api/auth/me") {
      return sendJson(response, 200, { user: publicUser(await getCurrentUser(request)) });
    }
    if (request.method === "POST" && url.pathname === "/auth/google") {
      if (!googleClientId) return redirectAfterLogin(response, "not-configured");
      if (!sameOriginRequest(request)) return redirectAfterLogin(response, "request-rejected");

      const form = await readForm(request);
      const postedCsrf = form.get("g_csrf_token");
      const cookieCsrf = getCookie(request, "g_csrf_token");
      if (!postedCsrf || !cookieCsrf || postedCsrf !== cookieCsrf) {
        return redirectAfterLogin(response, "request-rejected");
      }

      let payload;
      try {
        const ticket = await googleAuth.verifyIdToken({
          idToken: form.get("credential") || "",
          audience: googleClientId,
        });
        payload = ticket.getPayload();
      } catch {
        return redirectAfterLogin(response, "verification-failed");
      }
      if (!payload?.sub) return redirectAfterLogin(response, "verification-failed");

      const now = Date.now();
      const sessionToken = randomBytes(32).toString("base64url");
      const user = {
        googleSub: payload.sub,
        email: payload.email || "",
        name: payload.name || payload.email || "Google user",
        picture: typeof payload.picture === "string" && payload.picture.startsWith("https://") ? payload.picture : "",
      };
      await updateAuth((data) => {
        const existing = data.users.find((item) => item.googleSub === user.googleSub);
        if (existing) Object.assign(existing, user);
        else data.users.push(user);
        data.sessions = data.sessions.filter((item) => Date.parse(item.expiresAt) > now);
        data.sessions.push({
          tokenHash: sessionHash(sessionToken),
          googleSub: user.googleSub,
          expiresAt: new Date(now + sessionLifetimeMs).toISOString(),
        });
      });

      setSessionCookie(response, sessionToken);
      return redirectAfterLogin(response);
    }
    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      if (!sameOriginRequest(request)) return sendJson(response, 403, { error: "This request was rejected." });
      const token = getCookie(request, sessionCookieName);
      if (token) {
        const hash = sessionHash(token);
        await updateAuth((data) => {
          data.sessions = data.sessions.filter((item) => item.tokenHash !== hash);
        });
      }
      clearSessionCookie(response);
      return sendJson(response, 200, { signedOut: true });
    }
    if (request.method === "GET" && url.pathname === "/api/capabilities") {
      return sendJson(response, 200, { trash: true });
    }
    if (request.method === "GET" && url.pathname === "/api/cards") {
      const user = await getCurrentUser(request);
      if (!user) return sendJson(response, 401, { error: "Sign in to open your board." });
      const cards = await readCards();
      const owned = cards.filter((card) => card.ownerId === user.googleSub);
      const visible = url.searchParams.get("view") === "deleted"
        ? owned.filter((card) => card.deletedAt)
        : owned.filter((card) => !card.deletedAt);
      return sendJson(response, 200, visible);
    }
    if (request.method === "POST" && url.pathname === "/api/notes") {
      if (!sameOriginRequest(request)) return sendJson(response, 403, { error: "This request was rejected." });
      const user = await getCurrentUser(request);
      if (!user) return sendJson(response, 401, { error: "Sign in to save a note." });
      const body = await readJson(request);
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const noteBody = typeof body.body === "string" ? body.body.trim() : "";
      if (!title && !noteBody) return sendJson(response, 400, { error: "Write something before saving your note." });
      if (title.length > 120) return sendJson(response, 400, { error: "Keep the title under 120 characters." });
      if (noteBody.length > 5000) return sendJson(response, 400, { error: "Keep your note under 5,000 characters." });
      const card = {
        id: randomUUID(),
        ownerId: user.googleSub,
        type: "note",
        title,
        body: noteBody,
        createdAt: new Date().toISOString(),
        favorite: false,
      };
      await updateCards((cards) => cards.unshift(card));
      return sendJson(response, 201, card);
    }
    if (request.method === "POST" && url.pathname === "/api/ask") {
      if (!sameOriginRequest(request)) return sendJson(response, 403, { error: "This request was rejected." });
      const user = await getCurrentUser(request);
      if (!user) return sendJson(response, 401, { error: "Sign in to create an AI note." });
      const body = await readJson(request);
      const question = typeof body.question === "string" ? body.question.trim() : "";
      if (!question) return sendJson(response, 400, { error: "Enter a topic or question first." });
      if (question.length > 500) return sendJson(response, 400, { error: "Keep your prompt under 500 characters." });
      const answer = await askGemini(question);
      const card = {
        id: randomUUID(),
        ownerId: user.googleSub,
        type: "answer",
        question,
        title: question,
        answer,
        createdAt: new Date().toISOString(),
        favorite: false,
      };
      await updateCards((cards) => cards.unshift(card));
      return sendJson(response, 201, card);
    }
    const cardPathMatch = url.pathname.match(/^\/api\/cards\/([a-f0-9-]+)$/i);
    const restoreCardPathMatch = url.pathname.match(/^\/api\/cards\/([a-f0-9-]+)\/restore$/i);
    const permanentDeletePathMatch = url.pathname.match(/^\/api\/cards\/([a-f0-9-]+)\/permanent$/i);
    if (cardPathMatch && request.method === "PATCH") {
      if (!sameOriginRequest(request)) return sendJson(response, 403, { error: "This request was rejected." });
      const user = await getCurrentUser(request);
      if (!user) return sendJson(response, 401, { error: "Sign in to update your board." });
      const body = await readJson(request);
      if (Object.hasOwn(body, "title") && (typeof body.title !== "string" || body.title.trim().length > 120)) {
        return sendJson(response, 400, { error: "Keep the title under 120 characters." });
      }
      if (Object.hasOwn(body, "body") && (typeof body.body !== "string" || body.body.trim().length > 5000)) {
        return sendJson(response, 400, { error: "Keep your note under 5,000 characters." });
      }
      if (Object.hasOwn(body, "question") && (typeof body.question !== "string" || !body.question.trim() || body.question.trim().length > 500)) {
        return sendJson(response, 400, { error: "Keep the prompt or topic between 1 and 500 characters." });
      }
      if (Object.hasOwn(body, "answer") && (typeof body.answer !== "string" || !body.answer.trim() || body.answer.trim().length > 5000)) {
        return sendJson(response, 400, { error: "Keep the AI note between 1 and 5,000 characters." });
      }
      const card = await updateCards((cards) => {
        const found = cards.find((item) => item.id === cardPathMatch[1] && item.ownerId === user.googleSub);
        if (!found || found.deletedAt) return null;
        if (found.type === "note" && (Object.hasOwn(body, "question") || Object.hasOwn(body, "answer"))) return null;
        if (found.type !== "note" && Object.hasOwn(body, "body")) return null;
        if (typeof body.favorite === "boolean") found.favorite = body.favorite;
        if (Object.hasOwn(body, "title") || Object.hasOwn(body, "body") || Object.hasOwn(body, "question") || Object.hasOwn(body, "answer")) {
          if (found.type === "note" && typeof body.title === "string") found.title = body.title.trim();
          if (typeof body.body === "string") found.body = body.body.trim();
          if (typeof body.question === "string") found.question = body.question.trim();
          if (typeof body.answer === "string") found.answer = body.answer.trim();
          if (found.type !== "note") found.title = found.question;
          found.updatedAt = new Date().toISOString();
        }
        return found;
      });
      if (!card) return sendJson(response, 404, { error: "That card could not be found." });
      return sendJson(response, 200, card);
    }
    if (restoreCardPathMatch && request.method === "POST") {
      if (!sameOriginRequest(request)) return sendJson(response, 403, { error: "This request was rejected." });
      const user = await getCurrentUser(request);
      if (!user) return sendJson(response, 401, { error: "Sign in to update your board." });
      const restored = await updateCards((cards) => {
        const found = cards.find((item) => item.id === restoreCardPathMatch[1] && item.ownerId === user.googleSub && item.deletedAt);
        if (!found) return null;
        delete found.deletedAt;
        found.updatedAt = new Date().toISOString();
        return found;
      });
      if (!restored) return sendJson(response, 404, { error: "That deleted card could not be found." });
      return sendJson(response, 200, restored);
    }
    if (permanentDeletePathMatch && request.method === "DELETE") {
      if (!sameOriginRequest(request)) return sendJson(response, 403, { error: "This request was rejected." });
      const user = await getCurrentUser(request);
      if (!user) return sendJson(response, 401, { error: "Sign in to update your board." });
      const deleted = await updateCards((cards) => {
        const index = cards.findIndex((item) => item.id === permanentDeletePathMatch[1] && item.ownerId === user.googleSub && item.deletedAt);
        if (index < 0) return false;
        cards.splice(index, 1);
        return true;
      });
      if (!deleted) return sendJson(response, 404, { error: "That deleted card could not be found." });
      return sendJson(response, 200, { deleted: true, permanent: true });
    }
    if (cardPathMatch && request.method === "DELETE") {
      if (!sameOriginRequest(request)) return sendJson(response, 403, { error: "This request was rejected." });
      const user = await getCurrentUser(request);
      if (!user) return sendJson(response, 401, { error: "Sign in to update your board." });
      const deleted = await updateCards((cards) => {
        const found = cards.find((item) => item.id === cardPathMatch[1] && item.ownerId === user.googleSub && !item.deletedAt);
        if (!found) return null;
        found.deletedAt = new Date().toISOString();
        return found;
      });
      if (!deleted) return sendJson(response, 404, { error: "That card could not be found." });
      return sendJson(response, 200, deleted);
    }
    if (url.pathname.startsWith("/api/")) return sendJson(response, 404, { error: "API route not found." });
    return serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendJson(response, error.status || 500, { error: error.message || "Something went wrong." });
    else response.end();
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`AskNotes is ready at http://localhost:${port}`);
  if (!process.env.GEMINI_API_KEY) console.log("Add GEMINI_API_KEY to .env to enable AI notes.");
});
