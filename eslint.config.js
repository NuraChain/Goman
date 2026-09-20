// The one lint and layout authority for both workspaces.
//
// This replaces oxlint + oxfmt. Two reasons, neither stylistic: oxlint cannot parse `.azeroth`
// at all, and oxfmt has no brace-style option - `.oxfmtrc.jsonc` said so itself, and recorded
// that it had flattened the allman braces this tree was written in. The AzerothJS house style
// is that original style, so the rules below restore it rather than inventing one.
//
// There is no AzerothJS formatter package, so layout is enforced by @stylistic rules with
// `--fix` rather than by a formatter. That is a real downgrade from `oxfmt --check .` for
// `.azeroth` markup, which stays editor-only (the language server formats TS regions).
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import azeroth from '@azerothjs/eslint-plugin';

/** Paths no tool owns: build output, vendored data, and the lockfile. */
const IGNORED = ['**/dist/**', '**/dist-server/**', '**/node_modules/**', '**/build/**', '**/.azeroth/**'];

/** The house layout, applied identically to every source file. Mirrors `.oxfmtrc.jsonc`'s
 *  settled values - 4 space, single quotes, semicolons, no trailing commas, 120 columns -
 *  and adds the one thing oxfmt could not express. */
const layout = {
    '@stylistic/brace-style': ['error', 'allman', { allowSingleLine: true }],
    '@stylistic/indent': ['error', 4, { SwitchCase: 1 }],
    '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
    '@stylistic/semi': ['error', 'always'],
    '@stylistic/comma-dangle': ['error', 'never'],
    '@stylistic/eol-last': ['error', 'always'],
    '@stylistic/no-trailing-spaces': 'error',
    '@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxBOF: 0, maxEOF: 0 }],
    '@stylistic/space-before-blocks': 'error',
    '@stylistic/template-curly-spacing': ['error', 'always']
};

/** The rule intent carried over from `.oxlintrc.jsonc`, which is deleted with this commit. */
const typescript = {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
    '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports', disallowTypeAnnotations: false }
    ],
    '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'explicit', overrides: { constructors: 'no-public' } }
    ],
    '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }
    ],
    '@typescript-eslint/no-namespace': 'error',
    '@typescript-eslint/explicit-function-return-type': [
        'warn',
        { allowExpressions: true, allowTypedFunctionExpressions: true }
    ]
};

export default [
    { ignores: IGNORED },
    js.configs.recommended,
    {
        files: ['**/*.{ts,tsx,azeroth}'],
        languageOptions: {
            parser: tsParser,
            parserOptions: { ecmaVersion: 2024, sourceType: 'module', ecmaFeatures: { jsx: true } }
        },
        plugins: { '@stylistic': stylistic, '@typescript-eslint': tsPlugin },
        rules: {
            ...layout,
            ...typescript,
            curly: ['error', 'all'],
            // TypeScript's own checker owns these; the base rules only produce false positives
            // on type-only syntax. `no-redeclare` in particular cannot read an overload set.
            'no-unused-vars': 'off',
            'no-undef': 'off',
            'no-redeclare': 'off'
        }
    },
    {
        // The service worker runs in ServiceWorkerGlobalScope, not a window: `self`, `caches`
        // and `clients` are its globals, and it is hand-written JS with no build step.
        files: ['application/public/sw.js'],
        languageOptions: {
            globals: { self: 'readonly', caches: 'readonly', clients: 'readonly', fetch: 'readonly', URL: 'readonly' }
        }
    },
    {
        // Tests carry their own conventions: an inferred return type is noise on a `it()`
        // callback, and a non-null assertion on a query result is the point of the query.
        files: ['**/tests/**/*.{ts,tsx}', '**/*.spec.{ts,tsx}'],
        rules: { '@typescript-eslint/explicit-function-return-type': 'off' }
    },
    // LAST, per the framework's own instruction: the `.azeroth` processor forwards compiler
    // diagnostics, and its markup rules must see the final rule set.
    ...azeroth.configs.recommended,
    {
        // A component's return type is its markup, and writing it out says nothing. The old
        // oxlint config turned this off for `.tsx` for the same reason, and the AzerothJS
        // convention turns it off for `.azeroth`.
        //
        // `**/*.azeroth/*.ts` is the processor's virtual file, which is what the rule actually
        // sees - and why this block has to come after the plugin rather than before it.
        files: ['**/*.tsx', '**/*.azeroth', '**/*.azeroth/*.ts', '**/*.js'],
        rules: { '@typescript-eslint/explicit-function-return-type': 'off' }
    }
];
