// A watcher that keeps taking lsof samples of the sealed process while the rig
// waits for anything. Every wait in the rig goes through it, so the network
// evidence is continuous from the first moment the pid exists until teardown.

import { sampleOnce } from "./netproof.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Watch {
  /**
   * @param {object} o
   * @param {number} o.pid claude's pid
   * @param {number} o.stubPort
   * @param {Function} o.exec (bin, args) => {stdout}
   * @param {number} [o.intervalMs] gap between samples
   * @param {()=>number} [o.now]
   */
  constructor({ pid, stubPort, exec, intervalMs = 200, now = Date.now }) {
    this.pid = pid;
    this.stubPort = stubPort;
    this.exec = exec;
    this.intervalMs = intervalMs;
    this.now = now;
    this.startAt = now();
    this.phase = "start";
    this.samples = [];
  }

  tick() {
    this.samples.push(
      sampleOnce({
        pid: this.pid,
        stubPort: this.stubPort,
        exec: this.exec,
        now: this.now,
        phase: this.phase,
      }),
    );
  }

  /** Sample continuously for `ms`. */
  async wait(ms) {
    const end = this.now() + ms;
    do {
      this.tick();
      await sleep(Math.max(0, Math.min(this.intervalMs, end - this.now())));
    } while (this.now() < end);
  }

  /** Sample until `predicate()` is true or `timeoutMs` passes; returns whether it held. */
  async until(predicate, timeoutMs) {
    const end = this.now() + timeoutMs;
    while (this.now() < end) {
      this.tick();
      if (predicate()) return true;
      await sleep(this.intervalMs);
    }
    return false;
  }

  /** Compact record of every sample, for the evidence file. */
  toJsonl() {
    return this.samples
      .map((s) =>
        JSON.stringify({
          tMs: s.at - this.startAt,
          phase: s.phase,
          sockets: s.sockets.map((k) => `${k.proto} ${k.local}->${k.remote} ${k.state} [${k.kind}]`),
        }),
      )
      .join("\n");
  }
}
