# Pull Request Workflow

## Why

PR should let reviewer understand intent, verify evidence, and identify risk without reconstructing development history.

## Before Opening

- Confirm issue acceptance criteria.
- Update plan to reflect final implementation.
- Review full diff against default branch.
- Remove debug code and unrelated churn.
- Run required validation.
- Confirm migrations, configuration, and rollback needs.

## Title

Use Conventional Commit format with a Korean summary:

```text
<type>(<optional-scope>): <한글 요약>
```

Write the body in Korean as well. Keep the template headings, code identifiers,
API names, CLI commands, and error strings in their original form.

## Body Template

```markdown
## Why

## What Changed

## Validation
- [ ] Command or manual check

## Risks

## Rollback

Closes #123
```

## Metadata

Set assignee, label, and milestone when creating the PR, not afterwards. An
unassigned or unlabeled PR does not appear in the boards and filters the team
uses to find work, so it stalls without anyone noticing.

- **Assignee** — whoever is responsible for landing it. Use `--assignee @me`
  when that is you.
- **Label** — at minimum the one matching the change type.
- **Milestone or project** — when the repository tracks work that way.
- **Reviewer** — request explicitly rather than relying on default rules.

```bash
gh pr create --title "<title>" --body-file /tmp/pr-body.md \
  --assignee @me --label fix --reviewer <handle>
```

Read the repository's existing labels with `gh label list` before guessing.
Creating a label that duplicates an existing one with different wording splits
the boards it was meant to feed.

## Safe Creation

Write generated PR content to a Markdown file before invoking GitHub CLI. Pass
the file with `--body-file`; do not interpolate multiline content into `--body`.
This prevents shell quoting, command substitution, and newline damage.

Use a temporary file unless the repository requires the PR draft to be tracked:

```bash
gh pr create --title "<title>" --body-file /tmp/pr-body.md
```

After creation, read the remote PR back with `gh pr view` and confirm the title
and body match the source file. Fix the remote PR before reporting completion if
content is missing, truncated, or malformed. Remove temporary files after
successful verification.

## Review Rules

- Keep PR focused on one coherent outcome.
- Mark draft while known required work remains.
- Respond to each actionable review comment.
- Resolve threads only after change or explicit agreement.
- Add new commits during review when history clarity matters.
- Squash only when repository policy prefers a single final commit.

## Merge Criteria

- acceptance criteria satisfied
- required checks pass
- review approvals complete
- unresolved risks explicitly accepted
- deployment or migration order documented
