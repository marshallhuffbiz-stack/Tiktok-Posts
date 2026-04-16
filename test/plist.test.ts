// test/plist.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlist } from '../src/lib/plist.ts';

test('generatePlist produces valid xml with expected entries', () => {
  const xml = generatePlist({
    label: 'com.user.tiktokpost',
    nodePath: '/usr/local/bin/node',
    scriptPath: '/Users/me/proj/dist/post.js',
    workingDir: '/Users/me/proj',
    times: ['08:17', '14:11'],
    stdoutPath: '/Users/me/proj/logs/launchd.out.log',
    stderrPath: '/Users/me/proj/logs/launchd.err.log',
  });
  assert.match(xml, /<\?xml version="1\.0"/);
  assert.match(xml, /<key>Label<\/key><string>com\.user\.tiktokpost<\/string>/);
  assert.match(xml, /<string>\/usr\/local\/bin\/node<\/string>/);
  assert.match(xml, /<key>Hour<\/key><integer>8<\/integer><key>Minute<\/key><integer>17<\/integer>/);
  assert.match(xml, /<key>Hour<\/key><integer>14<\/integer><key>Minute<\/key><integer>11<\/integer>/);
  assert.match(xml, /<key>RunAtLoad<\/key><false\/>/);
});

test('generatePlist throws on bad time format', () => {
  assert.throws(() => generatePlist({
    label: 'x', nodePath: '/n', scriptPath: '/s', workingDir: '/w',
    times: ['not-a-time'], stdoutPath: '/o', stderrPath: '/e',
  }), /invalid time/i);
});
