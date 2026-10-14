# Orchestration: <short title>

Run with the `orchestrate` skill. If it is no longer in your context, re-read
its SKILL.md before you continue.

Started: <date> · Branch: <branch> · Repo: brownfield | greenfield
Status: scouting | waiting for direction | building | checking | awaiting review | blocked | done
Git: <commit when asked | HOLD: user said "<their words>">
Ledger path: <this file's path>
Request: <the user's request, as given>

## Goal

<one sentence, in the user's terms>

## Direction (from the user)

- <date> "<the user's words>"

## Definition of done

- [ ] <observable check, e.g. "`pnpm run check:jev` passes">
- [ ] <observable check>
- [ ] <check only the user can do> (needs user)

## Constraints and defaults

- <constraint or small default, and why. Direction decisions go above, not here.>

## Tasks

| ID | Goal | Owner (role · agent name/ID) | Depends on | Status | Evidence / notes |
|---|---|---|---|---|---|
| T1 | | Builder · | none | queued | |
| T1-check | Test + review T1 | Tester · / Reviewer · | T1 | queued | |

Status values: queued · running · checking · awaiting review · done · failed (attempt n) · dropped (reason)

## Open questions and blockers

- <question>: waiting on user | waiting on T3

## Log

- <time> Dispatched scouts S1, S2 and researcher R1.
- <time> User set direction. Dispatched T1, T2.
- <time> T1 check: tests pass, reviewer found 1 blocking issue. Sent back to builder.
