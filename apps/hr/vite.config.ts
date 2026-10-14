import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// 5175 is the hotel app's dev port; HR runs beside it.
	server: { port: 5176, allowedHosts: true },
	// The live-DB suites share one organization row (its payroll day-factor) and one set of payroll
	// cutoffs, so they must not run side by side.
	test: { include: ['src/**/*.{test,spec}.{js,ts}'], fileParallelism: false }
});
