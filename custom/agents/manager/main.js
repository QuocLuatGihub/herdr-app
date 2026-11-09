import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { terminals, panes, spaces, props, hc, run, closeOverlay, theme } from "herdr";

export default class AgentManager extends View {
  init() { this.busy = null; this.error = null; this.note = null; }
  assign(address, value, cx) {
    if (this.busy) return;
    if (!terminals().some(t => t.address === address && t.state === "live")) {
      this.error = "Terminal đã đóng hoặc mất kết nối."; cx.notify(); return;
    }
    this.busy = address; this.error = null; this.note = null; cx.notify();
    cx.spawn(async cx => {
      try {
        const r = await hc(["label", address, "custom.agent=" + value]);
        if (r.code) throw new Error(r.stderr || r.stdout || "Không cập nhật được.");
        this.note = (value ? "Đã gán Codex: " : "Đã trả về tự nhận: ") + address;
      } catch (e) { this.error = String(e.message ?? e); }
      finally { this.busy = null; cx.notify(); }
    });
  }
  render() {
    const t = theme();
    if (props()?.button) return h_flex().size_full().items_center().justify_center().bg(t.chrome).border_t(1).border_color(t.border)
      .child(div().id("open-agent-manager").px(10).py(4).rounded(5).text_size(11.8).text_color(t.foreground)
        .cursor_pointer().hover(s => s.bg(t.raised)).on_click(() => run("mod.open", { name: "agent-manager" })).child("Gán agent…"));
    const all = terminals().filter(t => t.state === "live"), allPanes = panes(), allSpaces = spaces();
    const button = (id, text, enabled, action, active = false) => div().id(id).px(10).py(7).rounded(6)
      .bg(active ? t.solid : t.raised).text_color(active ? t.solid_foreground : t.foreground).text_size(12)
      .opacity(enabled ? 1 : 0.45).when(enabled, el => el.cursor_pointer().on_click((_e, cx) => action(cx))).child(text);
    return v_flex().w_full().p(20).gap(12).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(17).font_semibold().child("Gán agent cho terminal"))
        .child(button("agent-manager-close", "Đóng", true, () => closeOverlay(props().overlay))))
      .child(div().text_size(12).text_color(t.muted).child("Chọn Codex cho phiên trong Screen/tmux. Tự nhận sẽ bỏ gán thủ công."))
      .child(v_flex().h(Math.min(360, Math.max(100, all.length * 100))).min_h(80).overflow_y_scrollbar().gap(8).children(all.map(item => {
        const pane = allPanes.find(p => p.terminal === item.address);
        const space = allSpaces.find(s => s.tabs?.some(tab => tab.id === pane?.tab));
        const tab = space?.tabs?.find(tab => tab.id === pane?.tab);
        const name = item.labels?.where || (space ? space.name + " / " + (tab?.name || "") : item.title || item.name || "Terminal");
        const marked = item.labels?.["custom.agent"] === "codex";
        return h_flex().id("agent-manager-" + item.address).p(12).gap(12).items_center().rounded(8).bg(t.background)
          .child(v_flex().flex_1().min_w(0).gap(4)
            .child(div().text_size(13).font_medium().truncate().child(name))
            .child(div().text_size(11).text_color(t.dim).truncate().child(item.address + " · " + (item.cwd || "")))
            .child(div().text_size(11).text_color(t.muted).child(marked ? "Đã gán Codex" : "Tự nhận: " + (item.program?.name || item.agent || "terminal"))))
          .child(button("assign-codex-" + item.address, marked ? "Codex ✓" : "Gán Codex", !this.busy && !marked, cx => this.assign(item.address, "codex", cx), marked))
          .child(button("unassign-" + item.address, "Tự nhận", !this.busy && marked, cx => this.assign(item.address, "", cx)));
      })))
      .when(!all.length, el => el.child(div().text_size(12).text_color(t.dim).child("Chưa có terminal đang mở.")))
      .when(!!this.error, el => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
      .when(!!this.note, el => el.child(div().text_size(12).text_color(t.foreground).child(this.note)))
      .child(div().text_size(11).text_color(t.dim).child("Chỉ đổi nhận diện từng terminal; không thay đổi chương trình đang chạy. Trạng thái cần tín hiệu thật từ agent."));
  }
}
