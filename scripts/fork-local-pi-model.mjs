import assert from "node:assert/strict";

// A deterministic wire fixture, not a model or a native outcome classifier.
// Four model HTTP exchanges implement exactly two admitted ACP prompts.
export function createScriptedModel(nonce) {
  let step = 0;
  const trace = [];
  return {
    trace,
    respond(body, effect) {
      assert.equal(body.model, "fork-loopback");
      assert.equal(body.stream, true);
      assert.ok(step < 4, "model HTTP budget exhausted; never retry automatically");
      const messages = body.messages;
      assert.ok(Array.isArray(messages));
      const lastUser = messages.findLast((message) => message.role === "user");
      const phase = step < 2 ? "one" : "two";
      const userContent = Array.isArray(lastUser?.content)
        ? lastUser.content
            .map((block) => {
              assert.equal(block.type, "text");
              return block.text;
            })
            .join("")
        : lastUser?.content;
      assert.equal(userContent, `fork-smoke-${phase}:${nonce}`);
      let delta;
      let finish;
      if (step % 2 === 0) {
        const name = step === 0 ? "write" : "read";
        assert.ok(body.tools?.some((tool) => tool.function?.name === name));
        const args = { path: "effect.txt" };
        if (name === "write") {
          args.content = nonce + "\n";
        } else {
          assert.equal(effect, nonce + "\n");
        }
        delta = {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `fork_${name}`,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        };
        finish = "tool_calls";
      } else {
        const tool = messages.at(-1);
        assert.equal(tool?.role, "tool");
        assert.equal(tool.tool_call_id, step === 1 ? "fork_write" : "fork_read");
        assert.equal(effect, nonce + "\n", "actual filesystem effect missing");
        if (step === 3) {
          // This is a scripted fixture payload check, never native outcome truth.
          assert.ok(JSON.stringify(tool.content).includes(nonce));
        }
        delta = { role: "assistant", content: `fork-smoke-${phase}-ack:${nonce}` };
        finish = "stop";
      }
      trace.push({ step, phase, effectVerified: step > 0, finish });
      const frame = {
        id: `fork_completion_${step++}`,
        object: "chat.completion.chunk",
        created: 1,
        model: "fork-loopback",
      };
      return (
        [
          { ...frame, choices: [{ index: 0, delta, finish_reason: null }] },
          {
            ...frame,
            choices: [{ index: 0, delta: {}, finish_reason: finish }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          },
        ]
          .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
          .join("") + "data: [DONE]\n\n"
      );
    },
  };
}
