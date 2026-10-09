// room/signal.js: parsing signaling server specs, the ordered list (?signal= > configured > primary) and
// openPeer's fallback against a fake Peer (down, black-holed, taken id, all down). No network.
import { parseServer, serverList, openPeer, reconnectDelay } from "../../room/signal.js";

const eq = (a, b, m) => { const ja = JSON.stringify(a), jb = JSON.stringify(b); if (ja !== jb) throw new Error((m || "mismatch") + ": " + ja + " != " + jb); };
const ok = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };

Deno.test("parseServer: TensorMesh endpoints only", () => {
  eq(parseServer("ws://127.0.0.1:9000/tensormesh").opts, {host:"127.0.0.1",port:9000,path:"/tensormesh/",secure:false,key:"tensormesh"});
  eq(parseServer("wss://sig.example.com/tensormesh/").spec,"wss://sig.example.com:443/tensormesh");
  for(const bad of ["primary","0.peerjs.com","127.0.0.1:9000","wss://pooled.invalid/tensormesh","ws://box:9000/tensormesh","javascript:alert(1)",null])eq(parseServer(bad),null);
});
Deno.test("serverList: fail closed, explicit TensorMesh services only", () => {
  const endpoint="ws://127.0.0.1:9000/tensormesh";
  eq(serverList({configured:[endpoint]})[0].opts.key,"tensormesh");
  for(const options of [{},{query:"primary",configured:[endpoint]},{query:"%%%",configured:[endpoint]}]) {
    let rejected=false;try {serverList(options);}catch{rejected=true;}ok(rejected);
  }
});

// A fake PeerJS: behaviour per host. "up" opens, "down" errors (network), "hole" never answers,
// "taken" answers unavailable-id, "noid" fails the id fetch (server-error).
function fakePeer(plan, made) {
  return class {
    constructor(id, opts) {
      this.id = id; this.opts = opts; this.h = {}; this.destroyed = false;
      made.push(this);
      const how = plan[opts.host || "primary"];
      setTimeout(() => {
        if (how === "up") this.emit("open", id || "rnd");
        else if (how === "down") this.emit("error", { type: "network" });
        else if (how === "noid") this.emit("error", { type: "server-error" });
        else if (how === "taken") this.emit("error", { type: "unavailable-id" });
      }, 1);
    }
    on(k, f) { (this.h[k] ||= []).push(f); }
    emit(k, v) { for (const f of this.h[k] || []) f(v); }
    destroy() { this.destroyed = true; }
  };
}
const list = (...hosts) => hosts.map(h => parseServer(`wss://${h}:9000/tensormesh`));

Deno.test("openPeer: first server up wins, keeps base options", async () => {
  const made = [];
  const r = await openPeer(fakePeer({ primary: "up" }, made), "tensormesh-room-ABCD", { debug: 1, config: { x: 1 } }, list("primary", "b"));
  eq(r.index, 0); eq(r.server.spec, "wss://primary:9000/tensormesh"); eq(made.length, 1);
  eq(made[0].opts, {debug:1,config:{x:1},host:"primary",port:9000,path:"/tensormesh/",secure:true,key:"tensormesh"}); eq(made[0].id, "tensormesh-room-ABCD");
});

Deno.test("openPeer: down and black-holed servers hand over, in order", async () => {
  const made = [], tries = [];
  const r = await openPeer(fakePeer({ primary: "down", a: "hole", b: "noid", c: "up" }, made), undefined, {}, list("primary", "a", "b", "c"),
    { timeoutMs: 30, onTry: (s, i, err) => tries.push([s.label, i, err?.type || null]) });
  eq(r.index, 3); eq(r.server.label, "c:9000");
  eq(tries, [["primary:9000", 0, null], ["a:9000", 1, "network"], ["b:9000", 2, "timeout"], ["c:9000", 3, "server-error"]]);
  ok(made.slice(0, 3).every((p) => p.destroyed), "failed peers destroyed");
  ok(!made[3].destroyed, "the winner stays");
});

Deno.test("openPeer: a taken id is an answer, not an outage (no fallback: that would split the room)", async () => {
  const made = [];
  let err = null;
  try { await openPeer(fakePeer({ primary: "taken", b: "up" }, made), "tensormesh-room-ABCD", {}, list("primary", "b")); } catch (e) { err = e; }
  eq(err?.type, "unavailable-id"); eq(err.server.spec, "wss://primary:9000/tensormesh"); eq(made.length, 1);
});

Deno.test("openPeer: all down rejects signaling-down with what it tried; from skips ahead", async () => {
  const made = [];
  let err = null;
  try { await openPeer(fakePeer({ primary: "down", b: "hole" }, made), undefined, {}, list("primary", "b"), { timeoutMs: 20, lastTimeoutMs: 20 }); } catch (e) { err = e; }
  eq(err?.type, "signaling-down"); eq(err.tried, ["primary:9000", "b:9000"]); eq(err.cause?.type, "timeout");
  const r = await openPeer(fakePeer({ primary: "up", b: "up" }, []), undefined, {}, list("primary", "b"), { from: 1 });
  eq(r.index, 1);
});

Deno.test("openPeer: the last server waits longer than the ones with a fallback after them", async () => {
  const t = Date.now();
  let err = null;
  try { await openPeer(fakePeer({ a: "hole", b: "hole" }, []), undefined, {}, list("a", "b"), { timeoutMs: 20, lastTimeoutMs: 120 }); } catch (e) { err = e; }
  eq(err?.type, "signaling-down");
  ok(Date.now() - t >= 135, "20 ms + 120 ms");
});

Deno.test("reconnectDelay: 2 s doubling, capped at 30 s", () => {
  eq([0, 1, 2, 3, 4, 5, 50].map(reconnectDelay), [2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});
