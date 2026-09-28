import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import moduleJSON from './module.json' with { type: 'json' };

const packagePath = `modules/${moduleJSON.id}`;

export default defineConfig(({ mode }) => ({
	root: 'src',
	base: `/${packagePath}/dist`,
	publicDir: false,
	cacheDir: '../.vite-cache',

	resolve: {
		conditions: ['browser', 'import'],
	},

	test: {
		globals: true,
		environment: 'node',
		exclude: [...configDefaults.exclude, '../tests/**'],
	},

	server: {
		port: 30001,
		open: false,
		proxy: {
			[`^(/${packagePath}/(assets|lang|packs|storage|dist/${moduleJSON.id}.css))`]: 'http://localhost:30000',
			[`^(?!/${packagePath}/)`]: 'http://localhost:30000',
			[`/${packagePath}/dist/${moduleJSON.id}.js`]: {
				target: `http://localhost:30001/${packagePath}/dist`,
				rewrite: () => '/index.ts',
			},
			'/socket.io': { target: 'ws://localhost:30000', ws: true },
		},
	},

	build: {
		outDir: '../dist',
		emptyOutDir: true,
		sourcemap: true,
		minify: mode === 'production',
		target: ['esnext', 'chrome127'],
		cssCodeSplit: false,
		lib: {
			entry: './index.ts',
			formats: ['es'],
			fileName: moduleJSON.id,
			cssFileName: moduleJSON.id,
		},
	},

	plugins: [
		visualizer(),
	],
}));
