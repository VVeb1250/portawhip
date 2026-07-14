#!/usr/bin/env node

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput, useStdin, useStdout } from "ink";
import ansiEscapes from "ansi-escapes";
import { CONFIG_SYNC_BACKENDS } from "../core/surface/config-sync-backends.mjs";
import { DEFAULT_CACHE_PATH, runEnrichment } from "../core/registry/enrich.mjs";
import { collectSurfaceInventory } from "../core/surface/surface-inventory.mjs";
import { collectSyncConfig } from "./sync/sync-config.mjs";
import { runReconcile } from "./sync/reconcile.mjs";
import { LINK_SCOPES, linkActionNeedsConfirmation, linkCommandForInput, runLinkAction } from "./tui-actions.mjs";
import { CONFIG_SCOPES, collectConfigRows, draftForRow, formatConfigValue, runConfigWrite, validateConfigDraft } from "./tui-config.mjs";

const TABS = ["overview", "sync", "connectors", "hooks", "enrich", "capabilities", "settings"];
const TAB_COPY = {
  overview: {
    title: "Start here",
    description: "See what portawhip found and choose the next check.",
    action: "Press 2 for sync, 3 for connectors, 4 for hooks, 5 for enrich, 6 for capabilities, 7 for settings.",
  },
  sync: {
    title: "Config sync",
    description: "Preview or apply config sync across agent hosts.",
    action: "Use f for safe profiles first, p to preview, then a twice to apply.",
  },
  connectors: {
    title: "MCP + instruction inventory",
    description: "Read-only host inventory; Rulesync owns all config writes.",
    action: "Choose scope with g and press s to refresh status; use the sync tab to write.",
  },
  hooks: {
    title: "Native hook inventory",
    description: "Read-only hook inventory; Rulesync owns all config writes.",
    action: "Choose scope with g and press s to refresh status; use the sync tab to write.",
  },
  enrich: {
    title: "Tool descriptions",
    description: "Fill cached descriptions for discovered tools so routing works from natural language.",
    action: "Press e to refresh the enrichment cache.",
  },
  capabilities: {
    title: "Routable capabilities",
    description: "Browse the skills, MCP servers, and CLI tools the router can suggest.",
    action: "Use up/down to inspect rows; details appear below the list.",
  },
  settings: {
    title: "Router settings",
    description: "Inspect effective values and edit user or project overrides.",
    action: "Use g for scope, e to edit, and u twice to unset an override.",
  },
};
const MIN_LIST_HEIGHT = 3;
const MAX_DETAIL_HEIGHT = 9;
const SYNC_SCOPES = ["all", "project", "global"];
const SYNC_DIRECTIONS = [
  { label: "auto", from: null, to: null },
  { label: "claude->codex", from: "claude", to: "codex" },
  { label: "codex->claude", from: "codex", to: "claude" },
];
const SYNC_INCLUDE_PRESETS = [
  { label: "none", include: null },
  { label: "instructions", include: "instructions" },
  { label: "mcp", include: "mcp" },
  { label: "hooks", include: "hooks" },
  { label: "permissions", include: "permissions" },
];
const SYNC_PROFILES = [
  { id: "manual", label: "manual", backends: null, scope: null, include: null },
  { id: "rulesync-project", label: "rulesync project", backends: ["rulesync"], scope: "project", include: "all" },
  { id: "rulesync-global", label: "rulesync global", backends: ["rulesync"], scope: "global", include: "all" },
  { id: "asm-status", label: "asm status", backends: ["agent-skill-manager"], scope: "all", include: null },
];
const STATUS_COLORS = {
  linked: "green",
  available: "green",
  success: "green",
  ok: "green",
  changed: "green",
  "no-op": "green",
  ready: "cyan",
  warning: "yellow",
  error: "red",
  missing: "yellow",
  unsupported: "gray",
  "mcp-only": "cyan",
  enriched: "green",
  "bare-name": "yellow",
};

function shortPath(path) {
  if (!path) return "";
  const parts = path.split(/[\\/]/);
  return parts.length > 4 ? `.../${parts.slice(-3).join("/")}` : path;
}

function truncate(value, width) {
  const text = String(value ?? "");
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 3) return ".".repeat(width);
  return `${text.slice(0, width - 3)}...`;
}

function statusColor(status) {
  return STATUS_COLORS[status] ?? "white";
}

function layoutForRows(terminalRows, hasDetail, hasHelp = false) {
  const headerRows = 4;
  const helpRows = hasHelp ? 7 : 0;
  const footerRows = 1;
  const margins = hasDetail ? 2 : 1;
  const available = Math.max(MIN_LIST_HEIGHT, terminalRows - headerRows - helpRows - footerRows - margins);
  const detailHeight = hasDetail && available >= MIN_LIST_HEIGHT + 4 ? Math.min(MAX_DETAIL_HEIGHT, Math.max(4, Math.floor(available * 0.35))) : 0;
  const listHeight = Math.max(MIN_LIST_HEIGHT, available - detailHeight);
  return { detailHeight, listHeight };
}

