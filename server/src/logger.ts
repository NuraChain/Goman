// The log surface, message-first: `log.info('indexed', { from, to })`. Pino's own argument
// order is the opposite (fields first, message second), and every call site in this server
// reads better the other way round - so the order is normalised here, once, rather than at
// forty call sites.
//
// Pretty lines on the terminal, clean NDJSON in server/logs/ - both, in every mode. The file
// half is what survives the terminal scrollback when something failed an hour ago.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import pino from 'pino';

export type LogFields = Record<string, unknown>;

export interface Logger {
    debug(message: string, fields?: LogFields): void;
    info(message: string, fields?: LogFields): void;
    warn(message: string, fields?: LogFields): void;
    error(message: string, fields?: LogFields): void;
}

export interface LoggerOptions {
    /** Directory the NDJSON file lands in. Created if missing. */
    directory: URL;

    /** Fields stamped onto every line (the service name, a deployment id). */
    fields?: LogFields;

    /** Terminal colour and time formatting. Off when stdout is not a TTY. */
    pretty?: boolean;
}

export function createLogger(options: LoggerOptions): Logger {
    const directory = fileURLToPath(options.directory);
    mkdirSync(directory, { recursive: true });

    const pretty = options.pretty ?? process.stdout.isTTY === true;
    const transport = pino.transport({
        targets: [
            pretty
                ? {
                      target: 'pino-pretty',
                      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' }
                  }
                : { target: 'pino/file', options: { destination: 1 } },
            { target: 'pino/file', options: { destination: `${directory}/server.log`, mkdir: true } }
        ]
    });

    const base = pino({ base: options.fields ?? {} }, transport);

    return {
        debug: (message, fields) => base.debug(fields ?? {}, message),
        info: (message, fields) => base.info(fields ?? {}, message),
        warn: (message, fields) => base.warn(fields ?? {}, message),
        error: (message, fields) => base.error(fields ?? {}, message)
    };
}
