import { Player } from 'discord-player';
import {
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
} from '@discordjs/voice';
import { DefaultExtractors } from '@discord-player/extractor';
import {
  YouTubeDlpExtractor,
  setFFmpegPath,
  setYtDlpPath,
} from 'discord-player-youtubedlp';
import ffmpegPath from 'ffmpeg-static';

let player = null;
let initialized = false;

function getVoiceChannel(interaction) {
  return interaction.member?.voice?.channel ?? null;
}

function getQueue(interaction) {
  return player?.nodes?.get(interaction.guildId) ?? null;
}

function requireVoiceChannel(interaction) {
  const voiceChannel = getVoiceChannel(interaction);

  if (!voiceChannel) {
    throw new Error(
      'Najpierw wejdź na kanał głosowy.',
    );
  }

  const permissions = voiceChannel.permissionsFor(
    interaction.guild.members.me,
  );

  if (
    !permissions?.has('Connect') ||
    !permissions?.has('Speak')
  ) {
    throw new Error(
      'Bot nie ma uprawnień Connect/Speak na tym kanale głosowym.',
    );
  }

  return voiceChannel;
}

function requireSameVoiceChannel(interaction) {
  const memberChannel = requireVoiceChannel(interaction);
  const botChannel =
    interaction.guild.members.me?.voice?.channel;

  if (
    botChannel &&
    botChannel.id !== memberChannel.id
  ) {
    throw new Error(
      'Musisz być na tym samym kanale głosowym co bot.',
    );
  }

  return memberChannel;
}


function configureYtDlp() {
  if (process.platform === 'win32') {
    setYtDlpPath('yt-dlp');
    console.log('[MUSIC] Systemowy yt-dlp: yt-dlp');
    return;
  }

  // Na hostingu pozostawiamy fallback extractora.
  console.log(
    '[MUSIC] Linux/Render: używam yt-dlp dostępnego dla extractora.',
  );
}

export async function initMusicPlayer(client) {
  if (initialized) {
    return player;
  }

  if (ffmpegPath) {
    setFFmpegPath(ffmpegPath);
    process.env.FFMPEG_PATH = ffmpegPath;
  }

  configureYtDlp();

  player = new Player(client);

  await player.extractors.loadMulti(
    DefaultExtractors,
  );

  await player.extractors.register(
    YouTubeDlpExtractor,
    {
      searchLimit: 3,
      playlistSearchLimit: 200,
      searchTimeoutMs: 10000,
      videoTimeoutMs: 15000,
      playlistTimeoutMs: 30000,
      ytdlpTimeoutMs: 30000,
      enableProtocols: true,
      debug: true,
    },
  );

  player.events.on(
    'playerStart',
    (queue, track) => {
      const channel =
        queue.metadata?.textChannel;

      channel
        ?.send({
          content:
            '🎵 **Teraz gra:** ' +
            `**${track.title}**` +
            (track.author
              ? `\n👤 ${track.author}`
              : ''),
        })
        .catch(() => {});
    },
  );

  player.events.on(
    'emptyQueue',
    (queue) => {
      queue.metadata?.textChannel
        ?.send({
          content:
            '✅ Kolejka muzyczna została zakończona.',
        })
        .catch(() => {});
    },
  );

  player.events.on(
    'playerError',
    (queue, error) => {
      console.error(
        '[MUSIC] playerError:',
        error,
      );

      queue.metadata?.textChannel
        ?.send({
          content:
            '❌ Błąd odtwarzania muzyki: ' +
            error.message,
        })
        .catch(() => {});
    },
  );

  player.events.on(
    'error',
    (queue, error) => {
      console.error(
        '[MUSIC] queue error:',
        error,
      );
    },
  );

  initialized = true;

  console.log(
    '[MUSIC] Odtwarzacz muzyczny gotowy.',
  );

  return player;
}


export async function handleJoin(interaction) {
  const voiceChannel =
    requireVoiceChannel(interaction);

  await interaction.deferReply();

  const existingConnection =
    getVoiceConnection(interaction.guild.id);

  if (existingConnection) {
    existingConnection.destroy();
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: interaction.guild.id,
    adapterCreator:
      interaction.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
  });

  console.log(
    `[MUSIC] Łączenie z voice: ${voiceChannel.name} (${voiceChannel.id})`,
  );

  try {
    await entersState(
      connection,
      VoiceConnectionStatus.Ready,
      15_000,
    );
  } catch (error) {
    connection.destroy();

    throw new Error(
      `Nie udało się połączyć z kanałem głosowym: ${error.message}`,
    );
  }

  console.log(
    `[MUSIC] Voice połączony: ${voiceChannel.name}`,
  );

  await interaction.editReply({
    content:
      `🔊 Dołączyłem do kanału **${voiceChannel.name}**.`,
  });
}

