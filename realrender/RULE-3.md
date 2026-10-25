# Rule 3: the Warp-fidelity holdout rule (pre-registered)

Written before any family C screen was captured. The numbers are in code (`lib/rule3.mjs`, pinned by `tests/rule3.test.mjs`); this page says what they mean. The sha256 of both files, and the time they were hashed, were recorded in `WARP-RULE-HASH.txt` before the first capture. A rule is never edited after data exists: if it turns out to be wrong, say so in the report and write rule 4.

## What it judges

One terminal profile's HOLDOUT: a fresh synthetic window of 40 assistant replies from template family C (`lib/templates-c.mjs`), shown in the real Claude Code through the sealed rig at 60, 80, 100 and 120 columns, with copies cut from the real screen by a model of a terminal selection and given to the frozen matcher. It is applied twice, to the `warp` profile (the rig adds `TERM_PROGRAM=WarpTerminal`, a Warp version string and `COLORTERM=truecolor`) and to the `default` profile (the rig adds nothing). **WARP PASS needs both holdouts to pass.**

The classic renderer is used. The fullscreen renderer was compared with it once on a calibration window (the report says what that showed); it is not part of the rule.

## The conditions

For each profile, on the main variant (trailing blanks trimmed):

1. **Size.** At least 120 captures, and at least 25 for each of the four widths. Less is INCONCLUSIVE, not a failure.
2. **Exact.** At least 95 percent of all captures are exact (integer test: `exact * 100 >= total * 95`).
3. **Every class.** Every construct class that has at least 10 captures has at least 80 percent exact. A capture counts in its anchor class (`anchor:para`, `anchor:ul`, ... the construct its first token sits in) and in each inline feature class its source range touches (`feature:link`, `feature:reflink`, `feature:autolink`, `feature:strike`, `feature:bold`, `feature:italic`, `feature:code`). Links and strike are therefore reported, and ruled on, as classes of their own.
4. **No wrong slice.** Zero captures where the matcher answered with text that is not the intended slice.
5. **No false positive.** Zero positive answers on the two negative controls: the window with the capture's message removed, and the window with that message replaced by its twin (same words, every token's digits shifted). In family C a message can also have an in-window markup twin, so the first control keeps a near-duplicate of the message in the window.
6. **Matched and right.** At least 10 exact captures.
7. **Padded.** Conditions 2 to 6 hold again on the padded variant (the same selections with trailing blanks kept up to the screen width).

A holdout is INCONCLUSIVE (no verdict on the matcher) if: the set was captured under another profile than the one being judged; its seed is a calibration seed; the matcher that scored it is not the one in the freeze record made before the capture; the rig could not draw the session at some width (fewer than 90 percent of the tokens found exactly once on screen); or a launch was not sealed (a non-local socket, or a request that reached the stub).

## Definitions (the scorer's, unchanged from the earlier step)

| Term | Meaning |
|---|---|
| capture | one (message, intended token span, terminal width) with the text a terminal selection yields from the real screen |
| exact | the matcher returned a result, its `source` equals the generator's expected slice (trimmed) and its `paste` is one of the expected paste forms |
| wrong slice | a result that is not exact |
| refusal | `no-match`, `ambiguous`, `too-short` or `empty`: not a failure of safety, but it does not count as exact |

The expected slice and the paste forms come from the generator alone (`lib/spans.mjs`); nothing in the ground truth imports the matcher. The matcher is imported by `lib/evaluate.mjs` only.

## Seeds and the order of work

| Role | Warp profile | Default profile |
|---|---|---|
| calibration | 4101 | 4103 |
| holdout | 5202 | 5303 |

More calibration seeds may be used (4102 and 4104 are reserved), and the matcher may be changed after calibration. Then it is frozen (`node realrender/freeze.mjs --out freeze.json --profile ...`: the matcher digest, the rule files, the generator, the plugin tree, each with its recipe in the file), the holdouts are captured, and each is scored once with `node realrender/measure.mjs --set DIR --role holdout --seed N --per-width 60 --rule 3 --profile P --freeze freeze.json`. The scorer refuses to score a holdout twice. If a holdout has to be thrown away, the scorer is run with `--discard "reason"`, the reason is stated in the report, and a new holdout with a new seed is captured; the number of discards is part of the result.

## What passing does not show

- How Warp selects and copies. The copied text is the screen's rows cut by column, joined with a hard newline; the rig never sees a real terminal's clipboard.
- Real replies. Family C is synthetic and tidier than a real session in ways that matter (no tool output, no diffs, no tables, no hard line breaks, no images, no HTML).
- True ambiguity. Every capture holds a full unique token, so two messages never carry the same copy; the proxy cannot tell a refusal that was right from one that was lazy. The unit tests carry that.
- Other Claude Code versions, the fullscreen renderer, other terminals.
