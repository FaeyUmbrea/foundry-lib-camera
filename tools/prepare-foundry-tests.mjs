import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

async function main() {
	// Reuse the seeded OBS Utils worlds; never migrate a source world in place.
	const generation = Number(process.argv[2]);
	const source = process.env.FOUNDRY_DATA_PATH;
	if (![13, 14].includes(generation) || !source) {
		throw new Error('Set FOUNDRY_DATA_PATH and pass Foundry generation 13 or 14');
	}
	const worldId = `obs-fixture-v${generation}`;
	const sourceWorld = path.join(source, 'Data', 'worlds', worldId);
	const world = JSON.parse(await readFile(path.join(sourceWorld, 'world.json'), 'utf8'));
	if (world.id !== worldId || !String(world.coreVersion).startsWith(`${generation}.`)) {
		throw new Error('The OBS Utils fixture does not match the requested Foundry generation');
	}
	if (typeof world.system !== 'string' || !/^[\w-]+$/.test(world.system)) throw new Error('Invalid fixture system ID');
	const runtime = await mkdtemp(path.join(tmpdir(), `libcamera-foundry-${generation}-`));
	const config = path.join(runtime, 'Config');
	await mkdir(config);
	await copyFile(path.join(source, 'Config', 'license.json'), path.join(config, 'license.json'));
	await chmod(path.join(config, 'license.json'), 0o600);
	for (const [kind, id] of [['worlds', worldId], ['systems', world.system], ['modules', 'lib-wrapper']]) {
		await cp(path.join(source, 'Data', kind, id), path.join(runtime, 'Data', kind, id), { recursive: true, dereference: true });
	}
	if (process.env.CANVAS3D_PATH) {
		const source3D = process.env.CANVAS3D_PATH;
		const manifest3D = JSON.parse(await readFile(path.join(source3D, 'module.json'), 'utf8'));
		if (manifest3D.id !== 'levels-3d-preview' || Number(manifest3D.compatibility.minimum) !== generation) {
			throw new Error('3D Canvas must match the requested Foundry generation');
		}
		await cp(source3D, path.join(runtime, 'Data', 'modules', 'levels-3d-preview'), { recursive: true });
	}
	const repository = fileURLToPath(new URL('../', import.meta.url));
	const modulePath = path.join(runtime, 'Data', 'modules', 'lib-camera');
	await mkdir(modulePath);
	for (const entry of ['dist', 'templates', 'lang', 'LICENSE']) {
		await cp(path.join(repository, entry), path.join(modulePath, entry), { recursive: true });
	}
	const manifest = JSON.parse(await readFile(path.join(repository, 'module.json'), 'utf8'));
	// The v13 test artifact exercises this source without changing main's v14 manifest.
	manifest.version = `${manifest.version.split('.')[0]}.${generation}.0`;
	manifest.compatibility = { minimum: generation === 13 ? '13.351' : '14', verified: String(generation), maximum: String(generation) };
	await writeFile(path.join(modulePath, 'module.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	await writeFile(path.join(config, 'options.json'), JSON.stringify({ port: 30098, hostname: 'localhost', upnp: false, telemetry: false, world: worldId, adminPassword: null }));
	process.stdout.write(`${runtime}\n`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
