import { spawn } from 'node:child_process';

import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';
import bundledFfmpegPath from 'ffmpeg-static';
import youtubeDl from 'youtube-dl-exec';

const guildPlayers = new Map();
const MAX_PLAYLIST_TRACKS = 200;
const PROCESS_TIMEOUT_MS = 45_000;

let initialized = false;
let ytDlpPath = null;
let ffmpegPath = null;

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

function isPlaylistUrl(value) {
  if (!isYouTubeUrl(value)) {
    return false;
  }

  const url = new URL(value);
  return url.pathname === '/playlist' || url.searchParams.has('list');
}

function getVoiceChannel(interaction) {
  return interaction.member?.voice?.channel ?? null;
}

function requireVoiceChannel(interaction) {
  const voiceChannel = getVoiceChannel(interaction);

  if (!voiceChannel) {
    throw new Error('Najpierw wejdź na kanał głosowy.');
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
  const voiceChannel = requireVoiceChannel(interaction);
  const state = guildPlayers.get(interaction.guildId);

  if (
    state?.voiceChannelId &&
    state.voiceChannelId !== voiceChannel.id
  ) {
    throw new Error(
      'Musisz być na tym samym kanale głosowym co bot.',
    );
  }

  return voiceChannel;
}

function runProcess(command, args, timeoutMs = PROCESS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(
        new Error(
          `Proces przekroczył limit ${Math.round(timeoutMs / 1000)} s.`,
        ),
      );
    }, timeoutMs);

    function finish(error, value) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.once('error', (error) => {
      finish(
        new Error(
          `Nie udało się uruchomić ${command}: ${error.message}`,
        ),
      );
    });

    child.once('close', (code) => {
      if (code !== 0) {
        finish(
          new Error(
            stderr.trim() ||
              `${command} zakończył się kodem ${code}.`,
          ),
        );
        return;
      }

      finish(null, stdout.trim());
    });
  });
}

function ytDlpArgs(extraArgs = []) {
  return [
    '--force-ipv4',
    '--no-warnings',
    '--no-progress',
    ...extraArgs,
  ];
}

async function verifyMediaTools() {
  ffmpegPath = process.env.FFMPEG_PATH || bundledFfmpegPath;
  ytDlpPath =
    process.env.YTDLP_PATH || youtubeDl.constants?.YOUTUBE_DL_PATH;

  if (!ffmpegPath) {
    throw new Error('Nie znaleziono binarki FFmpeg.');
  }

  if (!ytDlpPath) {
    throw new Error('Nie znaleziono binarki yt-dlp.');
  }

  const [ytDlpVersion] = await Promise.all([
    runProcess(ytDlpPath, ['--version'], 15_000),
    runProcess(ffmpegPath, ['-version'], 15_000),
  ]);

  console.log(`[MUSIC] yt-dlp: ${ytDlpPath} (${ytDlpVersion})`);
  console.log(`[MUSIC] FFmpeg: ${ffmpegPath}`);
}

function entryToTrack(entry, fallbackUrl) {
  if (!entry) {
    return null;
  }

  const id = entry.id;
  const webpageUrl =
    entry.webpage_url ||
    entry.original_url ||
    (id ? `https://www.youtube.com/watch?v=${id}` : null) ||
    fallbackUrl;

  if (!webpageUrl) {
    return null;
  }

  return {
    url: webpageUrl,
    title: entry.title || 'YouTube',
    author: entry.uploader || entry.channel || '',
    duration: entry.duration ?? null,
  };
}

async function resolveTracks(query) {
  const playlist = isPlaylistUrl(query);
  const target = isYouTubeUrl(query) ? query : `ytsearch1:${query}`;
  const args = ytDlpArgs([
    '--dump-single-json',
    '--flat-playlist',
    '--playlist-end',
    String(playlist ? MAX_PLAYLIST_TRACKS : 1),
    '--',
    target,
  ]);
  const output = await runProcess(ytDlpPath, args);
  const metadata = JSON.parse(output);
  const entries = Array.isArray(metadata.entries)
    ? metadata.entries
    : [metadata];
  const tracks = entries
    .map((entry) => entryToTrack(entry, query))
    .filter(Boolean);

  if (tracks.length === 0) {
    throw new Error('Nie znaleziono utworu.');
  }

  return {
    tracks,
    playlistTitle: playlist ? metadata.title || 'YouTube' : null,
  };
}

function stopPipeline(state) {
  for (const child of [state.ytDlpProcess, state.ffmpegProcess]) {
    if (child && !child.killed) {
      child.kill('SIGKILL');
    }
  }

  state.ytDlpProcess = null;
  state.ffmpegProcess = null;
}

function trimProcessError(value) {
  return value
    .trim()
    .split(/\r?\n/)
    .slice(-5)
    .join(' ')
    .slice(0, 1_000);
}

function bassGain(level) {
  return {
    off: 0,
    low: 5,
    medium: 10,
    high: 16,
  }[level] ?? 0;
}

