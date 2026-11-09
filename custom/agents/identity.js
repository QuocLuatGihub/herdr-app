import { terminals as nativeTerminals, panes as nativePanes, agents as nativeAgents, spaces as nativeSpaces, shared } from "herdr";
export const LABEL = "custom.agent";
const CODEX = { key: "codex", name: "Codex", icon: "icons/codex.svg", tint: false, tile: "#1c1d21", color: "#ffffff", shell: false, agent: true };

export function freshStatus(snapshot, address, now) {
  if (!snapshot) return null;
  const row = snapshot.rows?.[address];
  const at = row?.at ?? snapshot.at;
  if (typeof at !== "number" || now - at > 15000 || now < at) return null;
  return row?.source === "codex-app-server" && row.threadId && ["idle", "working", "blocked"].includes(row.status) ? row.status : null;
}
export function decoratePanes(all, raw, snapshot = null, now = Date.now()) {
  const marked = new Set(raw.filter(t => t.state === "live" && t.labels?.[LABEL] === "codex").map(t => t.address));
  return all.map(p => marked.has(p.terminal) && !p.app
    ? { ...p, app: "codex", program: CODEX, manualAgent: true, status: p.status || freshStatus(snapshot, p.terminal, now) }
    : p);
}
export function mergeAgents(list, allPanes, raw, spaces, snapshot = null, now = Date.now()) {
  const result = [...list], seen = new Set(list.map(a => a.address));
  for (const p of decoratePanes(allPanes, raw, snapshot, now)) {
    if (!p.manualAgent || seen.has(p.terminal)) continue;
    const terminal = raw.find(t => t.address === p.terminal);
    const space = spaces.find(s => s.tabs?.some(tab => tab.id === p.tab));
    const tab = space?.tabs?.find(tab => tab.id === p.tab);
    result.push({ address: p.terminal, pane: p.pane, space: space?.id ?? "", space_name: space?.name ?? "Codex",
      tab: p.tab, tab_index: tab?.index ?? 1, tab_name: tab?.name ?? "Codex", status: p.status || "unknown",
      app: "codex", program: CODEX, title: p.title, seq: 0, pinned: !!terminal?.labels?.["herdr.pinned"], focused: p.focused,
      manualAgent: true });
    seen.add(p.terminal);
  }
  return result;
}
export function panes() { return decoratePanes(nativePanes(), nativeTerminals(), shared("custom.agent-status")); }
export function agents() { return mergeAgents(nativeAgents(), nativePanes(), nativeTerminals(), nativeSpaces(), shared("custom.agent-status")); }
