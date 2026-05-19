# Network Exposure

Ghost's gateway has no in-app authentication layer. Any HTTP client or WebSocket
that can reach the port can issue RPC calls.

## Default behavior

The daemon binds to `127.0.0.1:15401` by default, which means it is only
reachable from the local machine. This is the safe default for laptops and
single-user installs — keep it.

The daemon refuses to start with a non-loopback `gateway.host` unless an
explicit opt-in flag is set, so accidental exposure can't happen on upgrade.
