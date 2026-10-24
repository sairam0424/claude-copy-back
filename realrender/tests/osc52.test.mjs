import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findOsc52 } from "../lib/osc52.mjs";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const BEL = "\x07";

describe("OSC 52 reader", () => {
  test("decodes a BEL-terminated write", () => {
    const [e] = findOsc52(Buffer.from(`noise\x1b]52;c;${b64("hello ✓")}${BEL}tail`, "utf8"));
    assert.equal(e.kind, "write");
    assert.equal(e.text, "hello ✓");
    assert.equal(e.selection, "c");
    assert.equal(e.validUtf8, true);
  });

  test("decodes an ST-terminated write and reports its byte offset", () => {
    const buf = Buffer.from(`abc\x1b]52;c;${b64("x y")}\x1b\\`, "latin1");
    const [e] = findOsc52(buf, 100);
    assert.equal(e.text, "x y");
    assert.equal(e.offset, 103);
  });

  test("decodes a tmux passthrough write (doubled ESC)", () => {
    const inner = `\x1b\x1b]52;c;${b64("via tmux")}${BEL}`;
    const [e] = findOsc52(Buffer.from(`\x1bPtmux;${inner}\x1b\\`, "latin1"));
    assert.equal(e.text, "via tmux");
  });

  test("finds several writes in order and ignores other escapes", () => {
    const raw = `\x1b[?2026h\x1b]52;c;${b64("one")}${BEL}\x1b]8;;http://x\x07\x1b]52;p;${b64("two")}${BEL}`;
    const found = findOsc52(Buffer.from(raw, "latin1"));
    assert.deepEqual(found.map((f) => f.text), ["one", "two"]);
    assert.deepEqual(found.map((f) => f.selection), ["c", "p"]);
  });

  test("flags a payload that is not valid UTF-8, a query and malformed base64", () => {
    const bad = Buffer.from([0xff, 0xfe, 0x41]).toString("base64");
    const [invalid, query, malformed] = findOsc52(Buffer.from(`\x1b]52;c;${bad}${BEL}\x1b]52;c;?${BEL}\x1b]52;c;@@@@${BEL}`, "latin1"));
    assert.deepEqual([invalid.kind, invalid.validUtf8, invalid.text], ["write", false, null]);
    assert.equal(query.kind, "query");
    assert.equal(malformed.kind, "malformed");
  });

  test("an empty buffer and plain text hold nothing", () => {
    assert.deepEqual(findOsc52(Buffer.alloc(0)), []);
    assert.deepEqual(findOsc52(Buffer.from("no escapes here")), []);
  });
});
