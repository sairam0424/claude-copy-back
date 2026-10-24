import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { protectedPaths } from "../lib/live-fixtures.mjs";
import { PASTEBOARD_SERVICE, buildProfile, sandboxArgs } from "../lib/seatbelt.mjs";

const profile = buildProfile(protectedPaths("/Users/someone"));

describe("seatbelt profile", () => {
  test("denies outbound network except local addresses and unix sockets", () => {
    const rows = profile.split("\n");
    assert.ok(rows.includes("(deny network-outbound)"));
    assert.ok(rows.includes('(allow network-outbound (remote ip "localhost:*"))'));
    assert.ok(rows.includes("(allow network-outbound (remote unix-socket))"));
    assert.ok(rows.indexOf("(deny network-outbound)") < rows.indexOf('(allow network-outbound (remote ip "localhost:*"))'), "allow rules come after the deny (last match wins)");
  });

  test("denies mach-lookup of the pasteboard service", () => {
    assert.equal(PASTEBOARD_SERVICE, "com.apple.pasteboard.1");
    assert.match(profile, /\(deny mach-lookup \(global-name "com\.apple\.pasteboard\.1"\)\)/);
  });

  test("denies writes under the real home and reads of credential and transcript folders", () => {
    assert.match(profile, /\(deny file-write\* \(subpath "\/Users\/someone"\)\)/);
    for (const p of [".claude", ".aws", ".ssh", "copy-back-captures"]) assert.match(profile, new RegExp(`\\(subpath "/Users/someone/${p.replace(".", "\\.")}"\\)`));
    assert.match(profile, /\(literal "\/Users\/someone\/\.claude\.json"\)/);
  });

  test("starts from allow default and is plain text with a version line", () => {
    assert.equal(profile.split("\n")[0], "(version 1)");
    assert.equal(profile.split("\n")[1], "(allow default)");
  });

  test("refuses a path that could break out of the quoted string", () => {
    for (const bad of ['/a"b', "/a/../b", "relative", "/a\nb", "/a)(allow default)"]) {
      assert.throws(() => buildProfile({ denyWrite: [bad], denyRead: [] }), /not allowed/);
    }
  });

  test("sandboxArgs puts -f profile before the command", () => {
    assert.deepEqual(sandboxArgs("/p.sb", ["/bin/echo", "x"]), ["-f", "/p.sb", "/bin/echo", "x"]);
  });
});
