// Pure builders for everything the sealed rig writes into the isolated HOME and
// for the explicit environment of the one Claude Code process it starts.
// Nothing here touches the disk, the network or process.env.

/** Minimal PATH of the sealed process (a fixed value). */
export const SEAL_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";

/**
 * A fixed placeholder credential. It is NOT a secret; it only makes
 * Claude Code skip its login dialog, and the local stub rejects every request
 * anyway. Joined from words so a secret scanner does not mistake it for one.
 */
export const PLACEHOLDER_AUTH = ["dummy", "token", "not", "real"].join("-");

/** Version of Claude Code the rig was built and proven against. */
export const EXPECTED_VERSION = "2.1.309";

/**
 * The baseline variables, in the order they are passed to `env -i`.
 * `home`, `port` come from the rig.
 */
export function taskEnv({ home, port }) {
  return [
    ["PATH", SEAL_PATH],
    ["HOME", home],
    ["TERM", "xterm-256color"],
    ["LANG", "en_US.UTF-8"],
    ["ANTHROPIC_BASE_URL", `http://127.0.0.1:${port}`],
    ["ANTHROPIC_AUTH_TOKEN", PLACEHOLDER_AUTH],
    ["DISABLE_TELEMETRY", "1"],
    ["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"],
    ["DISABLE_AUTOUPDATER", "1"],
  ];
}

/**
 * Variables the rig adds on top of the baseline list. Each one only CLOSES a path
 * (a download, a stray temp file); none opens anything.
 */
export function hardeningEnv({ tmpdir }) {
  return [
    // First sealed run: Claude Code fetched the official plugin marketplace
    // (about 15 MB from a Google Cloud host) despite the three switches above.
    ["CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL", "1"],
    // Keep its scratch files inside the throwaway directory.
    ["TMPDIR", tmpdir],
  ];
}

/** Full explicit environment, as ordered [key, value] pairs. */
export function sealedEnv({ home, port, tmpdir, extra = [] }) {
  return [...taskEnv({ home, port }), ...hardeningEnv({ tmpdir }), ...extra];
}

/** Names that must never appear in the sealed environment. */
export const FORBIDDEN_ENV = [
  /^AWS_/,
  /^ANTHROPIC_API_KEY$/,
  /^CLAUDE_CODE_USE_BEDROCK$/,
  /^CLAUDE_CODE_USE_VERTEX$/,
  /^GOOGLE_/,
  /^AZURE_/,
  /^OPENAI_/,
];

/** First forbidden name found in `pairs`, or null. */
export function forbiddenName(pairs) {
  const hit = pairs.find(([key]) => FORBIDDEN_ENV.some((re) => re.test(key)));
  return hit ? hit[0] : null;
}

/**
 * Keys that `buildClaudeJson` can leave out, for the ablation runs that find
 * which ones are really needed.
 */
export const DROPPABLE = [
  "theme",
  "hasCompletedOnboarding",
  "lastOnboardingVersion",
  "numStartups",
  "trust",
  "projectOnboarding",
];

/** The isolated HOME's `.claude.json`: onboarding, theme and trust, nothing else. */
export function buildClaudeJson({ cwd, drop = [] }) {
  const skip = new Set(drop);
  const project = {
    ...(skip.has("trust") ? {} : { hasTrustDialogAccepted: true }),
    ...(skip.has("projectOnboarding")
      ? {}
      : { hasCompletedProjectOnboarding: true }),
    allowedTools: [],
  };
  const top = {
    ...(skip.has("numStartups") ? {} : { numStartups: 3 }),
    ...(skip.has("hasCompletedOnboarding")
      ? {}
      : { hasCompletedOnboarding: true }),
    ...(skip.has("lastOnboardingVersion")
      ? {}
      : { lastOnboardingVersion: EXPECTED_VERSION }),
    ...(skip.has("theme") ? {} : { theme: "dark" }),
    projects: { [cwd]: project },
  };
  return `${JSON.stringify(top, null, 2)}\n`;
}

/** Renderer modes the rig can ask for. */
export const MODES = ["default", "fullscreen", "classic"];

/**
 * The isolated `~/.claude/settings.json`, or null when the mode is the
 * product's own default (then no settings file is written at all).
 */
export function buildSettings(mode) {
  if (mode === "classic") return `${JSON.stringify({ tui: "default" })}\n`;
  if (mode === "fullscreen") return `${JSON.stringify({ tui: "fullscreen" })}\n`;
  return null;
}
