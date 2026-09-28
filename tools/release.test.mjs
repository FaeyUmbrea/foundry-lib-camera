import { describe, expect, it } from 'vitest';
import { releaseManifest } from './release.mjs';

describe('generation-specific release artifacts', () => {
	it('keeps old-generation hotfixes on their own channel and immutable download', () => {
		const manifest = releaseManifest({ id: 'lib-camera' }, '1.13.6.1');
		expect(manifest.compatibility).toEqual({ minimum: '13.351', verified: '13.351', maximum: '13' });
		expect(manifest.manifest).toContain('/13/module.json');
		expect(manifest.download).toContain('/v1.13.6.1/module.zip');
	});
	it('uses main for stable v14 and refuses unsupported generations', () => {
		expect(releaseManifest({}, '1.14.0').manifest).toContain('/main/module.json');
		expect(() => releaseManifest({}, '1.15.0')).toThrow('verified');
	});
});