function messageColor(message) {
  if (!message) return "gray";
  const lower = message.toLowerCase();
  return lower.includes("error") || lower.includes("needs") || lower.includes("failed") ? "red" : "green";
}

function printHelp() {
  console.log(`portawhip TUI

Usage:
  node scripts/tui.mjs
  node scripts/tui.mjs --summary
  node scripts/tui.mjs --help

Keys:
  1-7 jump tabs, tab/right next tab, left previous tab
  up/down select rows, h or ? help, r refresh, q quit
  sync tab: f profile, b backend, g scope, d direction, i include
  sync actions: s status, p preview, a apply (press twice to confirm)
  connectors/hooks tabs: g scope, s status, l install or repair (press twice), x remove (press twice)
  settings tab: g scope, e edit, u unset (writes require confirmation)

Safety:
  sync apply requires one backend plus an include selector or safe profile.
  connector and hook changes require a second key press to confirm.
  sync-config does not run unpinned npx backends unless --allow-npx is used on the CLI.`);
}

function enterFullscreen() {
  process.stdout.write(ansiEscapes.enterAlternativeScreen + ansiEscapes.cursorHide + ansiEscapes.clearViewport);
}

function exitFullscreen() {
  process.stdout.write(ansiEscapes.cursorShow + ansiEscapes.exitAlternativeScreen);
}

function useInventory() {
  const [state, setState] = useState({ loading: true, error: null, inventory: null });
  const refresh = async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      setState({ loading: false, error: null, inventory: await collectSurfaceInventory() });
    } catch (error) {
      setState({ loading: false, error, inventory: null });
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return { ...state, refresh };
}

function useTerminalSize() {
  const { stdout } = useStdout();
  const readSize = () => ({
    columns: stdout.columns ?? process.stdout.columns ?? 100,
    rows: stdout.rows ?? process.stdout.rows ?? 30,
  });
  const [size, setSize] = useState(readSize);

  useEffect(() => {
    const onResize = () => setSize(readSize());
    stdout.on("resize", onResize);
    return () => stdout.off("resize", onResize);
  }, [stdout]);

  return size;
}

function Header({ tab, loading, enriching, syncing, linking }) {
  const copy = TAB_COPY[tab];
  return React.createElement(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    React.createElement(
      Box,
      null,
      React.createElement(Text, { color: "cyan", bold: true }, "portawhip"),
      React.createElement(Text, null, " surface"),
      loading ? React.createElement(Text, { color: "yellow" }, " refresh") : null,
      enriching ? React.createElement(Text, { color: "yellow" }, " enrich") : null,
      syncing ? React.createElement(Text, { color: "yellow" }, " sync") : null,
      linking ? React.createElement(Text, { color: "yellow" }, " link") : null,
    ),
    React.createElement(
      Box,
      null,
      TABS.map((item, index) =>
        React.createElement(
          Text,
          { key: item, inverse: item === tab, color: item === tab ? "black" : "white" },
          ` ${index + 1}:${item} `,
        ),
      ),
    ),
    React.createElement(
      Text,
      { color: "gray", wrap: "truncate-end" },
      `${copy.title}: ${copy.description}`,
    ),
  );
}

function Overview({ inventory }) {
  const rows = [
    ["sync backends", Object.keys(CONFIG_SYNC_BACKENDS).length, Object.fromEntries(Object.entries(CONFIG_SYNC_BACKENDS).map(([id, backend]) => [id, Object.keys(backend.supports).filter((action) => backend.supports[action]).join("/")]))],
    ["connectors", inventory.connectors.length, inventory.summary.connectors],
    ["hooks", inventory.hooks.length, inventory.summary.hooks],
    ["enrich", inventory.enrichments.length, inventory.summary.enrichments],
    ["capabilities", inventory.capabilities.length, inventory.summary.capabilities],
  ];

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Text, { color: "gray" }, `generated ${inventory.generatedAt}`),
    React.createElement(Text, { color: "gray" }, inventory.cwd),
    React.createElement(
      Box,
      { borderStyle: "round", borderColor: "cyan", paddingX: 1, flexDirection: "column", marginTop: 1, marginBottom: 1 },
      React.createElement(
        Text,
        null,
        React.createElement(Text, { color: "cyan", bold: true }, "Workspace pulse"),
        React.createElement(Text, { color: "gray" }, "  live inventory"),
      ),
      rows.map(([label, count, summary]) =>
        React.createElement(
          Box,
          { key: label },
          React.createElement(Text, { color: count > 0 ? "green" : "gray" }, count > 0 ? "● " : "○ "),
          React.createElement(Text, { bold: true }, `${label.padEnd(14)} `),
          React.createElement(Text, { color: "cyan", bold: true }, `${String(count).padStart(4)}  `),
          React.createElement(
            Text,
            { color: "gray" },
            Object.entries(summary)
              .map(([key, value]) => `${key}:${value}`)
              .join("  "),
          ),
        ),
      ),
    ),
    React.createElement(Text, { color: "cyan", bold: true }, "Start here"),
    React.createElement(Text, null, "1  Press 2, then f to choose a safe sync profile and p to preview."),
    React.createElement(Text, null, "2  Press 3 or 4 to inspect connector and hook status without writing."),
    React.createElement(Text, null, "3  Press 5, then e when tool descriptions need enrichment."),
    React.createElement(Text, null, "4  Press 7 to inspect and edit router settings for this user or project."),
    React.createElement(Text, { color: "gray" }, "Press h or ? for the key map. Config writes and destructive actions always ask twice."),
  );
}

