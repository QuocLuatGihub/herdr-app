import { View, div } from "gpui-kit";
import { v_flex, h_flex, EditorState, Editor } from "gpui-base";
import { terminals, theme, home, exec, hc, nextCommand } from "herdr";

export function liveTarget(all, address) {
  return all.find(t => t.address === address && t.state === "live");
}
export function sendArguments(address, text) {
  if (!address || !text.trim()) throw new Error("Chọn terminal và nhập nội dung trước khi gửi.");
  return ["send", "--json", address, text];
}
export function screenText(raw) {
  const result = JSON.parse(raw);
  if (typeof result.text !== "string") throw new Error("Không đọc được màn hình terminal.");
  return result.text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").trim().slice(-6000);
}

export default class Voice extends View {
  init(_props, cx) {
    this.target = null; this.busy = false; this.recording = false; this.speaking = false;
    this.note = "Chọn terminal, rồi bấm Ghi âm. Âm thanh xử lý trên Mac.";
    this.error = null; this.language = "vi"; this.closed = false;
    this.draft = EditorState.new({ language: "text", value: "", soft_wrap: true, line_numbers: false, folding: false, font_size: 13 });
    this.draft.on("change", (_e, cx) => cx.notify());
    this.response = EditorState.new({ language: "text", value: "", soft_wrap: true, line_numbers: false, folding: false, font_size: 12 });
    this.response.on("change", (_e, cx) => cx.notify());
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "record") this.toggleRecord(cx);
      }
    });
    cx.timer.every(1000, cx => {
      if (!this.recordJob || this.polling) return;
      this.polling = true;
      const job = this.recordJob;
      cx.spawn(async cx => {
        try {
          const r = await this.worker("status", job);
          const status = JSON.parse(r.stdout);
          if (this.recordJob === job && status.ready) {
            if (status.text) this.applyLive(status.text);
            this.note = status.phase === "finalizing" ? "Đang chốt nội dung…" : "Đang nghe · chữ cập nhật sau vài giây. Ngừng nói để tự kết thúc, hoặc bấm Gửi.";
            cx.notify();
          }
        } catch {} finally { this.polling = false; }
      });
    });
  }
  worker(action, job, value) {
    return exec("/usr/bin/python3", [home() + "/.local/share/herdr-voice/voice.py", action, job, ...(value === undefined ? [] : [value])], { timeout: 360000 });
  }
  job() { return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2); }
  select(address, cx) {
    if (this.busy || this.speaking) return;
    this.target = address; this.error = null; this.response.set_value(""); cx.notify();
  }
  applyLive(text) {
    // Never replace edits the person has made while a partial result was in flight.
    if (this.draft.value() !== this.liveApplied) return;
    this.liveApplied = this.liveBase + text;
    this.draft.set_value(this.liveApplied);
  }
  toggleRecord(cx) {
    if (this.recording) { this.stopRecord(cx); return; }
    if (this.busy || this.speaking) return;
    if (!liveTarget(terminals(), this.target)) { this.error = "Chọn một terminal còn hoạt động trước."; cx.notify(); return; }
    this.liveBase = this.draft.value().trim();
    this.liveBase = this.liveBase ? this.liveBase + "\n" : "";
    this.liveApplied = this.draft.value(); this.sendAfterRecord = false;
    this.recordJob = this.job(); const job = this.recordJob;
    this.busy = true; this.recording = true; this.error = null;
    this.note = "Đang mở mic… Cho phép Microphone nếu macOS hỏi."; cx.notify();
    cx.spawn(async cx => {
      let success = false;
      try {
        const r = await this.worker("record", job, this.language);
        if (r.code !== 0) throw new Error(r.stderr || "Không ghi âm được.");
        const text = JSON.parse(r.stdout).text;
        if (!this.closed) {
          this.applyLive(text);
          success = true;
          this.note = "Đã nhận chữ. Kiểm tra nội dung và terminal, rồi bấm Gửi.";
        }
      } catch (e) { if (!this.closed) this.error = String(e.message ?? e); }
      finally {
        const shouldSend = this.sendAfterRecord && success;
        this.sendAfterRecord = false;
        this.recording = false; this.busy = false; this.recordJob = null;
        if (!this.closed) {
          cx.notify();
          if (shouldSend) this.send(cx);
        }
      }
    });
  }
  stopRecord(cx) {
    if (!this.recording) return;
    this.recording = false; this.note = "Đang chuyển giọng nói thành chữ…"; cx.notify();
    const job = this.recordJob;
    cx.spawn(async cx => {
      try { const r = await this.worker("stop", job); if (r.code) throw new Error(r.stderr); }
      catch (e) { this.error = String(e.message ?? e); cx.notify(); }
    });
  }
  send(cx) {
    if (this.recordJob && this.busy && this.draft.value().trim()) {
      this.sendAfterRecord = true;
      this.stopRecord(cx);
      return;
    }
    if (this.busy || !this.draft.value().trim()) return;
    const target = this.target, text = this.draft.value();
    if (!liveTarget(terminals(), target)) { this.error = "Terminal đã đóng hoặc mất kết nối. Chọn lại trước khi gửi."; cx.notify(); return; }
    this.busy = true; this.error = null; cx.notify();
    cx.spawn(async cx => {
      try {
        const r = await hc(sendArguments(target, text));
        if (r.code) throw new Error(r.stderr || r.stdout);
        const result = JSON.parse(r.stdout);
        if (result.error || result.sent === false) throw new Error(result.error?.message || result.reason || "Chưa gửi được.");
        if (this.draft.value() === text) this.draft.set_value("");
        this.note = "Đã gửi tới " + target + ". Bấm Lấy phản hồi để xem và đọc màn hình.";
      } catch (e) { this.error = String(e.message ?? e); }
      finally { this.busy = false; if (!this.closed) cx.notify(); }
    });
  }
  read(cx) {
    if (this.busy || this.speaking) return;
    const target = this.target;
    if (!liveTarget(terminals(), target)) return;
    this.busy = true; this.error = null; cx.notify();
    cx.spawn(async cx => {
      try {
        const r = await hc(["read", target, "--json", "--lines", "0"]);
        if (r.code) throw new Error(r.stderr || "Không đọc được terminal.");
        this.response.set_value(screenText(r.stdout));
        this.note = "Nội dung màn hình hiện tại; có thể sửa hoặc chọn đoạn cần đọc bên dưới.";
      } catch (e) { this.error = String(e.message ?? e); }
      finally { this.busy = false; if (!this.closed) cx.notify(); }
    });
  }
  speak(cx) {
    if (this.speaking) {
      const job = this.speechJob;
      cx.spawn(async cx => { await this.worker("stop-speaking", job); cx.notify(); });
      return;
    }
    const text = this.response.value().trim();
    if (this.busy || !text) return;
    this.speaking = true; this.speechJob = this.job(); this.error = null; cx.notify();
    const job = this.speechJob;
    cx.spawn(async cx => {
      try { const r = await this.worker("speak", job, text); if (r.code) throw new Error(r.stderr); }
      catch (e) { this.error = String(e.message ?? e); }
      finally { this.speaking = false; this.speechJob = null; if (!this.closed) cx.notify(); }
    });
  }
  async close() {
    this.closed = true;
    const actions = [];
    if (this.recordJob) actions.push(this.worker("cancel", this.recordJob));
    if (this.speechJob) actions.push(this.worker("stop-speaking", this.speechJob));
    await Promise.all(actions);
  }
  render(cx) {
    const t = theme(), all = terminals().filter(t => t.state === "live");
    const target = liveTarget(all, this.target), locked = this.busy || this.speaking;
    const label = s => div().text_size(11).text_color(t.dim).child(s);
    const button = (id, text, enabled, action, primary = false) => div().id(id).px(10).py(8).rounded(7)
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .text_size(12).opacity(enabled ? 1 : 0.4).when(enabled, el => el.cursor_pointer().on_click((_e, cx) => action(cx))).child(text);
    return v_flex().id("voice-panel").size_full().min_h(0).p(14).gap(10).bg(t.surface).text_color(t.foreground)
      .child(h_flex().items_center().gap(8).child(div().flex_1().font_semibold().child("Voice · trên Mac"))
        .child(label("⌘⇧V bật mic")))
      .child(label("GỬI TỚI TERMINAL"))
      .child(v_flex().max_h(110).overflow_y_scrollbar().gap(4).children(all.map(item =>
        div().id("voice-target-" + item.address).px(8).py(6).rounded(6)
          .bg(this.target === item.address ? t.selected : t.raised).text_size(12)
          .when(!locked, el => el.cursor_pointer().on_click((_e, cx) => this.select(item.address, cx)))
          .child((this.target === item.address ? "● " : "○ ") + item.address + " · " + (item.program?.name || item.agent || item.name || "terminal")))))
      .when(!all.length, el => el.child(label("Mở terminal hoặc thêm máy remote trước.")))
      .child(h_flex().gap(6).children(["vi", "en", "auto"].map(lang => button("voice-lang-" + lang,
        lang === "vi" ? "Tiếng Việt" : lang === "en" ? "English" : "Tự nhận", !locked,
        cx => { this.language = lang; cx.notify(); }, this.language === lang))))
      .child(button("voice-record", this.recording ? "■ Dừng & nhận chữ" : this.busy ? "Đang xử lý…" : "● Bật mic", this.recording || (!locked && !!target), cx => this.toggleRecord(cx), true))
      .child(div().text_size(11).text_color(t.muted).child(this.note))
      .when(!!this.error, el => el.child(div().text_size(11).text_color(t.blocked).child(this.error)))
      .child(label("KIỂM TRA / SỬA LỜI NHẮN"))
      .child(Editor.new(this.draft).h(125).min_h(80).rounded(6).border_1().border_color(t.border))
      .child(button("voice-send", "Gửi → " + (this.target || "chưa chọn terminal"), (!locked || !!this.recordJob) && !!target && !!this.draft.value().trim(), cx => this.send(cx), true))
      .child(h_flex().gap(6)
        .child(button("voice-read", "Lấy phản hồi", !locked && !!target, cx => this.read(cx)))
        .child(button("voice-speak", this.speaking ? "■ Ngừng đọc" : "Đọc nội dung", this.speaking || (!this.busy && !!this.response.value().trim()), cx => this.speak(cx))))
      .child(Editor.new(this.response).flex_1().min_h(100).rounded(6).border_1().border_color(t.border))
      .child(label("Tự kết thúc sau 2 giây im lặng. Chỉ bấm Gửi để gửi."));
  }
}