function createTrackResource(state, track) {
  const sourceArgs = ytDlpArgs([
    '--no-playlist',
    '-f',
    'bestaudio/best',
    '-o',
    '-',
    '--',
    track.url,
  ]);
  const filter = `bass=g=${bassGain(state.bassLevel)}:f=110:w=0.6`;
  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-i',
    'pipe:0',
  ];

  if (track.seekSeconds > 0) {
    ffmpegArgs.push('-ss', String(track.seekSeconds));
  }

  ffmpegArgs.push(
    '-vn',
    '-af',
    filter,
    '-c:a',
    'libopus',
    '-b:a',
    '128k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-f',
    'ogg',
    'pipe:1',
  );

  const ytDlpProcess = spawn(ytDlpPath, sourceArgs, {
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  state.ytDlpProcess = ytDlpProcess;
  state.ffmpegProcess = ffmpegProcess;
  state.pipelineError = '';

  let ytDlpError = '';
  let ffmpegError = '';

  ytDlpProcess.stderr.on('data', (chunk) => {
    ytDlpError += chunk.toString();
  });

  ffmpegProcess.stderr.on('data', (chunk) => {
    ffmpegError += chunk.toString();
  });

  ytDlpProcess.stdout.pipe(ffmpegProcess.stdin);
  ffmpegProcess.stdin.on('error', () => {
    // Zamknięcie potoku podczas /skip, /back lub zmiany basu jest oczekiwane.
  });

  ytDlpProcess.once('error', (error) => {
    state.pipelineError = `yt-dlp: ${error.message}`;
    ffmpegProcess.stdin.destroy(error);
  });

  ffmpegProcess.once('error', (error) => {
    state.pipelineError = `FFmpeg: ${error.message}`;
  });

  ytDlpProcess.once('close', (code, signal) => {
    if (code && !signal) {
      state.pipelineError =
        trimProcessError(ytDlpError) || `yt-dlp: kod ${code}`;
      console.error(`[MUSIC] ${state.pipelineError}`);
    }
  });

  ffmpegProcess.once('close', (code, signal) => {
    if (code && !signal) {
      state.pipelineError =
        state.pipelineError ||
        trimProcessError(ffmpegError) ||
        `FFmpeg: kod ${code}`;
      console.error(`[MUSIC] ${state.pipelineError}`);
    }
  });

  return createAudioResource(ffmpegProcess.stdout, {
    inputType: StreamType.OggOpus,
    metadata: track,
  });
}

function sendMessage(state, content) {
  return state.textChannel?.send({ content }).catch(() => {});
}

function playNext(state) {
  if (
    state.current ||
    state.player.state.status !== AudioPlayerStatus.Idle
  ) {
    return;
  }

  const track = state.queue.shift();

  if (!track) {
    sendMessage(state, '✅ Kolejka muzyczna została zakończona.');
    return;
  }

  state.current = track;
  state.startedAt = Date.now();
  state.resource = createTrackResource(state, track);

  console.log(
    `[MUSIC] Start: ${track.title} (${track.url}), queued=${state.queue.length}`,
  );

  state.player.play(state.resource);
}

function buildState(guild, textChannel) {
  const player = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Pause,
      maxMissedFrames: 5,
    },
  });
  const state = {
    guildId: guild.id,
    player,
    connection: null,
    voiceChannelId: null,
    textChannel,
    queue: [],
    history: [],
    current: null,
    resource: null,
    ytDlpProcess: null,
    ffmpegProcess: null,
    pipelineError: '',
    suppressHistoryOnce: false,
    bassLevel: 'off',
    startedAt: 0,
  };

  player.on(AudioPlayerStatus.Playing, () => {
    const track = state.current;

    if (!track) {
      return;
    }

    console.log(`[MUSIC] Discord voice playing: ${track.title}`);
    sendMessage(
      state,
      `🎵 **Teraz gra:** **${track.title}**${
        track.author ? `\n👤 ${track.author}` : ''
      }`,
    );
  });

  player.on(AudioPlayerStatus.Idle, () => {
    const finishedTrack = state.current;
    const pipelineError = state.pipelineError;

    stopPipeline(state);
    state.current = null;
    state.resource = null;
    state.pipelineError = '';

    if (finishedTrack && !state.suppressHistoryOnce) {
      state.history.push({ ...finishedTrack, seekSeconds: 0 });
      state.history = state.history.slice(-50);
    }

    state.suppressHistoryOnce = false;

    if (pipelineError) {
      sendMessage(
        state,
        `❌ Błąd strumienia **${finishedTrack?.title ?? 'YouTube'}**: ${pipelineError}`,
      );
    }

    setImmediate(() => playNext(state));
  });

  player.on('error', (error) => {
    console.error('[MUSIC] Audio player error:', error);
    state.pipelineError = error.message;
  });

  return state;
}

