// Correctness harness guard; production sampling remains unchanged.
import { argmax } from "../engine/sampling.js";
export function checkedArgmax(logits) {
  if (!logits || logits.length === 0) throw new Error("Empty logits in synthetic GPU check");
  for (let i = 0; i < logits.length; i++) {
    if (!Number.isFinite(logits[i])) throw new Error(`Non-finite logit at index ${i}: ${logits[i]}`);
  }
  return argmax(logits);
}
