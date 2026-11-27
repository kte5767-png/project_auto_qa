import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: [
			'packages/*/src/**/*.test.ts',
			'apps/*/src/**/*.test.ts',
			'apps/*/server/**/*.test.ts',
			'fixtures/*/src/**/*.test.ts',
			'spikes/*/*.test.ts'
		],
		environment: 'node'
	}
});
