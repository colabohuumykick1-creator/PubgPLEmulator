import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyBotToken } from '../src/discordAuth.js';

test('weryfikacja akceptuje konto bota', async () => {
  const user = await verifyBotToken('secret', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: '123', bot: true }),
  }));

  assert.equal(user.id, '123');
});

test('weryfikacja zamienia 401 na bezpieczny komunikat', async () => {
  await assert.rejects(
    verifyBotToken('secret', async () => ({ ok: false, status: 401 })),
    /setup-env\.ps1/,
  );
});

test('weryfikacja nie blokuje startu przy chwilowym limicie Discord API', async () => {
  const result = await verifyBotToken('secret', async () => ({
    ok: false,
    status: 429,
  }));

  assert.equal(result, null);
});
