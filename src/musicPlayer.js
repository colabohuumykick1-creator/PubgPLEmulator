import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
const MIN_SUCCESSFUL_PLAYBACK_MS = 2_000;
const PIPELINE_ERROR_GRACE_MS = 1_500;

let initialized = false;
let ytDlpPath = null;
let ffmpegPath = null;
let youtubeCookiesPath = null;
let jsRuntimeSupported = false;

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

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
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
  // Nowe wersje yt-dlp potrzebują silnika JavaScript do rozwiązywania
  // zabezpieczeń YouTube. Używamy tego samego Node.js, na którym działa bot,
  // i zostawiamy yt-dlp wybór klienta YouTube. Stare wersje (bez tej opcji)
  // dostają dotychczasową listę klientów.
  const playerClient =
    process.env.YTDLP_PLAYER_CLIENT?.trim() ||
    (jsRuntimeSupported
      ? ''
      : youtubeCookiesPath
        ? 'web_safari,web'
        : 'android_vr,web_safari,web_embedded');

  return [
    '--force-ipv4',
    '--no-warnings',
    '--no-progress',
    ...(jsRuntimeSupported
      ? ['--js-runtimes', `node:${process.execPath}`]
      : []),
    ...(ffmpegPath ? ['--ffmpeg-location', ffmpegPath] : []),
    ...(playerClient
      ? ['--extractor-args', `youtube:player_client=${playerClient}`]
      : []),
    ...(youtubeCookiesPath
      ? ['--cookies', youtubeCookiesPath]
      : []),
    ...extraArgs,
  ];
}

function removeYouTubeCookiesFile() {
  if (!youtubeCookiesPath) {
    return;
  }

  try {
    unlinkSync(youtubeCookiesPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(
        '[MUSIC] Nie udało się usunąć tymczasowego pliku cookies.',
      );
    }
  } finally {
    youtubeCookiesPath = null;
  }
}

