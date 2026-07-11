# Contributing to portawhip

Thanks for helping make multi-host agent tooling calmer and more reliable.

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
   npm run route:eval
   npm run doctor
   npm audit
   ```

6. Open a pull request that explains the user-visible effect and the commands used to verify it.

Keep host writes opt-in, preserve existing user configuration, and never commit credentials or machine-specific generated state.

## Reporting bugs

Include the operating system, Node.js version, affected host, exact command, expected result, and sanitized output. Use the security process in [SECURITY.md](SECURITY.md) for vulnerabilities.
