import { terminals, run, home } from "herdr";

export function findLogin(all, machine) {
  return all.find(t => {
    if (t.state !== "live") return false;
    const foreground = t.foreground?.argv;
    const argv = foreground?.length ? foreground : t.argv ?? [];
    return argv.some((arg, i) => arg === "machine" && argv[i + 1] === "login" && argv[i + 2] === machine);
  });
}

export function openLogin(machine) {
  const existing = findLogin(terminals(), machine.name);
  if (existing) {
    run("pane.focus", { terminal: existing.address });
    return;
  }
  run("space.new", { name: "SSH · " + machine.name, folder: home(), machine: null,
    argv: [home() + "/.local/bin/hc", "machine", "login", machine.name] });
}
