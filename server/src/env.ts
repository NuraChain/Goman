// Environment reading, declared once per variable. A missing variable with no default is a
// BOOT failure with the variable's name in the message - not an `undefined` that survives to
// the first request and fails somewhere unrelated. Call after `process.loadEnvFile()`.

export interface Spec<T> {
    read(name: string): T;
}

/** A string variable. */
export function str(name: string, options: { default?: string } = {}): Spec<string> & { name: string } {
    return {
        name,
        read: () => {
            const raw = process.env[name];
            if (raw === undefined || raw === '') {
                if (options.default === undefined) {
                    throw new Error(`Missing required environment variable ${name}`);
                }
                return options.default;
            }
            return raw;
        }
    };
}

/** A numeric variable. A non-numeric value is a boot failure, never a silent NaN. */
export function num(name: string, options: { default?: number } = {}): Spec<number> & { name: string } {
    return {
        name,
        read: () => {
            const raw = process.env[name];
            if (raw === undefined || raw === '') {
                if (options.default === undefined) {
                    throw new Error(`Missing required environment variable ${name}`);
                }
                return options.default;
            }
            const parsed = Number(raw);
            if (!Number.isFinite(parsed)) {
                throw new Error(`Environment variable ${name} must be a number, got ${JSON.stringify(raw)}`);
            }
            return parsed;
        }
    };
}

/** A variable constrained to a fixed set - the set appears in the failure message. */
export function oneOf<const T extends readonly string[]>(
    name: string,
    values: T,
    options: { default?: T[number] } = {}
): Spec<T[number]> & { name: string } {
    return {
        name,
        read: () => {
            const raw = process.env[name];
            if (raw === undefined || raw === '') {
                if (options.default === undefined) {
                    throw new Error(`Missing required environment variable ${name}`);
                }
                return options.default;
            }
            if (!values.includes(raw)) {
                throw new Error(
                    `Environment variable ${name} must be one of ${values.join(', ')}, got ${JSON.stringify(raw)}`
                );
            }
            return raw as T[number];
        }
    };
}

/** Reads a whole config block at once, so every variable is named in one place. */
export function loadConfig<S extends Record<string, Spec<unknown> & { name: string }>>(
    specs: S
): { [K in keyof S]: S[K] extends Spec<infer T> ? T : never } {
    const out: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(specs)) {
        out[key] = spec.read(spec.name);
    }
    return out as { [K in keyof S]: S[K] extends Spec<infer T> ? T : never };
}