async function configureYouTubeCookies() {
  const encoded = process.env.YOUTUBE_COOKIES_BASE64?.replace(
    /\s/g,
    '',
  );

  if (!encoded) {
    console.log('[MUSIC] Cookies YouTube: nie skonfigurowano.');
    return;
  }

  if (
    encoded.length > 1_500_000 ||
    !/^[A-Za-z0-9+/_-]*={0,2}$/.test(encoded)
  ) {
    throw new Error(
      'YOUTUBE_COOKIES_BASE64 nie zawiera prawidłowych danych base64.',
    );
  }

  const normalized = encoded
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const cookies = Buffer.from(normalized, 'base64')
    .toString('utf8')
    .replace(/\r\n?/g, '\n');
  const hasNetscapeHeader =
    cookies.startsWith('# Netscape HTTP Cookie File\n') ||
    cookies.startsWith('# HTTP Cookie File\n');
  const validCookieLines = cookies
    .split(/\r?\n/)
    .filter(
      (line) =>
        line &&
        (!line.startsWith('#') ||
          line.startsWith('#HttpOnly_')) &&
        line.split('\t').length >= 7,
    );

  if (
    !hasNetscapeHeader ||
    cookies.includes('\0') ||
    validCookieLines.length === 0
  ) {
    throw new Error(
      'YOUTUBE_COOKIES_BASE64 nie zawiera pliku cookies w formacie Netscape.',
    );
  }

  const cookieFilePath = join(
    tmpdir(),
    `pubgplemulator-youtube-${randomUUID()}.txt`,
  );

  await writeFile(
    cookieFilePath,
    cookies.endsWith('\n') ? cookies : `${cookies}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    },
  );

  youtubeCookiesPath = cookieFilePath;
  delete process.env.YOUTUBE_COOKIES_BASE64;
  process.once('exit', removeYouTubeCookiesFile);
  console.log(
    '[MUSIC] Cookies YouTube skonfigurowane bezpiecznie z YOUTUBE_COOKIES_BASE64.',
  );
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

  await runProcess(ffmpegPath, ['-version'], 15_000);

  // YouTube często zmienia zabezpieczenia, a stary yt-dlp przestaje działać.
  // Aktualizacja przy starcie jest opcjonalna i nigdy nie blokuje bota.
  if (process.env.YTDLP_AUTO_UPDATE !== 'false') {
    try {
      const updateOutput = await runProcess(ytDlpPath, ['-U'], 90_000);
      console.log(
        `[MUSIC] Aktualizacja yt-dlp: ${
          updateOutput.split(/\r?\n/).pop() || 'OK'
        }`,
      );
    } catch (error) {
      console.warn(
        `[MUSIC] Nie udało się zaktualizować yt-dlp: ${trimProcessError(
          error.message,
        )}`,
      );
    }
  }

  const ytDlpVersion = await runProcess(
    ytDlpPath,
    ['--version'],
    15_000,
  );

  try {
    await runProcess(
      ytDlpPath,
      ['--js-runtimes', `node:${process.execPath}`, '--version'],
      15_000,
    );
    jsRuntimeSupported = true;
  } catch {
    jsRuntimeSupported = false;
    console.warn(
      '[MUSIC] Ta wersja yt-dlp nie obsługuje --js-runtimes. ' +
        'Zaktualizuj yt-dlp, inaczej YouTube może nie działać.',
    );
  }

  console.log(`[MUSIC] yt-dlp: ${ytDlpPath} (${ytDlpVersion})`);
  console.log(
    `[MUSIC] Silnik JS dla YouTube: ${
      jsRuntimeSupported ? `Node ${process.version}` : 'brak'
    }`,
  );
  console.log(`[MUSIC] FFmpeg: ${ffmpegPath}`);
}

function entryToTrack(entry, fallbackUrl) {
  if (!entry) {
    return null;
  }

  const id = entry.id;
  const isYouTubeEntry = /youtube/i.test(
    entry.ie_key || entry.extractor_key || entry.extractor || '',
  );
  // W trybie --flat-playlist adres utworu jest w polu "url". Link YouTube
  // budujemy z id tylko dla wpisów, które naprawdę pochodzą z YouTube.
  const webpageUrl =
    entry.webpage_url ||
    entry.original_url ||
    (isHttpUrl(entry.url) ? entry.url : null) ||
    (id && isYouTubeEntry
      ? `https://www.youtube.com/watch?v=${id}`
      : null) ||
    fallbackUrl;

  if (!webpageUrl || !isHttpUrl(webpageUrl)) {
    return null;
  }

  return {
    url: webpageUrl,
    title: entry.title || 'YouTube',
    author: entry.uploader || entry.channel || '',
    duration: entry.duration ?? null,
  };
}

function friendlyYouTubeError(message) {
  if (/sign in to confirm|not a bot|cookies/i.test(message)) {
    return (
      'YouTube zablokował ten adres IP (weryfikacja „nie jestem botem”). ' +
      'Ustaw zmienną YOUTUBE_COOKIES_BASE64 z plikiem cookies z YouTube.'
    );
  }

  return trimProcessError(message);
}

async function fetchTracks(target, limit) {
  const args = ytDlpArgs([
    '--dump-single-json',
    '--flat-playlist',
    '--playlist-end',
    String(limit),
    '--',
    target,
  ]);
  const output = await runProcess(ytDlpPath, args);
  const metadata = JSON.parse(output);
  const entries = Array.isArray(metadata.entries)
    ? metadata.entries
    : [metadata];
  const fallbackUrl = isHttpUrl(target) ? target : null;

  return {
    metadata,
    tracks: entries
      .map((entry) => entryToTrack(entry, fallbackUrl))
      .filter(Boolean),
  };
}

