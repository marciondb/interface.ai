# Single Process, CLI-First Composition

| Field | Value |
|---|---|
| **ADR** | ADR-003 |
| **Author** | Marcio Dias |
| **Contributors** | N/A |
| **Started at** | 2026-08-19 |
| **Status** | ACCEPTED |
| **Description** | This ADR documents the decision to run the system as a single process with a command-line entry point, storing capability artifacts and evidence on the filesystem, rather than as a set of services with a queue and a database. |

---

## Context

The system has three things a caller can ask it to do: discover a flow, replay a
capability, and take over a session as a human operator.

There is an obvious temptation to model this as distributed infrastructure — an
API that accepts goals, a queue of pending runs, workers that drive browsers, a
database of artifacts and run history. That shape is what the system would
eventually look like in production.

It is also almost entirely orthogonal to the problems that make this system hard.
The difficult parts are the artifact contract, deterministic re-execution, the
distinction between a business outcome and a failure, and transferring control of
a live session to a human. None of those get easier — or are better demonstrated —
by adding a broker.

Building the distributed shape early would consume effort, add operational
surface, and make the interesting parts harder to read.

---

## Decision

The system runs as a **single Node process** with a **command-line entry point**.

| Concern | Choice |
|---|---|
| Entry point | CLI commands: `discover` and `replay` |
| Handoff control | The operator types `take`, `resume`, or `abort` at a prompt on the running process's stdin |
| Artifact storage | Filesystem, one versioned JSON file per capability |
| Evidence storage | Filesystem, one directory per run |
| Run state | In-memory for the duration of a run |
| Composition | Explicit wiring in one composition root (`src/diplomat/composition/`), shared by both CLIs, the test harnesses, and the demo script; no dependency-injection container |

There is no HTTP server, no message broker, no database, and no worker pool.
Because run state lives in that single process, handoff is controlled from the
same process's stdin rather than through a separate command.

### The seam that is preserved

Controllers do not know they were invoked by a CLI. The CLI is an inbound Diplomat
that parses arguments, calls a controller, and renders the result. Exposing the
same capabilities over HTTP later means adding a second inbound Diplomat, not
restructuring the system.

Likewise, the artifact store is a port. Moving artifacts from the filesystem to a
registry is an outbound Diplomat swap.

### Why the filesystem is a deliberate choice, not a shortcut

Capability artifacts must be **reviewable**. Plain JSON files in a repository get
review, diffs, history, and blame for free — from tooling every engineer already
has. A database would make artifact review a feature someone has to build.

---

## Consequences

### Positive

- Effort concentrates on contracts and control flow, where the difficulty actually
  is
- The demo path is two commands with no infrastructure to stand up
- Artifact review works through ordinary code review
- No operational surface to explain or defend

### Negative

- No concurrency across runs; one process drives one session at a time
- No durable run history beyond what is written to the evidence directory
- A crash mid-run loses in-memory state; there is no resumption from a checkpoint
  other than re-running
- Human handoff must happen within the lifetime of the process, which constrains
  how long a session can wait for an operator

The last point is a genuine limitation rather than a deferred detail, and is
addressed as a design question in the escalation RFC rather than hidden.

---

## Alternatives

### API service plus queue and workers

An HTTP API accepting goals, a broker, and worker processes driving browsers.

**Rejected because** it is the production shape of a system whose production
requirements are not yet established, and it would add operational complexity
without improving any of the properties being designed for. The abstractions
chosen here do not prevent this evolution.

### Library only, no entry point

Publish the controllers and let a caller wire them up.

**Rejected because** the system needs a runnable, reproducible demonstration.
A library alone cannot show a discovery run followed by a replay.

### Long-running local server with a web UI

A local process with a browser-based control surface.

**Rejected because** the UI work is substantial and the operator surface it would
produce is explicitly out of scope. A minimal handoff mechanism with a real
control-transfer model is worth more than a polished console.

---

## Related

- ADR-001 — Diplomat Architecture as Service Structure
- ADR-002 — TypeScript on Node as Language and Runtime
- ADR-012 — Same-Session Control Transfer for Human Handoff
- RFC-001 — System Scope & Component Landscape
- RFC-005 — Human-in-the-Loop Escalation & Session Handoff
