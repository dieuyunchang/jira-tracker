---
name: pr-description
description: "Write a GitHub/GitLab pull request description in English Markdown from the current branch's own changes (committed and uncommitted since the branch was created), or against a branch the user names. Covers problem, changes, before/after examples for logic changes, and tests. Read-only: never creates or edits a PR."
user-invocable: true
when_to_use: "Invoke when the user asks for a PR/MR description, PR text, change summary or commit description for the current branch or a given range."
argument-hint: "[compare-branch | commit | commit-range] [--uncommitted-only]"
---

# PR description

Produce a ready-to-paste PR description in English Markdown that explains what the
branch changes and why, with concrete examples whenever behavior or calculations change.

## Hard rules

- Output is **text only**: one fenced ```markdown block in the reply.
- Never run `gh pr create`, `gh pr edit`, `glab mr ...`, push, or call any API that creates
  or updates a PR/MR. Do not commit. Do not write the description to a file unless asked.
- Write the description in **English**, even when the conversation is in another language.
  The short reply around the block follows the user's language.
- Describe only what the diff actually contains. Never invent behavior, numbers, ticket IDs
  or test results.

## 1. Resolve the scope

Default: **only the work done on the current branch since it was checked out (created)**,
committed **and** uncommitted. Do not compare with master/main or any other branch
unless the user names one.

1. Find the start point `START`, first match wins:
   - **Branch named by the user** (e.g. "compare with master", `/pr-description master`):
     `git fetch origin <branch> -q`, then
     `START=$(git merge-base HEAD origin/<branch>)` (use the local branch if no remote exists).
   - **Default, the branch creation point** from the reflog:
     `git reflog show --format='%H %gs' "$(git branch --show-current)" | grep 'branch: Created from' | tail -1`
     and take the hash of that line as `START`.
   - **No creation entry** (reflog expired, branch fetched from a remote, detached HEAD):
     do not guess. Ask the user which branch or commit to compare against, and offer
     "uncommitted changes only" as an option.
2. Collect:
   - `git log --oneline $START..HEAD` for the branch's commit subjects and ticket IDs;
   - `git diff --stat $START` for the file list, committed **and** uncommitted;
   - `git diff $START -- <path>` for each file you analyse;
   - `git status --short` for untracked files, and read new untracked source files.
3. Other arguments: a commit hash means `git show <sha>`; a range `A..B` means that
   range; `--uncommitted-only` means `git diff HEAD` plus untracked files.
4. State the resolved scope in the reply, e.g.
   "Scope: branch created at 470bb29, 2 commits + uncommitted changes."

For large diffs, read app/source code first, then migrations and config, then specs.
Skim generated files (schema dumps, lockfiles) only to mention them.

## 2. Understand before writing

For each logical change, open the surrounding code as needed. The goal is to state the
**problem it solves**, the **new behavior**, and **who or what is affected**.

- Group related files into one change item. Do not list every file.
- Identify the type of each change: bug fix, new feature, refactor (no behavior change),
  config, migration, tests only.
- Note public contract changes: API params and responses, DB schema, events, job
  arguments, renamed commands, removed validations or error codes.
- Note risks that a reviewer must know: data migrations, backfills, feature flags,
  deploy order, cache keys, idempotency, retries.
- Find the ticket ID from the branch name or commit subjects (e.g. `EJAR-20723`).

## 3. Examples are required when logic changes

Add an **Example** section whenever the diff changes a calculation, state transition,
validation rule, data mapping or flow outcome. Build it from the real code path:

- Choose small, realistic input values and **compute the output by following the code**,
  including rounding and edge rules. Re-check the arithmetic.
- Show input as a table, then a **Before / After** table of the observable result
  (DB fields, API response, invoice amounts, statuses, events or messages).
- Mark the wrong value before the fix and the corrected value after it (❌ / ✅) when the
  change is a bug fix.
- If a spec in the diff encodes the same scenario, use the same numbers and say so.
- Skip the Example section for pure refactors, renames, config or test-only changes.

## 4. Output template

Omit any section that has no content. Keep sentences complete and specific.

````markdown
## [TICKET-ID] <Outcome-focused title: what is now true after this change>

### Problem
<What was wrong or missing, and the concrete consequence. One or two short paragraphs.>

### Changes
- **`<Class or area>`**: <what changed and why, one bullet per logical change>.
  - <sub-bullets for important details: fields, rules, edge cases>
- **`<Next area>`**: ...

### Example
<Context: the input situation in one or two sentences.>

| <input columns> |
|---|

<Results / Before → After:>

| Field | Before | After |
|---|---|---|

### Impact & risks
- <Migrations, backfills, deploy order, contract changes, behavior visible to users.>

### Tests
- <New or updated specs and what they prove. "Fails on the previous code" only if verified.>
- <Commands run and their results, only if actually run in this session.>
````

Title rules: start with the ticket ID when one exists. Describe the outcome, not the
activity ("Settled installments count as paid on the new contract", not "Update allocation").

## 5. Before replying

- Every claim maps to a hunk in the diff; every number in the example comes from the code.
- Test results are reported only if they were run; otherwise list specs as "added/updated".
- The reply contains the fenced markdown block, then at most one or two lines that note
  scope limits (e.g. "covers commits X..Y; the HealthCheckJob commit is not included")
  and any open questions.
