import { strict as assert } from "node:assert";
import { summarize } from "../../benchmarks/hop_stats.js";
import { attachChannel, makeLink, sendFrame } from "../../room/transport.js";

Deno.test("hop probe reports interpolated p50 and p90", () => {
  assert.deepEqual(summarize([4, 1, 2, 3]), { n: 4, min: 1, p50: 2.5, p90: 3.7, max: 4, mean: 2.5 });
  assert.throws(() => summarize([1, Infinity]));
});

Deno.test("raw channel attachment uses production frame slicing and reassembly", async () => {
  const left = { readyState: "open", bufferedAmount: 0 };
  const right = { readyState: "open", bufferedAmount: 0 };
  left.send = (data) => queueMicrotask(() => right.onmessage({ data }));
  right.send = (data) => queueMicrotask(() => left.onmessage({ data }));
  const a = makeLink({ dup: 0 }), b = makeLink({ dup: 0 }), received = [];
  attachChannel(a, left, () => {});
  attachChannel(b, right, (frame) => received.push(frame));
  const payload = Uint16Array.from({ length: 6000 }, (_, i) => i);
  assert.equal(sendFrame(a, { t: "ai-hidden", pos: 12, data: payload }), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(received.length, 1);
  assert.equal(received[0].pos, 12);
  assert.deepEqual(received[0].data, payload);
});
