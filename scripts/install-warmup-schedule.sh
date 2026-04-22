#!/bin/zsh
# scripts/install-warmup-schedule.sh
#
# Installs a launchd job that runs `npm run warmup` 3 times a day at
# scattered hours. Uses your local npm + node setup. Logs to
# logs/warmup-launchd.log.
#
# Usage:
#   ./scripts/install-warmup-schedule.sh         # install
#   ./scripts/install-warmup-schedule.sh remove  # uninstall
#
# After install, you can verify with:
#   launchctl list | grep tiktokwarmup

set -e
PROJECT_DIR=$(cd "$(dirname "$0")/.." && pwd)
PLIST_LABEL="com.user.tiktokwarmup"
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

# Build the plist. 3 fires per day at varying hours. Each fire runs
# warmup with a different `--tab`/`--search` to vary the activity
# pattern. Wrapped in a shell so we can rotate session types.
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
    <string>cd '$PROJECT_DIR' && '$NPM_BIN' run warmup -- --minutes=20 >> '$LOG_DIR/warmup-launchd.log' 2>&1</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict>
      <key>Hour</key><integer>10</integer>
      <key>Minute</key><integer>23</integer>
    </dict>
    <dict>
      <key>Hour</key><integer>14</integer>
      <key>Minute</key><integer>47</integer>
    </dict>
    <dict>
      <key>Hour</key><integer>20</integer>
      <key>Minute</key><integer>11</integer>
    </dict>
  </array>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/warmup-launchd.out</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/warmup-launchd.err</string>
</dict>
</plist>
EOF

# Load it
launchctl bootout "gui/$UID/$PLIST_LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST_PATH"
echo "Installed $PLIST_LABEL — runs warmup at 10:23, 14:47, 20:11 daily"
echo "Logs: $LOG_DIR/warmup-launchd.log"
echo "To remove: $0 remove"
