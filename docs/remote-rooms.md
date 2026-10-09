# Rooms across different networks

`localhost` is the device that opens the link. A loopback invitation cannot reach another computer. The browser site needs a reachable HTTPS origin, and discovery needs a reachable WSS endpoint. WebRTC may additionally require a TURN relay when either network blocks direct peer connectivity.

## Temporary setup enabled October 9

The user approved a temporary Cloudflare tunnel. TensorMesh's own gateway serves the website and PeerServer behind one origin:

- Website: https://benz-his-algorithms-universities.trycloudflare.com
- Discovery: wss://benz-his-algorithms-universities.trycloudflare.com/tensormesh
- Local upstream: `127.0.0.1:1421`

The gateway is `scripts/start-gateway.mjs`. It serves the SPA's `/room/<code>` route and overrides the browser runtime's JSON/JavaScript configuration with the public HTTPS/WSS pair. Discovery uses TensorMesh's namespace/key; there is no hosted legacy-service fallback.

The desktop was rebuilt with both `TENSORMESH_PUBLIC_ORIGIN` and `TENSORMESH_SIGNAL_URL` set to those addresses. The executable at `work/tensormesh-production-before-audit.exe` was replaced after preserving a backup. Its SHA256 is `E718D4169FF38B89A0387DCAFB798476BF118006307E0F96DDD134C924C025A1`.

The native Invite dialog for room V9FP displayed a public HTTPS link and QR. Earlier localhost invites should be replaced with newly generated invites.

## Verification

- Gateway fixture passed HTTPS/WSS configuration, own discovery ID route, SPA room route and rejected-origin cases.
- A public HTTPS request returned the correct TensorMesh configuration.
- A public WSS probe registered two disposable peers and forwarded an offer through the owned gateway.
- Desktop frontend, native executable and NSIS installer rebuilt successfully.
- Actual native UI showed the public invitation.
- Tests above do not establish cross-network GPU inference. Verification on the user's other network/device is pending; request the displayed connection error if peer joining fails.

Commands from the standalone repository:

```powershell
node tests/gateway_flow.mjs
node tests/gateway_remote_probe.mjs https://benz-his-algorithms-universities.trycloudflare.com
```

## Lifetime and restart

Keep the host computer, gateway and tunnel running. Closing the native host ends its room. A new quick-tunnel process gets a different hostname; update both configuration variables and rebuild the desktop before using a replacement hostname. A normal build without those variables returns to localhost defaults.

The tunnel and gateway process IDs are recorded in `work/tensormesh-public-connection.json`; the logs are `work/tensormesh-tunnel-20261009.err.log` and `work/tensormesh-gateway-20261009.out.log`. Check that recorded PIDs still belong to those exact programs before stopping them. No system service, firewall exception or port forwarding was installed.

For a permanent endpoint, use a named tunnel/domain or a hosted reverse proxy forwarding HTTP and WebSocket requests to this gateway. Cloudflare quick tunnels are temporary: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/.
