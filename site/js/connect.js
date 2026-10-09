import { parseRoomInvite, generateRoomInvite } from '../../room/invite.js';
import { probe } from '../../room/preflight.js?v=2';
const form = document.querySelector('#quick-join');
form.addEventListener('submit', event => {
  event.preventDefault();
  const input = document.querySelector('#room-link');
  let invite;
  try { invite=parseRoomInvite(input.value,{signal:(window.TENSORMESH_SIGNAL_SERVERS||[new URL('/tensormesh',location.origin).href])[0]}); }
  catch(error) { document.querySelector('#join-feedback').textContent=error.message; input.setAttribute('aria-invalid','true'); input.focus(); return; }
  input.removeAttribute('aria-invalid');
  location.assign(generateRoomInvite(invite.roomId,{signal:invite.signal,origin:location.origin,expires:invite.expires||Date.now()+86400000}));
});
document.querySelector('#room-link').addEventListener('input', event => event.target.removeAttribute('aria-invalid'));
const check = document.querySelector('#device-check');
check.addEventListener('click', async () => {
  check.disabled = true; check.textContent = 'Checking…';
  const result = document.querySelector('#device-result');
  try {
    const gpu = await probe();
    result.textContent = gpu.line + (gpu.detail ? ` ${gpu.detail}` : ' Choose a memory pledge inside the room; browsers do not report free VRAM.');
    if (navigator.storage?.estimate) {
      try {
        const { usage, quota } = await navigator.storage.estimate();
        if (Number.isFinite(usage) && Number.isFinite(quota)) document.querySelector('#storage-result').textContent = `Origin storage: ${(usage / 2 ** 30).toFixed(1)} GB used / ${(quota / 2 ** 30).toFixed(1)} GB quota. Shared with other site data; quota can change.`;
      } catch { document.querySelector('#storage-result').textContent = 'Storage estimate unavailable.'; }
    }
  } catch { result.textContent = 'Device check unavailable. You can still open a room and join to chat.'; }
  finally { check.disabled = false; check.textContent = 'Check again ↗'; }
});

