import assert from 'node:assert/strict';
import { it } from 'vitest';
import { parseVersion, typePackageVersion } from './version.mjs';

it('preserves package versions and maps hotfix artifacts to valid SemVer', () => {
	assert.equal(typePackageVersion('1.14.0'), '1.14.0');
	assert.equal(typePackageVersion('1.13.6.1'), '1.13.6+hotfix.1');
	assert.equal(typePackageVersion('2.15.0.0'), '2.15.0+hotfix.0');
	assert.deepEqual(parseVersion('1.13.6.1'), { apiMajor: 1, generation: 13, patch: 6, hotfix: 1 });
});

it('rejects lossy, ambiguous, or nonnumeric versions before producing artifacts', () => {
	for (const version of ['', '1.14', '1.014.0', '1.14.0-beta', '1.14.0+build', '1.14.0.1.2', '0.14.0', '1.0.0', '1.14.9007199254740992', null]) {
		assert.throws(() => parseVersion(version));
	}
});
