# TASK

Implement issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}

Pull in the issue using `gh issue view {{ISSUE_NUMBER}}`. If it has a parent
PRD, pull that in too.

Only work on the issue specified.

You are on branch `{{BRANCH}}`, cut from `{{BASE_BRANCH}}`. This branch is one
layer of a stacked-PR walk: earlier issues' work is already present on
`{{BASE_BRANCH}}` even though it has not merged to main. Build on what is
there. Never merge, rebase, or switch branches.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# STANDARDS

Follow @.sandcastle/prompts/CODING_STANDARDS.md. In short: idiomatic Astro, zero
client JS by default, scoped styles on the design tokens, and the Astro docs
MCP (`astro-docs`) beats training data — consult it for any Astro question.

All rationale goes in the ADR; code comments never restate it — a comment
states a constraint and references the ADR (`/* ADR NNNN */`). Comments
speak the ubiquitous language: glossary names from `CONTEXT.md`, no
synonyms.

# EXPLORATION

Explore the repo and fill your context window with relevant information that
will allow you to complete the task.

# MISSING FOUNDATION — STOP, DON'T RE-IMPLEMENT

If the issue's spec references components, layouts, schema, or content
plumbing that do not exist in your tree, a foundation issue that should have
built before yours is missing from your branch's ancestry. Do NOT re-implement
that foundation blind — a duplicate implementation pollutes your PR diff and
forces the restack to reconcile two versions.

Instead, stop and report:

1. Make no commits.
2. Leave a comment on issue #{{ISSUE_NUMBER}} naming what is missing and
   which issue you suspect should have provided it.
3. Output a single line of the form
   `<missing-dependency>#<suspected foundation issue> should block #{{ISSUE_NUMBER}}: <what is missing></missing-dependency>`
   followed by `<promise>COMPLETE</promise>` to end the run. The host prunes
   this step, surfaces your report in the run summary, and the operator adds
   the blocked-by edge and re-runs.

Only trip this wire for genuine foundations the spec builds on — not for
nice-to-haves you could reasonably create as part of your own issue.

# FEEDBACK LOOPS

Before committing, run `npm run check` and fix every error it reports. This is
the only gate — the repo intentionally has no test runner. Do not add one.

# COMMIT

Make a git commit. The commit message must:

1. Start with `RALPH:` prefix
2. Include task completed + PRD reference
3. Key decisions made
4. Files changed
5. Blockers or notes for next iteration

Keep it concise.

# PULL REQUEST

When the work is complete and `npm run check` passes:

1. Push the branch: `git push -u origin {{BRANCH}}`. If the push is rejected
   for credentials, run `gh auth setup-git` once and retry.
2. Open a draft PR based on the branch you were cut from, using stock `gh`
   (the host retargets the base to the PR's final predecessor afterwards, so
   do not second-guess it):

   `gh pr create --draft --head {{BRANCH}} --base {{BASE_BRANCH}} --title "..." --body-file <file>`

3. The body must follow `.github/pull_request_template.md`, start with
   `Closes #{{ISSUE_NUMBER}}`, and stay under ~200 words. Never hard-wrap
   prose in the body — GitHub renders a single newline as a line break there.

Do not close the issue — merging the PR does that. Do not merge anything.

# THE ISSUE

If the task is not complete, leave a comment on the issue with what was done.

Do not close the issue.

Once complete, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
