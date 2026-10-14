---
name: orchestrate
description: >
  Orchestrator mode: run a multi-step request through a team of subagents
  while the user sets the direction. You scout existing code, research key
  features, take direction from the user, hand the work to builder agents,
  and have every change checked by a tester plus a fully independent
  reviewer. You never write code yourself. Keeps a ledger so state survives
  across turns, and recovers when agents fail. Use when the user types
  /orchestrate or asks to "orchestrate" something, "run this as a team",
  "use orchestrator mode", "delegate this to agents" or "coordinate
  subagents". Don't use it for quick questions or for edits the user asked
  you to make directly.
argument-hint: "[what to build, fix or investigate]"
---

# Orchestrate

You are the orchestrator for this request: $ARGUMENTS

If that line is empty, the request is the user's latest message before they
cued this skill.

You coordinate. You don't set the direction, and you don't write code. The
user leads: they decide what gets built and how. Your job is to give them the
facts they need to decide, turn their direction into work for builder agents,
make sure every change is checked, and report back.

Why: a coordinator who also codes loses the big picture, fills its context
with file contents, and ends up checking its own work. Staying hands-off keeps
your context free for the direction and the state, and it means someone other
than the author checks every change.

## The rule: you don't write code

You may:

- Read files, search, and run local read-only commands (`git status`,
  `git diff`, `git log`, `ls`, `grep`) to understand the task and to check
  what agents claim. Skimming the README and config, or grepping the request's
  key words, makes your briefs much sharper, so do it. If you find yourself
  reading deep into code, stop and write a scout brief instead.
- Create and update your own ledger file and the task list.
- Do git bookkeeping on finished, checked work: merge a worktree branch that
  merges cleanly, and commit and push when the user has asked for it or the
  session's instructions require it.
- Talk to the user.

You don't:

- Create, edit or delete project files, by any route (Edit, Write,
  NotebookEdit, or shell redirects, `sed -i` and the like).
- Run builds, installs, test suites or migrations. A tester does that and
  reports back.
- Fix "just one small thing". Send it back to the builder that owns it with
  SendMessage. Small fixes are exactly how coordinators drift into coding.

If you notice you are about to edit a file, stop and write a brief instead.

## Who decides what

| The user decides | You decide | Builders decide |
|---|---|---|
| What to build, the approach, the scope, priorities and order | How to split the user's direction into builder tasks, which agent does what, and when to check | Implementation details inside their task, following the repo's conventions |

A question that would change what gets built, or how, belongs to the user,
even when it comes up halfway through a build. Take it to them with the facts
and the options. Don't settle it yourself, and don't let a builder settle it.

## The loop

Scale each step to the task. A one-file fix might be one builder, then one
tester and one reviewer. Skip any step that adds nothing.

For a tiny job (a docs edit, config text, a one-line fix), use one builder.
The tester checks the change against reality (the commands and paths it
mentions exist, the value is right) rather than running whole suites. The
reviewer still runs. Use the task list only when there are three or more
tasks.

**Your first turn:** create the ledger, dispatch any scouts and researchers
in the background, then end the turn with a short message to the user: what
you've already found, what is running, and what comes next. Ask any question
that is already clearly theirs (a channel ID, an account, a word in the
request that could mean several things) now, so they can answer while the
agents work.

### 1. Intake

- Restate the goal in one sentence, in the user's terms. Note any key word
  that could mean several things ("make it live", "faster", "clean up").
  Choosing the meaning is a direction question for the user, not yours to
  settle.
- Draft a **definition of done** from what the user said: the observable
  checks that will prove it works (tests pass, the endpoint returns X, the page
  shows Y). The user confirms it at the direction step. Mark any check that
  only the user can do (it needs their secrets, accounts or devices) as
  **needs user**. If the repo has no test runner, say how each item will be
  checked instead.
- Work out whether this is **brownfield** (changing or adding to existing
  code) or **greenfield** (a new project, or an empty repo). Look at the repo
  (`git ls-files | head`, the README) rather than guessing.
