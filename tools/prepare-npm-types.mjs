import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { archiveFiles, npmPackageMetadata, typePackageName } from './npm-package.mjs';
import { parseVersion, typePackageVersion } from './version.mjs';

function run(command, args, binary = false) {
	const result = spawnSync(command, args, { encoding: binary ? undefined : 'utf8', maxBuffer: 16 * 1024 * 1024 });
	if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
	return result.stdout;
}

async function main() {
	const version = process.argv[2];
	parseVersion(version);
	const repository = 'FaeyUmbrea/foundry-lib-camera';
	const tag = `v${version}`;
	const release = JSON.parse(run('gh', ['release', 'view', tag, '--repo', repository, '--json', 'isDraft,isPrerelease,tagName']));
	if (release.isDraft || release.isPrerelease || release.tagName !== tag) throw new Error('Expected an exact, published stable module release');
	const temporary = await mkdtemp(path.join(tmpdir(), 'lib-camera-npm-'));
	try {
		run('gh', ['release', 'download', tag, '--repo', repository, '--pattern', 'lib-camera-api-types.tgz', '--pattern', 'module.json', '--dir', temporary]);
		const manifest = JSON.parse(await readFile(path.join(temporary, 'module.json'), 'utf8'));
		if (manifest.id !== 'lib-camera' || manifest.version !== version) throw new Error('Release manifest does not match libCamera version');
		const archive = path.join(temporary, 'lib-camera-api-types.tgz');
		const files = archiveFiles(run('tar', ['-tzf', archive]));
		const original = JSON.parse(run('tar', ['-xOzf', archive, 'package/package.json']));
		const legacyVersion = typePackageVersion(version).replace('-hotfix.', '+hotfix.');
		if (original.name !== typePackageName || ![typePackageVersion(version), legacyVersion].includes(original.version)
			|| original.types !== './public-api.d.ts' || original.license !== 'Apache-2.0') {
			throw new Error('Type archive metadata does not match release');
		}
		const output = path.resolve('.release/npm', version);
		await rm(output, { recursive: true, force: true });
		await mkdir(output, { recursive: true });
		for (const entry of files) {
			if (entry === 'package/package.json' || entry === 'package/README.md') continue;
			const destination = path.join(output, entry.slice('package/'.length));
			await mkdir(path.dirname(destination), { recursive: true });
			await writeFile(destination, run('tar', ['-xOzf', archive, entry], true));
		}
		await writeFile(path.join(output, 'package.json'), `${JSON.stringify(npmPackageMetadata(version), null, 2)}\n`);
		await writeFile(path.join(output, 'README.md'), await readFile('tools/api-types-readme.md'));
		process.stdout.write(`${output}\n`);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
