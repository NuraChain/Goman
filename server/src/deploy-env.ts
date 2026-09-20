// `npm start` means production, and `.env` must not quietly say otherwise.
//
// The twin of `dev-env.ts`, and it exists for the same reason read from the other end. The
// framework reads `NODE_ENV` before a file could be loaded, and `server/.env` ships
// `NODE_ENV=development` because that is what a local checkout wants - so a bare
// `node src/main.ts` booted the VITE DEV SESSION while looking exactly like a production start.
// Nothing said so: the log line reads `env=development` and is the only tell.
//
// That is the worst shape a deployment bug can take, because dev hides precisely the things
// production adds - the kit's dev session ignores `cache`, renders static pages live, and takes a
// different path to the shell - so `npm run build && npm start` would have verified none of them.
//
// `??=` rather than an assignment: this file says what `npm start` MEANS, not what an operator
// is allowed to mean. Someone who writes `NODE_ENV=staging npm start` still wins, and
// `process.loadEnvFile` in `main.ts` never overwrites a variable that is already set.
process.env['NODE_ENV'] ??= 'production';
