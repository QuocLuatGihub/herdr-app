import { terminals, hc, exec, appHome, readTextFile, setShared } from "herdr";

export function observe(cx) {
  let busy = false, code = null;
  const poll = cx => {
    if (busy) return;
    busy = true;
    cx.spawn(async cx => {
      try {
        if (!code) code = await readTextFile(appHome() + "/mods/custom-workspace-status/status.py");
        const marked = terminals().filter(t => t.state === "live" && t.labels?.["custom.agent"] === "codex");
        const groups = new Map();
        for (const terminal of marked) {
          const machine = terminal.address.includes("/") ? terminal.address.split("/")[0] : null;
          if (!machine) continue; // Native local reports remain authoritative.
          const r = await hc(["get", terminal.address]);
          if (r.code) continue;
          const details = JSON.parse(r.stdout);
          const list = groups.get(machine) || [];
          list.push(details); groups.set(machine, list);
        }
        const rows = {};
        await Promise.all([...groups].map(async ([machine, list]) => {
          try {
            const r = await exec("python3", ["-c", code, JSON.stringify(list)], { on: machine, timeout: 12000 });
            if (!r.code) {
              const result = JSON.parse(r.stdout);
              for (const [address, row] of Object.entries(result)) rows[address] = { ...row, at: Date.now() };
            }
          } catch {} // Missing daemon or disconnected machine becomes unknown, never stale idle.
        }));
        setShared("custom.agent-status", { at: Date.now(), rows });
      } catch { setShared("custom.agent-status", { at: Date.now(), rows: {} }); }
      finally { busy = false; }
    });
  };
  poll(cx);
  cx.timer.every(5000, cx => poll(cx));
}
