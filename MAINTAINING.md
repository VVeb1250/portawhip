# Maintaining portawhip

This is the maintainer track. For the contributor track (forks, PRs), see [CONTRIBUTING.md](CONTRIBUTING.md).

## Maintainer vs contributor — what differs

| | Maintainer (you) | Contributor |
| --- | --- | --- |
| Push to `main` | Yes, for small changes | Never — fork only |
| Branch source | Same repo | Fork |
| Review required | Optional (self) | **Yes, always** — enforced by CODEOWNERS |
| Can trigger a release | Yes (via `release-please` PR) | No |
| Trust boundary | Full | Gated by CI + your review |

Contributors never touch `main` directly, can't publish, and every PR they open requires your review via [`.github/CODEOWNERS`](.github/CODEOWNERS). That's the entire trust difference — same CI gates apply to both.

## Day-to-day: your own changes

**Small** (docs, typo, one eval case, single-file fix):

```bash
# edit directly on main
npm test && npm run route:eval && npm run doctor && npm audit
git add <files>
git commit -m "..."
git push
```

**Big** (behavior change, new adapter, router logic, cross-file):

```bash
git checkout -b feat/xxx
# ... changes, tests ...
git push -u origin feat/xxx
gh pr create --fill
# CI matrix (3 OS x Node 20/22) runs — you can't reproduce that matrix locally
# review your own diff, squash-merge once green
```

Why branch for big changes even solo: CI's OS matrix (windows-latest, macos-latest, ubuntu-latest) catches things your local Windows machine can't. Small changes are low-risk enough to skip that round-trip; anything touching cross-platform paths, the router, or adapters goes through CI first.

## Releases

Conventional Commits drive versioning automatically via [release-please](https://github.com/googleapis/release-please):

- `fix: ...` → patch bump (`0.1.1`, `0.1.2`, ...) — routine, low-ceremony, ship often.
- `feat: ...` → minor bump (`0.2.0`, `0.3.0`, ...) — the "big public release" milestones.
- `feat!: ...` / `BREAKING CHANGE:` footer → major bump (reserved for `1.0.0` and beyond).

Flow ([.github/workflows/release-please.yml](.github/workflows/release-please.yml)):

1. Every push to `main` runs `release-please`. It maintains a standing "Release PR" that accumulates the changelog from your commit messages since the last release, with the version bump already computed from those commits.
2. When you're ready to ship, merge that Release PR. release-please then tags the merge commit (`vX.Y.Z`) and cuts a GitHub Release — this is the "tag-triggered" moment.
3. The same workflow detects the fresh tag (`release_created` output) and runs the `publish` job: `npm test`, `npm run route:eval`, `npm audit --audit-level=high`, then `npm publish --provenance`. (`npm run doctor` is deliberately excluded here — it shells out to `add-mcp`/`mise`/`agent-skill-manager` to check *this machine's* installed capabilities, which a fresh CI runner never has. Useful before a manual local publish; meaningless as a CI gate.)

The `publish` job can also be fired manually (`workflow_dispatch`) to retry a publish against the current `main` tip without waiting for a new release commit — the recovery path if the gate ever breaks after a release is already tagged.

You never hand-bump `package.json` or hand-write the changelog — commit message discipline (`fix:`/`feat:`) is the only input.

**One-time setup required** (do this yourself in GitHub repo settings — not something I can do on your behalf):

- Add an npm **automation** access token as the `NPM_TOKEN` repo secret (Settings → Secrets and variables → Actions). Required for the `publish` job.
- npm provenance (`--provenance`) needs the workflow's `id-token: write` permission, already set in the workflow, plus the package being public (already true via `publishConfig.access: public`).

## Branch protection (recommended, not yet applied)

I did not enable this myself — changing access controls on a shared repo is outside what I'll do without you running it. Recommended settings for `main` (Settings → Branches → Add rule, or via `gh`):

```bash
gh api repos/VVeb1250/portawhip/branches/main/protection -X PUT --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Node 20 / ubuntu-latest", "Node 22 / ubuntu-latest", "Release gates"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1
  },
  "restrictions": null
}
EOF
```

`enforce_admins: false` is deliberate — it keeps your direct-to-main path open for small changes while still blocking contributors, who aren't admins, from merging without review and green CI.

## Bots and automation in this repo

| Bot / workflow | Does | File |
| --- | --- | --- |
| CI matrix | Tests on 3 OS x Node 20/22 + release gates on every push/PR | [.github/workflows/ci.yml](.github/workflows/ci.yml) |
| release-please | Tracks Conventional Commits, opens/updates the Release PR, tags releases, publishes to npm on merge | [.github/workflows/release-please.yml](.github/workflows/release-please.yml) |
| CodeQL | Weekly + on-push static security analysis (JS/TS) | [.github/workflows/codeql.yml](.github/workflows/codeql.yml) |
| Dependabot | Weekly npm dependency PRs (grouped prod/dev), monthly Actions version bumps | [.github/dependabot.yml](.github/dependabot.yml) |
| CODEOWNERS | Auto-requests your review on every PR | [.github/CODEOWNERS](.github/CODEOWNERS) |
| PR template | Forces user-visible effect + verify commands on every PR | [.github/pull_request_template.md](.github/pull_request_template.md) |

No merge-queue or auto-merge bot (Mergify/Kodiak) — unnecessary at solo-maintainer scale; add if PR volume grows.
