import { parseVersion, typePackageVersion } from './version.mjs';

export const typePackageName = '@faeyumbrea/lib-camera-api-types';

export function npmPackageMetadata(version) {
	const { generation } = parseVersion(version);
	if (![13, 14].includes(generation)) throw new RangeError('Only verified Foundry generations 13 and 14 can be packaged');
	return {
		name: typePackageName,
		version: typePackageVersion(version),
		description: `Public API declarations for libCamera ${version} on Foundry ${generation}.`,
		license: 'Apache-2.0',
		repository: { type: 'git', url: 'git+https://github.com/FaeyUmbrea/foundry-lib-camera.git' },
		homepage: `https://docs.void.monster/lib-camera/public/${version}/dev/`,
		types: './public-api.d.ts',
		exports: { '.': { types: './public-api.d.ts' } },
		files: ['**/*.d.ts', 'LICENSE', 'README.md'],
		publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/', tag: generation === 14 ? 'latest' : 'foundry-13' },
	};
}

export function archiveFiles(listing) {
	const files = listing.trim().split('\n').filter(entry => !entry.endsWith('/'));
	if (!files.length || new Set(files).size !== files.length) throw new Error('Empty archive or duplicate entries');
	for (const entry of files) {
		const parts = entry.split('/');
		if (parts[0] !== 'package' || parts.some(part => !/^[\w.-]+$/.test(part) || part === '.' || part === '..')
			|| !(/\.d\.ts$/.test(entry) || ['package/package.json', 'package/LICENSE', 'package/README.md'].includes(entry))) {
			throw new Error(`Unexpected type-package entry: ${entry}`);
		}
	}
	for (const required of ['package/package.json', 'package/public-api.d.ts', 'package/LICENSE']) {
		if (!files.includes(required)) throw new Error(`Missing ${required}`);
	}
	return files;
}
