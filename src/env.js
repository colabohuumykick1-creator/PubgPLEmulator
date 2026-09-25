import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(sourceDirectory, '..', '.env');

// The project .env is authoritative during local runs. This also prevents a
// stale DISCORD_TOKEN inherited from PowerShell from shadowing the saved file.
dotenv.config({
  path: envPath,
  override: true,
  quiet: true,
});

function requiredValue(environment, name) {
  const value = environment[name]?.replace(/^\uFEFF/, '').trim();

  if (!value) {
    throw new Error(`Brak zmiennej ${name}.`);
  }

  return value;
}

export function getBotConfig(environment = process.env) {
  const token = requiredValue(environment, 'DISCORD_TOKEN');
  const guildId = requiredValue(environment, 'GUILD_ID');

  if (/^Bot\s+/i.test(token)) {
    throw new Error("DISCORD_TOKEN musi zawierac sam token, bez prefiksu 'Bot '.");
  }

  if (/[\s\x00-\x1F\x7F]/.test(token)) {
    throw new Error('DISCORD_TOKEN zawiera niedozwolone biale lub sterujace znaki.');
  }

  if (/^(token|your[_ -]?token|bot[_ -]?token|wklej|paste|replace|\*+)/i.test(token)) {
    throw new Error('DISCORD_TOKEN jest placeholderem, a nie tokenem bota.');
  }

  if (!/^\d{17,20}$/.test(guildId)) {
    throw new Error('GUILD_ID musi byc numerycznym identyfikatorem serwera Discord.');
  }

  return { token, guildId };
}

