# Full-stack Demo

This example app demonstrates an end-to-end integration of the three monorepo packages:

- `sep10-auth` — SEP-10 challenge/verify, inline rate-limiter, and in-memory token revocation store
- `horizon-listener` — polls Soroban RPC for contract events and forwards them to a webhook
- `sanctions-oracle` — syncs flagged addresses using a `ProviderRegistry` (CSV + mock provider)

## Run the demo

From the repository root:

```bash
npm install
npm run build --workspaces --if-present
npm start --workspace=examples/full-stack-demo
```

The app listens on `http://localhost:3001` by default and exposes:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check — returns `{ status: "ok", serverPublicKey }` |
| `GET` | `/auth?account=G…` | Issue a SEP-10 challenge for the given Stellar address |
| `POST` | `/auth` | Verify a client-signed SEP-10 challenge; returns `{ address }` |
| `POST` | `/auth/revoke` | Revoke a bearer token (logout) |
| `GET` | `/sanctions/check?address=G…` | Check one address against the ProviderRegistry |
| `POST` | `/sanctions/sync` | Run a sanctions sync; body: `{ addresses: string[], dryRun?: boolean }` |
| `POST` | `/admin/listener/start` | Start the Horizon event listener (requires `DENYLIST_CONTRACT_ID`) |
| `POST` | `/admin/listener/stop` | Stop the Horizon event listener |
| `GET` | `/metrics` | Prometheus metrics (text/plain) |

## Configuration

All environment variables are optional. Sensible defaults are provided so the demo starts without any configuration for local testing.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port the server listens on |
| `HOME_DOMAIN` | `localhost:<PORT>` | SEP-10 home domain included in challenges |
| `SERVER_SECRET` | _(ephemeral random keypair)_ | Stellar secret key (`S…`) used to sign SEP-10 challenges. An ephemeral key is generated on each restart when unset — fine for a single local run, not for anything shared. |
| `NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | Stellar network passphrase |
| `CSV_SANCTIONS_PATH` | _(none)_ | Path to a CSV watchlist file; when set, a `CsvSanctionsProvider` is added ahead of the mock provider |
| `DENYLIST_CONTRACT_ID` | _(none)_ | Deployed `denylist-gate` contract ID; enables live denylist writes and the Horizon listener |
| `SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `WEBHOOK_URL` | _(none)_ | Webhook target for Horizon listener events |
| `HORIZON_START_LEDGER` | _(none)_ | Starting ledger for event polling |

## Hardening features not wired into this demo

This demo intentionally stays minimal, but each package it wires together has grown additional
hardening features that a production deployment would typically layer on top:

- **`sep10-auth`** — a `rateLimiter` middleware for throttling challenge/verify requests, and a
  `RevocationStore` for invalidating previously-issued sessions.
- **`sanctions-oracle`** — a `ProviderRegistry` for falling back across multiple sanctions data
  sources, a `CsvSanctionsProvider` for loading watchlists from a CSV file instead of the mock
  provider, and metrics/tracing instrumentation around sync runs.
- **`horizon-listener`** — matching metrics/tracing instrumentation around event polling and
  webhook delivery.

See each package's own README for usage details.
