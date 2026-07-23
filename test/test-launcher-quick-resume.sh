#!/usr/bin/env bash
# Quick-resume suite driven THROUGH THE LAUNCHER (launcherctl → control socket
# → the same op queue as the UI). Identical assertions to
# ~/moonlight/test-quick-resume.sh, so 30/30 here proves the launcher path is
# equivalent to driving the scripts directly.
# Requires TWO Steam games running AND the launcher running. Usage:
#   ./test-launcher-quick-resume.sh <appidA> <appidB>
# Always ends by resuming everything.
export DISPLAY=:0 XAUTHORITY=/run/user/1000/gdm/Xauthority
CTL=/home/nerio/moonlight/launcher/bin/launcherctl
RUN=/run/user/1000
A=${1:?need appid A}; B=${2:?need appid B}
pass=0; fail=0
g=$'\033[32m'; r=$'\033[31m'; b=$'\033[1m'; z=$'\033[0m'

"$CTL" ping >/dev/null || { echo "launcher not running — start it first"; exit 2; }

tree_of(){ pstree -p "$1" 2>/dev/null | grep -oP '\(\K[0-9]+'; }

gstate(){ # RUNNING / FROZEN / MIXED / GONE for an appid
  local id=$1 root pids t=0 s=0 st
  root=$(pgrep -f "AppId=$id" 2>/dev/null | head -1); [ -z "$root" ] && { echo GONE; return; }
  pids=$(tree_of "$root")
  for p in $pids; do
    st=$(ps -o state= -p "$p" 2>/dev/null | tr -d ' ')
    [ -z "$st" ] && continue
    [ "$st" = T ] && t=$((t+1)) || s=$((s+1))
  done
  if   [ $t -gt 0 ] && [ $s -eq 0 ]; then echo FROZEN
  elif [ $t -eq 0 ] && [ $s -gt 0 ]; then echo RUNNING
  elif [ $t -eq 0 ] && [ $s -eq 0 ]; then echo GONE
  else echo "MIXED(${t}T/${s}S)"; fi
}
sstate(){ local p; p=$(pgrep -x steam | head -1); [ -z "$p" ] && { echo GONE; return; }
          [ "$(ps -o state= -p "$p"|tr -d ' ')" = T ] && echo FROZEN || echo RUNNING; }
parked(){ ls "$RUN"/sunshine-susp-*.pids 2>/dev/null | grep -vc 'susp-steam'; }

chk(){ # chk "label" actual expected
  if [ "$2" = "$3" ]; then printf "  ${g}PASS${z}  %-46s %s\n" "$1" "$2"; pass=$((pass+1))
  else printf "  ${r}FAIL${z}  %-46s got=%s want=%s\n" "$1" "$2" "$3"; fail=$((fail+1)); fi
}

printf "${b}=== setup: resume everything, confirm both games running ===${z}\n"
"$CTL" resume-all >/dev/null 2>&1; sleep 2
chk "A running at start"        "$(gstate $A)" RUNNING
chk "B running at start"        "$(gstate $B)" RUNNING
chk "steam running at start"    "$(sstate)"    RUNNING
chk "nothing parked at start"   "$(parked)"    0

printf "\n${b}=== T1: suspend A -> A frozen, B UNTOUCHED, steam frozen ===${z}\n"
"$CTL" suspend $A >/dev/null; sleep 2
chk "A frozen"                  "$(gstate $A)" FROZEN
chk "B still running (KEY)"     "$(gstate $B)" RUNNING
chk "steam frozen"              "$(sstate)"    FROZEN
chk "1 game parked"             "$(parked)"    1

printf "\n${b}=== T2: suspend B too -> both parked ===${z}\n"
"$CTL" suspend $B >/dev/null; sleep 2
chk "A frozen"                  "$(gstate $A)" FROZEN
chk "B frozen"                  "$(gstate $B)" FROZEN
chk "2 games parked"            "$(parked)"    2

printf "\n${b}=== T3: resume A -> A runs, B STAYS PARKED (quick resume) ===${z}\n"
"$CTL" resume $A >/dev/null; sleep 2
chk "A running"                 "$(gstate $A)" RUNNING
chk "B STILL frozen (KEY)"      "$(gstate $B)" FROZEN
chk "steam resumed"             "$(sstate)"    RUNNING
chk "1 game still parked"       "$(parked)"    1

printf "\n${b}=== T4: resume B -> everything running, nothing parked ===${z}\n"
"$CTL" resume $B >/dev/null; sleep 2
chk "A running"                 "$(gstate $A)" RUNNING
chk "B running"                 "$(gstate $B)" RUNNING
chk "nothing parked"            "$(parked)"    0

printf "\n${b}=== T5: double-suspend A is idempotent (no strand) ===${z}\n"
"$CTL" suspend $A >/dev/null; "$CTL" suspend $A >/dev/null; sleep 2
chk "A frozen"                  "$(gstate $A)" FROZEN
chk "still only 1 parked"       "$(parked)"    1
"$CTL" resume $A >/dev/null; sleep 2
chk "A resumed cleanly"         "$(gstate $A)" RUNNING
chk "nothing parked"            "$(parked)"    0

printf "\n${b}=== T6: no-arg resume revives the LAST parked game ===${z}\n"
"$CTL" suspend $B >/dev/null; sleep 2
chk "B parked"                  "$(gstate $B)" FROZEN
"$CTL" resume >/dev/null; sleep 2      # no appid
chk "B revived by no-arg resume" "$(gstate $B)" RUNNING
chk "nothing parked"            "$(parked)"    0

printf "\n${b}=== T7: resume-all rescues everything ===${z}\n"
"$CTL" suspend $A >/dev/null; "$CTL" suspend $B >/dev/null; sleep 2
chk "2 parked"                  "$(parked)"    2
"$CTL" resume-all >/dev/null; sleep 2
chk "A running"                 "$(gstate $A)" RUNNING
chk "B running"                 "$(gstate $B)" RUNNING
chk "steam running"             "$(sstate)"    RUNNING
chk "nothing parked"            "$(parked)"    0

printf "\n${b}=== cleanup ===${z}\n"; "$CTL" resume-all >/dev/null 2>&1
printf "\n${b}RESULT: ${g}%d passed${z}, ${r}%d failed${z}\n" "$pass" "$fail"
exit $((fail > 0))
