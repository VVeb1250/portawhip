# Changelog

All notable user-facing changes are documented here.

## [0.2.0](https://github.com/VVeb1250/portawhip/compare/portawhip-v0.1.0...portawhip-v0.2.0) (2026-07-12)


### Features

* expand router capability discovery ([31597a9](https://github.com/VVeb1250/portawhip/commit/31597a9778b4e897c7fa9db29c7d56f25bab0c5f))
* expose public npx entry points ([c20b633](https://github.com/VVeb1250/portawhip/commit/c20b63323ea63d97337467c0d3a73b22cda92d84))
* harden connector release flow ([08748de](https://github.com/VVeb1250/portawhip/commit/08748de4de7b54caa9ad924bba3beefb760dc39f))
* manage connector and hook links in TUI ([57cf2ac](https://github.com/VVeb1250/portawhip/commit/57cf2ac74ebbe9ac201b7c785cd52c8c734c2e63))
* **router:** differentiate push and pull intent handling ([7e7a3b7](https://github.com/VVeb1250/portawhip/commit/7e7a3b7874a0cc40ce3f889bf5d63e0d1796eb39))
* **router:** sharpen route() instruction for intent extraction ([e20d273](https://github.com/VVeb1250/portawhip/commit/e20d273942fe620577d8a550fada2145da31ab2d))


### Bug Fixes

* load packaged router defaults outside workspaces ([e59ab46](https://github.com/VVeb1250/portawhip/commit/e59ab46e56881596cd60790314fe6a7555862896))
* share packaged runtime fallback across CLI surfaces ([974acd4](https://github.com/VVeb1250/portawhip/commit/974acd4fbda7c942c957120c4a12ef02f7e811dd))
* trust direct curated triggers on clean installs ([c40e908](https://github.com/VVeb1250/portawhip/commit/c40e90843ed6a2cd968ed6c1d92c9062bd514ec5))
* update js-yaml to v5, add-mcp to 1.14, ai-config-sync-manager to 0.1.7 ([d252eb7](https://github.com/VVeb1250/portawhip/commit/d252eb7b788a3cb279d1250baa91515d53a97831))
* use cross-platform Node test discovery ([caed0a7](https://github.com/VVeb1250/portawhip/commit/caed0a79a59bebfc62ed169212cca75dc95bc6b5))

## 0.1.0 - 2026-07-12

First public npm release.

- Added an interactive TUI for inventory, sync previews, connectors, hooks, enrichment, and capabilities.
- Added public `portawhip`, `portawhip-router`, and `harness-router` executables.
- Added hybrid lexical and local semantic capability routing with confidence-based abstention.
- Added cross-host connector, command, agent, skill, and supported-hook synchronization.
- Added guarded config-sync profiles, live doctor checks, route evaluations, and feedback-aware ranking.
