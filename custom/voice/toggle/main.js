import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, theme } from "herdr";

export default class VoiceToggle extends View {
  render() {
    const t = theme();
    return h_flex().size_full().items_center().justify_center().bg(t.chrome)
      .border_t(1).border_color(t.border)
      .child(div().id("voice-toggle").px(10).py(4).rounded(5).text_size(11.8)
        .text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.raised))
        .on_click(() => run("layout.toggle", { id: "voice-panel" }))
        .child("Voice ↔"));
  }
}
