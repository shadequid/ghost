# Network Exposure

Ghost's gateway has no in-app authentication layer. Any HTTP client or WebSocket
that can reach the port can issue RPC calls.

## Default behavior

The daemon binds to `127.0.0.1:15401` by default, which means it is only
reachable from the local machine. This is the safe default for laptops and
single-user installs — keep it.

The daemon enforces loopback bind and refuses to start on any non-loopback
host. To reach the dashboard from another device, do not change the bind —
put an authenticated tunnel in front of `127.0.0.1:15401` instead. Recipes
below.

## External access recipes

If you want to reach the dashboard from another device, use an authenticated
tunnel that terminates at `127.0.0.1:15401`. The gateway never has to listen
on a non-loopback address.

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

ngrok adds OAuth in front of the tunnel; requests are rejected unless the
caller signs in with the allowed identity. Keep `gateway.host=127.0.0.1`.

### mTLS (advanced)

Run an nginx or Caddy reverse proxy on the same host with a client certificate
requirement. Generate a CA, issue a client cert to each device, and configure
the proxy to require it:

```nginx
ssl_verify_client on;
ssl_client_certificate /etc/ssl/ghost-ca.crt;
```

The proxy upstream stays `127.0.0.1:15401`.

## What NOT to do

- Do not change `gateway.host` away from `127.0.0.1` — the daemon will refuse
  to start, and even if it did, the gateway has no in-app auth.
- Do not expose the port through a plain HTTP reverse proxy without authentication.
- Do not rely on a long port number as "security through obscurity".
