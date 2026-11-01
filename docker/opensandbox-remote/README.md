# OpenSandbox on a dedicated host

Example files for running the OpenSandbox lifecycle server on its own machine
and pointing ChatHub's Sandbox Hub at it. Start from these, then check every
setting against the OpenSandbox release you deploy (`opensandbox-server
init-config` prints that release's full config).

| File | Purpose |
| --- | --- |
| `compose.yaml` | OpenSandbox server (Docker runtime) bound to localhost, Caddy in front on 443 |
| `config.toml` | Server settings that matter on a remote host |
| `Caddyfile` | TLS, ChatHub-only source IP, API key required on **every** path, streaming-friendly proxying |
| `sandbox-profiles.example.yaml` | ChatHub `SANDBOX_PROFILES_FILE` pointing profiles at this host |
| `instructions/data.md` | Example profile instruction |

## Why the proxy checks the key itself

ChatHub reaches each sandbox's execd through the lifecycle server's proxy
route. In single-tenant mode OpenSandbox does not check the API key on that
route, and it has no TLS of its own. Caddy therefore terminates TLS, accepts
only the ChatHub host, and rejects any request whose `OPEN-SANDBOX-API-KEY`
header is wrong. ChatHub sends that header on every call, including execd
calls and the Sandbox Hub health check.

## Steps

1. On the sandbox host: set `OPENSANDBOX_SERVER_API_KEY` (a long random
   string), `SANDBOX_DOMAIN` (DNS name pointing here) and `CHATHUB_HOST_IP`
   (the address ChatHub connects from) in `.env`, then `docker compose up -d`.
2. Pull or build the sandbox images the profiles use on **this** host
   (`docker/opensandbox/Dockerfile` builds the general-purpose one).
3. Firewall: allow 443 only from the ChatHub host (or put both hosts on
   WireGuard/Tailscale and bind Caddy to that interface). Keep the server's
   own port on 127.0.0.1.
4. Network isolation for sandboxes: use a dedicated Docker bridge and drop
   traffic from the sandbox subnet to private ranges, `169.254.0.0/16` (cloud
   metadata) and the host itself (`DOCKER-USER` chain), unless a profile
   needs it.
5. On ChatHub: mount `sandbox-profiles.example.yaml` (edited) and set
   `SANDBOX_PROFILES_FILE` to its path, plus the key variable each server's
   `apiKeyEnv` names. Restart ChatHub, open **Sandbox Hub**, and check the
   server badge says Online.
6. If the badge is Online but calls fail to reach execd, the server returns
   an internal host for the proxy route: set `proxyEndpoint: baseUrl` on
   that server entry so ChatHub sends execd calls to the configured URL.

## Things one server cannot vary

The runtime class (gVisor, Kata), egress mode, Docker `network_mode` /
`publish_host` and the maximum timeout are server-wide. A profile that needs a
different value needs its own server entry (another server process or host).
Pools, multi-tenancy and idle pause are Kubernetes-only in OpenSandbox.

Mounting the Docker socket gives the server root on this host, which is one
more reason to keep it on a dedicated machine.