function syncSelection({ backendIndex, scopeIndex, directionIndex, includeIndex, profileIndex }) {
  const backendIds = Object.keys(CONFIG_SYNC_BACKENDS);
  const backendChoice = backendIndex === 0 ? "all" : backendIds[backendIndex - 1];
  const profile = SYNC_PROFILES[profileIndex];
  const direction = SYNC_DIRECTIONS[directionIndex];
  const includePreset = SYNC_INCLUDE_PRESETS[includeIndex];
  const backends = profile.backends ?? (backendChoice === "all" ? backendIds : [backendChoice]);
  return {
    backendChoice,
    profile,
    backends,
    options: {
      scope: profile.scope ?? SYNC_SCOPES[scopeIndex],
      include: profile.include ?? includePreset.include,
      from: direction.from,
      to: direction.to,
      cwd: process.cwd(),
    },
    labels: {
      backend: profile.backends ? profile.backends.join(",") : backendChoice,
      profile: profile.label,
      scope: profile.scope ?? SYNC_SCOPES[scopeIndex],
      include: profile.include ?? includePreset.label,
      direction: direction.label,
    },
  };
}

function syncRowsFromState(syncResult, selection, action) {
  if (syncResult?.rows?.length) return syncResult.rows;
  return selection.backends.map((backendId) => {
    const backend = CONFIG_SYNC_BACKENDS[backendId];
    return {
      backend: backend.id,
      label: backend.label,
      action,
      status: backend.supports[action] ? "ready" : "unsupported",
      ok: backend.supports[action],
      summary: backend.supports[action] ? backend.description : `${backend.label} does not support ${action}`,
      command: [],
      output: "",
      next_actions: backend.supports[action] ? [`Press ${action === "status" ? "s" : action === "preview" ? "p" : "a"} to run ${action}.`] : ["Choose a supported action."],
    };
  });
}

function scrollOffset(selected, rowCount, height) {
  if (rowCount <= height) return 0;
  const half = Math.floor(height / 2);
  const maxOffset = Math.max(0, rowCount - height);
  return Math.min(Math.max(0, selected - half), maxOffset);
}

function Rows({ rows, selected, height, renderRow }) {
  const listHeight = Math.max(MIN_LIST_HEIGHT, height);
  const offset = scrollOffset(selected, rows.length, listHeight);
  const needsRange = rows.length > listHeight;
  const rowBudget = needsRange ? Math.max(1, listHeight - 1) : listHeight;
  const visibleRows = rows.slice(offset, offset + rowBudget);
  const rangeLabel = needsRange ? ` ${offset + 1}-${offset + visibleRows.length}/${rows.length}` : "";

  return React.createElement(
    Box,
    { flexDirection: "column" },
    rangeLabel ? React.createElement(Text, { color: "gray" }, rangeLabel) : null,
    visibleRows.map((row, index) => renderRow(row, offset + index === selected)),
  );
}

function ConnectorRows({ rows, selected, height, width }) {
  return React.createElement(Rows, {
    rows,
    selected,
    height,
    renderRow: (row, active) =>
      React.createElement(
        Box,
        { key: `${row.hostId}-${row.scope}-${row.path ?? "mcp"}` },
        React.createElement(Text, { inverse: active }, active ? ">" : " "),
        React.createElement(Text, { bold: true }, ` ${row.hostId.padEnd(20)}`),
        React.createElement(Text, { color: "gray" }, `${row.scope.padEnd(8)}`),
        React.createElement(Text, { color: statusColor(row.mcpStatus) }, `mcp:${row.mcpStatus.padEnd(8)} `),
        React.createElement(
          Text,
          { color: statusColor(row.instructionStatus) },
          `instruction:${row.instructionStatus.padEnd(10)} `,
        ),
        React.createElement(Text, { color: "gray", wrap: "truncate-end" }, truncate(shortPath(row.path), Math.max(10, width - 70))),
      ),
  });
}

