#!/usr/bin/env bash
# Deterministic Tailwind-palette → semantic-token rewriter.
# Applies the rules from the repo-wide visual-system refactor plan.
# Usage: scripts/refactor-palette.sh <file> [...files]
#
# Mapping:
#   slate → sand (bg/border/ring/divide) or text-* (ink)
#   indigo → ocean (brand)
#   emerald / green → status-good
#   amber  / orange → status-warn
#   rose   / red    → status-bad
#   violet / purple → status-wait
#   sky    / blue   → status-info

set -e

for f in "$@"; do
  [ -f "$f" ] || continue
  sed -i -E \
    -e 's/\bbg-slate-([0-9]+)\b/bg-sand-\1/g' \
    -e 's/\bborder-slate-([0-9]+)\b/border-sand-\1/g' \
    -e 's/\bborder-(l|r|t|b|x|y)-slate-([0-9]+)\b/border-\1-sand-\2/g' \
    -e 's/\bring-slate-([0-9]+)\b/ring-sand-\1/g' \
    -e 's/\bdivide-slate-([0-9]+)\b/divide-sand-\1/g' \
    -e 's/\bfrom-slate-([0-9]+)\b/from-sand-\1/g' \
    -e 's/\bto-slate-([0-9]+)\b/to-sand-\1/g' \
    -e 's/\bvia-slate-([0-9]+)\b/via-sand-\1/g' \
    -e 's/\bborder-(l|r|t|b|x|y)-indigo-([0-9]+)\b/border-\1-ocean-\2/g' \
    -e 's/\bborder-(l|r|t|b|x|y)-emerald-([0-9]+)\b/border-\1-status-good-\2/g' \
    -e 's/\bborder-(l|r|t|b|x|y)-green-([0-9]+)\b/border-\1-status-good-\2/g' \
    -e 's/\bborder-(l|r|t|b|x|y)-amber-([0-9]+)\b/border-\1-status-warn-\2/g' \
    -e 's/\bborder-(l|r|t|b|x|y)-orange-([0-9]+)\b/border-\1-status-warn-\2/g' \
    -e 's/\bborder-(l|r|t|b|x|y)-rose-([0-9]+)\b/border-\1-status-bad-\2/g' \
    -e 's/\bborder-(l|r|t|b|x|y)-red-([0-9]+)\b/border-\1-status-bad-\2/g' \
    -e 's/\bborder-(l|r|t|b|x|y)-violet-([0-9]+)\b/border-\1-status-wait-\2/g' \
    -e 's/\bborder-(l|r|t|b|x|y)-purple-([0-9]+)\b/border-\1-status-wait-\2/g' \
    -e 's/\bborder-(l|r|t|b|x|y)-sky-([0-9]+)\b/border-\1-status-info-\2/g' \
    -e 's/\bborder-(l|r|t|b|x|y)-blue-([0-9]+)\b/border-\1-status-info-\2/g' \
    -e 's/\btext-slate-100\b/text-text-muted/g' \
    -e 's/\btext-slate-200\b/text-text-muted/g' \
    -e 's/\btext-slate-300\b/text-text-muted/g' \
    -e 's/\btext-slate-400\b/text-text-muted/g' \
    -e 's/\btext-slate-500\b/text-text-secondary/g' \
    -e 's/\btext-slate-600\b/text-text-secondary/g' \
    -e 's/\btext-slate-700\b/text-text-secondary/g' \
    -e 's/\btext-slate-800\b/text-text-primary/g' \
    -e 's/\btext-slate-900\b/text-text-primary/g' \
    -e 's/\b(bg|text|border|ring|from|to|via)-indigo-([0-9]+)\b/\1-ocean-\2/g' \
    -e 's/\b(bg|text|border|ring|from|to|via)-emerald-([0-9]+)\b/\1-status-good-\2/g' \
    -e 's/\b(bg|text|border|ring|from|to|via)-green-([0-9]+)\b/\1-status-good-\2/g' \
    -e 's/\b(bg|text|border|ring|from|to|via)-amber-([0-9]+)\b/\1-status-warn-\2/g' \
    -e 's/\b(bg|text|border|ring|from|to|via)-orange-([0-9]+)\b/\1-status-warn-\2/g' \
    -e 's/\b(bg|text|border|ring|from|to|via)-rose-([0-9]+)\b/\1-status-bad-\2/g' \
    -e 's/\b(bg|text|border|ring|from|to|via)-red-([0-9]+)\b/\1-status-bad-\2/g' \
    -e 's/\b(bg|text|border|ring|from|to|via)-violet-([0-9]+)\b/\1-status-wait-\2/g' \
    -e 's/\b(bg|text|border|ring|from|to|via)-purple-([0-9]+)\b/\1-status-wait-\2/g' \
    -e 's/\b(bg|text|border|ring|from|to|via)-sky-([0-9]+)\b/\1-status-info-\2/g' \
    -e 's/\b(bg|text|border|ring|from|to|via)-blue-([0-9]+)\b/\1-status-info-\2/g' \
    -e 's/\bshadow-slate-([0-9]+)\b/shadow-sand-\1/g' \
    -e 's/\bshadow-indigo-([0-9]+)\b/shadow-ocean-\1/g' \
    -e 's/\bshadow-emerald-([0-9]+)\b/shadow-status-good-\1/g' \
    -e 's/\bshadow-green-([0-9]+)\b/shadow-status-good-\1/g' \
    -e 's/\bshadow-amber-([0-9]+)\b/shadow-status-warn-\1/g' \
    -e 's/\bshadow-orange-([0-9]+)\b/shadow-status-warn-\1/g' \
    -e 's/\bshadow-rose-([0-9]+)\b/shadow-status-bad-\1/g' \
    -e 's/\bshadow-red-([0-9]+)\b/shadow-status-bad-\1/g' \
    -e 's/\bshadow-violet-([0-9]+)\b/shadow-status-wait-\1/g' \
    -e 's/\bshadow-purple-([0-9]+)\b/shadow-status-wait-\1/g' \
    -e 's/\bshadow-sky-([0-9]+)\b/shadow-status-info-\1/g' \
    -e 's/\bshadow-blue-([0-9]+)\b/shadow-status-info-\1/g' \
    -e 's/\bfont-black\b/font-semibold/g' \
    "$f"
done
