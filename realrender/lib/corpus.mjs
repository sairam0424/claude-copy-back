// Synthetic assistant messages for the rig's glyph survey. Every message is
// made of unique tokens (q0001, q0002, ...) so any token on the real screen
// names its position in the source. These are made up here; no real transcript
// content is involved.

const FENCE = "```";

/** Numbered token q0001, q0002, ... A fresh counter per corpus keeps them unique. */
function counter() {
  let n = 0;
  return () => `q${String((n += 1)).padStart(4, "0")}`;
}

/** Wrap lines into one message string. */
const lines = (...rows) => rows.join("\n");

function headings(t) {
  return lines(
    `# Heading one ${t()} alpha`,
    "",
    `## Heading two ${t()} beta`,
    "",
    `### Heading three ${t()} gamma`,
    "",
    `#### Heading four ${t()} delta`,
    "",
    `Plain paragraph ${t()} directly after the headings.`,
    "",
    `Setext heading ${t()}`,
    "-------------------",
    "",
    `Closing paragraph ${t()}.`,
  );
}

function inline(t) {
  return lines(
    `Paragraph with **bold ${t()}**, *italic ${t()}*, ***both ${t()}***, ~~struck ${t()}~~,`,
    `\`code ${t()}\`, a [named link ${t()}](https://example.com/${t()}/path), an autolink`,
    `<https://example.com/${t()}>, a bare https://example.com/${t()} url, an image`,
    `![alt ${t()}](https://example.com/${t()}.png) and an escaped \\* star ${t()}.`,
  );
}

function bulletLists(t) {
  return lines(
    `Dash list ${t()}:`,
    "",
    `- dash item ${t()}`,
    `- dash item ${t()}`,
    `  - nested dash ${t()}`,
    `    - deeper dash ${t()}`,
    "",
    `Star list ${t()}:`,
    "",
    `* star item ${t()}`,
    `* star item ${t()}`,
    "",
    `Plus list ${t()}:`,
    "",
    `+ plus item ${t()}`,
    `+ plus item ${t()}`,
    "",
    `Task list ${t()}:`,
    "",
    `- [ ] task open ${t()}`,
    `- [x] task done ${t()}`,
  );
}

function orderedLists(t) {
  return lines(
    `Ordered list ${t()}:`,
    "",
    `1. one ${t()}`,
    `2. two ${t()}`,
    `   - nested under two ${t()}`,
    `3. three ${t()}`,
    "",
    `Ordered list starting at five ${t()}:`,
    "",
    `5. five ${t()}`,
    `6. six ${t()}`,
    "",
    `Paren list ${t()}:`,
    "",
    `1) paren one ${t()}`,
    `2) paren two ${t()}`,
    "",
    `Loose list ${t()}:`,
    "",
    `- loose item ${t()}`,
    "",
    `- loose item ${t()}`,
  );
}

function quotes(t) {
  return lines(
    `> quote ${t()} first line`,
    `> quote ${t()} second line`,
    ">",
    `> second paragraph ${t()} inside the quote`,
    ">",
    `> > nested quote ${t()}`,
    ">",
    `> - list in quote ${t()}`,
    "",
    `After the quote ${t()}.`,
  );
}

function code(t) {
  const long = "a".repeat(150);
  return lines(
    `Fenced with a language ${t()}:`,
    "",
    `${FENCE}js`,
    `function ${t()}(a, b) {`,
    `  const ${t()} = a + b; // trailing ${t()}`,
    `\treturn ${t()}; // tab-indented ${t()}`,
    "}",
    FENCE,
    "",
    `Fenced without a language ${t()}:`,
    "",
    FENCE,
    `plain ${t()} code`,
    `  indented ${t()}`,
    FENCE,
    "",
    `Indented code ${t()}:`,
    "",
    `    indented block ${t()}`,
    `        deeper ${t()}`,
    "",
    `Long code line ${t()}:`,
    "",
    FENCE,
    `${t()} ${long} ${t()}`,
    FENCE,
  );
}

function misc(t) {
  const lane = "a".repeat(140);
  return lines(
    `Rule below ${t()}`,
    "",
    "---",
    "",
    `Wide characters ${t()}: 日本語のテキスト and emoji ${t()} 😀 and combining é.`,
    "",
    `Long token ${t()}: https://example.com/${lane}/${t()} end ${t()}.`,
    "",
    `| head ${t()} | head ${t()} |`,
    "|---|---|",
    `| cell ${t()} | cell ${t()} |`,
  );
}

function prose(t) {
  const words = Array.from({ length: 40 }, () => t());
  return `Wrapping paragraph ${t()}: ${words.join(" lorem ")}.`;
}

/** The last assistant message; its final token is the rig's "drawn" sentinel. */
function closing(t) {
  const last = t();
  return { text: `Last reply with \`code ${t()}\` and a final word ${last}.`, last };
}

/** Survey turns (one user prompt, then the assistant messages) and the sentinel token. */
export function surveyTurns() {
  const t = counter();
  const prompt = `synthetic prompt ${t()}`;
  const builders = [headings, inline, bulletLists, orderedLists, quotes, code, misc, prose];
  const texts = builders.map((build) => build(t));
  const tail = closing(t);
  return {
    sentinel: tail.last,
    turns: [
      { role: "user", text: prompt },
      ...[...texts, tail.text].map((text) => ({ role: "assistant", text })),
    ],
  };
}
