import { describe, expect, it } from 'vitest';
import { archiveFiles, npmPackageMetadata } from './npm-package.mjs';

describe('npm release contract', () => {
	it('publishes older Foundry types without moving latest, and has no runtime entry point', () => {
		const older = npmPackageMetadata('1.13.0');
		expect(older.publishConfig).toMatchObject({ access: 'public', tag: 'foundry-13' });
		expect(older.private).toBeUndefined();
		expect(older.main).toBeUndefined();
		expect(older.exports).toEqual({ '.': { types: './public-api.d.ts' } });
		expect(npmPackageMetadata('1.14.0').publishConfig.tag).toBe('latest');
		expect(npmPackageMetadata('1.14.0.1').version).not.toBe(npmPackageMetadata('1.14.0.2').version);
	});
	it('rejects runtime payloads, traversal, duplicates, and incomplete archives', () => {
		const valid = 'package/package.json\npackage/public-api.d.ts\npackage/LICENSE\n';
		expect(archiveFiles(valid)).toHaveLength(3);
		for (const extra of ['package/index.js', 'package/../outside.d.ts', '/package/types.d.ts', 'package/public-api.d.ts']) {
			expect(() => archiveFiles(valid + extra)).toThrow();
		}
		expect(() => archiveFiles('package/package.json')).toThrow();
	});
});
