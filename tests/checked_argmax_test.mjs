import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { checkedArgmax } from "./checked_argmax.js";
export function verifyCheckedArgmax() {
  assert.equal(checkedArgmax(new Float32Array([-4, 2, 1])), 1);
  assert.equal(checkedArgmax(new Float32Array([2, 2, 1])), 0);
  for (const values of [[], [NaN, NaN], [0, NaN], [Infinity, 0], [-Infinity, 0]]) {
    assert.throws(() => checkedArgmax(new Float32Array(values)), /Empty logits|Non-finite logit/);
  }
  return 7;
}
if (typeof process !== "undefined" && process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log(`${verifyCheckedArgmax()} logit guard checks passed`);
}
