import { collectConnectorLinks } from "./link/link-connectors.mjs";
import { collectHookLinks } from "./link/link-hooks.mjs";

export const LINK_SCOPES = ["project", "global", "all"];

const LINK_TABS = new Set(["connectors", "hooks"]);
const LINK_COMMANDS = new Set(["status"]);
const COMMAND_BY_INPUT = new Map([
  ["s", "status"],
]);

const defaultCollectors = {
  connectors: collectConnectorLinks,
  hooks: collectHookLinks,
};

export function linkCommandForInput(tab, input) {
  return LINK_TABS.has(tab) ? (COMMAND_BY_INPUT.get(input) ?? null) : null;
}

export function linkActionNeedsConfirmation(command) {
  return false;
}

export function summarizeLinkAction(tab, result) {
  const statuses = result.rows.map((row) => row.instructionStatus ?? row.status ?? "unknown");
  const changed = statuses.filter((status) => status === "changed").length;
  const unchanged = statuses.filter((status) => status === "no-op" || status === "linked").length;
  const missing = statuses.filter((status) => status === "missing").length;
  const unsupported = statuses.filter((status) => status === "unsupported").length;
  const details = [];

  if (changed) details.push(`${changed} changed`);
  if (unchanged) details.push(`${unchanged} already current`);
  if (missing) details.push(`${missing} missing`);
  if (unsupported) details.push(`${unsupported} unsupported`);
  return `${tab} ${result.command} ${result.scope}: ${details.join(", ") || "no targets found"}`;
}

export async function runLinkAction({ tab, command, scope, collectors = defaultCollectors } = {}) {
  if (!LINK_TABS.has(tab)) throw new Error(`unsupported TUI action tab: ${tab}`);
  if (!LINK_COMMANDS.has(command)) {
    throw new Error("connector/hook tabs are inventory-only; use portawhip sync apply so Rulesync owns the write");
  }
  if (!LINK_SCOPES.includes(scope)) throw new Error(`unsupported link scope: ${scope}`);

  const collect = collectors[tab];
  if (typeof collect !== "function") throw new Error(`missing ${tab} collector`);

  const scopes = scope === "all" ? ["project", "global"] : [scope];
  const runs = await Promise.all(scopes.map((selectedScope) => collect({ command, scope: selectedScope })));
  const result = {
    command,
    scope,
    rows: runs.flatMap((run) => run.rows ?? []),
    runs,
  };
  return { ...result, summary: summarizeLinkAction(tab, result) };
}
