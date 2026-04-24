#!/bin/zsh
# scripts/install-post-schedule.sh
#
# Installs a launchd job that runs `npm run post` 4 times per hour
# (at :00, :15, :30, :45) between 7am and 11:45pm local time.
# That's 4 × 17 = 68 posts per day.
#
# Use `--no-jitter` is implicit via env; the plist invokes node with
# that flag directly.
#
# Usage:
#   ./scripts/install-post-schedule.sh         # install
#   ./scripts/install-post-schedule.sh remove  # uninstall
#
# Verify after install:
#   launchctl list | grep tiktokpost
#   # or tail the run log:
#   tail -f logs/runs.jsonl | jq -c .

set -e
PROJECT_DIR=$(cd "$(dirname "$0")/.." && pwd)
PLIST_LABEL="com.user.tiktokpost"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
NODE_BIN=$(which node)
NPM_BIN=$(which npm)
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"

if [[ "$1" == "remove" ]]; then
  if [[ -f "$PLIST_PATH" ]]; then
    launchctl bootout "gui/$UID/$PLIST_LABEL" 2>/dev/null || true
    rm -f "$PLIST_PATH"
    echo "Removed $PLIST_LABEL"
  else
    echo "$PLIST_LABEL not installed"
  fi
  exit 0
fi

# Build 68 StartCalendarInterval entries: hours 7-23, minutes 0/15/30/45
SLOTS=""
for H in 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23; do
  for M in 0 15 30 45; do
    SLOTS+="    <dict>
      <key>Hour</key><integer>${H}</integer>
      <key>Minute</key><integer>${M}</integer>
    </dict>
"
  done
done

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-c</string>
    <string>cd '$PROJECT_DIR' &amp;&amp; pkill -f 'Chrome.*browser-data' 2>/dev/null; sleep 1; rm -f '$PROJECT_DIR/browser-data/SingletonLock' '$PROJECT_DIR/browser-data/SingletonCookie' '$PROJECT_DIR/browser-data/SingletonSocket' 2>/dev/null; '$NPM_BIN' run post -- --no-jitter >> '$LOG_DIR/post-launchd.log' 2>&amp;1</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
${SLOTS}  </array>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/post-launchd.out</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/post-launchd.err</string>
</dict>
</plist>
EOF

# Replace any prior install and bootstrap
launchctl bootout "gui/$UID/$PLIST_LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST_PATH"

SLOT_COUNT=$(grep -c "<integer>" "$PLIST_PATH")
# Each slot has 2 integers (Hour + Minute) so divide by 2
SLOT_COUNT=$((SLOT_COUNT / 2))

echo "Installed $PLIST_LABEL"
echo "  slots: $SLOT_COUNT (4 × 17 hours, 7:00am through 11:45pm)"
echo "  plist: $PLIST_PATH"
echo "  logs: $LOG_DIR/post-launchd.log"
echo ""
echo "To pause: launchctl bootout gui/$UID/$PLIST_LABEL"
echo "To remove permanently: $0 remove"
