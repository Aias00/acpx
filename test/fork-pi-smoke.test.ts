import assert from "node:assert/strict";
import test from "node:test";
import { createScriptedModel } from "../scripts/fork-local-pi-model.mjs";

const nonce = "synthetic-fixture-nonce";
const tools = ["write", "read"].map((name) => ({ type: "function", function: { name } }));
function body(phase: string, tool?: string) {
  return {
    model: "fork-loopback",
    stream: true,
    tools,
    messages: [
      { role: "user", content: `fork-smoke-${phase}:${nonce}` },
      ...(tool ? [{ role: "tool", tool_call_id: tool, content: nonce }] : []),
    ],
  };
}

test("Pi scripted wire fixture permits four exchanges for two admissions only", () => {
  const model = createScriptedModel(nonce);
  const write = model.respond(body("one"), undefined);
  assert.ok(write.includes("fork_write"));
  assert.ok(write.endsWith("data: [DONE]\n\n"));
  assert.throws(() => model.respond(body("one", "fork_write"), undefined));
  model.respond(body("one", "fork_write"), nonce + "\n");
  const read = model.respond(body("two"), nonce + "\n");
  assert.ok(read.includes("fork_read"));
  assert.throws(() => model.respond(body("two", "fork_write"), nonce + "\n"));
  model.respond(body("two", "fork_read"), nonce + "\n");
  assert.equal(model.trace.length, 4);
  assert.throws(() => model.respond(body("two"), nonce + "\n"));
});

test("Pi scripted wire fixture rejects wrong model, phase and unavailable tool", () => {
  const model = createScriptedModel(nonce);
  assert.throws(() => model.respond({ ...body("one"), model: "cloud" }, undefined));
  assert.throws(() => model.respond({ ...body("one"), stream: false }, undefined));
  assert.throws(() => model.respond(body("two"), undefined));
  assert.throws(() => model.respond({ ...body("one"), tools: [] }, undefined));
  assert.equal(model.trace.length, 0);
});

test("Pi scripted wire fixture accepts structured text blocks without accepting other content", () => {
  const model = createScriptedModel(nonce);
  assert.throws(() =>
    model.respond(
      {
        ...body("one"),
        messages: [
          { role: "user", content: [{ type: "image_url", text: `fork-smoke-one:${nonce}` }] },
        ],
      },
      undefined,
    ),
  );
  model.respond(
    {
      ...body("one"),
      messages: [{ role: "user", content: [{ type: "text", text: `fork-smoke-one:${nonce}` }] }],
    },
    undefined,
  );
  assert.equal(model.trace.length, 1);
});
