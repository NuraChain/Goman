// `npm run dev` means development, and nothing else may say otherwise.
//
// `NODE_ENV` cannot be set from `.env`: the framework reads it before a file could be loaded,
// and a local `.env` pinning `production` (which is what running the built app locally wants)
// would otherwise quietly turn the dev session off. An `--import` module runs before the entry,
// which is early enough.
process.env['NODE_ENV'] = 'development';
