import { Routes } from 'discord.js';

const gatewayRoute = Routes.gatewayBot();
const gatewayInformation = Object.freeze({
  url: 'wss://gateway.discord.gg',
  shards: 1,
  session_start_limit: {
    total: 1_000,
    remaining: 1_000,
    reset_after: 86_400_000,
    max_concurrency: 1,
  },
});

export function useSingleShardGateway(rest) {
  const originalGet = rest.get.bind(rest);

  rest.get = (route, options) => {
    if (route === gatewayRoute) {
      return Promise.resolve(gatewayInformation);
    }

    return originalGet(route, options);
  };
}

