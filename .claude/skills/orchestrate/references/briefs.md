# Brief templates

A subagent starts with nothing: no conversation, no ledger, no idea what the
other agents are doing. Write each brief so that a capable engineer who joined
the project five minutes ago could do the job without asking you anything.
Fill in the brackets and delete lines that don't apply.

## Contents

- Shared parts: context block and report block
- Explorer
- Researcher
- Planner
- Implementer
- Tester
- Reviewer
- Integrator

## Shared parts

Start every brief with a **context block**:

```
You are the <role> on a team working on: <overall goal, one sentence>.
Your part: <this subtask's goal>.
Repo: <path>. Branch: <branch>. Relevant conventions: <from CLAUDE.md/README, or "none found">.
Already known: <findings from earlier agents that this one needs, with file paths>.
Decisions already made: <and why, briefly>.
Other agents are working on: <their areas>. Don't touch those files.
```

End every brief with a **report block**:

```
When you finish, report in under 300 words:
- Result: done / partly done / blocked (one line).
- What you found or changed: file paths and a summary. No full files, no full diffs.
- Evidence: the commands you ran and the key lines of their output.
- Open points: anything uncertain, and anything out of scope you noticed but left alone.
```

The size limit matters. Long reports fill the orchestrator's context, and the
details already live in the files and in git.

## Explorer

Agent type: `Explore`.

```
<context block>
Question: <the specific thing to find out, e.g. "Where do source cards get
their fields, from the data file to the rendered card?">
Thoroughness: <quick | medium | very thorough>.
I need: the files and functions involved (file:line), how data flows between
them, existing tests that cover this, and the patterns a change should copy.
<report block>
```

## Researcher

Agent type: `general-purpose`.

```
<context block>
Question: <e.g. "What is the best way to cluster map pins with Mapbox GL JS
v3 for about 5,000 points?">
Why it matters: <the decision this feeds into>.
Limits: <runtime (for example Cloudflare Workers, no Node APIs), versions in
use, budget, licence needs>.
Deliver:
- A recommendation, and why it wins.
- Two or three alternatives, with their trade-offs.
- Sources: URLs, preferring official docs, with dates or versions.
- Gotchas and known bugs.
- A minimal code sketch if it helps (in your report only; don't write it into the repo).
Don't modify any files.
<report block>
```

## Planner

Agent type: `Plan`.

```
<context block>
Design: <the change to design>.
Must satisfy: <the definition-of-done items it covers>.
Angle: <optional, e.g. "the smallest change that works" or "built to scale
later". Give two planners different angles for a real choice>.
Return: ordered steps, the files each step touches, risks, the tests to add,
and anything that should be split into parallel work.
<report block>
```

## Implementer

Agent type: `general-purpose`, with `isolation: "worktree"` if other writers
run at the same time.

```
<context block>
Task: <exactly what to build or change>.
Scope: change only <files or areas>. If something outside that needs
changing, say so in your report instead of changing it.
Done when: <the acceptance checks, at most about three>.
Approach: <the chosen plan or research recommendation, if there is one>.
Rules:
- Match the surrounding code's style, naming and comment density.
- Before reporting, run the quick checks for what you touched (lint,
  typecheck, the closest unit tests), and include the output.
- Git: <in a worktree: "Commit your work on the worktree branch with a clear
  message." | in the main tree: "Don't commit; the orchestrator commits after
  verification.">
- Don't push, open pull requests, or change CI, secrets or deploy settings.
<report block>
```

## Tester

Agent type: `general-purpose`.

```
<context block>
You are checking someone else's change. Your job is to find out whether it
works, not to make it pass.
Change under test: <what changed, which files or branch>.
Check: <the definition-of-done items to verify>.
Do:
- Run the repo's relevant checks: <commands if known, e.g. `pnpm run check:jev`; otherwise "find them in package.json or the README">.
- Add tests for the new behaviour where the repo has a test setup, following
  its existing patterns.
- Try the edge cases: <the ones you can think of: empty input, missing
  fields, errors, permissions>.
- <For a bug: "Reproduce it first, and report the exact reproduction steps.">
Don't modify the implementation. If something fails, report the failing
command and its output word for word.
<report block>
```

## Reviewer

Agent type: `general-purpose`.

```
<context block>
Review: <the diff: `git diff <base>...<branch>`, or the listed files>.
Against: <the definition of done and the repo conventions>.
This is read-only. Don't edit any files. <If a code-review or security-review
skill is available: "Use it, without --fix.">
Look for: correctness bugs, unhandled edge cases, security problems, breaks
from the repo's conventions, and changes outside the stated scope.
For each finding give: file:line, what is wrong, a concrete input or sequence
that triggers it, and its severity (blocking or optional).
If you find nothing real, say "no blocking issues". Don't invent nitpicks.
<report block>
```

## Integrator

Agent type: `general-purpose`.

```
<context block>
Merge: <branches, in this order>.
Conflicts expected in: <files, if known>.
Intent of each side: <what each branch was meant to achieve, so neither
side's behaviour is lost>.
When both sides changed the same logic and keeping both is impossible,
don't choose: stop and report the conflict with both versions.
After merging, run <checks> and report the output.
<report block>
```