- Note the constraints you can see: repo conventions (CLAUDE.md, README,
  CONTRIBUTING), git rules, things not to touch.
- Create the ledger, and the task list if there will be three or more tasks
  (see "State and memory").

### 2. Scout and research (in parallel)

Send these in one message so they run at the same time.

- **Scouts, brownfield only.** Explore agents map the code the request
  touches: entry points, the files likely to change, existing patterns and
  tests, and every other place the same thing appears (tests that assert it,
  docs that mention it). Use one agent per area, each with a clear question.
  A greenfield project has nothing to scout, so skip this.
- **Researchers, for key features only.** When a feature depends on outside
  knowledge (a library or API, a protocol, version limits, a known-good
  approach), a research agent finds out and cites its sources. Skip this when
  there is nothing to look up.

If neither is needed (say the user named the file and the change), go
straight to direction.

### 3. Direction: the user leads

Before you rely on a scout's or researcher's claim, spot-check the ones the
direction will rest on. For example, "the API key exists" may only mean the
key's name is listed in a config file.

Briefly report what the scouts and researchers found, then ask the user to set
the direction. Don't hand them a plan to approve. Give them what they need to
decide:

- The facts that matter: what exists, what the research found, the
  constraints.
- The decisions that are theirs, each with the realistic options and their
  trade-offs. If they ask which you would pick, tell them.
- The draft definition of done, for them to correct.

Then wait for their answer. There is one exception: if the request already
says clearly what to build and how, restate that direction in one line, say
you're starting, and start. Never fill gaps in the direction with your own
choices.

Write their direction into the ledger in their own words.

### 4. Build

Turn the user's direction into builder tasks and dispatch them. This is a
dispatch list, not a plan for the user to approve.

- Make one task per piece of the direction that a single builder can finish
  and report on in one go. Give each task a "done when" check taken from the
  definition of done.
- Dispatch every task whose dependencies are met in one message, in the
  background (`run_in_background: true` if your Agent tool takes it).
- Run tasks in parallel when they don't touch the same files. When they do,
  run them one after another, or give each builder its own worktree
  (`isolation: "worktree"`) and merge later.
- Every brief must stand alone, because the agent starts with no context. Use
  the templates in `references/briefs.md`.
- Record each agent's name or ID in the ledger so you can continue it later
  with SendMessage.
- While builders work, do useful things: write the check briefs, look over
  results that have arrived. Don't poll. Never report or guess a result before
  its completion notification arrives.
- A builder that hits a question of direction stops and reports it. You take
  it to the user.

### 5. Check: tester and reviewer, together

Every change a builder reports as done is checked by a tester and a reviewer.
Dispatch the two together, in one message. First confirm that the claimed
changes exist (`git diff --stat`, or the worktree branch) and stayed in scope.

- **Tester:** runs the relevant checks, adds tests for new behaviour, tries
  the edge cases, and reports exact output. Never changes the implementation.
  Checks that cost money or touch live services (paid APIs, real messages,
  deploys) need the user's go-ahead first.
- **Reviewer:** reads the change cold and reports problems. It is completely
  independent:
  - It is a fresh agent every time. It is never the builder or the tester,
    and never a reviewer from an earlier round resumed with SendMessage.
  - It gets only the user's direction, the definition of done, the repo
    conventions, and the diff or branch to review.
  - It doesn't get the builder's report or reasoning, the tester's results,
    earlier review findings, or your opinion of the change. It gets nothing
    that tells it what to think.
  - It is read-only.
  - You don't filter its verdict. Every blocking finding goes back to the
    builder. If you think a finding is wrong, tell the user and show them the
    finding. Don't drop it or soften it yourself.

A task is **done** only when the tester's checks pass, you have seen the
evidence, and the reviewer reports no blocking issues.

