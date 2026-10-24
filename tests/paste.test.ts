import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findSource } from "../src/core/match.ts";
import { assertHit, makeCase } from "../src/sim/testkit.ts";

// F3: `source` is the exact slice (lossless, per the spec). `paste` is the
// same slice made paste-ready: the container prefix (list indentation, "> ")
// is dropped from every later line, and the first line gets back the
// indentation the copy carried. Nothing is invented: every character of
// `paste` is a character of the source.

function paste(
  source: string,
  from: string,
  to: string,
  width = 80,
  first = false,
) {
  const made = makeCase(source, from, to, width, { marginOnFirstRow: first });
  const result = findSource(made.copied, [source]);
  assertHit(result, [source]);
  return { made, result };
}

describe("paste: code inside containers", () => {
  const listed =
    "1. Install the tool:\n\n   ```bash\n   npm install --save-dev tool\n   npm run build:all\n   ```\n\n2. Next step goes here.\n";

  test("code in a numbered list item loses the list indentation", () => {
    const { result } = paste(listed, "npm install", "build:all");
    assert.equal(
      result.source,
      "npm install --save-dev tool\n   npm run build:all",
    );
    assert.equal(
      result.paste,
      "npm install --save-dev tool\nnpm run build:all",
    );
  });

  test("code in a block quote loses the quote markers", () => {
    const quoted =
      "> Config:\n>\n> ```yaml\n> key: value\n> list:\n>   - one\n> ```\n\nAfter the quote.\n";
    const { result } = paste(quoted, "key: value", "- one");
    assert.equal(result.source, "key: value\n> list:\n>   - one");
    assert.equal(result.paste, "key: value\nlist:\n  - one");
  });

  test("code in a quote inside a list loses both", () => {
    const nested =
      "- item\n\n  > ```sh\n  > first command here\n  > second command here\n  > ```\n";
    const { result } = paste(nested, "first command", "second command here");
    assert.equal(result.paste, "first command here\nsecond command here");
  });

  test("the code's own indentation is kept", () => {
    const code =
      "- Steps:\n\n  ```python\n  def f(x):\n      if x:\n          return 1\n  ```\n";
    const { result } = paste(code, "if x:", "return 1");
    assert.equal(result.paste, "if x:\n        return 1");
  });
});

describe("paste: the first line's indentation", () => {
  const python =
    "```python\nclass C:\n    def f(self):\n        if self.x:\n            return 1\n        return 2\n```";

  test("whole lines selected from the row start keep the first indentation", () => {
    const { made, result } = paste(
      python,
      "    def f(self):",
      "return 2",
      80,
      true,
    );
    assert.ok(made.copied.startsWith("  "), JSON.stringify(made.copied));
    assert.equal(
      result.paste,
      "    def f(self):\n        if self.x:\n            return 1\n        return 2",
    );
    assert.equal(result.source, made.expected);
  });

  test("a selection that starts mid-row gets no invented indentation", () => {
    const { result } = paste(python, "def f(self):", "return 2");
    assert.equal(
      result.paste,
      "def f(self):\n        if self.x:\n            return 1\n        return 2",
    );
  });

  test("the restored indentation never reaches outside the source line", () => {
    const listed = "1. Run:\n\n   ```sh\n   echo one\n   echo two\n   ```\n";
    const { result } = paste(listed, "echo one", "echo two", 80, true);
    assert.equal(result.paste, "echo one\necho two");
  });
});

describe("paste: everything else is the exact slice", () => {
  test("plain prose is unchanged", () => {
    const source =
      "A plain paragraph of words that wraps across several rows when drawn.";
    const { result } = paste(source, "paragraph of words", "several rows", 40);
    assert.equal(result.paste, result.source);
  });

  test("list markers inside the slice are kept", () => {
    const source =
      "- alpha bravo charlie delta echo\n- foxtrot golf hotel india juliet\n";
    const { result } = paste(source, "charlie delta", "hotel india");
    assert.equal(
      result.source,
      "charlie delta echo\n- foxtrot golf hotel india",
    );
    assert.equal(result.paste, result.source);
  });

  test("a soft-wrapped list paragraph loses the continuation indentation", () => {
    const source =
      "- first item text that continues\n  on a second source line here\n- second item\n";
    const { result } = paste(source, "item text", "source line here");
    assert.equal(
      result.source,
      "item text that continues\n  on a second source line here",
    );
    assert.equal(
      result.paste,
      "item text that continues\non a second source line here",
    );
  });

  test("a fence line inside the slice loses the container prefix with its content", () => {
    const source = "1. Run this:\n\n   ```sh\n   ls -la\n   ```\n";
    const { result } = paste(source, "Run this:", "ls -la");
    assert.equal(result.source, "Run this:\n\n   ```sh\n   ls -la");
    assert.equal(result.paste, "Run this:\n\n```sh\nls -la");
  });

  test("paste only ever contains characters of the source", () => {
    const source =
      "> Config:\n>\n> ```yaml\n> key: value\n> list:\n>   - one\n> ```\n\nAfter.\n";
    const { result } = paste(source, "key: value", "- one");
    const remaining = [...result.source];
    for (const ch of result.paste) {
      const at = remaining.indexOf(ch);
      assert.ok(at >= 0, `invented ${JSON.stringify(ch)}`);
      remaining.splice(at, 1);
    }
  });

  test("CRLF sources keep their line endings", () => {
    const source =
      "1. Install:\r\n\r\n   ```sh\r\n   npm ci\r\n   npm test\r\n   ```\r\n";
    const { result } = paste(source, "npm ci", "npm test");
    assert.equal(result.paste, "npm ci\r\nnpm test");
  });
});