function HookRows({ rows, selected, height, width }) {
  return React.createElement(Rows, {
    rows,
    selected,
    height,
    renderRow: (row, active) =>
      React.createElement(
        Box,
        { key: `${row.hostId}-${row.scope}` },
        React.createElement(Text, { inverse: active }, active ? ">" : " "),
        React.createElement(Text, { bold: true }, ` ${row.hostId.padEnd(20)}`),
        React.createElement(Text, { color: "gray" }, `${row.scope.padEnd(8)}`),
        React.createElement(Text, { color: statusColor(row.status) }, `${row.status.padEnd(12)} `),
        React.createElement(
          Text,
          { color: "gray", wrap: "truncate-end" },
          truncate(row.details.join(", ") || shortPath(row.path), Math.max(10, width - 45)),
        ),
      ),
  });
}

function CapabilityRows({ rows, selected, height, width }) {
  return React.createElement(Rows, {
    rows,
    selected,
    height,
    renderRow: (row, active) =>
      React.createElement(
        Box,
        { key: `${row.type}-${row.id}` },
        React.createElement(Text, { inverse: active }, active ? ">" : " "),
        React.createElement(Text, { bold: true }, ` ${row.id.slice(0, 28).padEnd(30)}`),
        React.createElement(Text, { color: "cyan" }, `${row.type.padEnd(8)}`),
        React.createElement(Text, { color: "gray" }, `${row.origin.padEnd(12)}`),
        React.createElement(Text, { wrap: "truncate-end" }, truncate(row.description, Math.max(10, width - 55))),
      ),
  });
}

function EnrichRows({ rows, selected, height, width }) {
  return React.createElement(Rows, {
    rows,
    selected,
    height,
    renderRow: (row, active) =>
      React.createElement(
        Box,
        { key: `${row.type}-${row.id}` },
        React.createElement(Text, { inverse: active }, active ? ">" : " "),
        React.createElement(Text, { bold: true }, ` ${row.id.slice(0, 26).padEnd(28)}`),
        React.createElement(Text, { color: "cyan" }, `${row.type.padEnd(6)}`),
        React.createElement(Text, { color: statusColor(row.status) }, `${row.status.padEnd(10)} `),
        React.createElement(Text, { color: "gray" }, `triggers:${String(row.triggerCount).padEnd(3)} `),
        React.createElement(Text, { wrap: "truncate-end" }, truncate(row.description, Math.max(10, width - 62))),
      ),
  });
}

function SyncRows({ rows, selected, height, width }) {
  return React.createElement(Rows, {
    rows,
    selected,
    height,
    renderRow: (row, active) =>
      React.createElement(
        Box,
        { key: `${row.backend}-${row.action}` },
        React.createElement(Text, { inverse: active }, active ? ">" : " "),
        React.createElement(Text, { bold: true }, ` ${row.backend.slice(0, 22).padEnd(24)}`),
        React.createElement(Text, { color: statusColor(row.status) }, `${row.status.padEnd(11)} `),
        React.createElement(Text, { color: "cyan" }, `${row.action.padEnd(8)} `),
        React.createElement(Text, { wrap: "truncate-end" }, truncate(row.summary, Math.max(10, width - 48))),
      ),
  });
}

function ConfigRows({ rows, selected, height, width, scope }) {
  return React.createElement(Rows, {
    rows,
    selected,
    height,
    renderRow: (row, active) => {
      const override = row[scope] === undefined ? "(inherit)" : formatConfigValue(row[scope]);
      return React.createElement(
        Box,
        { key: row.key },
        React.createElement(Text, { inverse: active }, active ? ">" : " "),
        React.createElement(Text, { bold: true }, " " + row.key.slice(0, 30).padEnd(32)),
        React.createElement(Text, { color: "cyan" }, row.type.padEnd(9)),
        React.createElement(Text, { color: "gray" }, "effective:"),
        React.createElement(Text, null, truncate(formatConfigValue(row.effective), Math.max(8, Math.floor((width - 62) / 2)))),
        React.createElement(Text, { color: "gray" }, "  " + scope + ":"),
        React.createElement(Text, { color: row[scope] === undefined ? "gray" : "green" }, truncate(override, Math.max(8, Math.floor((width - 62) / 2)))),
      );
    },
  });
}