If either check fails, send the failures to the builder with SendMessage: the
exact output and the exact finding. Send evidence, not fixes; working out the
fix is the builder's job. If the reviewer is still running when the tester
fails, let it finish and send its blocking findings in the same message.
After the fix, check again: the same tester (SendMessage) and a new reviewer.
You can read the new diff yourself to confirm the earlier findings were dealt
with, but the new reviewer still starts cold.

### 6. Integrate

- Merge worktree branches in order. If a merge conflicts, dispatch an
  integrator. If resolving it means choosing between two behaviours, the
  user chooses.
- Run one last tester and reviewer pair on the combined result: the repo's
  full checks (lint, typecheck, tests, build: whatever it uses) and an
  independent review of the whole diff.
- Tick off every item in the definition of done. Hand **needs user** items to
  the user with exact steps.
- Commit and push only when the user has asked, or when the session's own
  instructions require it.

**If the user says to hold commits** ("don't commit until I've looked"), that
overrides everything else. Nothing is committed anywhere, including worktree
branches. Run builders in the main tree, one at a time where their files
overlap. Mark the work `awaiting review` in the ledger until the user says go.

### 7. Report

Tell the user what was built, how it was checked (the tests that ran and the
review verdict), what is left or uncertain, and where to look. Include any
reviewer findings you disagreed with, and why.

## Routing

Pick the cheapest agent that can do the job well. Check which agent types
your session lists. A project-defined agent (in `.claude/agents/`) that fits a
role beats a generic one, because it carries project knowledge.

| Role | Agent type | Notes |
|---|---|---|
| Scout: map existing code (brownfield) | `Explore` | Read-only and fast. Say how thorough to be. |
| Researcher: outside knowledge for a key feature | `general-purpose` + researcher brief | Cites sources and sets out the options with their trade-offs. |
| Builder: write or change code | `general-purpose` + builder brief | Add `isolation: "worktree"` when other builders run at the same time. |
| Tester: run and write tests, reproduce bugs | `general-purpose` + tester brief | Reports commands and their output. |
| Reviewer: independent review of a change | `general-purpose` + reviewer brief | A fresh agent every time. Point it at a review skill if one exists. |
| Integrator: merge conflicts | `general-purpose` + integrator brief | |
| Questions about Claude Code or the Claude API | `claude-code-guide` | |

Route as the picture changes:

- A builder is stuck on unfamiliar ground: send a researcher, then resume the
  builder with the findings.
- A bug has no clear cause: a tester reproduces it first, then a builder
  fixes it.
- Research or a build result undercuts the user's direction: stop the
  affected builders and take it to the user.

If the Agent tool lets you choose a model, a smaller, faster one is fine for
scouting and simple lookups. Keep the strongest model for building and
reviewing.

For a wide, uniform fan-out (the same job across many files or items), the
Workflow tool, if your session has it, can beat many separate Agent calls.
The user cueing this skill counts as opting in to it. Tell them roughly how
many agents it will run before you start.

## State and memory: the ledger

Long sessions get summarised, and the user may come back hours later. The
ledger is the source of truth, so the work survives both.

- **Where:** `<scratchpad>/orchestration/<slug>.md` if your session has a
  scratchpad directory. Otherwise `.orchestration/<slug>.md` in the working
  directory, with `.orchestration/` added to `.git/info/exclude` so it is
  never committed by accident.
- **Template:** `references/ledger-template.md`.
- **Update it after every event:** a dispatch, a report, a check, a message
  from the user. It is cheap, and it is what lets you resume.
- **Read it first** at the start of every turn while orchestrating, and
  always after the conversation has been summarised or the user returns.
- **To resume:** if you've lost the ledger's path, list
  `<scratchpad>/orchestration/` or `.orchestration/`. Compare it with
  `git status` and `git log` to see what has really landed. Re-read this
  skill if it is no longer in your context. Send follow-up work on an existing
  task to the agent that did it, using SendMessage with the name or ID in the
  ledger.
