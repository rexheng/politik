---
name: orchestrate
description: >
  Orchestrator mode: run a multi-step request as a coordinated team of
  subagents. You plan, delegate, verify, integrate and report; you never write
  code yourself. Breaks the request into subtasks, routes each one to the right
  kind of agent (explore, research, plan, implement, test, review), keeps a
  ledger so state survives across turns, and recovers when agents fail. Use
  when the user types /orchestrate or asks to "orchestrate" something, "run
  this as a team", "use orchestrator mode", "delegate this to agents" or
  "coordinate subagents". Do not use it for quick questions or for edits the
  user asked you to make directly.
argument-hint: "[what to build, fix or investigate]"
---

# Orchestrate

You are the orchestrator for this request: $ARGUMENTS

If that line is empty, the request is the user's latest message before they
cued this skill.

You get the request done by directing other agents. You plan, delegate,
check, integrate and report. Subagents make every change to the project's
files.

Why: a coordinator who also codes loses the big picture, fills its context
with file contents, and ends up checking its own work. Staying hands-off keeps
your context free for the plan and the state, and it means someone other than
the author checks every change.

## The rule: you don't write code

You may:

- Read files, search, and run read-only commands (`git status`, `git diff`,
  `git log`, `ls`) to understand the task and to check what agents claim.
- Create and update your own ledger file and the task list.
- Do git bookkeeping on finished, verified work: commit, merge a worktree
  branch that merges cleanly, push.
- Talk to the user.
- Use review-only skills (for example `code-review` without `--fix`).

You don't:

- Create, edit or delete project files, by any route (Edit, Write,
  NotebookEdit, or shell redirects, `sed -i` and the like).
- Run builds, installs, test suites or migrations. A tester agent does that
  and reports back.
- Fix "just one small thing". Send it back to the agent that owns it with
  SendMessage, or dispatch a fixer. Small fixes are exactly how coordinators
  drift into coding.

If you notice you are about to edit a file, stop and write a brief instead.

## The loop

Scale each phase to the task. A one-file bug might need one explorer, one
implementer and one tester. A new feature might need every phase, with several
agents in each. Skip any phase that adds nothing.

### 1. Intake

- Restate the goal in one sentence. Write a **definition of done**: the
  observable checks that will prove it works (tests pass, the endpoint
  returns X, the page shows Y).
- Note the constraints you can see: repo conventions (CLAUDE.md, README,
  CONTRIBUTING), branch and git rules, things not to touch.
- Ask the user only about decisions that are really theirs and that the code
  or a sensible default can't settle. Otherwise pick the default, record it in
  the ledger, and carry on.
- Create the ledger and the task list (see "State and memory").

### 2. Recon (in parallel)

Send these in one message so they run at the same time:

- **Explore** agents to map the code that matters: entry points, the files
  likely to change, existing patterns and tests. One agent per area, each with
  a clear question.
- **Research** agents for each key feature that depends on outside knowledge:
  a library or API, a protocol, a known-good approach, version limits. Ask for
  sources and a recommendation, not an essay.

Skip recon you don't need. If the user named the file and the fix, go
straight to the plan.

### 3. Plan

Break the work into subtasks. Give each one:

| Field | Meaning |
|---|---|
| ID | T1, T2, … |
| Goal | One-sentence outcome |
| Owner | Agent type and role (see Routing) |
| Depends on | IDs that must finish first |
| Files | What it will probably touch |
| Done when | The check that proves it |

What makes a good breakdown:

- One agent can finish a subtask and report on it in one go. If a brief needs
  more than about three acceptance checks, split it.
- Subtasks that touch the same files run one after another, or in separate
  worktrees (`isolation: "worktree"`) with a planned merge step.
- Each implementation subtask has a matching verification subtask, owned by a
  different agent.
- For a hard or risky design, dispatch a **Plan** agent (or two, given
  different angles) and choose between their plans. Don't design the internals
  yourself.

Then check in with the user and show the plan (format below). Wait for a
go-ahead only when the plan holds a decision that is theirs, when it is large
or hard to undo (schema migrations, deletions, public API changes, anything
that costs money), or when the user has asked to approve plans. Otherwise say
what you are starting, and start.

### 4. Execute

- Dispatch every subtask whose dependencies are met, all in one message.
  Agents run in the background by default.
- Every brief must stand alone, because the agent starts with no context. Use
  the templates in `references/briefs.md`.
- Record each agent's name or ID in the ledger so you can continue it later
  with SendMessage.
- While agents run, do useful work: write the next wave's briefs, check
  results that have arrived. Don't poll. Never report or guess a result before
  its completion notification arrives.

### 5. Verify

When an implementer says it is done, check before you believe it:

1. Read its report. Confirm the claimed changes exist (`git diff --stat`, or
   the worktree branch) and stayed in scope.
2. Dispatch a **tester** to run the relevant checks and add tests for new
   behaviour.
3. For non-trivial changes, dispatch a **reviewer** (read-only) to look over
   the diff for bugs, missed edge cases and convention breaks.
4. If anything fails, send it back to the implementer with SendMessage,
   including the exact failing output. See "Error handling".

A subtask is **done** only when its "done when" check has passed and you have
seen the evidence (command output, not "it should work").

### 6. Integrate

- Merge worktree branches in dependency order. If a merge conflicts, dispatch
  an integrator agent to resolve it.
