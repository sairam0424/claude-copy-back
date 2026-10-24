import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { classify, parseLsof, parseNettop, parseName, sampleOnce, splitEndpoint, summarize } from "../lib/netproof.mjs";

// A row shaped like real lsof output, with documentation addresses (RFC 5737)
// and made-up values: the fixture for what an EXTERNAL socket looks like.
const EXTERNAL = [
  "COMMAND   PID       USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME",
  "2.1.309  4242       user   12u  IPv4                0x1      0t0  TCP 192.0.2.10:50000->198.51.100.7:443 (ESTABLISHED)",
].join("\n");
const STUB = "2.1.309 1 u 9u  IPv4 0x1 0t0  TCP 127.0.0.1:50000->127.0.0.1:62397 (ESTABLISHED)";
const LISTEN = "2.1.309 1 u 10u IPv4 0x2 0t0  TCP *:3000 (LISTEN)";
const UDP = "2.1.309 1 u 11u IPv4 0x3 0t0  UDP *:5353";
const V6 = "2.1.309 1 u 12u IPv6 0x4 0t0  TCP [::1]:50001->[::1]:62397 (ESTABLISHED)";
const V6X = "2.1.309 1 u 13u IPv6 0x5 0t0  TCP [fe80::1]:50002->[2001:db8::1]:443 (ESTABLISHED)";

describe("lsof parsing", () => {
  test("splits endpoints, including IPv6 literals", () => {
    assert.deepEqual(splitEndpoint("127.0.0.1:62397"), { host: "127.0.0.1", port: "62397" });
    assert.deepEqual(splitEndpoint("[::1]:80"), { host: "[::1]", port: "80" });
    assert.equal(splitEndpoint("nonsense"), null);
  });

  test("parses the NAME column", () => {
    assert.deepEqual(parseName("10.0.0.1:5->1.2.3.4:443 (ESTABLISHED)"), { local: "10.0.0.1:5", remote: "1.2.3.4:443", state: "ESTABLISHED" });
    assert.deepEqual(parseName("*:3000 (LISTEN)"), { local: "*:3000", remote: "", state: "LISTEN" });
  });

  test("header and non-network rows are skipped; no output gives no rows", () => {
    assert.equal(parseLsof("").length, 0);
    assert.equal(parseLsof("COMMAND PID\n").length, 0);
    assert.equal(parseLsof(EXTERNAL).length, 1);
  });
});

describe("classification", () => {
  const kinds = (text) => parseLsof(text).map((r) => classify(r, 62397));

  test("a connection to the stub port on loopback is the stub", () => {
    assert.deepEqual(kinds(STUB), ["stub"]);
    assert.deepEqual(kinds(V6), ["stub"]);
  });

  test("loopback to another port is loopback, not the stub", () => {
    assert.deepEqual(kinds(STUB.replace("62397", "1234")), ["loopback"]);
  });

  test("anything not on loopback is external", () => {
    assert.deepEqual(kinds(EXTERNAL), ["external"]);
    assert.deepEqual(kinds(V6X), ["external"]);
  });

  test("listeners and unconnected UDP have no remote end", () => {
    assert.deepEqual(kinds(LISTEN), ["unbound"]);
    assert.deepEqual(kinds(UDP), ["unbound"]);
  });
});

describe("sampling and summary", () => {
  test("sampleOnce asks lsof for the right flags and tags the phase", () => {
    const calls = [];
    const exec = (bin, args) => { calls.push([bin, args]); return { stdout: EXTERNAL }; };
    const s = sampleOnce({ pid: 7, stubPort: 62397, exec, now: () => 5, phase: "idle" });
    assert.deepEqual(calls[0], ["/usr/sbin/lsof", ["-a", "-i", "-n", "-P", "-p", "7"]]);
    assert.equal(s.phase, "idle");
    assert.equal(s.sockets[0].kind, "external");
  });

  test("summarize counts per phase and lists external remotes", () => {
    const clean = { at: 0, phase: "start", sockets: [] };
    const bad = { at: 1, phase: "idle", sockets: parseLsof(EXTERNAL).map((r) => ({ ...r, kind: "external" })) };
    const sum = summarize([clean, clean, bad]);
    assert.deepEqual(sum.byPhase, { start: 2, idle: 1 });
    assert.deepEqual(sum.externalRemotes, ["198.51.100.7:443"]);
    assert.equal(sum.socketObservations.external, 1);
    assert.deepEqual(summarize([clean]).externalRemotes, []);
  });

  test("nettop output parses; a header-only answer means no rows", () => {
    const rows = parseNettop(",bytes_in,bytes_out,\n2.1.309.4242,8163940,2116,\ntcp4 10.1.1.1:1<->35.1.1.1:443,8163940,2116,\n");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { name: "2.1.309.4242", bytesIn: 8163940, bytesOut: 2116 });
    assert.deepEqual(parseNettop(",bytes_in,bytes_out,\n"), []);
  });
});
