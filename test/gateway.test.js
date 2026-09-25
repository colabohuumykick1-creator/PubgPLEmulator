import assert from 'node:assert/strict';
import test from 'node:test';
import { Routes } from 'discord.js';
import { useSingleShardGateway } from '../src/gateway.js';

test('Gateway jednego sharda omija tylko blokujacy endpoint startowy', async () => {
  const calls = [];
  const rest = {
    async get(route, options) {
      calls.push({ route, options });
      return { route };
    },
  };

  useSingleShardGateway(rest);

  const gateway = await rest.get(Routes.gatewayBot());
  const regular = await rest.get('/guilds/123', { query: 'test' });

  assert.equal(gateway.url, 'wss://gateway.discord.gg');
  assert.equal(gateway.shards, 1);
  assert.equal(gateway.session_start_limit.max_concurrency, 1);
  assert.deepEqual(regular, { route: '/guilds/123' });
  assert.deepEqual(calls, [
    { route: '/guilds/123', options: { query: 'test' } },
  ]);
});

