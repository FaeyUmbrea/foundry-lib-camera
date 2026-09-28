import { spawnSync } from 'node:child_process';
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseVersion } from './version.mjs';

export function releaseManifest(source, version, base = 'https://github.com/FaeyUmbrea/foundry-lib-camera') {
	const { generation } = parseVersion(version);
	if (![13, 14].includes(generation)) throw new RangeError('Only verified Foundry generations 13 and 14 can be packaged');
	const branch = generation === 14 ? 'main' : String(generation);
	return {
		...source,
		version,
		compatibility: { minimum: generation === 13 ? '13.351' : '14', verified: generation === 13 ? '13.351' : '14.363', maximum: String(generation) },
		url: base,
		manifest: `https://raw.githubusercontent.com/FaeyUmbrea/foundry-lib-camera/${branch}/module.json`,
		download: `${base}/releases/download/v${version}/module.zip`,
		readme: `${base}/blob/${branch}/README.md`,
	};
}

async function main() {
	const source = JSON.parse(await readFile('module.json', 'utf8'));
	const version = process.argv[2] ?? source.version;
	const manifest = releaseManifest(source, version);
	const { generation } = parseVersion(version);
	if (process.env.GITHUB_ACTIONS && (source.version !== version || process.env.GITHUB_REF_NAME !== (generation === 14 ? 'main' : String(generation)))) {
		throw new Error('Release the version declared on its matching generation branch');
	}
	const output = path.resolve('.release', version);
	const staging = path.join(output, 'module');
	await rm(output, { recursive: true, force: true });
	await mkdir(staging, { recursive: true });
	for (const entry of ['dist', 'templates', 'lang', 'LICENSE', 'README.md']) await cp(entry, path.join(staging, entry), { recursive: true });
	await writeFile(path.join(staging, 'module.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	await copyFile(path.join(staging, 'module.json'), path.join(output, 'module.json'));
	const zip = spawnSync('zip', ['-qr', path.join(output, 'module.zip'), '.'], { cwd: staging, stdio: 'inherit' });
	if (zip.status !== 0) throw new Error('Module archive failed');
	const types = spawnSync(process.execPath, ['tools/build-api-types.mjs'], { env: { ...process.env, API_TYPES_VERSION: version }, stdio: 'inherit' });
	if (types.status !== 0) throw new Error('API declaration build failed');
	const tar = spawnSync('tar', ['-czf', path.join(output, 'lib-camera-api-types.tgz'), '-C', '.release/api-types', 'package'], { stdio: 'inherit' });
	if (tar.status !== 0) throw new Error('API archive failed');
	process.stdout.write(`${output}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