async function connectState(interaction, voiceChannel) {
  let state = guildPlayers.get(interaction.guildId);

  if (!state) {
    state = buildState(interaction.guild, interaction.channel);
    guildPlayers.set(interaction.guildId, state);
  }

  state.textChannel = interaction.channel;

  if (
    state.connection &&
    state.voiceChannelId === voiceChannel.id &&
    state.connection.state.status !== VoiceConnectionStatus.Destroyed
  ) {
    await entersState(
      state.connection,
      VoiceConnectionStatus.Ready,
      20_000,
    );
    return state;
  }

  if (state.connection) {
    state.connection.destroy();
  }

  state.connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: interaction.guildId,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
  });
  state.voiceChannelId = voiceChannel.id;
  state.connection.subscribe(state.player);

  state.connection.on('error', (error) => {
    console.error('[MUSIC] Voice connection error:', error);
  });

  await entersState(
    state.connection,
    VoiceConnectionStatus.Ready,
    20_000,
  );

  console.log(`[MUSIC] Voice ready: ${voiceChannel.name}`);
  return state;
}

export async function initMusicPlayer() {
  if (initialized) {
    return;
  }

  await verifyMediaTools();
  initialized = true;
  console.log('[MUSIC] Odtwarzacz muzyczny gotowy.');
}

export async function handleJoin(interaction) {
  if (!initialized) {
    throw new Error('Odtwarzacz muzyczny nie został zainicjalizowany.');
  }

  const voiceChannel = requireVoiceChannel(interaction);
  await interaction.deferReply();
  await connectState(interaction, voiceChannel);
  await interaction.editReply({
    content: `🔊 Dołączyłem do kanału **${voiceChannel.name}**.`,
  });
}

export async function handlePlay(interaction) {
  if (!initialized) {
    throw new Error('Odtwarzacz muzyczny nie został zainicjalizowany.');
  }

  const voiceChannel = requireVoiceChannel(interaction);
  const query = interaction.options.getString('query', true).trim();

  await interaction.deferReply();

  const state = await connectState(interaction, voiceChannel);
  const result = await resolveTracks(query);
  const wasIdle = !state.current && state.queue.length === 0;

  state.queue.push(...result.tracks);

  if (wasIdle) {
    playNext(state);
  }

  if (result.playlistTitle) {
    await interaction.editReply({
      content:
        `📚 Dodano playlistę **${result.playlistTitle}**\n` +
        `🎵 Utworów: **${result.tracks.length}**`,
    });
    return;
  }

  await interaction.editReply({
    content: `➕ Dodano do kolejki: **${result.tracks[0].title}**`,
  });
}

export async function handlePause(interaction) {
  const state = guildPlayers.get(interaction.guildId);

  if (!state?.current) {
    throw new Error('Aktualnie nic nie jest odtwarzane.');
  }

  requireSameVoiceChannel(interaction);

  const paused = state.player.state.status === AudioPlayerStatus.Paused;
  const changed = paused ? state.player.unpause() : state.player.pause();

  if (!changed) {
    throw new Error('Nie udało się zmienić stanu odtwarzania.');
  }

  await interaction.reply({
    content: paused
      ? '▶️ Wznowiono odtwarzanie.'
      : '⏸️ Muzyka została wstrzymana.',
  });
}

export async function handleSkip(interaction) {
  const state = guildPlayers.get(interaction.guildId);

  if (!state?.current) {
    throw new Error('Aktualnie nic nie jest odtwarzane.');
  }

  requireSameVoiceChannel(interaction);
  const title = state.current.title;
  state.player.stop(true);

  await interaction.reply({
    content: `⏭️ Pominięto: **${title}**`,
  });
}

export async function handleBack(interaction) {
  const state = guildPlayers.get(interaction.guildId);

  if (!state?.current) {
    throw new Error('Aktualnie nic nie jest odtwarzane.');
  }

  requireSameVoiceChannel(interaction);
  const previous = state.history.pop();

  if (!previous) {
    throw new Error('Brak poprzedniego utworu w historii.');
  }

  state.queue.unshift(
    { ...previous, seekSeconds: 0 },
    { ...state.current, seekSeconds: 0 },
  );
  state.suppressHistoryOnce = true;
  state.player.stop(true);

  await interaction.reply({
    content: `⏮️ Wracam do: **${previous.title}**`,
  });
}

export async function handleBass(interaction) {
  const state = guildPlayers.get(interaction.guildId);

  if (!state?.current) {
    throw new Error('Najpierw uruchom jakiś utwór.');
  }

  requireSameVoiceChannel(interaction);

  const level = interaction.options.getString('poziom', true);
  const labels = {
    off: 'wyłączony',
    low: 'niski',
    medium: 'średni',
    high: 'mocny',
  };

  if (!labels[level]) {
    throw new Error('Nieprawidłowy poziom basu.');
  }

  const elapsedSeconds = Math.max(
    0,
    (state.current.seekSeconds ?? 0) +
      Math.floor((state.resource?.playbackDuration ?? 0) / 1_000),
  );
  const current = {
    ...state.current,
    seekSeconds: elapsedSeconds,
  };

  state.bassLevel = level;
  state.queue.unshift(current);
  state.suppressHistoryOnce = true;
  state.player.stop(true);

  await interaction.reply({
    content: `🔊 Bass: **${labels[level]}**`,
  });
}
