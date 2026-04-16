// src/lib/plist.ts

export interface PlistInput {
  label: string;
  nodePath: string;
  scriptPath: string;
  workingDir: string;
  times: string[]; // "HH:MM"
  stdoutPath: string;
  stderrPath: string;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseTime(t: string): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) throw new Error(`invalid time format: ${t}`);
  const h = parseInt(m[1]!, 10);
  const min = parseInt(m[2]!, 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) throw new Error(`invalid time: ${t}`);
  return { h, m: min };
}

export function generatePlist(input: PlistInput): string {
  const calendarEntries = input.times.map(t => {
    const { h, m } = parseTime(t);
    return `    <dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>${m}</integer></dict>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${escapeXml(input.label)}</string>
  <key>ProgramArguments</key><array>
    <string>${escapeXml(input.nodePath)}</string>
    <string>${escapeXml(input.scriptPath)}</string>
  </array>
  <key>WorkingDirectory</key><string>${escapeXml(input.workingDir)}</string>
  <key>StartCalendarInterval</key><array>
${calendarEntries}
  </array>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${escapeXml(input.stdoutPath)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(input.stderrPath)}</string>
</dict></plist>
`;
}
