import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { expectedProbe, fnv, parseProbeToast } from "../lib/probe-expect.mjs";

describe("rows probe expectations", () => {
  test("fnv is order sensitive and deterministic", () => {
    assert.equal(fnv(["a", "b"]), fnv(["a", "b"]));
    assert.notEqual(fnv(["a", "b"]), fnv(["b", "a"]));
    assert.notEqual(fnv(["ab"]), fnv(["a", "b"]));
    assert.equal(fnv([]), "811c9dc5");
    assert.match(fnv(["é 🚀"]), /^[0-9a-f]{8}$/);
  });

  test("expectedProbe counts rows, roles, alternation and length of the assistant texts", () => {
    const turns = [{ role: "user", text: "q1" }, { role: "assistant", text: "abc" }, { role: "user", text: "q2" }, { role: "assistant", text: "de" }];
    const e = expectedProbe(turns);
    assert.deepEqual([e.rows, e.a, e.u, e.e, e.alt, e.f, e.l, e.len], [4, 2, 2, 0, 1, "u", "a", 5]);
    assert.equal(e.fnv, fnv(["abc", "de"]));
    assert.equal(e.fnvNewestFirst, fnv(["de", "abc"]));
    assert.equal(expectedProbe([{ role: "assistant", text: "x" }]).alt, 0);
  });

  test("parseProbeToast reads key=value pairs and ignores the toast prefix and the cut mark", () => {
    const p = parseProbeToast("   rows-probe: probe rows=80 a=40 u=40 e=0 alt=1 f=u l=a fnv=0badf00d len=123 k=handle,role…");
    assert.deepEqual([p.rows, p.a, p.alt, p.fnv, p.k], ["80", "40", "1", "0badf00d", "handle,role"]);
    assert.equal(parseProbeToast("nothing"), null);
  });
});
