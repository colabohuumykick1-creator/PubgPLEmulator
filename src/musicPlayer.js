import { spawn } from 'node:child_process';

import { Player } from 'discord-player';

import { DefaultExtractors } from '@discord-player/extractor';
import {
  YouTubeDlpExtractor,
  setFFmpegPath,
  setYtDlpPath,
} from 'discord-player-youtubedlp';
import ffmpegPath from 'ffmpeg-static';

let player = null;
let initialized = false;


function isYouTubeUrl(value) {
  try {
    const url = new URL(value);

    return [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'youtu.be',
    ].includes(url.hostname);
  } catch {
    return false;
  }
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'yt-dlp',
      args,
      {
        windowsHide: true,
        shell: false,
      },
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(
        new Error(
          `Nie udało się uruchomić yt-dlp: ${error.message}`,
        ),
      );
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() ||
              `yt-dlp zakończył się kodem ${code}.`,
          ),
        );

        return;
      }

      resolve(stdout.trim());
    });
  });
}

async function resolveYouTubeAudio(url) {
  const metadataRaw = await runYtDlp([
    '--no-playlist',
    '--no-warnings',
    '--dump-single-json',
    url,
  ]);

  const metadata = JSON.parse(metadataRaw);

  const streamRaw = await runYtDlp([
    '--no-playlist',
    '--no-warnings',
    '-f',
    'bestaudio/best',
    '--get-url',
    url,
  ]);

  const streamUrl = streamRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!streamUrl) {
    throw new Error(
      'yt-dlp nie zwrócił adresu audio.',
    );
  }

  return {
    streamUrl,
    title:
      metadata.title ??
      'YouTube',
    author:
      metadata.uploader ??
      metadata.channel ??
      '',
    webpageUrl:
      metadata.webpage_url ??
      url,
  };
}

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
  if (!player) {
    throw new Error(
      'Odtwarzacz muzyczny nie został jeszcze zainicjalizowany.',
    );
  }

  const voiceChannel =
    requireVoiceChannel(interaction);

  await interaction.deferReply();

  let queue =
    player.nodes.get(interaction.guildId);

  if (!queue) {
    queue = player.nodes.create(
      interaction.guild,
      {
        metadata: {
          textChannel:
            interaction.channel,
        },

        selfDeaf: true,
        volume: 70,

        leaveOnEmpty: true,
        leaveOnEmptyCooldown: 60_000,

        leaveOnEnd: false,

        leaveOnStop: true,
        leaveOnStopCooldown: 5_000,

        maxHistorySize: 50,
        disableHistory: false,
      },
    );
  }

  if (!queue.connection) {
    console.log(
      `[MUSIC] Discord Player łączy się z voice: ${voiceChannel.name}`,
    );

    await queue.connect(voiceChannel);
  }

  await interaction.editReply({
    content:
      `🔊 Dołączyłem do kanału **${voiceChannel.name}**.`,
  });
}


async function ensurePlaybackStarted(interaction) {
  const queue =
    player?.nodes?.get(interaction.guildId);

  if (!queue) {
    console.log('[MUSIC] Brak kolejki po /play.');
    return;
  }

  if (queue.node.isPlaying()) {
    console.log('[MUSIC] Odtwarzanie już trwa.');
    return;
  }

  if (queue.node.isPaused()) {
    queue.node.setPaused(false);

    console.log(
      '[MUSIC] Wznowiono wstrzymane odtwarzanie.',
    );

    return;
  }

  const queuedTracks =
    queue.tracks?.size ?? 0;

  console.log(
    `[MUSIC] Start kolejki: current=${queue.currentTrack?.title ?? 'brak'}, queued=${queuedTracks}`,
  );

  if (
    !queue.currentTrack &&
    queuedTracks === 0
  ) {
    console.log(
      '[MUSIC] Kolejka jest pusta — nie ma czego uruchomić.',
    );

    return;
  }

  try {
    await queue.node.play();

    console.log(
      '[MUSIC] queue.node.play() uruchomione.',
    );
  } catch (error) {
    console.error(
      '[MUSIC] Błąd queue.node.play():',
      error,
    );

    throw error;
  }
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

  const commonOptions = {
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
  };

  if (isYouTubeUrl(query)) {
    console.log(
      `[MUSIC] Link YouTube wykryty: ${query}`,
    );

    try {
      const resolved =
        await resolveYouTubeAudio(query);

      console.log(
        `[MUSIC] yt-dlp resolved: ${resolved.title}`,
      );

      const result =
        await player.play(
          voiceChannel,
          resolved.streamUrl,
          commonOptions,
        );

      if (result.track) {
        result.track.title =
          resolved.title;

        result.track.author =
          resolved.author;

        result.track.url =
          resolved.webpageUrl;
      }

      await interaction.editReply({
        content:
          `➕ Dodano z YouTube: **${resolved.title}**`,
      });

      return;
    } catch (error) {
      console.error(
        '[MUSIC] yt-dlp direct URL error:',
        error,
      );

      throw new Error(
        `Nie udało się odtworzyć linku YouTube: ${error.message}`,
      );
    }
  }

  const result =
    await player.play(
      voiceChannel,
      query,
      commonOptions,
    );

  const playlist =
    result.searchResult?.playlist;

  if (playlist) {
    const count =
      result.searchResult?.tracks
        ?.length ?? 0;

    await interaction.editReply({
      content:
        `📚 Dodano playlistę **${playlist.title}**\n` +
        `🎵 Utworów: **${count}**`,
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