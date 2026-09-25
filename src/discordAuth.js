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

  if (!response.ok) {
    throw new Error(`Discord API zwrocilo HTTP ${response.status}.`);
  }

  const user = await response.json();

  if (user.bot !== true) {
    throw new Error('DISCORD_TOKEN nie nalezy do konta bota.');
  }

  return user;
}

