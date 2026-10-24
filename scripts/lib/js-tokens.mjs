// A small lexer for the JavaScript and TypeScript the plugin is written in.
//
// It exists for one job: telling code from text. A word inside a comment, a
// string or a regular expression is not an identifier, and a template literal
// holds code between its `${` and `}`. The privacy guard (source-scan.mjs)
// reads the tokens, so it cannot be fooled by a comment and cannot miss a
// banned name that stands in code. It does not parse; it only tokenizes.
//
// Token kinds: id (identifier, escapes decoded), str (string, escapes
// decoded), tpl (one static chunk of a template literal), num, re (regular
// expression literal), p (punctuator: one character, or `?.`, `=>`, `...`, `++`, `--`).
// Every token carries the 1-based line it starts on. Malformed input never
// throws and never loops: an unterminated string ends at its line, an
// unterminated template or comment at the end of the text.
//
// A `/` after `)`, `]`, `}`, `++` or `--` is ambiguous without a parser: it
// divides in `f(x) / 2` and starts a regular expression in `if (a) /`/.test(s)`.
// Read the wrong way, a regular expression that holds a quote or a backtick
// hides the code after it. `tokenize(src, "usual")` decides from the context
// (a `)` that closes an `if`, `while`, `for` or `with` header and a `}` that
// closes a block are followed by a regular expression; any other `)` or `}`,
// a `]`, `++` and `--` by a division). `tokenize(src, "other")` reads every
// such slash the other way round. The privacy guard scans both readings.

const ID_START = /[\p{ID_Start}$_]/u;
const ID_PART = /[\p{ID_Continue}$\u200c\u200d]/u;
const DIGIT = /[0-9]/;
const SIMPLE_ESCAPES = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  v: "\v",
  0: "\0",
};

// After one of these words a `/` starts a regular expression, not a division.
const REGEX_AFTER_WORD = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

/** Decode one escape at `src[at]` (the character after the backslash). Returns [text, nextIndex]. */
function readEscape(src, at) {
  const c = src[at];
  if (c === "x" && /^[0-9a-fA-F]{2}$/.test(src.slice(at + 1, at + 3))) {
    return [
      String.fromCharCode(parseInt(src.slice(at + 1, at + 3), 16)),
      at + 3,
    ];
  }
  if (c === "u" && src[at + 1] === "{") {
    const end = src.indexOf("}", at);
    const code = end > 0 ? parseInt(src.slice(at + 2, end), 16) : NaN;
    if (Number.isInteger(code) && code <= 0x10ffff)
      return [String.fromCodePoint(code), end + 1];
  }
  if (c === "u" && /^[0-9a-fA-F]{4}$/.test(src.slice(at + 1, at + 5))) {
    return [
      String.fromCharCode(parseInt(src.slice(at + 1, at + 5), 16)),
      at + 5,
    ];
  }
  if (c === undefined) return ["", at];
  return [SIMPLE_ESCAPES[c] ?? c, at + 1];
}

/** A quoted string starting at the quote `src[at]`: [decoded text, index after it, lines crossed]. */
function readString(src, at) {
  const quote = src[at];
  let text = "";
  let i = at + 1;
  let lines = 0;
  while (i < src.length && src[i] !== quote && src[i] !== "\n") {
    if (src[i] === "\\") {
      if (src[i + 1] === "\n") lines += 1;
      const [piece, next] = readEscape(src, i + 1);
      text += piece;
      i = next;
    } else {
      text += src[i];
      i += 1;
    }
  }
  return [text, src[i] === quote ? i + 1 : i, lines];
}

/** A template chunk from `at` (just after the backtick or the closing brace): [text, index after, ended by "${", lines]. */
function readTemplateChunk(src, at) {
  let text = "";
  let i = at;
  let lines = 0;
  while (
    i < src.length &&
    src[i] !== "`" &&
    !(src[i] === "$" && src[i + 1] === "{")
  ) {
    if (src[i] === "\\") {
      const [piece, next] = readEscape(src, i + 1);
      text += piece;
      i = next;
    } else {
      if (src[i] === "\n") lines += 1;
      text += src[i];
      i += 1;
    }
  }
  const opensExpression = src[i] === "$" && src[i + 1] === "{";
  return [
    text,
    i < src.length ? i + (opensExpression ? 2 : 1) : i,
    opensExpression,
    lines,
  ];
}

/** A regular expression literal starting at the slash `src[at]`, or null when it does not close on its line. */
function readRegex(src, at) {
  let i = at + 1;
  let inClass = false;
  while (i < src.length && src[i] !== "\n") {
    const c = src[i];
    if (c === "\\") i += 1;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      let end = i + 1;
      while (end < src.length && /[a-z]/i.test(src[end])) end += 1;
      return { text: src.slice(at, end), next: end };
    }
    i += 1;
  }
  return null;
}

/** An identifier starting at `at`, escapes decoded: [name, next index]. */
function readIdentifier(src, at) {
  let name = "";
  let i = at;
  while (i < src.length) {
    if (src[i] === "\\" && src[i + 1] === "u") {
      const [piece, next] = readEscape(src, i + 1);
      name += piece;
      i = next;
    } else if (ID_PART.test(src[i]) || (i === at && ID_START.test(src[i]))) {
      name += src[i];
      i += 1;
    } else break;
  }
  return [name, i];
}

const CONTROL_WORDS = new Set(["if", "while", "for", "with"]);
const BLOCK_WORDS = new Set(["else", "do", "try", "finally"]);
const BLOCK_PUNCT = new Set([")", ";", "{", "}", "=>"]);

