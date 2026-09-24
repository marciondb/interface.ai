# Bank Test — Member Services Console (Fixture)

Hostile legacy web UI for exercising computer-use / UI automation systems.

This is **not** a product. It is a controlled target application: ugly IDs, nested tables, an iframe shell, business outcomes triggered by data, and runtime faults injected on demand.

## Requirements

- Node.js LTS (built-in modules only — **no `npm install`**)

## Run

```bash
node server.js
```

Open [http://localhost:8080/login](http://localhost:8080/login). The server listens on
`127.0.0.1` only: it has no real authentication and `POST /_fault` is open to anyone who can
reach it.

### Demo credentials

Shown on the login page on purpose:

- User ID: `operator`
- Password: `training`

### Supervisor approval code

Used when opening a sub-account with initial deposit **≥ $10,000.00**.

- Default: `482917`
- Override: `SUPERVISOR_CODE=...... node server.js`

This value is **not** shown in the UI, HTML, or terminal logs. It is documented here only.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port (on `127.0.0.1`); `0` picks a free port, printed in the `listening on` line |
| `TENANT` | `banktest` | Tenant config key |
| `SESSION_TTL_MIN` | `30` | Session cookie lifetime |
| `SUPERVISOR_CODE` | `482917` | Dual-control approval code |

## Seeded members

| ID | Name | Notes |
|---|---|---|
| `10001` | Maria Santos | Happy path (Checking + Savings) |
| `10002` | James Whitfield | Three accounts; Savings is **not** first |
| `10009` | Patricia Alvarez | Restricted → authorization message |
| `99999` | — | Not found |

## Main flows

**Read:** Login → Member Lookup → Results → Member Detail → read Savings balance (sibling cell).

**Write:** Member Detail → Open Sub-Account → Review → browser `confirm()` → Confirmation (or Supervisor Approval if deposit ≥ $10,000).

## Fault injection

Arm a one-shot runtime condition (called by the test harness, not by the automation under test):

```bash
curl -X POST http://localhost:8080/_fault \
  -H 'Content-Type: application/json' \
  -d '{"kind":"server_error"}'
```

| `kind` | Effect on the **next** response |
|---|---|
| `slow_load` | Delay 8 seconds |
| `interstitial` | Maintenance notice with Continue |
| `server_error` | HTTP 500 app error page |
| `element_missing` | Remove primary submit button |
| `session_expired` | Invalidate session and redirect to login (may appear inside the iframe) |
| `unexpected_dialog` | The next **HTML page** opens a native `alert("Your password expires in 3 days.")` while it loads |

Every kind is single-fire: it affects exactly one response and then clears. `unexpected_dialog`
waits for an HTML page: a redirect or a non-HTML answer in between leaves it armed.
`/_fault`, `/public/*` and `/favicon.ico` never consume a fault.

## Smoke test

```bash
node smoke.js
```

## Layout

```
fixture/
  server.js          HTTP server (no dependencies)
  tenants.js         Tenant configuration
  smoke.js           Smoke test
  data/members.json  Seeded members / accounts
  pages/*.html       Screen templates
  public/legacy.css  Era styling
```
