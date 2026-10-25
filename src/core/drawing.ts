// How Claude Code draws the two inline constructs whose drawing depends on the
// terminal it believes it runs in. It decides from TERM_PROGRAM (and a few
// other variables), read from the installed binary and seen on sealed-rig
// screens of both profiles (realrender/lib/profile.mjs):
//
//   links    "url"    [label](dest) is drawn "label (dest)": a terminal with no hyperlink support
//            "label"  [label](dest) is drawn "label": an OSC 8 hyperlink (Warp, iTerm, kitty, ...)
//            A link with a title, a mailto link and an image show their destination either way.
//   strike   "tilde"  ~~text~~ is drawn as typed, tildes included
//            "plain"  ~~text~~ is drawn as "text", struck with a text attribute (Warp, iTerm, ...)
//
// Warp is { links: "label", strike: "plain" }; a terminal without TERM_PROGRAM is
// the default. The two settings are independent in the binary (a terminal can be
// in one list and not the other), so the matcher allows all four combinations.

export interface Drawing {
  readonly links: "url" | "label";
  readonly strike: "tilde" | "plain";
}

/** The rig's profile without TERM_PROGRAM, and what the simulator draws unless told otherwise. */
export const DEFAULT_DRAWING: Drawing = Object.freeze({ links: "url", strike: "tilde" });

/** The rig's warp profile (TERM_PROGRAM=WarpTerminal). */
export const WARP_DRAWING: Drawing = Object.freeze({ links: "label", strike: "plain" });

const LINK_SYNTAX = "](";
const STRIKE_SYNTAX = "~~";

/**
 * The drawings under which `source` can look different, the default first. A
 * source with no link syntax draws the same whatever the link setting; one
 * with no double tilde draws the same whatever the strike setting. Most
 * messages need one drawing.
 */
export function drawingsFor(source: string): Drawing[] {
  const links: Array<Drawing["links"]> = source.includes(LINK_SYNTAX) ? ["url", "label"] : ["url"];
  const strikes: Array<Drawing["strike"]> = source.includes(STRIKE_SYNTAX) ? ["tilde", "plain"] : ["tilde"];
  const out: Drawing[] = [];
  for (const l of links) for (const s of strikes) out.push(l === "url" && s === "tilde" ? DEFAULT_DRAWING : Object.freeze({ links: l, strike: s }));
  return out;
}
