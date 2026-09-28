import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { typePackageVersion } from './version.mjs';

async function main() {
	const outputDirectory = path.resolve('.release/api-types/package');
	const sourcePackage = JSON.parse(await readFile('package.json', 'utf8'));
	const version = typePackageVersion(process.env.API_TYPES_VERSION ?? sourcePackage.version);

	await rm(path.dirname(outputDirectory), { recursive: true, force: true });
	await mkdir(outputDirectory, { recursive: true });

	const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.api-types.json'], { stdio: 'inherit' });
	if (result.status !== 0) process.exit(result.status ?? 1);

	const artifactPackage = {
		name: '@faeyumbrea/lib-camera-api-types',
		version,
		private: true,
		license: sourcePackage.license,
		types: './public-api.d.ts',
		exports: {
			'.': {
				types: './public-api.d.ts',
			},
		},
	};
	await copyFile('LICENSE', path.join(outputDirectory, 'LICENSE'));

	await writeFile(
		path.join(outputDirectory, 'package.json'),
		`${JSON.stringify(artifactPackage, null, 2)}\n`,
	);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
