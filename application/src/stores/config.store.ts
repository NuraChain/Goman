// The chain configuration, served by the indexer: factory/treasury addresses and the last
// indexed block. One fetch per session replaces every hardcoded address map.

import { createStore, createResource, type Resource } from '../lib/reactive.ts';

import { client, type ChainConfig } from '../api.ts';

export const useConfig = createStore((): Resource<ChainConfig> =>
    createResource(() => client.chain.config(), { name: 'chain-config' })
);
