# TensorMesh cross-network relay

The HTTPS tunnel exposes the website and signaling. A separate reachable TURN server carries WebRTC traffic when NAT/firewalls block a direct path. No relay has been provisioned yet.

## Public relay host

Use a public Linux VPS and your own DNS name (for example `relay.your-domain`). Install coturn and obtain a TLS certificate for that name. Configure coturn with:

```ini
listening-port=3478
tls-listening-port=443
fingerprint
use-auth-secret
static-auth-secret=<random-secret>
realm=relay.your-domain
cert=/path/to/fullchain.pem
pkey=/path/to/privkey.pem
min-port=49160
max-port=49200
no-multicast-peers
no-loopback-peers
```

Open TCP 443, UDP/TCP 3478, and UDP 49160–49200 on the VPS firewall. Port 443 must be available for coturn. If the VPS is behind NAT, configure coturn's external-ip mapping as documented by coturn. Apply quotas appropriate to the host's capacity and restrict private destination ranges. A local coturn instance behind the current mobile/home NAT does not solve this problem.

## Gateway configuration

Set these environment variables on the TensorMesh gateway process before restarting it:

```powershell
$env:TENSORMESH_TURN_URLS='turn:relay.your-domain:3478?transport=udp,turns:relay.your-domain:443?transport=tcp'
$env:TENSORMESH_TURN_SECRET='<same random-secret as coturn>'
node scripts/start-gateway.mjs
```

Retain the existing `TENSORMESH_PUBLIC_ORIGIN` environment variable. Never put the shared secret in frontend build variables, invite URLs, screenshots, or source control. `/api/ice` issues one-hour coturn credentials on each join/create attempt; both native and browser peers fetch from the same signaling origin. Manual Network settings override deployment credentials.

The credential endpoint is for this temporary private test deployment. Before public production deployment, protect credential issuance with room/session authorization and request quotas. Anyone who can access the current endpoint can obtain temporary credentials and consume relay bandwidth.

## Verification

```powershell
node --test --test-isolation=none tests/turn_deployment_test.mjs
node tests/gateway_flow.mjs
```

After rebuilding the desktop and browser assets, create a new room and join from the second network. Confirm the room roster contains both devices, the connection path reports relay, and a model completes a request. Unit tests verify credential generation and client configuration; they do not prove a live relay allocation or distributed inference.

Reference: https://github.com/coturn/coturn/blob/master/README.turnserver
