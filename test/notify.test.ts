// test/notify.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _internals, notify } from '../src/lib/notify.ts';

test('notify invokes osascript with display notification command', async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  _internals.spawn = (cmd, args) => {
    calls.push({ cmd, args });
    return {
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') setImmediate(() => cb(0));
      },
    } as never;
  };
  await notify('Test Title', 'Test body', 'Basso');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.cmd, 'osascript');
  const script = calls[0]!.args[1]!;
  assert.match(script, /display notification "Test body"/);
  assert.match(script, /with title "Test Title"/);
  assert.match(script, /sound name "Basso"/);
});

test('notify escapes double quotes in body and title', async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  _internals.spawn = (cmd, args) => {
    calls.push({ cmd, args });
    return {
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') setImmediate(() => cb(0));
      },
    } as never;
  };
  await notify('Title with "quote"', 'Body with "quote" too');
  const script = calls[0]!.args[1]!;
  assert.match(script, /Title with \\"quote\\"/);
  assert.match(script, /Body with \\"quote\\" too/);
});
