# Network Exposure

Ghost's gateway has no in-app authentication layer. Any HTTP client or WebSocket
that can reach the port can issue RPC calls.

## Default behavior

The daemon binds to `127.0.0.1:15401` by default, which means it is only
reachable from the local machine. This is the safe default for laptops and
single-user installs.

## Public bind opt-in

To bind to a non-loopback address (e.g. `0.0.0.0` or a specific LAN IP),
you must explicitly set `gateway.allowPublicBind=true`. The daemon refuses to
start with a non-loopback `gateway.host` unless this flag is set — this guards
against upgrading users whose persisted `~/.ghost/config.json` still contains
a wide-open `gateway.host` from an older version.

```json
{
  "gateway": {
    "host": "0.0.0.0",
    "allowPublicBind": true
  }
}
```

**Only do this if you understand the exposure.** The gateway has no in-app
authentication; any host that can reach the port can read your portfolio,
issue orders, and access connected API keys. Secure the path externally
(firewall, VPN, authenticated tunnel — see below) before setting this flag.

## External access recipes

If you want to reach the dashboard from another device, use an authenticated
tunnel rather than opening the port directly to the internet.

### Cloudflare Tunnel + Access

1. Install `cloudflared` and authenticate: `cloudflared tunnel login`
2. Create a tunnel: `cloudflared tunnel create ghost`
3. Route traffic: `cloudflared tunnel route dns ghost ghost.example.com`
4. Run the connector pointing at the gateway:

   ```
   cloudflared tunnel run --url http://127.0.0.1:15401 ghost
   ```

5. In the Cloudflare Zero Trust dashboard, add an Access policy for
   `ghost.example.com` (email OTP or SSO provider).

Keep `gateway.host=127.0.0.1` (the default) — the tunnel handles exposure.

### Tailscale Serve

```bash
tailscale serve --bg http://15401
```

This exposes the gateway on `https://<tailnet-hostname>` — reachable only by
devices on your tailnet. No public internet exposure. Keep `gateway.host=127.0.0.1`.

### ngrok OAuth

```bash
ngrok http 15401 --oauth=google --oauth-allow-email=you@example.com
```

ngrok adds OAuth in front of the tunnel. Keep `gateway.host=127.0.0.1`.

### mTLS (advanced)

Run an nginx or Caddy reverse proxy on the same host with a client certificate
requirement. Generate a CA, issue a client cert to each device, and configure
the proxy to require it:

```nginx
ssl_verify_client on;
ssl_client_certificate /etc/ssl/ghost-ca.crt;
```

## What NOT to do

- Do not set `gateway.allowPublicBind=true` on a public VPS without a
  firewall rule or authenticated tunnel in front.
- Do not rely solely on a long port number as "security through obscurity".
- Do not expose the port through a plain HTTP reverse proxy without authentication.
