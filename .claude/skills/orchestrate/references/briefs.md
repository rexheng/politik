# Brief templates

A subagent starts with nothing: no conversation, no ledger, no idea what the
other agents are doing. Write each brief so that a capable engineer who joined
the project five minutes ago could do the job without asking you anything.
Fill in the brackets and delete lines that don't apply.

## Contents

- Shared parts: context block and report block
- Scout
- Researcher
- Builder
- Tester
- Reviewer (uses its own context block, not the shared one)
- Integrator

## Shared parts

Start every brief except the reviewer's with a **context block**:

```
You are the <role> on a team working on: <overall goal, one sentence>.
Your part: <this task's goal>.
The user's direction: <in their words, if given yet>.
Repo: <path>. Branch: <branch>. Relevant conventions: <from CLAUDE.md/README, or "none found">.
Environment: <secrets actually present (not just named), network limits, and
commands that cost money or touch live services, which you must not run>.
Already known: <findings from earlier agents that this one needs, with file paths>.
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

## Scout

Agent type: `Explore`. Brownfield repos only.

```
<context block>
Question: <the specific thing to find out, e.g. "Where do source cards get
their fields, from the data file to the rendered card?">
Thoroughness: <quick | medium | very thorough>.
I need: the files and functions involved (file:line), how data flows between
them, existing tests that cover this, the patterns a change should copy, and
every other place the same thing appears (tests that assert it, docs and
README text that mention it).
<report block>
```

## Researcher

Agent type: `general-purpose`.

```
<context block>
Question: <e.g. "What is the best way to cluster map pins with Mapbox GL JS
v3 for about 5,000 points?">
Why it matters: <the decision the user will make with this>.
Limits: <runtime (for example Cloudflare Workers, no Node APIs), versions in
use, budget, licence needs>.
Deliver:
- The realistic options, each with its trade-offs, and which one best fits
  the limits above.
- Sources: URLs, preferring official docs, with dates or versions.
- Gotchas and known bugs.
- A minimal code sketch if it helps (in your report only; don't write it into the repo).
Don't modify any files.
<report block>
```

## Builder

Agent type: `general-purpose`, with `isolation: "worktree"` if other builders
run at the same time.

```
<context block>
Task: <exactly what to build or change, following the user's direction>.
Scope: change only <files or areas>. If something outside that needs
changing, say so in your report instead of changing it.
Done when: <the checks from the definition of done, at most about three>.
Rules:
- Follow the user's direction. If you hit a question that would change what
  gets built or how, stop and report it. Don't decide it yourself.
- Match the surrounding code's style, naming and comment density.
- If your change makes an existing test's expected value wrong, update that
  test and say so in your report. The tester will check those edits.
- Before reporting, run the quick checks for what you touched (lint,
  typecheck, the closest unit tests), and include the output.
- Git: <in a worktree: "Commit your work on the worktree branch with a clear
  message." | in the main tree: "Don't commit; the orchestrator commits after
  the checks.">
- Don't push or open pull requests. Don't change CI, secrets, cloud
  resources or deploy settings unless this task names the exact change.
<report block>
```

## Tester

Agent type: `general-purpose`. Dispatched in the same message as the reviewer.

```
<context block>
You are checking someone else's change. Your job is to find out whether it
works, not to make it pass.
Change under test: <what changed, which files or branch>.
Check: <the definition-of-done items to verify>.
Do:
- Run the repo's relevant checks: <commands if known, e.g. `pnpm run check:jev`; otherwise "find them in package.json or the README">.
- Add tests for the new behaviour where the repo has a test setup, following
  its existing patterns. If it has none, check another way (run the code, a
  small throwaway script outside the repo) and say exactly how. Don't set up
  a test framework unless your task says to.
- Don't run anything that costs money or touches live services (paid APIs,
  real messages, deploys) unless this brief says you may.
- <For a docs or config change: "Check the text against reality: the
  commands, paths and values it mentions exist and are right.">

- Try the edge cases: <the ones you can think of: empty input, missing
  fields, errors, permissions>.
- <For a bug: "Reproduce it first, and report the exact reproduction steps.">
- <If a reviewer flagged a bug: "Add a test that would catch: <finding>.">
- <If the builder updated existing tests: "Check that each test edit matches
  the user's direction and doesn't just make a failing test pass.">
Don't modify the implementation. If something fails, report the failing
command and the first 20 lines of its error output, word for word.
<report block>
```

## Reviewer

Agent type: `general-purpose`. Always a fresh agent. Dispatched in the same
message as the tester.

The reviewer does **not** get the shared context block. "Already known" and
"Other agents are working on" carry the builder's and other agents' framing,
and the reviewer must form its own view. Give it only this:

```
You are an independent code reviewer. You have not seen this change before,
and no one has told you whether it is good.
What the user asked for: <the user's direction, in their words>.
Definition of done: <the list>.
Repo: <path>. Conventions: <from CLAUDE.md/README, or "none found">.
Review: <the diff: `git diff <base>...<branch>`, or the listed files>.
This is read-only. Don't edit any files. <If a code-review or security-review
skill is available: "Use it, without --fix.">
Look for: correctness bugs, unhandled edge cases, security problems, breaks
from the repo's conventions, gaps against what the user asked for, and
changes outside that scope.
For each finding give: file:line, what is wrong, a concrete input or sequence
that triggers it, and its severity (blocking or optional).
If you find nothing real, say "no blocking issues". Don't invent nitpicks.
<report block>
```

Don't add the builder's report, the tester's results, earlier review findings
or your own view of the change, even as "background".

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
