# TASK

Review the code changes on branch `{{BRANCH}}` and improve code clarity, consistency, and maintainability while preserving exact functionality.

This branch is one layer of a stacked-PR walk, based on `{{BASE_BRANCH}}`. Review only this layer's increment. Never merge, rebase, or switch branches.

# CONTEXT

## Branch diff

!`git diff {{BASE_BRANCH}}...{{BRANCH}}`

## Commits on this branch

!`git log {{BASE_BRANCH}}..{{BRANCH}} --oneline`

# REVIEW PROCESS

1. **Understand the change**: Read the diff and commits above to understand the intent.

2. **Analyze for improvements**: Look for opportunities to:
   - Reduce unnecessary complexity and nesting
   - Eliminate redundant code and abstractions
   - Improve readability through clear variable and function names
   - Consolidate related logic
   - Avoid nested ternary operators - prefer switch statements or if/else chains
   - Choose clarity over brevity - explicit code is often better than overly compact code

3. **Comment pass (mandatory)**: Apply this to every comment the diff adds
   or edits. Do not touch comments the diff leaves alone.
   - Delete any comment that states no constraint the code cannot show.
   - Replace rationale with an ADR reference (`/* ADR NNNN */`). The
     comment never restates the ADR's content.
   - Compress any comment over the caps: 2 lines per comment, 6 lines
     for a function comment or file header. Content that earns more is
     documentation — move it to a concise Markdown document under
     `docs/` and reference it from the code. Not into an ADR: ADRs
     record decisions; they are not documentation.
   - Rewrite the survivors in the comment register from
     @.sandcastle/prompts/CODING_STANDARDS.md.
   - Survivors speak the ubiquitous language: domain concepts use their
     glossary names from `CONTEXT.md` at repo root — no synonyms, no
     coinages. If the change introduces a brand-new concept with no
     glossary entry, add the entry to `CONTEXT.md`; do not let the
     concept ship unnamed.

   A well-written paragraph is not exempt — well-written rationale
   belongs in the ADR, well-written explanation belongs in a docs page;
   neither belongs in a comment.

4. **Check correctness**:
   - Does the implementation match the intent? Are edge cases handled?
   - Are there unsafe casts, `any` types, or unchecked assumptions?
   - Does the change introduce injection vulnerabilities, credential leaks, or other security issues?

5. **Maintain balance**: Avoid over-simplification that could:
   - Reduce code clarity or maintainability
   - Create overly clever solutions that are hard to understand
   - Combine too many concerns into single functions or components
   - Remove helpful abstractions that improve code organization
   - Make the code harder to debug or extend

6. **Apply project standards**: Follow the coding standards defined in @.sandcastle/prompts/CODING_STANDARDS.md

7. **Preserve functionality**: Never change what the code does - only how it does it. All original features, outputs, and behaviors must remain intact.

# EXECUTION

If you find improvements to make:

1. Make the changes directly on this branch
2. Run `npm run check` to ensure nothing is broken — it is the only gate; the repo intentionally has no test runner, and you must not add one
3. Commit describing the refinements. Do not push — the host pushes your commits and opens the draft PR after your pass.

If the code is already clean and well-structured, do nothing.

Once complete, output <promise>COMPLETE</promise>.
