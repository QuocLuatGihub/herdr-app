"""Generate personal UI mods from this checkout's upstream mods; never edit shipped mods."""
from pathlib import Path
import json
import re
import shutil

ROOT = Path(__file__).resolve().parents[2]


def generate(source):
    text = (ROOT / 'defaults/mods' / source / 'main.js').read_text()
    imports = ['panes'] if source in ('pane', 'tabs') else ['agents', 'panes'] if source == 'agents' else ['agents']
    # Replace only imported readers, leaving all upstream behavior intact.
    def rewrite(match):
        names = [n.strip() for n in match.group(1).split(',')]
        if not set(imports).issubset(names):
            raise ValueError(f'Upstream {source} readers changed; review the adapter')
        names = [n for n in names if n not in imports]
        return 'import { ' + ', '.join(names) + ' } from "herdr";\nimport { ' + ', '.join(imports) + ' } from "./identity.js";'
    text, count = re.subn(r'import \{ ([^}]+) \} from "herdr";', rewrite, text, count=1)
    if count != 1:
        raise ValueError(f'Upstream {source} imports changed; review the adapter')
    if source == 'agents':
        for anchor in ('const SECTION = { 4:', 'const r = rankOf(a) || RANK.idle;', '  status(t, a, compact = false) {'):
            if text.count(anchor) != 1:
                raise ValueError(f'Upstream agent rendering changed: {anchor}')
        text = text.replace('const SECTION = { 4:', 'const SECTION = { 0: "Chưa có tín hiệu", 4:')
        text = text.replace('const r = rankOf(a) || RANK.idle;', 'const r = rankOf(a) ?? RANK.idle;')
        text = text.replace('  status(t, a, compact = false) {', '  status(t, a, compact = false) {\n    if (a.status === "unknown") return div().text_size(10).text_color(t.dim).child("?");')
        text = text.replace('mod: "agents"', 'mod: "custom-agents"')
    if source == 'pane':
        for anchor in ('props, run, theme, home', '  render(cx) {', '.when(st === "working",'):
            if text.count(anchor) != 1:
                raise ValueError(f'Upstream pane rendering changed: {anchor}')
        text = text.replace('props, run, theme, home', 'props, run, theme, home, hc, terminals')
        text = text.replace('  render(cx) {', '''  mark(p, cx) {
    cx.spawn(async cx => {
      const marked = terminals().find(t => t.address === p.terminal)?.labels?.["custom.agent"] === "codex";
      const result = await hc(["label", p.terminal, "custom.agent=" + (marked ? "" : "codex")]);
      this.markError = result.code ? result.stderr : null;
      cx.notify();
    });
  }
  render(cx) {''')
        needle = '.when(st === "working",'
        text = text.replace(needle, '''.when(p.manualAgent && !p.status, el => el.child(div().text_size(10).text_color(t.dim).child("Chưa có tín hiệu")))
      .when(terminals().some(t => t.address === p.terminal && t.labels?.["custom.agent"] === "codex" && t.labels?.["custom.scroll.exit"] === "1"),
        el => el.child(div().id("screen-live-" + pane).px(7).py(2).rounded(4).text_size(10)
          .text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.hover))
          .tooltip("Về màn hình trực tiếp; không gửi Escape vào Codex")
          .on_click((_e, cx) => { cx.stop_propagation(); run("terminal.scroll", { terminal: p.terminal, to: "bottom" }); })
          .child("Về trực tiếp")))
      .when(!p.app || p.manualAgent, el => el.child(div().id("mark-codex-" + pane).px(5).py(2).rounded(4)
        .text_size(10).text_color(t.dim).cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
        .tooltip(this.markError || (p.manualAgent ? "Bỏ gán Codex cho terminal này" : "Gán terminal này là Codex (Screen/tmux)"))
        .on_click((_e, cx) => { cx.stop_propagation(); this.mark(p, cx); }).child(p.manualAgent ? "Bỏ gán" : "Gán Codex")))
      ''' + needle)
    if source == 'workspace-status':
        text = 'import { observe } from "./observer.js";\n' + text
        text = text.replace('export default class WorkspaceStatus extends View {',
            'export default class WorkspaceStatus extends View {\n  init(_props, cx) { observe(cx); }')
    return text


def install(app_home):
    app_home = Path(app_home)
    for source in ('agents', 'pane', 'tabs', 'workspace-status'):
        destination = app_home / 'mods' / ('custom-' + source)
        destination.mkdir(parents=True, exist_ok=True)
        (destination / 'main.js').write_text(generate(source))
        shutil.copy2(ROOT / 'defaults/mods' / source / 'mod.json', destination / 'mod.json')
        shutil.copy2(ROOT / 'custom/agents/identity.js', destination / 'identity.js')
    for name in ('observer.js', 'status.py', 'screen_scroll.py'):
        shutil.copy2(ROOT / 'custom/agents' / name, app_home / 'mods/custom-workspace-status' / name)
    shutil.copytree(ROOT / 'custom/agents/manager', app_home / 'mods/agent-manager', dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('gpui-kit.d.ts', 'jsconfig.json', '.gitignore'))
    path = app_home / 'layouts/voice-custom.json'
    layout = json.loads(path.read_text())
    mapping = {s: 'custom-' + s for s in ('agents', 'pane', 'tabs', 'workspace-status')}
    def visit(value):
        if isinstance(value, dict):
            if value.get('mod') in mapping:
                value['mod'] = mapping[value['mod']]
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(layout)
    def add_button(value):
        if isinstance(value, dict):
            if value.get('id') == 'status-row' and not any(c.get('id') == 'agent-manager-button' for c in value['children']):
                value['children'].insert(-1, dict(id='agent-manager-button', type='block', size={'px': 120},
                    content={'mod': 'agent-manager', 'props': {'button': True}}))
            for child in value.values():
                add_button(child)
        elif isinstance(value, list):
            for child in value:
                add_button(child)
    add_button(layout)
    path.write_text(json.dumps(layout, indent=2) + '\n')


if __name__ == '__main__':
    install(Path.home() / '.config/herdr-app-custom')
