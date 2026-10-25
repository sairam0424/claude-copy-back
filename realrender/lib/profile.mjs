// Terminal profiles of the sealed rig. Claude Code draws a markdown link and
// struck text differently depending on the terminal it believes it runs in, and
// it decides from the environment. A static read of the installed 2.1.310
// binary (the strings, nothing executed) shows it keys on TERM_PROGRAM alone for
// Warp: "WarpTerminal" is in its hyperlink list (a link is then drawn as its label
// only, as an OSC 8 hyperlink) and in its strikethrough list (struck text is then
// drawn with the SGR attribute and no tildes). It reads no WARP_* variable.
// COLORTERM only sets the colour depth and TERM_PROGRAM_VERSION is read for other
// terminals; both are added because a real Warp session carries them.
//
//   default  nothing is added: no TERM_PROGRAM, as in every earlier pass.
//   warp     TERM_PROGRAM=WarpTerminal, a plausible TERM_PROGRAM_VERSION, COLORTERM=truecolor.
//
// Every sealing control is untouched: the profile only NAMES a terminal. The
// pairs go through the same `extra` slot of sealedEnv() as any experiment.

export const PROFILES = Object.freeze(["default", "warp"]);

/** A Warp stable-channel version string, as its own environment writes it (a version, not an identifier). */
export const WARP_TERM_PROGRAM_VERSION = "v0.2026.10.21.08.25.stable_02";

const ADDED = Object.freeze({
  default: Object.freeze([]),
  warp: Object.freeze([
    Object.freeze(["TERM_PROGRAM", "WarpTerminal"]),
    Object.freeze(["TERM_PROGRAM_VERSION", WARP_TERM_PROGRAM_VERSION]),
    Object.freeze(["COLORTERM", "truecolor"]),
  ]),
});

/** The profile named by a command line value; no value means "default". */
export function parseProfile(value) {
  const name = value ?? "default";
  if (!PROFILES.includes(name)) throw new Error(`unknown profile "${name}" (use ${PROFILES.join(" or ")})`);
  return name;
}

/** The environment pairs a profile adds to the sealed set, in order (fresh arrays). */
export function profileEnv(profile) {
  return ADDED[parseProfile(profile)].map(([key, value]) => [key, value]);
}

/** What every evidence file records about the terminal profile of its launch. */
export function profileRecord(profile) {
  const name = parseProfile(profile);
  return { profile: name, added: profileEnv(name).map(([key, value]) => `${key}=${value}`) };
}
