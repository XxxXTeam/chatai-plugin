import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
    {
        ignores: [
            'frontend/**',
            'resources/**',
            'data/**',
            'node_modules/**',
            'dist/**',
            'build/**',
            'temp/**',
            '.next/**',
            'docs/**',
            '*.md'
        ]
    },
    {
        linterOptions: {
            reportUnusedDisableDirectives: false
        }
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.es2024,
                Bot: 'readonly',
                plugin: 'readonly',
                segment: 'readonly',
                logger: 'readonly'
            }
        },
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }
            ],
            '@typescript-eslint/no-empty-function': ['warn', { allow: ['arrowFunctions', 'functions', 'methods'] }],
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/naming-convention': [
                'warn',
                {
                    selector: 'variable',
                    format: null,
                    filter: { regex: '_', match: true }
                },
                { selector: 'default', format: null }
            ],
            '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-useless-escape': 'off',
            'no-case-declarations': 'off',
            'no-control-regex': 'off'
        }
    },
    {
        files: ['src/services/media/RenderService.js'],
        languageOptions: {
            globals: {
                window: 'readonly',
                document: 'readonly'
            }
        }
    },
    {
        files: ['test/**/*'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off'
        }
    }
)