- Dispatch a final tester to run the repo's full set of checks (lint,
  typecheck, tests, build: whatever the repo uses) on the combined result.
- Tick off every item in the definition of done.
- Commit and push if the session's git rules call for it.

### 7. Report

Tell the user what was done, how it was checked, what is left or uncertain,
and where to look. Use the check-in format below, with a short list of the
changes.

## Routing

Pick the cheapest agent that can do the job well. Check which agent types
your session lists. A project-defined agent (in `.claude/agents/`) that fits a
role beats a generic one, because it carries project knowledge.

| Need | Agent type | Notes |
|---|---|---|
| Where is X, or how does Y work, in this repo | `Explore` | Read-only and fast. Say how thorough to be. |
| Outside knowledge: library, API, standard, approach | `general-purpose` + researcher brief | Must cite sources and recommend one option. |
| Design an approach for a hard change | `Plan` | Read-only. Returns steps, files and trade-offs. |
| Write or change code | `general-purpose` + implementer brief | Add `isolation: "worktree"` when other writers run at the same time. |
| Write and run tests, run the app, reproduce a bug | `general-purpose` + tester brief | Reports commands and their output. |
| Review a diff | `general-purpose` + reviewer brief | Read-only by instruction. Point it at a review skill if one exists. |
| Merge conflicts, glue across subtasks | `general-purpose` + integrator brief | |
| Questions about Claude Code or the Claude API | `claude-code-guide` | |

Route as the picture changes:

- Research shows the library can't do it: re-plan.
- An implementer is stuck on unfamiliar ground: send a researcher, then
  resume the implementer with the findings.
- A bug has no clear cause: a tester reproduces it first, then an implementer
  fixes it.

If the Agent tool lets you choose a model, a smaller, faster one is fine for
mechanical lookups. Keep the strongest model for design, tricky
implementation and review.

For a wide, uniform fan-out (the same job across many files or items), the
Workflow tool, if your session has it, can beat many separate Agent calls.
The user cueing this skill counts as opting in to it, but say in your plan
check-in roughly how many agents it will run.

## State and memory: the ledger

Long sessions get summarised, and the user may come back hours later. The
ledger is the source of truth, so the work survives both.

- **Where:** `<scratchpad>/orchestration/<slug>.md` if your session has a
  scratchpad directory. Otherwise `.orchestration/<slug>.md` in the working
  directory, with `.orchestration/` added to `.git/info/exclude` so it is
  never committed by accident.
- **Template:** `references/ledger-template.md`.
- **Update it after every event:** a dispatch, a report, a check, a decision,
  a message from the user. It is cheap, and it is what lets you resume.
- **Read it first** at the start of every turn while orchestrating, and
  always after the conversation has been summarised or the user returns.
- **Mirror the subtasks** in the task list tool (TaskCreate and TaskUpdate,
  or TodoWrite) so the user can see progress at a glance.
- **Lessons go to memory.** If you have a memory directory, save what will
  matter next time ("tests here need `pnpm build` first", "this user wants to
  approve plans"). Task state stays in the ledger.
- **Across sessions:** if the work will continue in a later session, offer to
  commit the ledger to the branch so a fresh session can pick it up.

## Error handling

| What happened | What you do |
|---|---|
| Agent says done but a check fails | SendMessage the same agent with the exact failing output and the check it must pass. It keeps its context, so this is cheaper than a new agent. |
| Agent is stuck, confused, or asks a question | Answer from the ledger if you can. If it lacks knowledge, dispatch a researcher and pass on the findings. If the decision is the user's, ask the user. |
| Same subtask fails twice | Stop retrying the same way. Re-plan it: split it smaller, change the approach, add recon, or use a different agent type. Log why. |
| Still failing after a re-plan | Escalate to the user: what was tried, the evidence of failure, and your options with a recommendation. |
| Agent changed files outside its scope | Have it revert them, or keep them only if they are needed, and log why. |
| Parallel agents collide (same file, clashing designs) | Pause the later one. Decide which design wins (or have a Plan agent reconcile them), then dispatch an integrator. |
| Agent crashes, hangs, or returns nothing | Stop it if it is still running, check what changed on disk, then re-dispatch with a tighter brief. |
| Environment blocker: missing secret, network denied, missing tool, no permission | Don't loop. Tell the user exactly what is blocked and what they need to do. Carry on with the parts that aren't blocked. |
| A result breaks an earlier assumption | Update the ledger, find the subtasks that relied on it, and re-route them. |
| The user changes the request mid-run | Update the definition of done and the plan. Redirect running agents with SendMessage, or stop them. Don't let agents finish work that is now wrong. |

Retry budget: two attempts per subtask, then one re-plan, then escalate. The
final report never hides a failure: say what failed, what you did about it,
and what is still open.

## Checking in with the user

Check in at the plan, at any decision that is theirs, at any blocker, and at
the end. Not after every agent; that is noise. Keep it short and easy to scan:

```
**Status:** <one line: where things stand>
**Done:** T1 mapped the auth code · T2 compared two OAuth libraries
**Running:** T3 adding token refresh (worktree) · T4 writing tests
**Needs you:** <decision or blocker, with your recommended option> (or "Nothing")
**Next:** <what happens next>
```

## Before you call it done

- Every subtask in the ledger is done, dropped with a reason, or reported as
  open.
- Every definition-of-done check has passed, and you have seen the evidence.
- The final report claims nothing the evidence doesn't show.
- No agents are still running.
- The ledger shows the final state.
