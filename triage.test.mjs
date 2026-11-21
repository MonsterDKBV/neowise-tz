import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { server } from "./server.mjs";

let baseUrl;

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

function triage(body) {
  return fetch(`${baseUrl}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

test("normal request returns ready with topic and draft", async () => {
  const reply = await triage(JSON.stringify({ text: "Когда будет доставка?" }));
  assert.equal(reply.status, 200);
  const data = await reply.json();
  assert.equal(data.status, "ready");
  assert.equal(data.topic, "delivery");
  assert.ok(data.draft.trim());
});

for (const label of ["[timeout]", "[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
  test(`${label} returns manual_review`, async () => {
    const started = Date.now();
    const reply = await triage(JSON.stringify({ text: `Сколько стоит? ${label}` }));
    assert.equal(reply.status, 200);
    assert.deepEqual(await reply.json(), { status: "manual_review", topic: null, draft: null });
    assert.ok(Date.now() - started < 1000, "server must not wait for the model longer than 300 ms");
  });
}

for (const body of ["", "{broken", "null", "{}", '{"text":5}', '{"text":"   "}']) {
  test(`invalid input ${JSON.stringify(body)} returns 400`, async () => {
    const reply = await triage(body);
    assert.equal(reply.status, 400);
    assert.deepEqual(await reply.json(), { status: "invalid_input" });
  });
}
