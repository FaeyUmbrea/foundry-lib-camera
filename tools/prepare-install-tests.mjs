import { spawnSync } from 'node:child_process';
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { releaseManifest } from './release.mjs';

async function main() {
	const generation = Number(process.argv[2]);
	const source = process.env.FOUNDRY_DATA_PATH;
	if (![13, 14].includes(generation) || !source) throw new Error('Set FOUNDRY_DATA_PATH and pass generation 13 or 14');
	const root = await mkdtemp(path.join(tmpdir(), `libcamera-install-${generation}-`));
	const runtime = path.join(root, 'runtime');
	const packages = path.join(root, 'packages');
	await mkdir(path.join(runtime, 'Config'), { recursive: true });
	await mkdir(packages);
	await copyFile(path.join(source, 'Config', 'license.json'), path.join(runtime, 'Config', 'license.json'));
	await chmod(path.join(runtime, 'Config', 'license.json'), 0o600);
	await cp(path.join(source, 'Data', 'modules', 'lib-wrapper'), path.join(runtime, 'Data', 'modules', 'lib-wrapper'), { recursive: true });
	await writeFile(path.join(runtime, 'Config', 'options.json'), JSON.stringify({ port: 30099, hostname: 'localhost', upnp: false, telemetry: false, adminPassword: null }));
	const manifest = JSON.parse(await readFile('module.json', 'utf8'));
	// Synthetic version variants exercise install, hotfix and dependency-boundary behavior using this build.
	for (const version of [`1.${generation}.0`, `1.${generation}.0.1`, `2.${generation}.0`, `1.${generation === 13 ? 14 : 13}.0`]) {
		const directory = path.join(packages, version);
		await mkdir(directory);
		const staging = path.join(root, `module-${version}`);
		await mkdir(staging);
		for (const entry of ['dist', 'templates', 'lang', 'LICENSE', 'README.md']) await cp(entry, path.join(staging, entry), { recursive: true });
		const variant = releaseManifest(manifest, version);
		variant.manifest = `http://127.0.0.1:30097/${version}/module.json`;
		variant.download = `http://127.0.0.1:30097/${version}/module.zip`;
		const text = `${JSON.stringify(variant, null, '\t')}\n`;
		await writeFile(path.join(staging, 'module.json'), text);
		await writeFile(path.join(directory, 'module.json'), text);
		const zip = spawnSync('zip', ['-qr', path.join(directory, 'module.zip'), '.'], { cwd: staging, stdio: 'inherit' });
		if (zip.status !== 0) throw new Error('Test archive creation failed');
	}
	for (const [name, major] of [['compatible', 1], ['incompatible', 2]]) {
		const directory = path.join(packages, name);
		await mkdir(directory);
		const consumer = {
			id: `lib-camera-test-${name}`,
			title: `libCamera installation test (${name})`,
			version: '1.0.0',
			compatibility: { minimum: String(generation), verified: String(generation), maximum: String(generation) },
			manifest: `http://127.0.0.1:30097/${name}/module.json`,
			download: `http://127.0.0.1:30097/${name}/module.zip`,
			relationships: { requires: [{
				id: 'lib-camera',
				type: 'module',
				manifest: `http://127.0.0.1:30097/${major}.${generation}.0/module.json`,
				compatibility: { minimum: '1.13.0', maximum: '1.999' },
			}] },
		};
		await writeFile(path.join(directory, 'module.json'), `${JSON.stringify(consumer, null, '\t')}\n`);
		const zip = spawnSync('zip', ['-q', 'module.zip', 'module.json'], { cwd: directory, stdio: 'inherit' });
		if (zip.status !== 0) throw new Error('Consumer test archive creation failed');
	}
	process.stdout.write(`${JSON.stringify({ runtime, packages, generation })}\n`);
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
