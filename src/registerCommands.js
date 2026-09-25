import { REST, Routes } from 'discord.js';
import { commandData } from './commands.js';
import { getBotConfig } from './env.js';

const { token, guildId } = getBotConfig();

try {
  const rest = new REST({ version: '10' }).setToken(token);
  const application = await rest.get(Routes.oauth2CurrentApplication());
  const registered = await rest.put(
    Routes.applicationGuildCommands(application.id, guildId),
    { body: commandData },
  );

  console.log(
    `Zarejestrowano komendy na serwerze ${guildId}: ${registered
      .map((command) => `/${command.name}`)
      .join(', ')}`,
  );
} catch (error) {
  console.error('Nie udało się zarejestrować komend:', error);
  process.exit(1);
}
