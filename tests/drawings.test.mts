import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DRAWING, WARP_DRAWING, drawingsFor } from "../src/core/drawing.ts";
import { ordinalOf } from "../src/core/ordinals.ts";
import { findSource } from "../src/core/match.ts";
import { inlineMask } from "../src/core/inline.ts";
import { OPAQUE, project, projectText } from "../src/core/project.ts";
import { copySpan } from "../src/sim/copy.ts";
import { randomMarkdown } from "../src/sim/grammar.ts";
import { mulberry32, pick, randInt } from "../src/sim/prng.ts";
import { trueSlice } from "../src/sim/truth.ts";

// What Claude Code 2.1.310 draws, read from sealed-rig screens of synthetic
// text (calibration seeds 4101 for the Warp profile and 4103 for the default
// one, and two hand-written probe sessions; see WARP-REPORT.md). The default
// profile has no TERM_PROGRAM; the Warp profile sets TERM_PROGRAM=WarpTerminal.
// The binary decides from that variable alone: Warp is in its hyperlink list (a
// link is then an OSC 8 hyperlink and shows its label only) and in its
// strikethrough list (struck text is then drawn with an attribute, no tildes).

const shown = (source: string, drawing = DEFAULT_DRAWING): string =>
  projectText(source, undefined, drawing).projected;

describe("the two drawings", () => {
  test("the default drawing is the rig's profile without TERM_PROGRAM; Warp's differs in both settings", () => {
    assert.deepEqual(DEFAULT_DRAWING, { links: "url", strike: "tilde" });
    assert.deepEqual(WARP_DRAWING, { links: "label", strike: "plain" });
  });

  test("a source without links or strikethrough needs one drawing, one with either needs the others too", () => {
    assert.deepEqual(drawingsFor("plain words, **bold** and `code` and a [ref][x]"), [DEFAULT_DRAWING]);
    assert.equal(drawingsFor("see [a](https://x.y)").length, 2);
    assert.equal(drawingsFor("a ~~b~~ c").length, 2);
    assert.equal(drawingsFor("see [a](https://x.y) and ~~b~~").length, 4);
    for (const d of drawingsFor("see [a](https://x.y) and ~~b~~")) assert.ok(["url", "label"].includes(d.links) && ["tilde", "plain"].includes(d.strike));
  });

  test("the drawings are distinct and the first one is the default", () => {
    const all = drawingsFor("see [a](https://x.y) and ~~b~~");
    assert.deepEqual(all[0], DEFAULT_DRAWING);
    assert.equal(new Set(all.map((d) => `${d.links}/${d.strike}`)).size, 4);
  });
});