function ConfigControls({ scope, edit, armedAction }) {
  const writeHint = edit
    ? edit.armed
      ? "press enter again to save"
      : "type value; enter to validate; esc cancels"
    : armedAction
      ? "confirm unset: press u again"
      : "g scope  e edit  u unset";
  return React.createElement(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    React.createElement(
      Text,
      null,
      React.createElement(Text, { color: "gray" }, "scope "),
      React.createElement(Text, { color: "cyan", bold: true }, scope),
      React.createElement(Text, { color: "gray" }, "  writes "),
      React.createElement(Text, null, "confirmed " + scope + " overrides only"),
    ),
    edit
      ? React.createElement(
          Text,
          null,
          React.createElement(Text, { color: "gray" }, edit.key + " = "),
          React.createElement(Text, { inverse: true }, edit.value || " "),
          React.createElement(Text, { color: edit.armed ? "yellow" : "gray" }, "  " + writeHint),
        )
      : React.createElement(Text, { color: armedAction ? "yellow" : "gray" }, writeHint),
  );
}
function SyncControls({ action, selection, armedApply }) {
  const applyHint = armedApply ? "confirm apply: press a again" : "a apply";
  return React.createElement(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    React.createElement(
      Text,
      null,
      React.createElement(Text, { color: "gray" }, "mode "),
      React.createElement(Text, { color: "cyan", bold: true }, action),
      React.createElement(Text, { color: "gray" }, "  backend "),
      React.createElement(Text, null, selection.labels.backend),
      React.createElement(Text, { color: "gray" }, "  profile "),
      React.createElement(Text, null, selection.labels.profile),
    ),
    React.createElement(
      Text,
      null,
      React.createElement(Text, { color: "gray" }, "scope "),
      React.createElement(Text, null, selection.labels.scope),
      React.createElement(Text, { color: "gray" }, "  include "),
      React.createElement(Text, null, selection.labels.include),
      React.createElement(Text, { color: "gray" }, "  direction "),
      React.createElement(Text, null, selection.labels.direction),
      React.createElement(Text, { color: "gray" }, `  s status  p preview  ${applyHint}`),
    ),
  );
}

function LinkControls({ tab, scope, action }) {
  const title = TAB_COPY[tab].title;
  return React.createElement(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    React.createElement(
      Text,
      null,
      React.createElement(Text, { color: "gray" }, "scope "),
      React.createElement(Text, { color: "cyan", bold: true }, scope),
      React.createElement(Text, { color: "gray" }, "  action "),
      React.createElement(Text, null, action),
    ),
    React.createElement(Text, { color: "gray" }, `g scope  s status  read-only  (${title})`),
  );
}

function EmptyState({ tab }) {
  const copy = TAB_COPY[tab];
  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Text, { color: "yellow" }, "No rows yet."),
    React.createElement(Text, { color: "gray" }, copy.action),
  );
}

function HelpPanel({ tab, width }) {
  const copy = TAB_COPY[tab];
  const rows = [
    "1-7 jump tabs  tab/right next tab  left previous tab",
    "up/down select rows  r refresh  h or ? toggle help  q quit",
    "sync tab: f profile  b backend  g scope  d direction  i include  s status  p preview  a apply",
    "connectors/hooks tabs: g scope  s status (read-only; writes use sync tab)",
    "enrich tab: e refresh cached tool descriptions",
    "settings tab: g scope, e edit, u unset (confirm writes)",
  ];
  return React.createElement(
    Box,
    { borderStyle: "single", borderColor: "cyan", paddingX: 1, flexDirection: "column", marginBottom: 1 },
    React.createElement(Text, { bold: true }, `Help - ${copy.title}`),
    React.createElement(Text, { color: "gray", wrap: "truncate-end" }, truncate(copy.action, Math.max(10, width - 4))),
    rows.map((row) => React.createElement(Text, { key: row, color: "gray", wrap: "truncate-end" }, truncate(row, Math.max(10, width - 4)))),
  );
}

function Detail({ row, tab, width, height }) {
  if (height <= 0) return null;
  if (!row) return React.createElement(Text, { color: "gray" }, "No row selected.");
  const pairs = Object.entries(row).filter(([, value]) => value !== null && value !== undefined && value !== "");
  return React.createElement(
    Box,
    { borderStyle: "single", borderColor: "gray", paddingX: 1, flexDirection: "column", height, marginTop: 1 },
    React.createElement(Text, { bold: true }, `${TAB_COPY[tab].title} detail`),
    pairs.slice(0, Math.max(1, height - 3)).map(([key, value]) =>
      React.createElement(
        Text,
        { key, wrap: "truncate-end" },
        React.createElement(Text, { color: "gray", wrap: "truncate-end" }, `${key}: `),
        truncate(Array.isArray(value) ? value.join(" ") : typeof value === "object" ? JSON.stringify(value) : String(value), Math.max(10, width - key.length - 5)),
      ),
    ),
  );
}

