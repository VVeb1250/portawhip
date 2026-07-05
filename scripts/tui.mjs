#!/usr/bin/env node

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput, useStdin, useStdout } from "ink";
import ansiEscapes from "ansi-escapes";
import { DEFAULT_CACHE_PATH, runEnrichment } from "../core/enrich.mjs";
import { collectSurfaceInventory } from "../core/surface-inventory.mjs";

const TABS = ["overview", "connectors", "hooks", "enrich", "capabilities"];
const MIN_LIST_HEIGHT = 3;
const MAX_DETAIL_HEIGHT = 7;
const STATUS_COLORS = {
  linked: "green",
  available: "green",
  changed: "green",
  "no-op": "green",
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

function layoutForRows(terminalRows, hasDetail) {
  const headerRows = 3;
  const footerRows = 1;
  const margins = hasDetail ? 2 : 1;
  const available = Math.max(MIN_LIST_HEIGHT, terminalRows - headerRows - footerRows - margins);
  const detailHeight = hasDetail && available >= MIN_LIST_HEIGHT + 4 ? Math.min(MAX_DETAIL_HEIGHT, 4) : 0;
  const listHeight = Math.max(MIN_LIST_HEIGHT, available - detailHeight);
  return { detailHeight, listHeight };
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

function Header({ tab, loading, enriching }) {
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
    ),
    React.createElement(
      Box,
      null,
      TABS.map((item) =>
        React.createElement(
          Text,
          { key: item, inverse: item === tab, color: item === tab ? "black" : "white" },
          ` ${item} `,
        ),
      ),
    ),
  );
}

function Overview({ inventory }) {
  const rows = [
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
    React.createElement(Box, { height: 1 }),
    rows.map(([label, count, summary]) =>
      React.createElement(
        Box,
        { key: label },
        React.createElement(Text, { bold: true }, `${label.padEnd(14)} `),
        React.createElement(Text, null, `${String(count).padStart(4)}  `),
        React.createElement(
          Text,
          { color: "gray" },
          Object.entries(summary)
            .map(([key, value]) => `${key}:${value}`)
            .join("  "),
        ),
      ),
    ),
  );
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

function Detail({ row, width, height }) {
  if (height <= 0) return null;
  if (!row) return React.createElement(Text, { color: "gray" }, "No row selected.");
  const pairs = Object.entries(row).filter(([, value]) => value !== null && value !== undefined && value !== "");
  return React.createElement(
    Box,
    { borderStyle: "single", borderColor: "gray", paddingX: 1, flexDirection: "column", height, marginTop: 1 },
    pairs.slice(0, Math.max(1, height - 2)).map(([key, value]) =>
      React.createElement(
        Text,
        { key, wrap: "truncate-end" },
        React.createElement(Text, { color: "gray", wrap: "truncate-end" }, `${key}: `),
        truncate(Array.isArray(value) ? value.join(", ") : String(value), Math.max(10, width - key.length - 5)),
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
  const [message, setMessage] = useState("");
  const [tabIndex, setTabIndex] = useState(0);
  const [selected, setSelected] = useState(0);
  const tab = TABS[tabIndex];
  const rows = useMemo(() => {
    if (!inventory) return [];
    if (tab === "connectors") return inventory.connectors;
    if (tab === "hooks") return inventory.hooks;
    if (tab === "enrich") return inventory.enrichments;
    if (tab === "capabilities") return inventory.capabilities;
    return [];
  }, [inventory, tab]);

  useEffect(() => {
    setSelected((index) => Math.min(index, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  const layout = layoutForRows(terminalRows, tab !== "overview");

  useInput(
    (input, key) => {
      if (input === "q" || key.escape) exit();
      if (input === "r") {
        setMessage("");
        refresh();
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
      if (key.tab || key.rightArrow) {
        setTabIndex((index) => (index + 1) % TABS.length);
        setSelected(0);
      }
      if (key.leftArrow) {
        setTabIndex((index) => (index - 1 + TABS.length) % TABS.length);
        setSelected(0);
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
    React.createElement(Header, { tab, loading, enriching }),
    tab === "overview" ? React.createElement(Overview, { inventory }) : null,
    tab === "connectors"
      ? React.createElement(ConnectorRows, { rows, selected, height: layout.listHeight, width: columns })
      : null,
    tab === "hooks" ? React.createElement(HookRows, { rows, selected, height: layout.listHeight, width: columns }) : null,
    tab === "enrich" ? React.createElement(EnrichRows, { rows, selected, height: layout.listHeight, width: columns }) : null,
    tab === "capabilities"
      ? React.createElement(CapabilityRows, { rows, selected, height: layout.listHeight, width: columns })
      : null,
    tab === "overview" ? null : React.createElement(Detail, { row: rows[selected], width: columns, height: layout.detailHeight }),
    message ? React.createElement(Text, { color: message.startsWith("enriched") ? "green" : "red" }, message) : null,
    React.createElement(
      Box,
      { marginTop: 1 },
      React.createElement(Text, { color: "gray" }, "tab/arrows switch  up/down select  r refresh  e enrich  q quit"),
    ),
  );
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  const inventory = await collectSurfaceInventory();
  console.log(
    [
      `portawhip surface ${inventory.generatedAt}`,
      `connectors ${inventory.connectors.length}: ${JSON.stringify(inventory.summary.connectors)}`,
      `hooks ${inventory.hooks.length}: ${JSON.stringify(inventory.summary.hooks)}`,
      `enrich ${inventory.enrichments.length}: ${JSON.stringify(inventory.summary.enrichments)}`,
      `capabilities ${inventory.capabilities.length}: ${JSON.stringify(inventory.summary.capabilities)}`,
    ].join("\n"),
  );
} else {
  enterFullscreen();
  const instance = render(React.createElement(App));
  instance.waitUntilExit().finally(exitFullscreen);
}
