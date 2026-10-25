// The files that describe the project to GitHub, npm tooling and Claude Code
// must agree with each other: one version, one licence, no dependencies, and a
// Node floor that matches what the tests really need.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const text = (rel: string): string => fs.readFileSync(`${ROOT}${rel}`, "utf8");
const json = (rel: string): any => JSON.parse(text(rel));

const REPO_URL = "https://github.com/sairam0424/claude-copy-back";
const SEMVER = /^\d+\.\d+\.\d+$/;

const pkg = json("package.json");
const plugin = json(".claude-plugin/plugin.json");
const marketplace = json(".claude-plugin/marketplace.json");

describe("one version, one licence, one repository", () => {
  test("package.json and plugin.json carry the same plain x.y.z version", () => {
    assert.match(pkg.version, SEMVER);
    assert.equal(plugin.version, pkg.version);
  });

  test("both name MIT and the same GitHub repository", () => {
    assert.equal(pkg.license, "MIT");
    assert.equal(plugin.license, "MIT");
    assert.equal(plugin.repository, REPO_URL);
    assert.equal(plugin.homepage, REPO_URL);
    assert.equal(pkg.repository.url, `git+${REPO_URL}.git`);
    assert.equal(pkg.bugs.url, `${REPO_URL}/issues`);
    assert.equal(pkg.homepage, `${REPO_URL}#readme`);
  });

  test("the LICENSE file is the MIT text with the author as holder", () => {
    const license = text("LICENSE");
    assert.ok(
      license.startsWith("MIT License\n\nCopyright (c) 2026 Sairam Ugge\n"),
    );
    assert.match(license, /Permission is hereby granted, free of charge/);
    assert.match(
      license,
      /THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND/,
    );
    assert.ok(license.endsWith("\n"));
  });
});

describe("package.json", () => {
  test("is private, ES module, and has no dependencies of any kind", () => {
    assert.equal(pkg.name, "claude-copy-back");
    assert.equal(pkg.private, true);
    assert.equal(pkg.type, "module");
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
      "bundledDependencies",
      "bundleDependencies",
    ])
      assert.equal(pkg[field], undefined, field);
  });

  test("the Node floor is the first release with default type stripping and threadCpuUsage", () => {
    assert.equal(pkg.engines.node, ">=22.19.0");
  });

  test("describes the project honestly: experimental and macOS only", () => {
    assert.match(pkg.description, /experimental/i);
    assert.match(pkg.description, /macOS/);
    assert.doesNotMatch(pkg.description, /\bDay \d/);
  });

  test("has the documented scripts, and the test scripts use a glob, not a directory", () => {
    for (const name of [
      "test",
      "test:rig",
      "selftest",
      "kit-test",
      "check",
      "validate",
    ])
      assert.equal(typeof pkg.scripts[name], "string", name);
    // `node --test tests/` fails on Node 22 (the directory is loaded as a module).
    assert.match(pkg.scripts.test, /"tests\/\*\.test\.mts"/);
    assert.match(pkg.scripts["test:rig"], /"realrender\/tests\/\*\.test\.mjs"/);
    for (const name of ["test", "test:rig"])
      assert.match(pkg.scripts[name], /--test-concurrency=1/, name);
  });
});

describe("the changelog follows the version", () => {
  const changelog = text("CHANGELOG.md");
  const headings = [
    ...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/gm),
  ];
  const links = new Map(
    [...changelog.matchAll(/^\[([^\]]+)\]: (\S+)$/gm)].map((m) => [m[1], m[2]]),
  );

  test("the newest dated section is the package version", () => {
    assert.ok(headings.length >= 1, "expected one dated section per release");
    assert.equal(headings[0][1], pkg.version);
  });

  test("[Unreleased] stays above the newest release and compares from its tag", () => {
    const unreleased = changelog.indexOf("## [Unreleased]");
    assert.ok(unreleased >= 0 && unreleased < changelog.indexOf("## [0."));
    assert.equal(
      links.get("Unreleased"),
      `${REPO_URL}/compare/v${pkg.version}...HEAD`,
    );
  });

  test("every release has a link: the first a tag, each later one a compare from the one before", () => {
    const versions = headings.map((h) => h[1]).reverse();
    versions.forEach((version, at) => {
      const expected =
        at === 0
          ? `${REPO_URL}/releases/tag/v${version}`
          : `${REPO_URL}/compare/v${versions[at - 1]}...v${version}`;
      assert.equal(links.get(version), expected, version);
    });
  });
});

describe("Claude Code manifests", () => {
  test("plugin.json: name, author, honest description, keywords", () => {
    assert.equal(plugin.name, "copy-back");
    assert.equal(plugin.author.name, "Sairam Ugge");
    assert.match(plugin.description, /macOS/);
    assert.match(plugin.description, /experimental/i);
    for (const keyword of ["claude-code-mod", "clipboard", "copy", "terminal"])
      assert.ok(plugin.keywords.includes(keyword), keyword);
  });

  test("marketplace.json lists exactly this plugin, from the repository root, without a second version", () => {
    assert.equal(marketplace.name, "claude-copy-back");
    assert.equal(marketplace.owner.name, "Sairam Ugge");
    assert.equal(marketplace.plugins.length, 1);
    const [entry] = marketplace.plugins;
    assert.equal(entry.name, plugin.name);
    assert.equal(entry.source, "./");
    // plugin.json is the one place a version lives; a second one would drift.
    assert.equal(entry.version, undefined);
    assert.equal(marketplace.version, undefined);
  });
});

describe("repository hygiene files", () => {
  test(".gitignore keeps engine-written files, dependencies, OS files and rig output out", () => {
    const lines = new Set(text(".gitignore").split("\n"));
    for (const entry of [
      ".claude-plugin/types/",
      "/tsconfig.json",
      "node_modules/",
      ".DS_Store",
      ".env",
      "*.log",
      "copy-back-captures/",
      "*-evidence/",
      "clip-log.jsonl",
    ])
      assert.ok(lines.has(entry), entry);
  });

  test(".gitattributes and .editorconfig both say LF, UTF-8, a final newline and 2-space indent", () => {
    assert.match(text(".gitattributes"), /^\* text=auto eol=lf$/m);
    const editorconfig = text(".editorconfig");
    for (const rule of [
      "root = true",
      "charset = utf-8",
      "end_of_line = lf",
      "insert_final_newline = true",
      "indent_style = space",
      "indent_size = 2",
    ])
      assert.ok(editorconfig.includes(rule), rule);
  });
});