export async function handlePlay(interaction) {
  if (!player) {
    throw new Error(
      'Odtwarzacz muzyczny nie został jeszcze zainicjalizowany.',
    );
  }

  const voiceChannel =
    requireVoiceChannel(interaction);

  const query =
    interaction.options.getString(
      'query',
      true,
    );

  await interaction.deferReply();

  const result = await player.play(
    voiceChannel,
    query,
    {
      requestedBy: interaction.user,

      nodeOptions: {
        metadata: {
          textChannel:
            interaction.channel,
          requestedBy:
            interaction.user.id,
        },

        selfDeaf: true,
        volume: 70,

        leaveOnEmpty: true,
        leaveOnEmptyCooldown: 60_000,

        leaveOnEnd: true,
        leaveOnEndCooldown: 60_000,

        leaveOnStop: true,
        leaveOnStopCooldown: 5_000,

        maxHistorySize: 50,
        disableHistory: false,
      },
    },
  );

  const playlist =
    result.searchResult?.playlist;

  if (playlist) {
    const count =
      result.searchResult?.tracks
        ?.length ?? 0;

    await interaction.editReply({
      content:
        `📚 Dodano playlistę **${playlist.title}**` +
        `\n🎵 Utworów: **${count}**`,
    });

    return;
  }

  if (!result.track) {
    throw new Error(
      'Nie znaleziono utworu.',
    );
  }

  await interaction.editReply({
    content:
      `➕ Dodano do kolejki: **${result.track.title}**`,
  });
}

export async function handlePause(interaction) {
  const queue = getQueue(interaction);

  if (!queue?.currentTrack) {
    throw new Error(
      'Aktualnie nic nie jest odtwarzane.',
    );
  }

  requireSameVoiceChannel(interaction);

  const wasPaused =
    queue.node.isPaused();

  queue.node.setPaused(
    !wasPaused,
  );

  await interaction.reply({
    content: wasPaused
      ? '▶️ Wznowiono odtwarzanie.'
      : '⏸️ Muzyka została wstrzymana.',
  });
}

export async function handleSkip(interaction) {
  const queue = getQueue(interaction);

  if (!queue?.currentTrack) {
    throw new Error(
      'Aktualnie nic nie jest odtwarzane.',
    );
  }

  requireSameVoiceChannel(interaction);

  const title =
    queue.currentTrack.title;

  queue.node.skip();

  await interaction.reply({
    content:
      `⏭️ Pominięto: **${title}**`,
  });
}

export async function handleBack(interaction) {
  const queue = getQueue(interaction);

  if (!queue) {
    throw new Error(
      'Nie ma aktywnej kolejki.',
    );
  }

  requireSameVoiceChannel(interaction);

  if (
    !queue.history ||
    queue.history.isEmpty()
  ) {
    throw new Error(
      'Brak poprzedniego utworu w historii.',
    );
  }

  await queue.history.previous(true);

  await interaction.reply({
    content:
      '⏮️ Wrócono do poprzedniego utworu.',
  });
}

export async function handleBass(interaction) {
  const queue = getQueue(interaction);

  if (!queue?.currentTrack) {
    throw new Error(
      'Najpierw uruchom jakiś utwór.',
    );
  }

  requireSameVoiceChannel(interaction);

  const level =
    interaction.options.getString(
      'poziom',
      true,
    );

  const presets = {
    off: [
      { band: 0, gain: 0 },
      { band: 1, gain: 0 },
      { band: 2, gain: 0 },
    ],

    low: [
      { band: 0, gain: 0.1 },
      { band: 1, gain: 0.08 },
      { band: 2, gain: 0.05 },
    ],

    medium: [
      { band: 0, gain: 0.25 },
      { band: 1, gain: 0.2 },
      { band: 2, gain: 0.12 },
    ],

    high: [
      { band: 0, gain: 0.45 },
      { band: 1, gain: 0.35 },
      { band: 2, gain: 0.2 },
    ],
  };

  const selected =
    presets[level];

  if (!selected) {
    throw new Error(
      'Nieprawidłowy poziom basu.',
    );
  }

  queue.filters.equalizer.setEQ(
    selected,
  );

  const labels = {
    off: 'wyłączony',
    low: 'niski',
    medium: 'średni',
    high: 'mocny',
  };

  await interaction.reply({
    content:
      `🔊 Bass: **${labels[level]}**`,
  });
}