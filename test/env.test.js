import assert from 'node:assert/strict';
import test from 'node:test';
import { getBotConfig } from '../src/env.js';

const validToken = 'part_one.part_two.part_three';
const validGuildId = '1476865931429810197';

test('konfiguracja przycina wartosci z .env', () => {
  assert.deepEqual(
    getBotConfig({
      DISCORD_TOKEN: `  ${validToken}  `,
      GUILD_ID: `  ${validGuildId}  `,
    }),
    {
      token: validToken,
      guildId: validGuildId,
    },
  );
});

test('konfiguracja odrzuca prefiks Bot', () => {
  assert.throws(
    () => getBotConfig({
      DISCORD_TOKEN: `Bot ${validToken}`,
      GUILD_ID: validGuildId,
    }),
    /bez prefiksu/,
  );
});

test('konfiguracja odrzuca placeholder tokenu', () => {
  assert.throws(
    () => getBotConfig({
      DISCORD_TOKEN: 'replace_with_fresh_bot_token',
      GUILD_ID: validGuildId,
    }),
    /placeholderem/,
  );
});

test('konfiguracja odrzuca nieprawidlowy identyfikator serwera', () => {
  assert.throws(
    () => getBotConfig({
      DISCORD_TOKEN: validToken,
      GUILD_ID: 'server',
    }),
    /GUILD_ID/,
  );
});

