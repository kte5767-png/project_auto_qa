import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
	{
		ignores: ['**/node_modules/**', '**/dist/**', '**/dist-webos/**', '**/coverage/**', '**/.data/**']
	},
	js.configs.recommended,
	tseslint.configs.strict,
	{
		languageOptions: {
			globals: { ...globals.node }
		},
		rules: {
			'@typescript-eslint/consistent-type-imports': 'error'
		}
	},
	{
		files: ['fixtures/*/src/**/*.{ts,tsx}', 'apps/web/src/**/*.{ts,tsx}'],
		languageOptions: {
			globals: { ...globals.browser }
		}
	}
);
