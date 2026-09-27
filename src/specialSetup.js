import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

import {
  BRAND,
  EMULATOR_HELP_CHANNEL_ID,
  VERIFICATION_CHANNEL_ID,
} from './config.js';

const REASON = 'Aktualizacja panelu PubgPLEmulator';

function markerEmbed(marker, embed) {
  return embed.setFooter({
    text: `${BRAND.footer} • ${marker}`,
  });
}

function verificationPayload() {
  return {
    embeds: [
      markerEmbed(
        'setup:verification:v1',
        new EmbedBuilder()
          .setColor(BRAND.color)
          .setTitle(
            'Secure Verification / Bezpieczna weryfikacja / Безопасная проверка',
          )
          .setDescription(
            '🇵🇱 Wybierz język, aby zakończyć weryfikację i uzyskać dostęp do serwera.\\n' +
              '🇬🇧 Choose a language to complete verification and access the server.\\n' +
              '🇷🇺 Выберите язык, чтобы завершить проверку и получить доступ к серверу.',
          ),
      ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('emuplcoom-verify:POLISH')
          .setLabel('Polski')
          .setEmoji('🇵🇱')
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId('emuplcoom-verify:ENGLISH')
          .setLabel('English')
          .setEmoji('🇬🇧')
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId('emuplcoom-verify:RUSSIAN')
          .setLabel('Русский')
          .setEmoji('🇷🇺')
          .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
          .setCustomId('emuplcoom-verify:BOTH')
          .setLabel('Polski + English')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

function helpPayload() {
  return {
    embeds: [
      markerEmbed(
        'setup:help:v1',
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle(
            'Pomoc GameLoop / GameLoop Help / Помощь GameLoop 🧰',
          )
          .setDescription(
            '🇵🇱 **Skopiuj i uzupełnij:**\\n' +
              '\`\`\`text\\n' +
              'GameLoop i wersja:\\n' +
              'System:\\n' +
              'Procesor / karta graficzna:\\n' +
              'Gra:\\n' +
              'Opis problemu:\\n' +
              'Wykonane próby naprawy:\\n' +
              'Komunikat błędu / log:\\n' +
              '\`\`\`\\n\\n' +

              '🇬🇧 **Copy and complete:**\\n' +
              '\`\`\`text\\n' +
              'GameLoop version:\\n' +
              'Operating system:\\n' +
              'CPU / GPU:\\n' +
              'Game:\\n' +
              'Problem description:\\n' +
              'Fixes already attempted:\\n' +
              'Error message / log:\\n' +
              '\`\`\`\\n\\n' +

              '🇷🇺 **Скопируйте и заполните:**\\n' +
              '\`\`\`text\\n' +
              'GameLoop и версия:\\n' +
              'Операционная система:\\n' +
              'Процессор / видеокарта:\\n' +
              'Игра:\\n' +
              'Описание проблемы:\\n' +
              'Что уже пробовали сделать:\\n' +
              'Сообщение об ошибке / лог:\\n' +
              '\`\`\`\\n\\n' +

              '🔒 🇵🇱 Nie publikuj haseł, tokenów ani danych prywatnych.\\n' +
              '🔒 🇬🇧 Never share passwords, tokens or private information.\\n' +
              '🔒 🇷🇺 Не публикуйте пароли, токены или личные данные.',
          ),
      ),
    ],
    components: [],
    allowedMentions: { parse: [] },
  };
}

async function updatePanel(guild, channelId, marker, payload) {
  const channel =
    guild.channels.cache.get(channelId) ??
    (await guild.channels.fetch(channelId).catch(() => null));

  if (!channel || !channel.isTextBased() || !channel.messages) {
    throw new Error(
      `Nie znaleziono kanału tekstowego o ID ${channelId}.`,
    );
  }

  const messages = await channel.messages.fetch({
    limit: 100,
  });

  const existing = messages.find(
    (message) =>
      message.author.id === channel.client.user.id &&
      message.embeds.some((embed) =>
        embed.footer?.text?.includes(marker),
      ),
  );

  let message;
  let action;

  if (existing) {
    message = await existing.edit(payload);
    action = 'updated';
  } else {
    message = await channel.send(payload);
    action = 'created';
  }

  if (!message.pinned) {
    await message.pin(REASON);
  }

  return {
    action,
    channelId: channel.id,
    channelName: channel.name,
    messageId: message.id,
  };
}

export async function setupHelpChannel(guild) {
  return updatePanel(
    guild,
    EMULATOR_HELP_CHANNEL_ID,
    'setup:help:v1',
    helpPayload(),
  );
}

export async function setupVerificationChannel(guild) {
  return updatePanel(
    guild,
    VERIFICATION_CHANNEL_ID,
    'setup:verification:v1',
    verificationPayload(),
  );
}
