# Contributing to portawhip

Thanks for helping make multi-host agent tooling calmer and more reliable.

This is the contributor track: fork, branch, PR. Nothing here can push to `main` or trigger a release — those are maintainer-only (see [MAINTAINING.md](MAINTAINING.md) if you're curious how releases work).

## Good first contributions

- Add a routing eval case for a real false positive or missed capability.
- Improve a host-support probe or its documentation.
- Add tests for an unverified operating-system path.
- Clarify setup, safety boundaries, or troubleshooting.

## Development workflow

1. Fork and clone the repository.
2. Install Node.js 20 or newer and run `npm ci`.
3. Create a focused branch.
4. Add or update a test before changing behavior.
5. Run the release gates:

   ```bash
   npm test
   PORTAWHIP_DISABLE_PROVIDERS=all npm test
   npm run doctor
   npm audit
   ```

6. Open a pull request using the provided template — it asks for the user-visible effect and the commands used to verify it. Every PR is auto-assigned to [@VVeb1250](https://github.com/VVeb1250) for review via CODEOWNERS; the CI matrix (3 OS x Node 20/22) plus the release gates must pass before merge.

Keep host writes opt-in, preserve existing user configuration, and never commit credentials or machine-specific generated state.

Use `fix:` / `feat:` prefixes in your commit messages (Conventional Commits) — they drive automatic changelog and version bumps after merge.

## Reporting bugs

Include the operating system, Node.js version, affected host, exact command, expected result, and sanitized output. Use the security process in [SECURITY.md](SECURITY.md) for vulnerabilities.
