// freeze.json: what a pass or a holdout was frozen against, written so that
// anyone can recompute every digest in it from the file and the repository.
//
// An earlier freeze.json carried a plugin tree digest whose recipe was not
// written anywhere, and a verifier tried nine recipes without finding it. Here
// the recipes are fields of the file (`recipe`), the per-file hashes the digest
// is made of are in the file too, and `verifyFreeze` recomputes everything.
// Read-only: nothing here writes outside the file the caller asks for.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { profileRecord } from "./profile.mjs";

export const TREE_DIGEST_RECIPE =
  "treeSha256 is the SHA-256 (64 lowercase hex digits) of the byte string made by taking every file of the tree in ascending " +
  "order of its relative path (relative to the repository root, '/' separators, compared as UTF-8 bytes) and appending, for each " +
  "file, its relative path, a line feed, the SHA-256 of the file's content as 64 lowercase hex digits, and a line feed.";

export const MATCHER_DIGEST_RECIPE =
  "sha256 over the files directly inside src/core in ascending file-name order; each file contributes its name, a line feed, " +
  "then the raw bytes of the file.";

export const GENERATOR_DIGEST_RECIPE =
  "sha256 over the raw bytes of the listed generator files, concatenated in the order listed.";

const hex = (data) => createHash("sha256").update(data).digest("hex");
const utf8 = (text) => Buffer.from(text, "utf8");

/** The digest of a tree given as { relative path: sha256 of content } (the recipe above). */
export function treeDigest(files) {
  const hash = createHash("sha256");
  for (const rel of Object.keys(files).sort((a, b) => Buffer.compare(utf8(a), utf8(b)))) hash.update(`${rel}\n${files[rel]}\n`);
  return hash.digest("hex");
}

/** sha256 of every file under the given parts of `root`, keyed by path relative to `root`. */
export function hashTreeFiles(root, parts) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out[path.relative(root, full).split(path.sep).join("/")] = hex(fs.readFileSync(full));
    }
  };
  for (const part of parts) if (fs.existsSync(path.join(root, part))) walk(path.join(root, part));
  return out;
}

/** The "frozen matcher" digest: the same value measure.mjs prints as matcherSha. */
export function matcherDigest(coreDir) {
  const hash = createHash("sha256");
  for (const f of fs.readdirSync(coreDir).sort()) hash.update(`${f}\n`).update(fs.readFileSync(path.join(coreDir, f)));
  return hash.digest("hex");
}

/** sha256 over the raw bytes of `names` (paths relative to `root`), in the order given. */
export function generatorDigest(root, names) {
  const hash = createHash("sha256");
  for (const name of names) hash.update(fs.readFileSync(path.join(root, name)));
  return hash.digest("hex");
}

function ruleEntry(root, rel) {
  const full = path.join(root, rel);
  return { path: rel, sha256: hex(fs.readFileSync(full)), mtime: fs.statSync(full).mtime.toISOString() };
}

/**
 * @param {object} o
 * @param {string} o.root repository root
 * @param {string[]} o.parts folders that make the plugin tree (".claude-plugin", "hooks", "src")
 * @param {string[]} o.ruleFiles rule files (relative to root): their hash and modification time are recorded
 * @param {string[]} [o.generatorFiles] generator files (relative to root)
 * @param {string} [o.profile] terminal profile
 * @param {string} [o.claudeVersion] banner version of the engine the evidence ran on
 * @param {Date} [o.now]
 * @param {string} [o.note]
 */
export function buildFreeze(o) {
  const files = hashTreeFiles(o.root, o.parts);
  const record = profileRecord(o.profile);
  return {
    schema: 1,
    frozenAt: (o.now ?? new Date()).toISOString(),
    profile: record.profile,
    profileAdded: record.added,
    claudeVersion: o.claudeVersion ?? null,
    ...(o.note ? { note: o.note } : {}),
    rule: { files: o.ruleFiles.map((rel) => ruleEntry(o.root, rel)) },
    generator: o.generatorFiles
      ? { files: o.generatorFiles, sha256: generatorDigest(o.root, o.generatorFiles), recipe: GENERATOR_DIGEST_RECIPE }
      : null,
    matcher: { sha256: matcherDigest(path.join(o.root, "src", "core")), recipe: MATCHER_DIGEST_RECIPE },
    pluginTree: { parts: o.parts, files: Object.keys(files).length, treeSha256: treeDigest(files), recipe: TREE_DIGEST_RECIPE, fileSha256: files },
  };
}

function treeMismatches(freeze, root) {
  const { pluginTree: tree } = freeze;
  const now = hashTreeFiles(root, tree.parts);
  const out = [];
  for (const [rel, sha] of Object.entries(tree.fileSha256)) {
    if (!(rel in now)) out.push(`${rel} (missing)`);
    else if (now[rel] !== sha) out.push(`${rel} (changed)`);
  }
  for (const rel of Object.keys(now)) if (!(rel in tree.fileSha256)) out.push(`${rel} (extra)`);
  if (treeDigest(tree.fileSha256) !== tree.treeSha256) out.push("treeSha256 (the recorded digest is not the digest of the recorded file hashes)");
  if (treeDigest(now) !== tree.treeSha256) out.push("treeSha256 (the tree on disk no longer has the recorded digest)");
  return out;
}

/** Recompute every digest of a freeze against `root`; names what differs. */
export function verifyFreeze(freeze, root) {
  const mismatches = treeMismatches(freeze, root);
  for (const entry of freeze.rule.files) {
    const full = path.join(root, entry.path);
    if (!fs.existsSync(full)) mismatches.push(`rule ${entry.path} (missing)`);
    else if (hex(fs.readFileSync(full)) !== entry.sha256) mismatches.push(`rule ${entry.path} (changed)`);
  }
  if (matcherDigest(path.join(root, "src", "core")) !== freeze.matcher.sha256) mismatches.push("matcher src/core (changed)");
  if (freeze.generator && generatorDigest(root, freeze.generator.files) !== freeze.generator.sha256) mismatches.push("generator files (changed)");
  return { ok: mismatches.length === 0, mismatches };
}
