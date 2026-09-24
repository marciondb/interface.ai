# Safety, Guardrails & Regulated Data Handling (v1)

---

| Field | Value |
|---|---|
| **RFC** | RFC-006 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-09-24 |
| **Status** | ACCEPTED |
| **Description** | Defines the allowlist, action risk classification, and redaction model that bound what the system may do and what it may store. |

---

## Allowlist

`policy.json`, loaded at startup and enforced at the action gateway (ADR-011):

```json
{
  "allowedOrigins": ["http://localhost:8080"],
  "allowedRoutes": ["/", "/welcome", "/member/*"],
  "allowedActions": ["click", "fill", "select", "navigate", "read"],
  "risky": {
    "routes": ["/member/danger/*", "/member/subacct/confirm", "/member/subacct/approve"],
    "controlText": ["Close Account", "Post Adjustment", "Confirm"]
  }
}
```

- Routes match exactly; a trailing `*` matches by prefix, and `/x/*` also matches
  `/x` itself. A route must start with `/` and may only end with `*`
- Paths are canonicalized before matching: each segment percent-decoded, `;params`
  dropped, empty segments removed; a segment that decodes to `/`, `\`, `.` or `..`
  is denied. Risky routes match case-insensitively
- URLs carrying a username or password are denied
- Risky control text is matched as whole words (Unicode NFKC, invisible format
  characters removed, spaces collapsed, case-insensitive) in any label the control
  shows: accessible name, text, value, `alt`, `title`, `aria-labelledby` text and
  image alts. `Yes, confirm` is risky; `Confirmation details` is not
- An action is risky when its control text, its destination, the current page or
  the page of the element's frame is risky; `read` never is, since it does not
  change the page
- `press` needs a target and is checked like a click on it
- Precedence: deny > `requires_human` > allow
- A policy file without `risky` fails to load (fail closed)
- Actions outside the allowlist are **denied**, not logged and executed
- Navigation to a disallowed origin or route is denied before the driver is called;
  the driver also aborts page- or script-started navigations outside the allowlist
  and closes popups
- After an action, every URL it loaded and every frame must still be inside the
  allowlist, and no frame it moved may be on a risky route; otherwise the result is
  `landed_outside_policy` (`landed_outside_allowlist` / `landed_on_risky_route`), a hard stop in
  both modes. Replay's one exception is the sign-in page, handled as an expired
  session (ADR-013)
- The target URL is checked before signing in, so credentials are never sent for a
  target the policy refuses

## Risk classes

| Class | Examples | Policy |
|---|---|---|
| Safe / reversible | Navigate, fill a form field, read a value, search | Allowed |
| Risky / irreversible | Close account, post adjustment, final confirm of a write | Blocked for automation; human handoff only (RFC-005) |

The artifact records each step's `risk`; replay honors it even if policy changes.

## Redaction

- **Secrets** (credentials, tokens, cookies) never enter the system's data: the
  session provider holds them in memory only (ADR-013)
- **Sensitive values** are redacted before:
  - observations are sent to the model: secrets, the patterns below and every
    sensitive output read so far are masked; declared inputs stay visible, since
    the model has to type them
  - events and snapshots are written to evidence (ADR-014), where inputs are
    masked too
  - screenshots are written: every element or field showing a sensitive declared
    input or output value is covered by a solid box
- Patterns redacted:
  - secrets by value in any case, also URL-encoded and JSON-escaped
    (`[REDACTED:secret]`): the target password, and the hosted API key when
    `--reasoner hosted` is used; plus fields named like credentials (`password`,
    `token`, `cookie`, `secret`, `authorization`, `api_key`, `session`, and `pin`
    or `otp` as a whole word)
  - account-number-like runs of 8 to 17 digits, keeping the last 4 digits
  - SSN-like strings (`***-**-****`)
  - declared input and output values whose `sensitivity` (RFC-002) is not `none`
    (`[REDACTED:<sensitivity>]`), from the moment they are known; values shorter
    than 4 characters are not masked
- Redaction is pure Logic, applied in two places: in discovery, the controller
  redacts each observation before calling the reasoner; the evidence recorder
  redacts every JSON record before writing. Screenshot masking is done by the
  surface driver, from the values the run protects; the sign-in page is never
  photographed
- A value learned late (an output read at the last step) may already sit in
  earlier snapshots, whole or partly masked (an account number whose member-id
  prefix was masked first); when the run finishes, the recorder redacts every
  JSON file of the run again with the final values, including those partly
  masked forms
- The decisions echoed on the terminal during discovery use the recorder's rules;
  model and page text printed there (rationale, help request, goal, URL) is
  stripped of terminal control sequences
- Outputs are masked in evidence but returned unmasked to the caller

## Data residency

The default reasoner is a local model (ADR-015): observations are redacted **and**
never leave the machine. The local adapter refuses an `OLLAMA_BASE_URL` that is not
a loopback host (`localhost`, `127.0.0.1`, `::1`); a remote model goes through the
hosted adapter. Redaction is still applied on the local path, so switching to the
hosted adapter does not change what the model sees.

The hosted adapter is opt-in per run (`--reasoner hosted`) and never selected
automatically; it requires an `https:` `HOSTED_BASE_URL` unless the host is
loopback. When it is used, the evidence records it, so it is always clear whether
an artifact was produced with data sent off the machine.

The model is also constrained by construction: its output schema only admits
refs present in the current observation, so it cannot aim at anything the page
does not show, and every action still goes through the gateway.

## Limits

- Screenshots mask only the declared sensitive input and output values; other page
  data and pattern-shaped values (account numbers, SSNs) stay visible in them,
  acceptable only because the target uses synthetic data
- Risk classification by route and control text is per-app configuration and can
  be wrong; it fails closed when in doubt
- Pattern-based redaction cannot catch every novel PII shape; the local default
  limits the exposure to the machine running discovery
- Page data that is not a declared input or output (other balances, names) is not
  masked
- Using the hosted adapter in production would require a data-processing agreement
  with the provider

## Related

- ADR-011 — Guardrail Enforcement at a Single Action Gateway
- ADR-013 — Authentication as Environment Precondition
- ADR-014 — Per-Run Evidence Bundle Layout
- ADR-015 — Local Reasoner with Schema-Constrained Output
- RFC-005 — Human-in-the-Loop Escalation & Session Handoff