/** True when the group a `(` or `{` opens, being closed, is followed by a regular expression rather than a division. */
function regexFollowsGroup(open, out) {
  const prev = out[out.length - 1];
  if (open === "(") {
    const before = out[out.length - 2];
    return (
      prev?.t === "id" &&
      (CONTROL_WORDS.has(prev.v) || (prev.v === "await" && before?.v === "for"))
    );
  }
  if (prev === undefined) return true;
  if (prev.t === "id") {
    return BLOCK_WORDS.has(prev.v) || !REGEX_AFTER_WORD.has(prev.v);
  }
  return prev.t === "p" && BLOCK_PUNCT.has(prev.v);
}

/** Is `/` after `prev` a regular expression? `reading` is "usual" or "other" (every ambiguous slash the other way). */
function regexAllowed(prev, reading) {
  if (prev === undefined) return true;
  if (prev.t === "id") return REGEX_AFTER_WORD.has(prev.v);
  if (prev.t !== "p") return false;
  if (prev.v === ")" || prev.v === "}") {
    return reading === "other"
      ? prev.regexAfter !== true
      : prev.regexAfter === true;
  }
  if (["]", "++", "--"].includes(prev.v)) return reading === "other";
  return true;
}

function startsNumber(src, i) {
  return DIGIT.test(src[i]) || (src[i] === "." && DIGIT.test(src[i + 1] ?? ""));
}

function skipTrivia(src, at) {
  let i = at;
  let lines = 0;
  for (;;) {
    if (/\s/.test(src[i] ?? "x")) {
      if (src[i] === "\n") lines += 1;
      i += 1;
    } else if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
    } else if (src[i] === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      lines += src.slice(i, stop).split("\n").length - 1;
      i = stop;
    } else return [i, lines];
  }
}

/** The punctuator at `at`: `...`, `=>`, `++`, `--`, `?.` (not before a digit, where it is a ternary), else one character. */
function readPunct(src, at) {
  const two = src.slice(at, at + 2);
  if (src.slice(at, at + 3) === "...") return "...";
  if (two === "=>" || two === "++" || two === "--") return two;
  if (two === "?." && !DIGIT.test(src[at + 2] ?? "")) return two;
  return src[at];
}

function readNumber(src, at) {
  let i = at;
  while (i < src.length && /[0-9A-Za-z_.]/.test(src[i])) i += 1;
  return i;
}

/** Push a punctuator; a `(` or `{` opens a group, and its closer remembers whether a regular expression may follow. */
function emitPunct(st, op) {
  const token = { t: "p", v: op, line: st.line };
  if (op === "(" || op === "{") {
    st.groups.push({ open: op, regexAfter: regexFollowsGroup(op, st.out) });
  } else if (op === ")" || op === "}") {
    const group = st.groups[st.groups.length - 1];
    if (group?.open === (op === ")" ? "(" : "{")) {
      st.groups.pop();
      token.regexAfter = group.regexAfter;
    }
  }
  st.out.push(token);
}

/** Read one token at the cursor (after trivia) into `st`. */
function readToken(st) {
  const { src } = st;
  const c = src[st.i];
  const emit = (t, v) => st.out.push({ t, v, line: st.line });
  const regex =
    c === "/" && regexAllowed(st.out[st.out.length - 1], st.reading)
      ? readRegex(src, st.i)
      : null;
  if (c === '"' || c === "'") {
    const [text, next, lines] = readString(src, st.i);
    emit("str", text);
    st.line += lines;
    st.i = next;
  } else if (c === "`") startTemplate(st, st.i + 1);
  else if (
    c === "}" &&
    st.braces.length > 0 &&
    st.braces[st.braces.length - 1] === 0
  ) {
    st.braces.pop();
    startTemplate(st, st.i + 1);
  } else if (regex !== null) {
    emit("re", regex.text);
    st.i = regex.next;
  } else if (startsNumber(src, st.i)) {
    const end = readNumber(src, st.i);
    emit("num", src.slice(st.i, end));
    st.i = end;
  } else if (ID_START.test(c) || (c === "\\" && src[st.i + 1] === "u")) {
    const [name, next] = readIdentifier(src, st.i);
    emit("id", name);
    st.i = Math.max(next, st.i + 1);
  } else {
    const op = readPunct(src, st.i);
    const top = st.braces.length - 1;
    if (top >= 0 && op === "{") st.braces[top] += 1;
    if (top >= 0 && op === "}") st.braces[top] -= 1;
    emitPunct(st, op);
    st.i += op.length;
  }
}

/** A template chunk from `from`: one tpl token; if it ends in `${`, a new open-brace count for the expression. */
function startTemplate(st, from) {
  const [text, next, open, lines] = readTemplateChunk(st.src, from);
  st.out.push({ t: "tpl", v: text, line: st.line });
  st.line += lines;
  st.i = next;
  if (open) st.braces.push(0);
}

/** Tokenize `src`; `reading` ("usual" or "other") says how a `/` after `)`, `]`, `}`, `++` or `--` is read. */
export function tokenize(src, reading = "usual") {
  // braces: one open-brace count per template expression being read
  // groups: the open `(` and `{` groups, each with whether a regex may follow its closer
  const st = { src, i: 0, line: 1, out: [], braces: [], groups: [], reading };
  while (st.i < src.length) {
    const [at, crossed] = skipTrivia(src, st.i);
    st.line += crossed;
    st.i = at;
    if (st.i >= src.length) break;
    readToken(st);
  }
  return st.out;
}
