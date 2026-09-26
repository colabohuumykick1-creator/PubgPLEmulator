import {
  ActivityType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';

import { BRAND } from './config.js';
import { commandData } from './commands.js';
import { sendEmbedCommand } from './embedCommand.js';
import { getBotConfig } from './env.js';
import { useSingleShardGateway } from './gateway.js';
import { startHealthServer } from './healthServer.js';
import { setupGuild, toggleSelfRole, verifyMember } from './setupGuild.js';

const { token, guildId } = getBotConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
  ],
  shards: [0],
  shardCount: 1,
});

useSingleShardGateway(client.rest);

const healthServer = startHealthServer(client);

let setupRunning = false;

async function checkDiscordApiConnection() {
  const startedAt = Date.now();

  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        Authorization: `Bot ${token}`,
      },
      signal: AbortSignal.timeout(5_000),
    });

    console.log(
      `[DISCORD API] status=${response.status} latency=${Date.now() - startedAt}ms`,
    );
  } catch (error) {
    console.error(
      `[DISCORD API] brak odpowiedzi po ${Date.now() - startedAt}ms: ${error.message}`,
    );
  }
}

async function runSetup(guild, progress = () => {}) {
  if (setupRunning) {
    throw new Error(
      'Konfiguracja jest już uruchomiona. Poczekaj na jej zakończenie.',
    );
  }

  setupRunning = true;

  try {
    return await setupGuild(guild, progress);
  } finally {
    setupRunning = false;
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log('======================================');
  console.log(`Discord: zalogowano jako ${readyClient.user.tag}`);
  console.log(`Bot ID: ${readyClient.user.id}`);
  console.log('======================================');

  readyClient.user.setPresence({
    activities: [
      {
        name: 'PUBG Mobile • GameLoop • PL',
        type: ActivityType.Watching,
      },
    ],
    status: 'online',
  });

  try {
    const guild = readyClient.guilds.cache.get(guildId);

    if (!guild) {
      throw new Error(`Bot nie znajduje się na skonfigurowanym serwerze ${guildId}.`);
    }

    console.log(`Połączono z serwerem: ${guild.name} (${guild.id})`);
    console.log(`Załadowano ${commandData.length} komendy slash.`);
    console.log('Bot PubgPLEMULATOR jest gotowy (ClientReady).');
    void checkDiscordApiConnection();
  } catch (error) {
    console.error(
      'Bot zalogował się do Discorda, ale wystąpił problem z serwerem:',
      error,
    );
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  console.log(
    '[INTERACTION] command=' +
      (interaction.commandName ?? '-') +
      ' guild=' +
      (interaction.guildId ?? '-'),
  );
  try {
    if (
      interaction.isButton() &&
      interaction.customId.startsWith('emuplcoom-verify:')
    ) {
      if (interaction.guildId !== guildId) {
        await interaction.reply({
          content: 'Ten bot jest skonfigurowany dla innego serwera.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await verifyMember(interaction);
      return;
    }

    if (
      interaction.isButton() &&
      interaction.customId.startsWith('emuplcoom-role:')
    ) {
      await toggleSelfRole(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.guildId !== guildId) {
      await interaction.reply({
        content:
          'Ten bot jest skonfigurowany dla innego serwera.',
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    if (interaction.commandName === 'setup') {
      console.log('[SETUP] handler rozpoczęty');
      console.log(
        '[SETUP] administrator=' +
          Boolean(
            interaction.memberPermissions?.has(
              PermissionFlagsBits.Administrator,
            ),
          ),
      );
      if (
        !interaction.memberPermissions?.has(
          PermissionFlagsBits.Administrator,
        )
      ) {
        await interaction.reply({
          content:
            'Tej komendy może użyć tylko administrator.',
          flags: MessageFlags.Ephemeral,
        });

        return;
      }

      console.log('[SETUP] przed deferReply');

      await interaction.deferReply({
        flags: MessageFlags.Ephemeral,
      });

      console.log('[SETUP] deferReply OK');

      const report = await runSetup(
        interaction.guild,
        (message) => console.log(message),
      );

      const warningText = report.warnings.length
        ? `\n\n**Ostrzeżenia:**\n${report.warnings
            .map((item) => `• ${item}`)
            .join('\n')}`
        : '';

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(BRAND.color)
            .setTitle(
              'PubgPLEMULATOR • konfiguracja zakończona ✅',
            )
            .setDescription(
              `Utworzono: **${report.created.length}**\n` +
                `Zaktualizowano: **${report.updated.length}**` +
                warningText,
            )
            .setFooter({
              text: BRAND.footer,
            })
            .setTimestamp(),
        ],
      });

      return;
    }

    if (interaction.commandName === 'test') {
      await interaction.reply({
        content:
          '✅ Bot działa poprawnie przez Render.\n' +
          `Discord Gateway: połączony (${Math.max(0, Math.round(client.ws.ping))} ms).`,
        flags: MessageFlags.Ephemeral,
      });

      console.log('[TEST] Komenda /test zakończona powodzeniem.');
      return;
    }

    if (
      interaction.commandName === 'emuplcoom' ||
      interaction.commandName === 'pubgplemulator'
    ) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(BRAND.accentColor)
            .setTitle('PubgPLEMULATOR 🎮')
            .setDescription(
              'Bot społeczności **PUBG Mobile PL Emulator Center**.\n\n' +
                'Obsługuje konfigurację serwera, role, wiadomości i narzędzia administracyjne.',
            )
            .addFields(
              {
                name: 'Status',
                value: '🟢 Online',
                inline: true,
              },
              {
                name: 'Wersja',
                value: '1.0.0',
                inline: true,
              },
            )
            .setFooter({
              text: BRAND.footer,
            }),
        ],
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    if (interaction.commandName === 'embed') {
      await sendEmbedCommand(interaction);
    }
  } catch (error) {
    console.error('Błąd interakcji:', error);

    const message =
      `Nie udało się wykonać operacji: ${error.message}`;

    if (
      interaction.deferred ||
      interaction.replied
    ) {
      await interaction
        .editReply({
          content: message,
          embeds: [],
          components: [],
        })
        .catch(() => {});
    } else {
      await interaction
        .reply({
          content: message,
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
  }
});

client.on(Events.Error, (error) => {
  console.error(
    'Błąd klienta Discord:',
    error,
  );
});

client.on(Events.Warn, (warning) => {
  console.warn(
    'Ostrzeżenie Discord:',
    warning,
  );
});

client.on(Events.ShardDisconnect, (event, shardId) => {
  console.warn(
    `Discord rozłączył shard ${shardId}. Kod: ${event.code}`,
  );
});

process.on('unhandledRejection', (error) => {
  console.error(
    'Nieobsłużony Promise rejection:',
    error,
  );
});

process.on('uncaughtException', (error) => {
  console.error(
    'Nieobsłużony wyjątek:',
    error,
  );
});

async function shutdown(signal) {
  console.log(
    `Odebrano ${signal}. Wyłączam PubgPLEMULATOR...`,
  );

  client.destroy();

  await new Promise((resolve) => {
    healthServer.close(resolve);
  });

  process.exit(0);
}

process.once('SIGINT', () =>
  shutdown('SIGINT'),
);

process.once('SIGTERM', () =>
  shutdown('SIGTERM'),
);

async function startBot() {
  try {
    console.log(
      'Łączenie PubgPLEMULATOR z Discord Gateway...',
    );

    const gatewayTimeout = setTimeout(() => {
      console.error(
        'TIMEOUT: brak ClientReady po 30 sekundach.',
      );
    }, 30000);

    client.once(Events.ClientReady, () => {
      clearTimeout(gatewayTimeout);
    });

    await client.login(token);
  } catch (error) {
    console.error(
      'NIE UDAŁO SIĘ ZALOGOWAĆ DO DISCORDA:',
      error,
    );

    healthServer.close(() => {
      process.exit(1);
    });
  }
}

startBot();

