export async function verifyBotToken(token, fetchImplementation = fetch) {
  const response = await fetchImplementation(
    'https://discord.com/api/v10/users/@me',
    {
      headers: {
        Authorization: `Bot ${token}`,
      },
    },
  );

  if (response.status === 401) {
    throw new Error(
      'Discord odrzucil token (401). Uruchom setup-env.ps1 ze swiezym Bot Tokenem w schowku.',
    );
  }

  // Walidacja wstępna jest tylko zabezpieczeniem. Discord może chwilowo
  // ograniczyć ten endpoint podczas restartów lub kolejnych wdrożeń. W takim
  // przypadku pozwalamy discord.js wykonać właściwe logowanie do Gateway.
  if (response.status === 429 || response.status >= 500) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Discord API zwrocilo HTTP ${response.status}.`);
  }

  const user = await response.json();

  if (user.bot !== true) {
    throw new Error('DISCORD_TOKEN nie nalezy do konta bota.');
  }

  return user;
}
