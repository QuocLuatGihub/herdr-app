# Manual agent identity for Screen/tmux

Herdr's native Agents list requires an OSC 7501 report. Screen/tmux can hide
that report even while Codex is running. These personal mods add a per-terminal
`custom.agent=codex` label without changing herdr-core, its status API, or the
upstream model. There is no global `screen => Codex` mapping.

Open **Gán agent…** in the bottom status bar to see all local/remote terminals,
their space/tab names, and their addresses. **Gán Codex** assigns one terminal;
**Tự nhận** removes its manual label.

You can also click **Gán Codex** in a terminal pane's header. The terminal then shows Codex in
its pane header, tab icon, Agents sidebar and status bar count. **Bỏ gán** removes
it. A marked terminal without a native report says **Chưa có tín hiệu** (unknown),
never idle, working, done or blocked. Native reports take precedence automatically.
Manual identity does not add native core status or automatic permission handling.
The mark stays with the terminal; remove it if that terminal no longer runs Codex.

`install.py` generates personal adapters from this checkout's upstream UI mods.
It replaces only their live-data readers and adds the marker control and unknown
state display. Shipped UI mods remain unchanged. The Custom installer reapplies
these adapters after voice setup. If upstream imports change, generation fails
for review instead of silently producing a broken import.

Verification: `bun test scripts/agent-identity.test.ts` and `herdr-custom check`
on the generated `custom-agents`, `custom-pane`, `custom-tabs`, and
`custom-workspace-status` directories.
