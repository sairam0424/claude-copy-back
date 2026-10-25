import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Static guards on the plugin's source tree. They read the files as text and
// stand in for the parts of the release gate (scripts/check-footprint.sh) that
// need no engine: where engine calls may be spelled, how the seam is shaped,
// what a hooks module may import, and which names the manifest may carry.

const ROOT = new URL("..", import.meta.url).pathname;
const HOOKS = join(ROOT, "hooks");

const files = (dir: string, ext: RegExp): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => ext.test(f))
    .map((f) => join(dir, f));

const read = (path: string): string => readFileSync(path, "utf8");
const hookFiles = files(HOOKS, /\.(ts|tsx)$/);
const CALL = /\$\.[a-z]+\.[a-zA-Z]+(<[^(]*>)?\(/;

test("engine calls are spelled only in hooks/api.ts and hooks/register.tsx, comments included", () => {
  const scanned = [...hookFiles, ...files(join(ROOT, "src"), /\.ts$/)];
  const offenders = scanned
    .filter((f) => CALL.test(read(f)))
    .map((f) => f.slice(ROOT.length));
  assert.deepEqual(offenders.sort(), ["hooks/api.ts", "hooks/register.tsx"]);
});

test("register.tsx spells exactly one engine call itself: the command declaration", () => {
  const calls = read(join(HOOKS, "register.tsx")).match(
    /\$\.[a-z]+\.[a-zA-Z]+\(/g,
  );
  assert.deepEqual(calls, ["$.command.register("]);
});

test("every API the mod reaches has exactly one wrapper in api.ts, four in all", () => {
  const api = read(join(HOOKS, "api.ts"));
  const spelled = [...api.matchAll(/return \$\.([a-z]+\.[a-zA-Z]+)\(/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(spelled, [
    "process.run",
    "session.messages",
    "ui.copy",
    "ui.toast",
  ]);
});

test("wrappers are function declarations of at most seven characters, unique across hooks/", () => {
  const api = read(join(HOOKS, "api.ts"));
  assert.doesNotMatch(
    api,
    /export\s+(const|let|var)\s/,
    "an arrow const fails the engine load",
  );
  const names = [...api.matchAll(/export function (\w+)\(/g)].map(
    (m) => m[1] as string,
  );
  assert.deepEqual(names, ["pbpaste", "history", "toClip", "notify"]);
  for (const name of names) {
    assert.ok(name.length <= 7, name);
    const declaredElsewhere = hookFiles
      .filter((f) => !f.endsWith("hooks/api.ts"))
      .filter((f) =>
        new RegExp(`(function|const|let|var|class)\\s+${name}\\b`).test(
          read(f),
        ),
      );
    assert.deepEqual(declaredElsewhere, [], name);
  }
});

test("a hooks module imports only its own files and type-only from claude-code", () => {
  for (const file of hookFiles) {
    const imports = [
      ...read(file).matchAll(/^(import|export)\b[^;]*?from\s+"([^"]+)"/gms),
    ];
    for (const [statement, , specifier] of imports) {
      const spec = specifier as string;
      if (spec === "claude-code") {
        assert.match(
          statement as string,
          /^(import|export) type\b/,
          `${file}: ${statement}`,
        );
      } else {
        assert.match(spec, /^\.\.?\//, `${file} imports ${spec}`);
        assert.ok(!spec.startsWith("node:"), file);
      }
    }
  }
});

test("no timers, no state, no store, no files, no network, no model in the hooks", () => {
  const forbidden =
    /\b(setTimeout|setInterval|setImmediate|fetch|XMLHttpRequest|WebSocket|localStorage|process\.env)\b|\$\.(clock|state|store|fs|http|model|prompt|env)\./;
  for (const file of hookFiles) {
    assert.doesNotMatch(read(file), forbidden, file);
  }
});

test("the command name is a literal in the declaration and in the matcher", () => {
  const register = read(join(HOOKS, "register.tsx"));
  assert.match(register, /name: "cc"/);
  assert.match(register, /\{ command: "cc" \}/);
  assert.match(register, /immediate: true/);
});

test("the command hook never reads next and ends in a catch that answers {}", () => {
  const register = read(join(HOOKS, "register.tsx"));
  const matcher = register.slice(register.indexOf('on("command.run"'));
  assert.doesNotMatch(matcher, /\bnext\b/);
  assert.match(matcher, /\.catch\(\(\) => \(\{\}\)\)/);
});

test("the manifest names the plugin, carries no config, and lists one hooks module", () => {
  const manifest = JSON.parse(read(join(ROOT, ".claude-plugin/plugin.json")));
  assert.equal(manifest.name, "copy-back");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof manifest.description, "string");
  assert.ok(manifest.description.split(/[.!?] /).length === 1, "one sentence");
  for (const key of [
    "userConfig",
    "commands",
    "agents",
    "skills",
    "mcpServers",
    "hooks",
  ]) {
    assert.equal(key in manifest, false, key);
  }
  const hooks = JSON.parse(read(join(HOOKS, "hooks.json")));
  assert.deepEqual(hooks, { modules: ["register.tsx"] });
});

test("every hooks, test and script file stays under 400 lines", () => {
  const all = [
    ...hookFiles,
    ...files(join(ROOT, "tests"), /\.(ts|tsx)$/),
    ...files(join(ROOT, "scripts"), /\.(sh|mjs)$/),
  ];
  for (const file of all) {
    const lines = read(file).split("\n").length;
    assert.ok(lines <= 400, `${file}: ${lines} lines`);
  }
});
