import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CAPTURE_FLAGS, SESSION, SOCKET, TMUX_CONF, Tmux } from "../lib/tmux.mjs";

function fake() {
  const calls = [];
  const exec = (bin, args, env) => { calls.push({ bin, args, env }); return { status: 0, stdout: "pid=1 dead=0 w=100 h=40 alt=1", stderr: "" }; };
  return { calls, tmux: new Tmux({ bin: "/t/tmux", conf: "/c/tmux.conf", env: { PATH: "/p" }, exec }) };
}

describe("tmux wrapper", () => {
  test("every command goes to the dedicated socket with the private config", () => {
    const { calls, tmux } = fake();
    tmux.hasServer();
    tmux.newSession({ width: 100, height: 40, cwd: "/w", command: "/w/run.sh" });
    tmux.resize(60, 40);
    for (const kind of Object.keys(CAPTURE_FLAGS)) tmux.capture(kind);
    tmux.capture("plain", { history: true });
    tmux.paneFacts();
    tmux.sendKeys("PageUp");
    tmux.killServer();
    assert.ok(calls.length >= 12);
    for (const { bin, args } of calls) {
      assert.equal(bin, "/t/tmux");
      assert.deepEqual(args.slice(0, 4), ["-L", SOCKET, "-f", "/c/tmux.conf"]);
    }
    assert.equal(SOCKET, "cbrender");
  });

  test("the environment handed to tmux is exactly the one given", () => {
    const { calls, tmux } = fake();
    tmux.hasServer();
    assert.deepEqual(calls[0].env, { PATH: "/p" });
  });

  test("session creation is detached, sized and aimed at the cwd and the launcher", () => {
    const { calls, tmux } = fake();
    tmux.newSession({ width: 100, height: 300, cwd: "/w", command: "/w/run.sh" });
    assert.deepEqual(calls[0].args.slice(4), ["new-session", "-d", "-s", SESSION, "-x", "100", "-y", "300", "-c", "/w", "/w/run.sh"]);
  });

  test("capture variants: plain, joined (-J), escapes (-e), padded (-N), history range", () => {
    const { calls, tmux } = fake();
    tmux.capture("joined");
    tmux.capture("styled");
    tmux.capture("padded");
    tmux.capture("plain", { history: true });
    const flags = calls.map((c) => c.args.slice(5));
    assert.deepEqual(flags[0], ["-p", "-J", "-t", SESSION]);
    assert.deepEqual(flags[1], ["-p", "-e", "-t", SESSION]);
    assert.deepEqual(flags[2], ["-p", "-N", "-t", SESSION]);
    assert.deepEqual(flags[3], ["-p", "-S", "-", "-E", "-", "-t", SESSION]);
    assert.throws(() => tmux.capture("nope"));
  });

  test("a failed new-session throws", () => {
    const tmux = new Tmux({ bin: "t", conf: "c", env: {}, exec: () => ({ status: 1, stdout: "", stderr: "boom" }) });
    assert.throws(() => tmux.newSession({ width: 1, height: 1, cwd: "/", command: "x" }), /boom/);
  });

  test("pane facts parse into fields", () => {
    const { tmux } = fake();
    assert.deepEqual(tmux.paneFacts(), { pid: "1", dead: "0", w: "100", h: "40", alt: "1" });
  });

  test("the private config keeps the pane after exit and hides the status line", () => {
    assert.match(TMUX_CONF, /remain-on-exit on/);
    assert.match(TMUX_CONF, /status off/);
    assert.match(TMUX_CONF, /default-shell \/bin\/sh/);
  });
});

describe("raw stream tap", () => {
  test("pipe-pane appends to a single-quoted file path on the dedicated socket", () => {
    const calls = [];
    const tmux = new Tmux({ bin: "t", conf: "c", env: {}, exec: (b, a) => { calls.push(a); return { status: 0, stdout: "", stderr: "" }; } });
    tmux.pipeTo("/o/it's raw.bin");
    assert.deepEqual(calls[0].slice(0, 4), ["-L", "cbrender", "-f", "c"]);
    assert.deepEqual(calls[0].slice(4, 7), ["pipe-pane", "-t", SESSION]);
    assert.equal(calls[0][7], "cat >> '/o/it'\\''s raw.bin'");
  });
});
