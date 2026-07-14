# Changelog

All notable user-facing changes are documented here.

## [0.3.0](https://github.com/VVeb1250/portawhip/compare/portawhip-v0.2.1...portawhip-v0.3.0) (2026-07-14)


### Features

* **scope:** derive MCP project/global scope from config, add consolidation docs ([e9ab947](https://github.com/VVeb1250/portawhip/commit/e9ab94715b128d25e26089907368d74af8da39c0))
* **scope:** merge compatible MCP variants instead of blocking on any difference ([ba660cb](https://github.com/VVeb1250/portawhip/commit/ba660cba910a0c26b0862bbea599d65a505e949d))
* **scope:** wire derived scope into global MCP seed ([3e9ba73](https://github.com/VVeb1250/portawhip/commit/3e9ba736af8f7272bc272d4974333e3926ad90b8))
* **sync:** wire real SessionStart auto-sync, fix orphaned hook writer ([f7d6949](https://github.com/VVeb1250/portawhip/commit/f7d694977a9d351256d1d2b66d755f58c88438dc))


### Bug Fixes

* **deps:** regenerate package-lock.json, npm ci was broken ([532af0e](https://github.com/VVeb1250/portawhip/commit/532af0edc00080ef1bb60b4ee04b7922acca725d))
* **test:** make reconcile fixture path cross-platform ([04c055e](https://github.com/VVeb1250/portawhip/commit/04c055e8c879b2bafb0f9fb54c0f16257a8bb3b1))

## [0.2.1](https://github.com/VVeb1250/portawhip/compare/portawhip-v0.2.0...portawhip-v0.2.1) (2026-07-12)


### Bug Fixes

* drop npm run doctor from CI publish gate, add manual re-publish trigger ([be3d388](https://github.com/VVeb1250/portawhip/commit/be3d388bd7c0793166627a86013d54e677c8e062))

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
