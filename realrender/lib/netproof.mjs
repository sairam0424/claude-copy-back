// Evidence that the sealed process talks to nobody but the local stub:
// parsing and classifying `lsof -a -i -n -P -p PID` output, a sampler that
// takes many of them, and a summary. The classification is pure and tested.

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|\[?::1\]?|localhost)$/;

/** Split "host:port" where host may be an [IPv6] literal; returns null when not parseable. */
export function splitEndpoint(text) {
  const m = /^(\[[^\]]+\]|[^:]+|\*):(\d+|\*)$/.exec(text);
  return m ? { host: m[1], port: m[2] } : null;
}

/** Parse the NAME column: "local->remote (STATE)", "*:port (LISTEN)" or "*:port". */
export function parseName(name) {
  const state = /\((\w+)\)\s*$/.exec(name)?.[1] ?? "";
  const body = name.replace(/\s*\(\w+\)\s*$/, "").trim();
  const [local, remote] = body.split("->");
  return {
    local: local ?? "",
    remote: remote ?? "",
    state,
  };
}

/** Parse lsof text into socket rows (header and blank lines skipped). */
export function parseLsof(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("COMMAND")) continue;
    const cols = line.trim().split(/\s+/);
    // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME...
    if (cols.length < 9) continue;
    const proto = cols[7];
    if (proto !== "TCP" && proto !== "UDP") continue;
    rows.push({
      fd: cols[3],
      family: cols[4],
      proto,
      ...parseName(cols.slice(8).join(" ")),
    });
  }
  return rows;
}

/**
 * Classify one socket row against the stub's port:
 *  "stub"      connected to 127.0.0.1:<stubPort>
 *  "loopback"  connected to some other loopback endpoint
 *  "external"  connected to anything that is not loopback  (the dangerous kind)
 *  "unbound"   no remote end (a listener or an unconnected UDP socket)
 */
export function classify(row, stubPort) {
  if (!row.remote) return "unbound";
  const ep = splitEndpoint(row.remote);
  if (!ep || !LOOPBACK.test(ep.host)) return "external";
  return String(ep.port) === String(stubPort) ? "stub" : "loopback";
}

/** Take one sample: run lsof for the pid and classify every socket. */
export function sampleOnce({ pid, stubPort, exec, now, phase = "start" }) {
  const r = exec("/usr/sbin/lsof", ["-a", "-i", "-n", "-P", "-p", String(pid)]);
  const sockets = parseLsof(r.stdout).map((row) => ({
    ...row,
    kind: classify(row, stubPort),
  }));
  return { at: now(), phase, sockets };
}

/** Counts per phase and the distinct remote endpoints over all samples. */
export function summarize(samples) {
  const kinds = { stub: 0, loopback: 0, external: 0, unbound: 0 };
  const byPhase = {};
  const remotes = new Set();
  const external = new Set();
  for (const s of samples) {
    byPhase[s.phase] = (byPhase[s.phase] ?? 0) + 1;
    for (const sock of s.sockets) {
      kinds[sock.kind] += 1;
      if (sock.remote) remotes.add(sock.remote);
      if (sock.kind === "external") external.add(sock.remote);
    }
  }
  return {
    samples: samples.length,
    byPhase,
    socketObservations: kinds,
    distinctRemotes: [...remotes].sort(),
    externalRemotes: [...external].sort(),
  };
}

/** Parse `nettop -x -J bytes_in,bytes_out` CSV: process row first. */
export function parseNettop(text) {
  const rows = text
    .split("\n")
    .map((l) => l.split(","))
    .filter((c) => c.length >= 3 && /^\d+$/.test(c[1]) && /^\d+$/.test(c[2]));
  const toRow = (c) => ({ name: c[0], bytesIn: Number(c[1]), bytesOut: Number(c[2]) });
  return rows.map(toRow);
}
