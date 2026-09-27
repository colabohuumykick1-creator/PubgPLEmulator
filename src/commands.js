import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const commandData = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Aktualizuje istniejące kanały i wiadomości bez tworzenia nowych kanałów.')
    .setDescriptionLocalizations({
      'en-US': 'Updates existing channels and messages without creating new channels.',
      'en-GB': 'Updates existing channels and messages without creating new channels.',
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('setup-help')
    .setDescription('Aktualizuje tylko wiadomość na kanale Emulator Help.')
    .setDescriptionLocalizations({
      'en-US': 'Updates only the Emulator Help message.',
      'en-GB': 'Updates only the Emulator Help message.',
      ru: 'Обновляет только сообщение Emulator Help.',
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('setup-verification')
    .setDescription('Aktualizuje tylko panel weryfikacji językowej.')
    .setDescriptionLocalizations({
      'en-US': 'Updates only the language verification panel.',
      'en-GB': 'Updates only the language verification panel.',
      ru: 'Обновляет только панель языковой проверки.',
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('emuplcoom')
    .setDescription('Pokazuje informacje o bocie i serwerze.')
    .setDescriptionLocalizations({
      'en-US': 'Shows information about the bot and server.',
      'en-GB': 'Shows information about the bot and server.',
    })
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Dołącza bota do Twojego kanału głosowego.')
    .setDescriptionLocalizations({
      'en-US': 'Joins your current voice channel.',
      'en-GB': 'Joins your current voice channel.',
    })
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Odtwarza muzykę z linku YouTube, playlisty lub wyszukiwania.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Link YouTube, playlista lub nazwa utworu.')
        .setMaxLength(2_000)
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Wstrzymuje lub wznawia muzykę.')
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Pomija aktualny utwór.')
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('back')
    .setDescription('Wraca do poprzedniego utworu.')
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('bass')
    .setDescription('Ustawia poziom basu.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('poziom')
        .setDescription('Poziom podbicia basu.')
        .setRequired(true)
        .addChoices(
          { name: 'Wyłączony', value: 'off' },
          { name: 'Niski', value: 'low' },
          { name: 'Średni', value: 'medium' },
          { name: 'Mocny', value: 'high' },
        ),
    ),

  new SlashCommandBuilder()
    .setName('test')
    .setDescription('Sprawdza, czy bot działa poprawnie przez Render.')
    .setDescriptionLocalizations({
      'en-US': 'Checks whether the bot is working correctly through Render.',
      'en-GB': 'Checks whether the bot is working correctly through Render.',
    })
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Wysyła estetyczną wiadomość EMUPLCOOM na wybrany kanał.')
    .setDescriptionLocalizations({
      'en-US': 'Sends a styled EMUPLCOOM message to a selected channel.',
      'en-GB': 'Sends a styled EMUPLCOOM message to a selected channel.',
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addChannelOption((option) =>
      option
        .setName('kanal')
        .setNameLocalizations({ 'en-US': 'channel', 'en-GB': 'channel' })
        .setDescription('Kanał, na który bot ma wysłać wiadomość.')
        .setDescriptionLocalizations({
          'en-US': 'Channel where the bot should send the message.',
          'en-GB': 'Channel where the bot should send the message.',
        })
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('tytul')
        .setNameLocalizations({ 'en-US': 'title', 'en-GB': 'title' })
        .setDescription('Tytuł wiadomości.')
        .setDescriptionLocalizations({
          'en-US': 'Message title.',
          'en-GB': 'Message title.',
        })
        .setMaxLength(256)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('tresc')
        .setNameLocalizations({ 'en-US': 'content', 'en-GB': 'content' })
        .setDescription('Główna treść wiadomości.')
        .setDescriptionLocalizations({
          'en-US': 'Main message content.',
          'en-GB': 'Main message content.',
        })
        .setMaxLength(4_000)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('kolor')
        .setNameLocalizations({ 'en-US': 'colour', 'en-GB': 'colour' })
        .setDescription('Kolor bocznego paska embeda.')
        .setDescriptionLocalizations({
          'en-US': 'Colour of the embed sidebar.',
          'en-GB': 'Colour of the embed sidebar.',
        })
        .addChoices(
          { name: 'Błękit / Cyan EMUPLCOOM', value: '21D4FD' },
          { name: 'Fiolet / Purple EMUPLCOOM', value: '9B5CFF' },
          { name: 'Zielony / Green', value: '57F287' },
          { name: 'Złoty / Gold', value: 'F1C40F' },
          { name: 'Czerwony / Red', value: 'ED4245' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('obraz')
        .setNameLocalizations({ 'en-US': 'image', 'en-GB': 'image' })
        .setDescription('Opcjonalny bezpośredni adres URL dużego obrazu.')
        .setDescriptionLocalizations({
          'en-US': 'Optional direct URL of a large image.',
          'en-GB': 'Optional direct URL of a large image.',
        })
        .setMaxLength(2_000),
    )
    .addStringOption((option) =>
      option
        .setName('miniatura')
        .setNameLocalizations({ 'en-US': 'thumbnail', 'en-GB': 'thumbnail' })
        .setDescription('Opcjonalny bezpośredni adres URL miniatury.')
        .setDescriptionLocalizations({
          'en-US': 'Optional direct URL of a thumbnail.',
          'en-GB': 'Optional direct URL of a thumbnail.',
        })
        .setMaxLength(2_000),
    )
    .addStringOption((option) =>
      option
        .setName('stopka')
        .setNameLocalizations({ 'en-US': 'footer', 'en-GB': 'footer' })
        .setDescription('Opcjonalny tekst w stopce.')
        .setDescriptionLocalizations({
          'en-US': 'Optional footer text.',
          'en-GB': 'Optional footer text.',
        })
        .setMaxLength(1_000),
    ),
].map((command) => command.toJSON());
