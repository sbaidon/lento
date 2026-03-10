# Releasing

## Published Packages

- `@lento/core`
- `@lento/cli`

`@lento/server` remains private and is not part of npm releases.

## Release Flow

1. Merge changes to `main`.
2. If a changeset exists, the `Release PR` workflow updates or creates a version PR.
3. npm publishing is disabled by default until the repo variable `NPM_PUBLISH_ENABLED=true` is set.
4. Once publishing is enabled and no pending changesets remain, the same workflow runs `changeset publish`.

## Before First Public Publish

1. Ensure package names are available on npm.
2. Finalize the package scope decision.
3. Configure npm publishing for the repo.
4. Set the repository variable `NPM_PUBLISH_ENABLED=true`.
5. Prefer npm trusted publishing from GitHub Actions.
6. Optionally add final repository metadata if the GitHub repo URL is settled.

## Initial Changeset Note

The repo includes an initial public-alpha changeset so the release PR flow has real metadata. Because the public packages are currently versioned at `0.1.0` in source control before first publish, keeping that changeset will bump the first automated npm release to `0.1.1`. If you want the first public npm release to be exactly `0.1.0`, replace or remove that changeset before enabling publishing.

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