function App() {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { columns, rows: terminalRows } = useTerminalSize();
  const { loading, error, inventory, refresh } = useInventory();
  const [enriching, setEnriching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [message, setMessage] = useState("");
  const [tabIndex, setTabIndex] = useState(0);
  const [selected, setSelected] = useState(0);
  const [syncResult, setSyncResult] = useState(null);
  const [syncAction, setSyncAction] = useState("status");
  const [backendIndex, setBackendIndex] = useState(0);
  const [scopeIndex, setScopeIndex] = useState(0);
  const [directionIndex, setDirectionIndex] = useState(0);
  const [includeIndex, setIncludeIndex] = useState(0);
  const [profileIndex, setProfileIndex] = useState(0);
  const [armedApply, setArmedApply] = useState(false);
  const [linkScopeIndex, setLinkScopeIndex] = useState(0);
  const [linkAction, setLinkAction] = useState("status");
  const [linkResult, setLinkResult] = useState(null);
  const [armedLinkAction, setArmedLinkAction] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [settingsRows, setSettingsRows] = useState(() => collectConfigRows());
  const [configScopeIndex, setConfigScopeIndex] = useState(0);
  const [configEdit, setConfigEdit] = useState(null);
  const [armedConfigAction, setArmedConfigAction] = useState(null);
  const tab = TABS[tabIndex];
  const linkScope = LINK_SCOPES[linkScopeIndex];
  const configScope = CONFIG_SCOPES[configScopeIndex];
  const syncSelectionState = useMemo(
    () => syncSelection({ backendIndex, scopeIndex, directionIndex, includeIndex, profileIndex }),
    [backendIndex, scopeIndex, directionIndex, includeIndex, profileIndex],
  );
  const rows = useMemo(() => {
    if (!inventory) return [];
    if (tab === "sync") return syncRowsFromState(syncResult, syncSelectionState, syncAction);
    if (tab === "connectors") return linkResult?.tab === "connectors" ? linkResult.rows : inventory.connectors;
    if (tab === "hooks") return linkResult?.tab === "hooks" ? linkResult.rows : inventory.hooks;
    if (tab === "enrich") return inventory.enrichments;
    if (tab === "capabilities") return inventory.capabilities;
    if (tab === "settings") return settingsRows;
    return [];
  }, [inventory, tab, syncResult, syncSelectionState, syncAction, linkResult, settingsRows]);

  useEffect(() => {
    setSelected((index) => Math.min(index, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  const layout = layoutForRows(terminalRows, tab !== "overview", showHelp);

  useInput(
    (input, key) => {
      if (tab === "settings" && configEdit) {
        if (key.escape) {
          setConfigEdit(null);
          setMessage("config edit cancelled");
          return;
        }
        if (key.return) {
          try {
            validateConfigDraft(configEdit.key, configEdit.value);
            if (!configEdit.armed) {
              setConfigEdit((current) => ({ ...current, armed: true }));
              setMessage("config value valid; press enter again to save");
              return;
            }
            runConfigWrite({
              action: "set",
              key: configEdit.key,
              value: configEdit.value,
              scope: configScope,
            });
            setSettingsRows(collectConfigRows());
            setMessage("saved " + configEdit.key + " (" + configScope + ")");
            setConfigEdit(null);
            setArmedConfigAction(null);
          } catch (error) {
            setConfigEdit((current) => ({ ...current, armed: false }));
            setMessage("config error: " + error.message);
          }
          return;
        }
        if (key.backspace || key.delete) {
          setConfigEdit((current) => ({ ...current, value: current.value.slice(0, -1), armed: false }));
          setMessage("");
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          setConfigEdit((current) => ({ ...current, value: current.value + input, armed: false }));
          setMessage("");
        }
        return;
      }
      if (input === "q" || key.escape) exit();
      const numericTab = Number(input);
      if (Number.isInteger(numericTab) && numericTab >= 1 && numericTab <= TABS.length) {
        setTabIndex(numericTab - 1);
        setSelected(0);
        setArmedApply(false);
        setArmedLinkAction(null);
        setConfigEdit(null);
        setArmedConfigAction(null);
        return;
      }
      if (input === "h" || input === "?") {
        setShowHelp((visible) => !visible);
        return;
      }
      if (input === "r") {
        setMessage("");
        setLinkResult(null);
        setArmedLinkAction(null);
        setConfigEdit(null);
        setArmedConfigAction(null);
        refresh();
        try {
          setSettingsRows(collectConfigRows());
        } catch (configError) {
          setMessage("config error: " + configError.message);
        }
      }
      if (tab === "sync" && !syncing) {
        const runSync = (action) => {
          if (action === "apply") {
            if (syncSelectionState.backends.length !== 1) {
              setMessage("apply needs one selected backend or one-backend safe profile");
              return;
            }
            if (!syncSelectionState.options.include) {
              setMessage("apply needs an include selector or safe profile");
              return;
            }
            if (!armedApply) {
              setArmedApply(true);
              setMessage("apply is armed; press a again to run");
              return;
            }
          }
          setSyncing(true);
          setArmedApply(false);
          setSyncAction(action);
          setMessage("");
          Promise.resolve()
            .then(async () => {
              if (action !== "apply") {
                return collectSyncConfig({
                  action,
                  backends: syncSelectionState.backends,
                  options: syncSelectionState.options,
                });
              }
              const reconcile = await runReconcile({
                command: "apply",
                scope: syncSelectionState.options.scope,
                root: process.cwd(),
                allowApply: true,
              });
              return {
                rows: [
                  {
                    backend: "rulesync",
                    action: "apply",
                    status: reconcile.status,
                    ok: reconcile.status === "success",
                    summary: `guarded reconcile ${reconcile.status}`,
                    output: JSON.stringify(reconcile),
                  },
                ],
                summary: `guarded reconcile ${reconcile.status}`,
              };
            })
            .then((result) => {
              setSyncResult(result);
              setMessage(result.summary);
            })
            .catch((err) => setMessage(err.message))
            .finally(() => setSyncing(false));
        };
        if (input === "s") runSync("status");
        if (input === "p") runSync("preview");
        if (input === "a") runSync("apply");
        if (input === "b") {
          setBackendIndex((index) => (index + 1) % (Object.keys(CONFIG_SYNC_BACKENDS).length + 1));
          setSyncResult(null);
          setArmedApply(false);
        }
        if (input === "g") {
          setScopeIndex((index) => (index + 1) % SYNC_SCOPES.length);
          setSyncResult(null);
          setArmedApply(false);
        }
        if (input === "d") {
          setDirectionIndex((index) => (index + 1) % SYNC_DIRECTIONS.length);
          setSyncResult(null);
          setArmedApply(false);
        }
        if (input === "i") {
          setIncludeIndex((index) => (index + 1) % SYNC_INCLUDE_PRESETS.length);
          setSyncResult(null);
          setArmedApply(false);
        }
        if (input === "f") {
          setProfileIndex((index) => (index + 1) % SYNC_PROFILES.length);
          setSyncResult(null);
          setArmedApply(false);
        }
      }
      if (input === "e" && tab === "enrich" && !enriching) {
        setEnriching(true);
        setMessage("");
        runEnrichment({ cachePath: DEFAULT_CACHE_PATH })
          .then((entries) => {
            setMessage(`enriched ${Object.keys(entries).length} cached tools`);
            return refresh();
          })
          .catch((err) => setMessage(err.message))
          .finally(() => setEnriching(false));
      }
      if (tab === "settings") {
        const row = settingsRows[selected];
        if (input === "g") {
          setConfigScopeIndex((index) => (index + 1) % CONFIG_SCOPES.length);
          setConfigEdit(null);
          setArmedConfigAction(null);
          setMessage("");
          return;
        }
        if (input === "e" && row) {
          setConfigEdit({ key: row.key, value: draftForRow(row, configScope), armed: false });
          setArmedConfigAction(null);
          setMessage("editing " + row.key + "; enter validates, enter again saves");
          return;
        }
        if (input === "u" && row) {
          const actionKey = "unset:" + configScope + ":" + row.key;
          if (armedConfigAction !== actionKey) {
            setArmedConfigAction(actionKey);
            setMessage("unset is armed; press u again to remove the " + configScope + " override");
            return;
          }
          try {
            const result = runConfigWrite({ action: "unset", key: row.key, scope: configScope });
            setSettingsRows(collectConfigRows());
            setMessage(result.removed ? "unset " + row.key + " (" + configScope + ")" : row.key + " has no " + configScope + " override");
          } catch (error) {
            setMessage("config error: " + error.message);
          }
          setArmedConfigAction(null);
          return;
        }
      }
      if ((tab === "connectors" || tab === "hooks") && !linking) {
        const requestedAction = linkCommandForInput(tab, input);
        if (input === "g") {
          setLinkScopeIndex((index) => (index + 1) % LINK_SCOPES.length);
          setLinkResult(null);
          setArmedLinkAction(null);
        }
        if (requestedAction) {
          if (linkActionNeedsConfirmation(requestedAction) && armedLinkAction !== requestedAction) {
            setLinkAction(requestedAction);
            setArmedLinkAction(requestedAction);
            setMessage(`${requestedAction} is armed; press ${input} again to run`);
            return;
          }
          setLinking(true);
          setArmedLinkAction(null);
          setLinkAction(requestedAction);
          setMessage("");
          runLinkAction({ tab, command: requestedAction, scope: linkScope })
            .then((result) => {
              setLinkResult({ ...result, tab });
              setMessage(result.summary);
              return refresh();
            })
            .catch((err) => setMessage(err.message))
            .finally(() => setLinking(false));
        }
      }
      if (key.tab || key.rightArrow) {
        setTabIndex((index) => (index + 1) % TABS.length);
        setSelected(0);
        setArmedApply(false);
        setArmedLinkAction(null);
        setConfigEdit(null);
        setArmedConfigAction(null);
      }
      if (key.leftArrow) {
        setTabIndex((index) => (index - 1 + TABS.length) % TABS.length);
        setSelected(0);
        setArmedApply(false);
        setArmedLinkAction(null);
        setConfigEdit(null);
        setArmedConfigAction(null);
      }
      if (key.upArrow) setSelected((index) => Math.max(0, index - 1));
      if (key.downArrow) setSelected((index) => Math.min(Math.max(rows.length - 1, 0), index + 1));
    },
    { isActive: isRawModeSupported },
  );

  if (error) return React.createElement(Text, { color: "red" }, error.message);
  if (!inventory) return React.createElement(Text, { color: "yellow" }, "Loading portawhip surface...");

  return React.createElement(
    Box,
    { flexDirection: "column", paddingX: 1, width: columns, height: terminalRows },
    React.createElement(Header, { tab, loading, enriching, syncing, linking }),
    showHelp ? React.createElement(HelpPanel, { tab, width: columns }) : null,
    tab === "overview" ? React.createElement(Overview, { inventory }) : null,
    tab === "sync" ? React.createElement(SyncControls, { action: syncAction, selection: syncSelectionState, armedApply }) : null,
    tab === "connectors" || tab === "hooks"
      ? React.createElement(LinkControls, { tab, scope: linkScope, action: linkAction, armedAction: armedLinkAction })
      : null,
    tab === "settings"
      ? React.createElement(ConfigControls, { scope: configScope, edit: configEdit, armedAction: armedConfigAction })
      : null,
    tab !== "overview" && rows.length === 0 ? React.createElement(EmptyState, { tab }) : null,
    tab === "sync" && rows.length > 0
      ? React.createElement(SyncRows, { rows, selected, height: Math.max(MIN_LIST_HEIGHT, layout.listHeight - 2), width: columns })
      : null,
    tab === "connectors" && rows.length > 0
      ? React.createElement(ConnectorRows, { rows, selected, height: layout.listHeight, width: columns })
      : null,
    tab === "hooks" && rows.length > 0 ? React.createElement(HookRows, { rows, selected, height: layout.listHeight, width: columns }) : null,
    tab === "enrich" && rows.length > 0 ? React.createElement(EnrichRows, { rows, selected, height: layout.listHeight, width: columns }) : null,
    tab === "capabilities" && rows.length > 0
      ? React.createElement(CapabilityRows, { rows, selected, height: layout.listHeight, width: columns })
      : null,
    tab === "settings" && rows.length > 0
      ? React.createElement(ConfigRows, { rows, selected, height: Math.max(MIN_LIST_HEIGHT, layout.listHeight - 2), width: columns, scope: configScope })
      : null,
    tab === "overview" || rows.length === 0 ? null : React.createElement(Detail, { row: rows[selected], tab, width: columns, height: layout.detailHeight }),
    message ? React.createElement(Text, { color: messageColor(message) }, message) : null,
    React.createElement(
      Box,
      { marginTop: 1 },
      React.createElement(Text, { color: "gray", wrap: "truncate-end" }, `${TAB_COPY[tab].action}  h help  r refresh  q quit`),
    ),
  );
}

const cliArgs = new Set(process.argv.slice(2));

if (cliArgs.has("--help") || cliArgs.has("-h")) {
  printHelp();
} else if (!process.stdin.isTTY || !process.stdout.isTTY || cliArgs.has("--summary")) {
  const inventory = await collectSurfaceInventory();
  const settings = collectConfigRows();
  const attention = [
    ...(inventory.summary.connectors.missing ? [`connectors missing=${inventory.summary.connectors.missing}`] : []),
    ...(inventory.summary.connectors["mcp-only"] ? [`connectors mcp-only=${inventory.summary.connectors["mcp-only"]}`] : []),
    ...(inventory.summary.hooks.missing ? [`hooks missing=${inventory.summary.hooks.missing}`] : []),
    ...(inventory.summary.enrichments["bare-name"] ? [`enrich bare-name=${inventory.summary.enrichments["bare-name"]}`] : []),
    ...(inventory.summary.surfaceAttention?.length ? [`surface gaps=${inventory.summary.surfaceAttention.join(",")}`] : []),
  ];
  console.log(
    [
      `portawhip surface ${inventory.generatedAt}`,
      `sync backends ${Object.keys(CONFIG_SYNC_BACKENDS).length}: ${Object.keys(CONFIG_SYNC_BACKENDS).join(",")}`,
      `connectors ${inventory.connectors.length}: ${JSON.stringify(inventory.summary.connectors)}`,
      `hooks ${inventory.hooks.length}: ${JSON.stringify(inventory.summary.hooks)}`,
      `enrich ${inventory.enrichments.length}: ${JSON.stringify(inventory.summary.enrichments)}`,
      `capabilities ${inventory.capabilities.length}: ${JSON.stringify(inventory.summary.capabilities)}`,
      `settings ${settings.length}: user=${settings.filter((row) => row.user !== undefined).length} project=${settings.filter((row) => row.project !== undefined).length}`,
      `attention ${attention.length ? attention.join("; ") : "none"}`,
      "run with --help for keys and safety notes",
    ].join("\n"),
  );
} else {
  enterFullscreen();
  const instance = render(React.createElement(App));
  instance.waitUntilExit().finally(exitFullscreen);
}