describe("links: label (destination) by default, the label alone in Warp unless there is a title", () => {
  const rows: Array<[string, string, string, string]> = [
    ["plain link", "see [the docs](https://x.y/a) now", "see the docs (https://x.y/a) now", "see the docs now"],
    ["relative path", "open [page](./docs/page.md) now", "open page (./docs/page.md) now", "open page now"],
    ["anchor", "go [there](#section) now", "go there (#section) now", "go there now"],
    ["other scheme", "get [files](ftp://f.example.com/x) now", "get files (ftp://f.example.com/x) now", "get files now"],
    ["bold label", "see [**bold label**](https://x.y/b) now", "see bold label (https://x.y/b) now", "see bold label now"],
    ["code label", "see [`code label`](https://x.y/c) now", "see code label (https://x.y/c) now", "see code label now"],
    ["double-quoted title", 'see [l](https://x.y/a "T1") now', 'see l (https://x.y/a) ("T1") now', 'see l (https://x.y/a) ("T1") now'],
    ["single-quoted title", "see [l](https://x.y/a 'T2') now", 'see l (https://x.y/a) ("T2") now', 'see l (https://x.y/a) ("T2") now'],
    ["parenthesised title", "see [l](https://x.y/a (T3)) now", 'see l (https://x.y/a) ("T3") now', 'see l (https://x.y/a) ("T3") now'],
    ["angle destination with a title", 'see [l](<https://x.y/a> "T4") now', 'see l (https://x.y/a) ("T4") now', 'see l (https://x.y/a) ("T4") now'],
    ["mailto shows the address", "write [me](mailto:someone@x.y) now", "write me (someone@x.y) now", "write me (someone@x.y) now"],
    ["label equal to the destination is not repeated", "see [https://x.y/same](https://x.y/same) now", "see https://x.y/same now", "see https://x.y/same now"],
    ["image", "see ![alt text](https://x.y/p.png) now", "see alt text (https://x.y/p.png) now", "see alt text (https://x.y/p.png) now"],
    ["image with a title keeps it inside the parentheses", 'see ![alt](https://x.y/q.png "IT") now', 'see alt (https://x.y/q.png "IT") now', 'see alt (https://x.y/q.png "IT") now'],
    ["autolink", "go <https://x.y/z> now", "go https://x.y/z now", "go https://x.y/z now"],
    ["reference style is not interpreted", "see [text][ref] now", "see [text][ref] now", "see [text][ref] now"],
    ["bare url", "see https://x.y/paren_(x) now", "see https://x.y/paren_(x) now", "see https://x.y/paren_(x) now"],
    ["two links, one titled", 'a [one](https://x.y/1) b [two](https://x.y/2 "T") c', 'a one (https://x.y/1) b two (https://x.y/2) ("T") c', 'a one b two (https://x.y/2) ("T") c'],
  ];
  for (const [name, source, byDefault, inWarp] of rows) {
    test(`${name}: default and Warp`, () => {
      assert.equal(shown(source, DEFAULT_DRAWING), byDefault);
      assert.equal(shown(source, WARP_DRAWING), inWarp);
    });
  }

  test("every drawn character of a titled link maps into the link's own source", () => {
    const source = 'xx [lab](https://x.y/a "TT") yy';
    for (const drawing of [DEFAULT_DRAWING, WARP_DRAWING]) {
      const p = projectText(source, undefined, drawing);
      for (const at of p.map) assert.ok(at >= 0 && at < source.length);
      const first = p.projected.indexOf("lab");
      const last = p.projected.indexOf('("TT")') + 5;
      assert.ok(source.slice(p.map[first] as number, (p.map[last] as number) + 1).startsWith("lab"));
    }
  });

  test("the mask of a titled link: blanks before the title are drawn as ') (' and its delimiters as double quotes", () => {
    const mask = inlineMask('[l](u "T")');
    assert.deepEqual([...mask], [1, 0, 2, 0, 0, 3, 4, 0, 4, 0]);
  });

  test("a break inside the link's tail is not drawn; a break inside its label is", () => {
    assert.equal(shown('see [l](<https://x.y/a>\n"T") end'), 'see l (https://x.y/a) ("T") end');
    assert.equal(shown('see [l](https://x.y/a\n"T") end', WARP_DRAWING), 'see l (https://x.y/a) ("T") end');
    assert.equal(shown("see [l](https://x.y/a\n) end"), "see l (https://x.y/a) end");
    assert.equal(shown("see [two\nwords](https://x.y/a) end"), "see two\nwords (https://x.y/a) end");
    assert.equal(shown("see [two\nwords](https://x.y/a) end", WARP_DRAWING), "see two\nwords end");
    assert.equal(shown("see [l](\nhttps://x.y/a) end", WARP_DRAWING), "see l end");
  });

  test("a link inside a quote, a list item and a heading is drawn the same way", () => {
    assert.equal(shown("> see [a](https://x.y)", WARP_DRAWING), "see a");
    assert.equal(shown("- see [a](https://x.y)", WARP_DRAWING), "- see a");
    assert.equal(shown("## see [a](https://x.y)", WARP_DRAWING), "see a");
    assert.equal(shown('- see [a](https://x.y "T")'), '- see a (https://x.y) ("T")');
  });
});

