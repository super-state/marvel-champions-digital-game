#!/usr/bin/env bash
# What does a pack use in its card scripts that no pack already on the 3D table uses? Each line printed is a mechanic
# the table has never had to show: the list the new-content skill starts its design pass from.
#   bash .claude/skills/new-content/new-mechanics.sh packages/cards/src/wave1/gob
#   bash .claude/skills/new-content/new-mechanics.sh packages/cards/src/wave1/gob packages/cards/src/core
# With one folder, "already on the table" is audited-packs.txt beside this script (one folder per line; add a pack to
# it when its pass is finished). Further folders replace that list: Green Goblin against Core alone prints flipCard,
# stateCheck, cannotChangeForm, cannotReady, repeatWhenRevealed, dealIndirectDamage, discardEncounterCards and more.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
pack="${1:?give the card-script folder of the pack, for example packages/cards/src/wave1/gob}"
shift
words() {
  grep -rhoE "(kind|on|trigger|until|zone|status|keyword): \"[a-zA-Z_]+\"" "$@" --include=*.ts \
    --exclude=*.test.ts --exclude=testing.ts 2>/dev/null | sort -u || true
}
known="$(mktemp)"
new="$(mktemp)"
: > "$known"
if [ "$#" -gt 0 ]; then
  against=("$@")
else
  mapfile -t against < <(grep -vE "^(#|\s*$)" "$here/audited-packs.txt")
fi
for dir in "${against[@]}"; do
  dir="${dir%$'\r'}"
  [ "$root/$dir" -ef "$root/$pack" ] && continue
  words "$root/$dir" >> "$known"
done
sort -u "$known" -o "$known"
words "$root/$pack" > "$new"
echo "Used by $pack and by none of: ${against[*]}"
comm -13 "$known" "$new" | while read -r line; do
  word="$(echo "$line" | sed -E "s/.*\"(.*)\"/\1/")"
  files="$(grep -rlE "\"$word\"|\b$word\(" "$root/$pack" --include=*.ts --exclude=*.test.ts | xargs -r -n1 basename | tr "\n" " ")"
  echo "  $line   ($files)"
done
echo
echo "Also read the data of the pack (packages/content/src/data/<pack>/cards.ts) for a card type, a keyword, a"
echo "counter name or a flipSide that the audited packs do not have: those never show up in the scripts."
