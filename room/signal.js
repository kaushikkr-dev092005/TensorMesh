import { validateSignal } from './invite.js';
// Only explicitly configured TensorMesh services are used. Invite endpoints are validated;
// invalid endpoints fail closed. There is no public PeerJS discovery fallback.
export const DEFAULT_SERVERS = [];
// errors that mean "this server is unreachable or broken", so the next one is worth a try. Anything
// else (unavailable-id: the code is taken; invalid-id; browser-incompatible) is an answer, not an outage:
// falling back on those would split a room across two servers.
export const FALLBACK_ERRORS = new Set(["network", "server-error", "socket-error", "socket-closed", "ssl-unavailable"]);

const HOST_RE = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])$/;

// one spec -> { spec, label, opts } (opts go to new Peer()), or null when it doesn't parse
export function parseServer(spec, pageSecure = true) {
  if (spec && typeof spec === "object") {
    const host = String(spec.host || "");
    if (!HOST_RE.test(host)) return null;
    const secure = spec.secure ?? pageSecure;
    const port = +spec.port || (secure ? 443 : 80);
    const path = normPath(spec.path);
    const opts = { host, port, path, secure };
    opts.key = "tensormesh";
    try {validateSignal(specString(opts));}catch{return null;}
    return { spec: specString(opts), label: label(opts), opts };
  }
  const s = String(spec ?? "").trim();
  if (!s) return null;
  try { validateSignal(s); } catch { return null; }
  const m = /^(?:(wss?|https?):\/\/)?([^/:\[\]]+|\[[^\]]+\])(?::(\d{1,5}))?(\/.*)?$/.exec(s);
  if (!m || !HOST_RE.test(m[2])) return null;
  const secure = m[1] ? m[1] === "wss" || m[1] === "https" : pageSecure;
  const port = m[3] ? +m[3] : (m[1] ? (secure ? 443 : 80) : 443);
  if (!(port > 0 && port < 65536)) return null;
  const opts = { host: m[2], port, path: normPath(m[4]), secure, key: "tensormesh" };
  return { spec: m[1] ? specString(opts) : s, label: label(opts), opts };
}
// PeerJS appends "peerjs" to the path, so it must end in "/" ("/tensormesh" -> "/tensormesh/")
const normPath = (p) => { p = String(p || "/"); if (!p.startsWith("/")) p = "/" + p; if (!p.endsWith("/")) p += "/"; return p; };
const label = (o) => o.host + (o.port === (o.secure ? 443 : 80) ? "" : ":" + o.port);
const specString = (o) => `${o.secure ? "wss" : "ws"}://${o.host}:${o.port}${o.path === "/" ? "" : o.path.slice(0, -1)}`;

// A query selects only its validated servers. It cannot fall through to configuration.
export function serverList({ query = null, configured = null, pageSecure = true } = {}) {
  const pick = (arr) => {
    const out = [], seen = new Set();
    for (const s of arr) { const p = parseServer(s, pageSecure); if (p && !seen.has(p.spec)) { seen.add(p.spec); out.push(p); } }
    return out;
  };
  const entries = query ? String(query).split(",") : configured;
  if (!Array.isArray(entries) || !entries.length) throw new Error("Configure TensorMesh signaling; no public fallback is enabled");
  if(entries.some(entry=>!parseServer(entry,pageSecure)))throw new Error('Invalid TensorMesh signaling configuration');
  const servers = pick(entries);
  if (!servers.length) throw new Error("Invalid TensorMesh signaling configuration");
  return servers;
}

// Open a PeerJS peer on the first server in `servers` that answers. Resolves { peer, server, index }
// once the peer is registered ("open"); the caller attaches its own handlers after that. Rejects with the
// server's own error for an answer that isn't an outage (err.server says which), or, when every server
// failed, an Error with type "signaling-down" and .tried (the labels). onTry(server, index, lastError)
// runs before each attempt (for a status line). timeoutMs: a server that neither opens nor errors by then
// (a black-holed port, a captive portal) counts as down; the last server in the list gets longer
// (lastTimeoutMs), since there is nothing to fall back to and a slow phone network may still get there.
export function openPeer(PeerCtor, id, baseOpts, servers, { timeoutMs = 8000, lastTimeoutMs = 20000, onTry = () => {}, from = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const tried = [];
    let last = null;
    const attempt = (i) => {
      if (i >= servers.length) {
        const e = new Error(`no signaling server answered (${tried.join(", ")})`);
        e.type = "signaling-down"; e.tried = tried; e.cause = last;
        reject(e); return;
      }
      const server = servers[i];
      tried.push(server.label);
      try { onTry(server, i, last); } catch {}
      let peer, done = false;
      const finish = (fn) => { if (done) return; done = true; clearTimeout(timer); fn(); };
      const giveUp = (err) => finish(() => {
        last = err;
        try { peer?.destroy(); } catch {}
        attempt(i + 1);
      });
      const ms = i < servers.length - 1 ? timeoutMs : lastTimeoutMs;
      const timer = setTimeout(() => { const e = new Error(`${server.label} did not answer in ${Math.round(ms / 1000)} s`); e.type = "timeout"; giveUp(e); }, ms);
      try { peer = new PeerCtor(id, { ...baseOpts, ...server.opts }); }
      catch (e) { giveUp(e); return; }
      peer.on("open", () => finish(() => resolve({ peer, server, index: i })));
      peer.on("error", (err) => {
        if (done) return;
        if (FALLBACK_ERRORS.has(err?.type)) { giveUp(err); return; }
        finish(() => { try { peer.destroy(); } catch {} ; err.server = server; reject(err); });
      });
    };
    attempt(from);
  });
}

// reconnect backoff for a peer that lost its signaling server mid-room: 2, 4, 8, 16, 30, 30 … s
export const reconnectDelay = (n) => Math.min(30000, 2000 * 2 ** Math.max(0, n));
