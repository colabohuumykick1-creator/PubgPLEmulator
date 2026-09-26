import assert from 'node:assert/strict';
import test from 'node:test';
import { commandData } from '../src/commands.js';

test('nazwy komend slash są unikalne', () => {
  const names = commandData.map((command) => command.name);
  assert.equal(new Set(names).size, names.length);
});

test('komenda /test jest dostępna do kontroli Rendera', () => {
  const command = commandData.find((item) => item.name === 'test');

  assert.ok(command);
  assert.match(command.description, /Render/);
  assert.equal(command.dm_permission, false);
});