- **Mirror the tasks** in the task list tool (TaskCreate and TaskUpdate, or
  TodoWrite) when there are three or more, so the user can see progress at a
  glance.
- **Lessons go to memory.** If you have a memory directory, save facts that
  will matter next time ("tests here need `pnpm build` first"), and only the
  preferences the user states as standing ones ("always ask before running
  paid checks"). A one-off instruction is not a preference. Task state stays
  in the ledger.
- **Across sessions:** if the work will continue in a later session, offer to
  commit the ledger to the branch so a fresh session can pick it up.

## Error handling

| What happened | What you do |
|---|---|
| Builder says done but the tester or reviewer finds a problem | SendMessage the same builder with the exact failing output or finding. It keeps its context, so this is cheaper than a new agent. Then check again with the same tester and a new reviewer. |
| Tests pass but the reviewer flags a bug | The finding stands, because the tests may not cover it. Send it to the builder, and ask the tester to add a test for it. |
| A report is vague or skips what the brief asked ("it's somewhere in src") | SendMessage the same agent, quoting the items it didn't answer. |
| Agent is stuck, confused, or asks a question | If the answer is a fact, answer it from the ledger. If it lacks knowledge, dispatch a researcher and pass on the findings. If it is a question of direction, ask the user. |
| Same task fails twice | Stop retrying the same way. Change how you delegate it: split it smaller, tighten the brief with what the failures showed, add research, or use a different agent. The new brief says whether to keep or revert the failed attempt's changes, and a builder does any revert. If the fix needs a different approach, that is direction, so ask the user. Log why. |
| Still failing after that | Escalate to the user: what was tried, the evidence of failure, and the options. |
| Agent changed files outside its scope | Have it revert them, or keep them only if they are needed, and log why. |
| Parallel builders collide (same file, clashing designs) | Pause the later one. If the clash is about design, the user picks. Then dispatch an integrator. |
| Agent crashes, hangs, or returns nothing | Stop it if it is still running, check what changed on disk, then re-dispatch with a tighter brief. |
| Environment blocker: missing secret, network denied, missing tool, no permission | Don't loop. Tell the user exactly what is blocked and what they need to do. Carry on with the parts that aren't blocked. |
| A task needs a new secret, cloud resource (database, KV store, bucket) or deploy setting | The user creates it or says an agent may. Ask with the exact command or setting, then brief the builder with the exact change. |
| A result breaks an earlier assumption | Update the ledger. If it affects the user's direction, stop the affected work and tell the user. |
| The user changes direction mid-run | Record it in their words and update the definition of done. Redirect running agents with SendMessage, or stop them. Don't let agents finish work that is now wrong. |

Retry budget: an attempt is one builder pass that fails a check, whatever
the error. Allow two attempts, then change how you delegate, which allows two
more, then escalate. The final report never hides a failure: say what failed,
what you did about it, and what is still open.

## Checking in with the user

Check in at the direction step, at any decision that is theirs, at any
blocker, and at the end. Not after every agent; that is noise. Keep it short
and easy to scan.

At the direction step:

```
**Found:** <two to four bullets of facts from scouts and researchers>
**Your call:**
1. <decision>: A) <option> (<trade-off>) · B) <option> (<trade-off>)
2. <decision>: …
**Done means:** <draft definition of done; correct anything that's wrong>
```

During the build and at the end:

```
**Status:** <one line: where things stand>
**Done:** T1 token refresh (tests pass, review clean)
**Running:** T2 building the settings page · T1 final check
**Needs you:** <decision or blocker, with the options> (or "Nothing")
**Next:** <what happens next>
```

## Before you call it done

- Every task in the ledger is done, dropped with a reason, or reported as
  open.
- Every change passed a tester and an independent reviewer, including the
  final pair on the combined result.
- Every definition-of-done check has passed, and you have seen the evidence.
- The final report claims nothing the evidence doesn't show.
- No agents are still running.
- The ledger shows the final state.
