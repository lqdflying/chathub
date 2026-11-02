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
2. Make the sandbox images available on **this** host. OpenSandbox pulls a
   missing image when it first creates a sandbox (with the server's
   `registries` login for a private registry), and Sandbox Hub admins can
   pull one ahead of users with **Prepare image**. A tag already on the host
   is not pulled again, so prefer versioned tags over `latest`.
   (`docker/opensandbox/Dockerfile` builds the general-purpose image.)
3. Firewall. Keep the OpenSandbox server port on 127.0.0.1. On 443, allow
   only the ChatHub host: the Caddyfile checks that address and the API key
   there. Leave port 80 reachable from the internet so Caddy can answer the
   HTTP certificate challenge. On a private network with no public 80 or 443,
   use the DNS challenge (a Caddy build with your DNS provider module and a
   `tls { dns ... }` block). That certificate is publicly trusted, so ChatHub
   needs nothing extra. Or use `tls internal` and point `NODE_EXTRA_CA_CERTS`
   on the ChatHub container at Caddy's root certificate (`docker compose cp
   caddy:/data/caddy/pki/authorities/local/root.crt .`). A `*.ts.net` name
   gets a Let's Encrypt certificate from Tailscale instead: enable HTTPS for
   the tailnet and mount the host's `/var/run/tailscale/tailscaled.sock` into
   the Caddy container.
4. Network isolation for sandboxes: use a dedicated Docker bridge and drop
   traffic from the sandbox subnet to private ranges, `169.254.0.0/16` (cloud
   metadata) and the host itself (`DOCKER-USER` chain), unless a profile
   needs it.
5. On ChatHub: mount `sandbox-profiles.example.yaml` (edited) and set
   `SANDBOX_PROFILES_FILE` to its path, plus the key variable each server's
   `apiKeyEnv` names (and any `registries` variables). Restart ChatHub, open
   **Sandbox Hub**, and check the server badge says Online. The file's
   profiles are imported once; after that, add and edit profiles in the Hub
   as an admin (`SANDBOX_HUB_ADMINS`), choosing the server from its list.
6. The example sets `proxyEndpoint: baseUrl` so execd calls use the configured
   HTTPS URL and pass through Caddy. Leave it set. Switch a server back to
   `proxyEndpoint: server` only when that server returns a host ChatHub can
   use directly.

## Things one server cannot vary

The runtime class (gVisor, Kata), egress mode, Docker `network_mode` /
`publish_host` and the maximum timeout are server-wide. A profile that needs a
different value needs its own server entry (another server process or host).
Pools, multi-tenancy and idle pause are Kubernetes-only in OpenSandbox.

Mounting the Docker socket gives the server root on this host, which is one
more reason to keep it on a dedicated machine.
