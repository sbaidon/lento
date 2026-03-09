# Releasing

## Published Packages

- `@lento/core`
- `@lento/cli`

`@lento/server` remains private and is not part of npm releases.

## Release Flow

1. Merge changes to `main`.
2. If a changeset exists, the `Release PR` workflow updates or creates a version PR.
3. When no pending changesets remain, the same workflow runs `changeset publish`.
4. For first publish, unpublished packages at their current version can be published directly.

## Before First Public Publish

1. Ensure package names are available on npm.
2. Configure npm publishing for the repo.
3. Prefer npm trusted publishing from GitHub Actions.
4. Optionally add final repository metadata if the GitHub repo URL is settled.

## Local Shipping Check

```bash
bun run ship:check
```

This runs:

- format check
- lint
- typecheck
- build
- tests
- coverage thresholds
- `npm pack --dry-run` for public packages
