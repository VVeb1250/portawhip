# Security policy

## Supported versions

Security fixes are applied to the latest published npm version and the default branch.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not open a public issue or include secrets, tokens, private prompts, or host configuration in a report.

Include a concise impact statement, affected version, reproduction steps, and any suggested mitigation. You should receive an acknowledgement within seven days.

## Scope and trust boundaries

Portawhip suggests and configures capabilities; it does not bypass the host's permission model. Connector and hook linking can modify host configuration, so those writes remain explicit and should be preceded by a backup. Embedded third-party hooks are inventoried but never activated automatically.