describe("strikethrough: drawn with its tildes by default, without them in Warp", () => {
  const rows: Array<[string, string, string, string]> = [
    ["plain", "a ~~gone~~ b", "a ~~gone~~ b", "a gone b"],
    ["inside bold", "a **~~bold strike~~** b", "a ~~bold strike~~ b", "a bold strike b"],
    ["around bold", "a ~~**strike bold**~~ b", "a ~~strike bold~~ b", "a strike bold b"],
    ["around italic", "a ~~a *b* c~~ d", "a ~~a b c~~ d", "a a b c d"],
    ["followed by a letter", "a ~~x~~y z", "a ~~x~~y z", "a xy z"],
    ["inside a word", "a b~~c~~d e", "a b~~c~~d e", "a bcd e"],
    ["across a soft break", "a ~~across\nsoft~~ b", "a ~~across\nsoft~~ b", "a across\nsoft b"],
    ["a second pair after a lone double tilde", "a ~~b ~~ c~~ d", "a ~~b ~~ c~~ d", "a b ~~ c d"],
    ["two in a row", "~~one~~ ~~two~~ end", "~~one~~ ~~two~~ end", "one two end"],
  ];
  for (const [name, source, byDefault, inWarp] of rows) {
    test(`${name}`, () => {
      assert.equal(shown(source, WARP_DRAWING), inWarp);
      assert.equal(shown(source, DEFAULT_DRAWING), byDefault);
    });
  }

  test("a strike pair inside a link label: no tildes in Warp, tildes and the destination by default", () => {
    assert.equal(shown("see [~~in label~~](https://x.y/s) end", WARP_DRAWING), "see in label end");
    assert.equal(shown("see [~~in label~~](https://x.y/s) end"), "see ~~in label~~ (https://x.y/s) end");
  });

  test("what is not a strike pair stays typed in both drawings", () => {
    for (const source of [
      "a ~single~ b",
      "a ~~~triple~~~ b",
      "a ~~ spaced ~~ b",
      "a ~~unclosed b",
      "about ~40 lines (~2 each) and ~a and b~ and 5~6 end",
      "a `~~in code~~` b",
    ]) {
      const code = source.includes("`");
      const expected = code ? source.replace(/`/g, "") : source;
      assert.equal(shown(source, DEFAULT_DRAWING), expected, source);
      assert.equal(shown(source, WARP_DRAWING), expected, source);
    }
  });

  test("a strike pair hides exactly its four tildes", () => {
    const hidden = [...inlineMask("a ~~b~~ c", WARP_DRAWING)].map((f, i) => (f === 1 ? i : -1)).filter((i) => i >= 0);
    assert.deepEqual(hidden, [2, 3, 5, 6]);
    assert.deepEqual([...inlineMask("a ~~b~~ c")].filter((f) => f !== 0), []);
  });
});

describe("ordered lists: the marker style follows the list nesting depth", () => {
  test("ordinalOf: numerals, letters, lowercase roman numerals, then numerals again", () => {
    assert.deepEqual([1, 2, 10].map((n) => ordinalOf(0, n)), ["1", "2", "10"]);
    assert.deepEqual([1, 2, 26, 27, 28, 30, 52, 53].map((n) => ordinalOf(1, n)), ["a", "b", "z", "aa", "ab", "ad", "az", "ba"]);
    assert.deepEqual([1, 2, 3, 4, 5, 9, 10, 14, 40, 90, 1994].map((n) => ordinalOf(2, n)), ["i", "ii", "iii", "iv", "v", "ix", "x", "xiv", "xl", "xc", "mcmxciv"]);
    assert.deepEqual([1, 5].map((n) => ordinalOf(3, n)), ["1", "5"]);
    assert.deepEqual([1, 5].map((n) => ordinalOf(7, n)), ["1", "5"]);
  });

  test("a number that has no letter or numeral falls back to the digits", () => {
    assert.equal(ordinalOf(1, 0), "0");
    assert.equal(ordinalOf(2, 0), "0");
    assert.equal(ordinalOf(2, 4000), "4000");
  });

  const source = [
    "1. level0 first", "   1. level1 first", "      1. level2 first", "         1. level3 first", "            1. level4 first",
    "            2. level4 second", "         2. level3 second", "      2. level2 second", "   2. level1 second", "2. level0 second",
  ].join("\n");

  test("depth 0 numerals, depth 1 letters, depth 2 roman, deeper numerals (the five-level probe)", () => {
    assert.equal(
      shown(source),
      ["1. level0 first", "a. level1 first", "i. level2 first", "1. level3 first", "1. level4 first", "2. level4 second", "2. level3 second", "ii. level2 second", "b. level1 second", "2. level0 second"].join("\n"),
    );
  });

  test("bullets stay a hyphen at every depth, and an ordered list inside bullets counts the bullet depth", () => {
    assert.equal(shown("- b0\n  - b1\n    1. deep\n    2. deeper"), "- b0\n- b1\ni. deep\nii. deeper");
    assert.equal(shown("- b0\n  1. one\n  2. two"), "- b0\na. one\nb. two");
  });

  test("a quote is not a list: an ordered list in a quote is depth 0, its nested list depth 1", () => {
    assert.equal(shown("> 1. q one\n>    1. q nested"), "1. q one\na. q nested");
  });

  test("the 27th item of a nested list is aa", () => {
    const items = Array.from({ length: 27 }, (_, i) => `   ${i + 1}. item ${i + 1}`).join("\n");
    assert.match(shown(`1. top\n${items}`), /\naa\. item 27$/);
  });

  test("drawn markers are list markers: a nested-letter copy finds its source", () => {
    const message = "Intro words.\n\n1. top item\n   1. first nested item here\n   2. second nested item here\n\nThe end.";
    const found = findSource("a. first nested item here\n  b. second nested item", [message]);
    assert.equal(found.ok && found.source, "1. first nested item here\n   2. second nested item");
  });

  test("the marker offsets stay inside the source for letters and numerals alike", () => {
    const p = projectText(source);
    for (const at of p.map) assert.ok(at >= 0 && at < source.length);
  });
});

describe("findSource understands both drawings", () => {
  const message = "Intro sentence about the build.\n\nRead [the deployment guide](https://docs.example.com/guide) before you ~~skip the checks~~ run the checks twice.\n\nClosing words.";
  const slice = "the deployment guide](https://docs.example.com/guide) before you ~~skip the checks~~ run the checks";

  test("a copy in the default drawing (destination in parentheses, tildes drawn)", () => {
    const found = findSource("the deployment guide (https://docs.example.com/guide) before you ~~skip the checks~~ run the checks", [message]);
    assert.equal(found.ok && found.source, slice);
  });

  test("a copy in the Warp drawing (label only, no tildes)", () => {
    const found = findSource("the deployment guide before you skip the checks run the checks", [message]);
    assert.equal(found.ok && found.source, slice);
  });

  test("each of the four drawings (destination or not, tildes or not) finds the same slice", () => {
    const copies = [
      "the deployment guide (https://docs.example.com/guide) before you ~~skip the checks~~ run the checks",
      "the deployment guide (https://docs.example.com/guide) before you skip the checks run the checks",
      "the deployment guide before you ~~skip the checks~~ run the checks",
      "the deployment guide before you skip the checks run the checks",
    ];
    for (const copy of copies) {
      const found = findSource(copy, [message]);
      assert.equal(found.ok && found.source, slice, copy);
    }
  });

  test("a copy that mixes two drawings of the SAME kind is refused, never guessed", () => {
    const two = "See [first guide](https://a.example.com/one) and [second guide](https://b.example.com/two) today.";
    assert.equal(findSource("See first guide (https://a.example.com/one) and second guide today", [two]).ok, false);
    assert.equal(findSource("See first guide and second guide (https://b.example.com/two) today", [two]).ok, false);
    const struck = "Do ~~this one~~ and ~~that one~~ before the release.";
    assert.equal(findSource("Do ~~this one~~ and that one before the release", [struck]).ok, false);
  });

  test("the same words in two messages with different slices are ambiguous, as before", () => {
    const linked = "Read [the deployment guide](https://docs.example.com/guide) before you start.";
    const plain = "Read the deployment guide before you start.";
    const found = findSource("Read the deployment guide before you start", [linked, plain]);
    assert.deepEqual(found, { ok: false, reason: "ambiguous" });
    const struck = "Never ~~skip the checks~~ run them twice.";
    const typed = "Never skip the checks run them twice.";
    assert.deepEqual(findSource("Never skip the checks run them twice", [struck, typed]), { ok: false, reason: "ambiguous" });
  });

  test("a link whose label appears in no other message is not made ambiguous by the second drawing", () => {
    const linked = "Read [the deployment guide](https://docs.example.com/guide) before you start.";
    const other = "Nothing about guides here, just other words entirely.";
    const found = findSource("the deployment guide before you start", [other, linked]);
    assert.equal(found.ok && found.messageIndex, 1);
  });

  test("the answer carries the exact slice and the same slice as paste text", () => {
    const found = findSource("the deployment guide before you skip the checks run the checks", [message]);
    assert.ok(found.ok);
    if (!found.ok) return;
    assert.equal(message.slice(found.start, found.end), found.source);
    assert.equal(found.paste, found.source);
  });

  test("a copy that begins in the middle of a destination is found only in the default drawing", () => {
    const found = findSource("example.com/guide) before you ~~skip the checks~~ run", [message]);
    assert.equal(found.ok && found.source, "example.com/guide) before you ~~skip the checks~~ run");
    assert.equal(findSource("example.com/guide before you skip the checks run", [message]).ok, false);
  });

  test("a titled link is the same in both drawings, so it is found from one copy", () => {
    const titled = 'Open [the setup page](https://x.example.com/setup "Setup") before you begin.';
    const found = findSource('the setup page (https://x.example.com/setup) ("Setup") before you begin', [titled]);
    assert.equal(found.ok && found.source, 'the setup page](https://x.example.com/setup "Setup") before you begin');
  });
});

describe("the simulator draws both screens and each copy comes back as the exact slice", () => {
  const source = [
    "Release notes for the new build.",
    "",
    "- **Fast path:** read [the setup guide](https://docs.example.com/setup/guide) before you ~~skip the checks~~ run them twice.",
    "- Second item mentions [another page](./docs/other.md) and plain words that continue for a while to wrap.",
    "",
    "Closing paragraph with more words to fill a row or two, and a last [link](https://docs.example.com/last) here.",
  ].join("\n");

  for (const [name, drawing] of [["default", DEFAULT_DRAWING], ["warp", WARP_DRAWING]] as const) {
    for (const width of [40, 60, 80, 120]) {
      test(`${name} drawing at ${width} columns`, () => {
        const projection = project(source, { width, drawing });
        const from = projection.projected.indexOf("Fast path");
        const to = projection.projected.indexOf("run them twice") + "run them twice".length;
        const copied = copySpan(projection, from, to, { width });
        const found = findSource(copied, [source]);
        assert.ok(found.ok, `${name} ${width}: ${JSON.stringify(found)}`);
        if (found.ok) assert.equal(found.source, trueSlice(source, projection, from, to));
      });
    }
  }

  test("the Warp rows carry no destination and no tildes; the default rows carry both", () => {
    const warp = project(source, { width: 120, drawing: WARP_DRAWING }).rows.join("\n");
    const normal = project(source, { width: 120 }).rows.join("\n");
    assert.doesNotMatch(warp, /docs\.example\.com|~~/);
    assert.match(normal, /docs\.example\.com\/setup\/guide/);
    assert.match(normal, /~~skip the checks~~/);
  });
});

describe("round trip under every drawing: random markdown with links and strikethrough", () => {
  const rng = mulberry32(20261024);
  const docs = Array.from({ length: 40 }, () => randomMarkdown(rng, randInt(rng, 3, 8)));
  const drawings = [
    ["default", DEFAULT_DRAWING],
    ["warp", WARP_DRAWING],
    ["destination and no tildes", { links: "url", strike: "plain" }],
    ["label and tildes", { links: "label", strike: "tilde" }],
  ] as const;

  function randomSpan(r: () => number, projected: string): [number, number] | null {
    for (let attempt = 0; attempt < 30; attempt++) {
      let a = randInt(r, 0, projected.length - 1);
      let b = Math.min(projected.length, a + randInt(r, 30, 300));
      while (a < b && /\s/.test(projected[a] as string)) a++;
      while (b > a && /\s/.test(projected[b - 1] as string)) b--;
      if (a > 0 && /[\udc00-\udfff]/.test(projected[a] as string)) a--;
      if (b < projected.length && /[\ud800-\udbff]/.test(projected[b - 1] as string)) b++;
      if (projected.slice(a, b).includes(OPAQUE) || projected.slice(a, b).replace(/\s+/g, " ").length < 20) continue;
      return [a, b];
    }
    return null;
  }

  for (const [name, drawing] of drawings) {
    for (const width of [40, 80, 120]) {
      test(`${name} at ${width} columns: every copy comes back as its exact slice, never another`, () => {
        const r = mulberry32(width * 31 + name.length);
        let trials = 0;
        let linked = 0;
        for (const source of docs) {
          const p = project(source, { width, drawing });
          const span = randomSpan(r, p.projected);
          if (span === null) continue;
          const copied = copySpan(p, span[0], span[1], { width, pad: r() < 0.8, marginOnFirstRow: r() < 0.5 });
          const others = [pick(r, docs), pick(r, docs)].filter((o) => o !== source);
          const result = findSource(copied, [others[0] ?? "", source, ...others.slice(1)]);
          const label = `${name} ${width}: ${JSON.stringify(copied.slice(0, 60))}`;
          assert.equal(result.ok, true, `${label}: ${JSON.stringify(result)}`);
          if (!result.ok) return;
          assert.equal(result.source, trueSlice(source, p, span[0], span[1]), label);
          trials++;
          if (/\]\(|~~/.test(result.source)) linked++;
        }
        assert.ok(trials >= 30, `only ${trials} trials`);
        assert.ok(linked >= 3, `only ${linked} copies held a link or a strike`);
      });
    }
  }
});
