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
it. For marked Linux SSH terminals in GNU Screen, an observer queries the
Codex daemon with read-only requests over its local Unix WebSocket every five seconds. It associates
Screen session process metadata with a unique loaded root thread in that
project, then displays the daemon’s idle/active/waiting state. Only thread metadata and runtime state are used; conversation content is not
exported. No turn is started, and approvals are never answered.
Native OSC reports take precedence automatically.

Missing daemons, embedded `--no-daemon` sessions, unloaded threads and ambiguous
projects remain **Chưa có tín hiệu**. Status expires after 15 seconds if no
fresh result is received. There is no fallback that guesses state from screen text.
Daemon-derived status is a Custom UI feature; it does not modify native core
status or add automatic permission handling. For verified GNU Screen attachments on Linux SSH machines, wheel input uses
private Screen bindings to scroll its own history, including Codex inline mode.
Scroll up enters Screen copy mode. Scrolling back to the bottom automatically
returns to live Codex output; **Về trực tiếp** in the pane header does so
immediately. This uses a private Screen key ignored outside copy mode, not
a bare Escape that could interrupt Codex. Avoid using Escape as a universal
return-to-live shortcut. The
child program receives no wheel keystrokes. Bindings use private sequences,
not the user's PageUp/PageDown keys, and live only in that Screen server.
Setup is tied to the attachment PID; a new attachment is configured before
private wheel input is enabled. Local terminals are unchanged. Reopen Herdr
Custom after installing the native input fix; remote work stays in core.
The mark stays with the terminal; remove it if that terminal no longer runs Codex.

`install.py` generates personal adapters from this checkout's upstream UI mods.
It replaces only their live-data readers and adds the marker control and unknown
state display. Shipped UI mods remain unchanged. The Custom installer reapplies
these adapters after voice setup. If upstream imports change, generation fails
for review instead of silently producing a broken import.

Verification: `bun test scripts/agent-identity.test.ts` and `herdr-custom check`
on the generated `custom-agents`, `custom-pane`, `custom-tabs`, and
`custom-workspace-status` directories.

The safe return-to-live path is regression-tested with a synthetic, headless
Screen job: `HC_SESSION=<session> python3 scripts/screen-live-smoke.py
--machine <connected-linux-machine>`. It verifies history freezes, new output
resumes, repeated return-to-live is harmless, and the child receives no keys.
