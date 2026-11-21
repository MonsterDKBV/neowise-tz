import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));

const TOPICS = ["delivery", "pricing", "other"];
const MODEL_TIMEOUT_MS = 300;
const MANUAL_REVIEW = { status: "manual_review", topic: null, draft: null };

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

// Returns the request text, or null if the input is invalid.
function parseInput(raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  const text = body?.text;
  return typeof text === "string" && text.trim() !== "" ? text : null;
}

// Checks the model output. Returns { topic, draft } or null if it is unusable.
function parseModelReply(raw) {
  let reply;
  try {
    reply = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!TOPICS.includes(reply?.topic)) return null;
  if (typeof reply.draft !== "string" || reply.draft.trim() === "") return null;
  return { topic: reply.topic, draft: reply.draft };
}

async function handleTriage(request, response) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = parseInput(Buffer.concat(chunks).toString("utf8"));
  if (text === null) return json(response, 400, { status: "invalid_input" });

  // One shared deadline for both attempts: the model is never awaited longer than 300 ms in total.
  const signal = AbortSignal.timeout(MODEL_TIMEOUT_MS);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = parseModelReply(await classify(text, { signal }));
      if (result) return json(response, 200, { status: "ready", ...result });
      console.error(`triage: unusable model reply (attempt ${attempt})`);
    } catch (error) {
      console.error(`triage: model failed (attempt ${attempt}): ${error.message}`);
      if (signal.aborted) break; // no time left for a retry
    }
  }
  return json(response, 200, MANUAL_REVIEW);
}

export const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }
  if (request.method !== "POST" || request.url !== "/api/triage") {
    return json(response, 404, { status: "not_found" });
  }
  try {
    await handleTriage(request, response);
  } catch {
    json(response, 500, { status: "server_error" });
  }
});

// Start listening only when run as `node server.mjs`, not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(Number(process.env.PORT || 3000), "127.0.0.1");
}