async function resolveTracks(query) {
  const playlist = isPlaylistUrl(query);
  // Linki są przekazywane bez zmian. Sam tekst szukamy najpierw na YouTube,
  // a dopiero gdy YouTube odmówi – na SoundCloud.
  const targets = isHttpUrl(query)
    ? [query]
    : [`ytsearch1:${query}`, `scsearch1:${query}`];
  let lastError = null;

  for (const target of targets) {
    try {
      const { metadata, tracks } = await fetchTracks(
        target,
        playlist ? MAX_PLAYLIST_TRACKS : 1,
      );

      if (tracks.length > 0) {
        return {
          tracks,
          playlistTitle: playlist ? metadata.title || 'YouTube' : null,
        };
      }
    } catch (error) {
      lastError = error;
      console.error(
        `[MUSIC] Wyszukiwanie ${target} nie powiodło się: ${trimProcessError(
          error.message,
        )}`,
      );
    }
  }

  if (lastError) {
    throw new Error(friendlyYouTubeError(lastError.message));
  }

  throw new Error('Nie znaleziono utworu.');
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
  state.pipelineSettled = Promise.allSettled([
    new Promise((resolve) => ytDlpProcess.once('close', resolve)),
    new Promise((resolve) => ffmpegProcess.once('close', resolve)),
  ]);

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
        friendlyYouTubeError(ytDlpError) || `yt-dlp: kod ${code}`;
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
    if (!state.suppressQueueFinishedOnce) {
      sendMessage(state, '✅ Kolejka muzyczna została zakończona.');
    }
    state.suppressQueueFinishedOnce = false;
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
    pipelineSettled: null,
    suppressQueueFinishedOnce: false,
    suppressHistoryOnce: false,
    intentionalStopOnce: false,
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

  player.on(AudioPlayerStatus.Idle, async () => {
    const finishedTrack = state.current;
    const playbackDuration = state.resource?.playbackDuration ?? 0;
    const intentionalStop = state.intentionalStopOnce;

    if (
      finishedTrack &&
      playbackDuration < MIN_SUCCESSFUL_PLAYBACK_MS &&
      state.pipelineSettled
    ) {
      await Promise.race([
        state.pipelineSettled,
        new Promise((resolve) =>
          setTimeout(resolve, PIPELINE_ERROR_GRACE_MS),
        ),
      ]);
    }

    const pipelineError = state.pipelineError;

    stopPipeline(state);
    state.current = null;
    state.resource = null;
    state.pipelineError = '';
    state.pipelineSettled = null;
    state.intentionalStopOnce = false;

    const failedBeforePlayback =
      !intentionalStop &&
      Boolean(finishedTrack) &&
      playbackDuration < MIN_SUCCESSFUL_PLAYBACK_MS;

    if (
      finishedTrack &&
      !failedBeforePlayback &&
      !state.suppressHistoryOnce
    ) {
      state.history.push({ ...finishedTrack, seekSeconds: 0 });
      state.history = state.history.slice(-50);
    }

    state.suppressHistoryOnce = false;

    if (pipelineError || failedBeforePlayback) {
      state.suppressQueueFinishedOnce = state.queue.length === 0;
      sendMessage(
        state,
        `❌ Nie udało się uruchomić **${finishedTrack?.title ?? 'YouTube'}**: ${
          pipelineError ||
          'YouTube nie udostępnił działającego strumienia. Spróbuj innego utworu.'
        }`,
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

  const connection = state.connection;

  connection.on('error', (error) => {
    console.error('[MUSIC] Voice connection error:', error);
  });

  // Po wyrzuceniu bota z kanału lub zerwaniu połączenia czyścimy stan,
  // żeby następne /play mogło połączyć się od nowa.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
        connection.destroy();
      }

      if (state.connection === connection) {
        state.connection = null;
        state.voiceChannelId = null;
        state.queue = [];

        if (state.current) {
          state.intentionalStopOnce = true;
          state.suppressQueueFinishedOnce = true;
          state.player.stop(true);
        }

        console.log('[MUSIC] Rozłączono z kanału głosowego.');
      }
    }
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

  await configureYouTubeCookies();
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
  state.intentionalStopOnce = true;
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
  state.intentionalStopOnce = true;
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
  state.intentionalStopOnce = true;
  state.player.stop(true);

  await interaction.reply({
    content: `🔊 Bass: **${labels[level]}**`,
  });
}
