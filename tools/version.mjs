/** Foundry compares dotted numbers; the optional fourth number is not npm SemVer. */
export function parseVersion(version) {
	if (typeof version !== 'string' || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?$/.test(version)) {
		throw new TypeError('Expected API-major.Foundry-generation.patch[.hotfix]');
	}
	const [apiMajor, generation, patch, hotfix] = version.split('.').map(Number);
	if (![apiMajor, generation, patch, hotfix ?? 0].every(Number.isSafeInteger) || apiMajor < 1 || generation < 1) {
		throw new RangeError('Version segments must be safe integers with positive API and Foundry generations');
	}
	return { apiMajor, generation, patch, hotfix };
}

/** Type packages are private, installed by exact release URL, and never ranged on npm. */
export function typePackageVersion(version) {
	const { apiMajor, generation, patch, hotfix } = parseVersion(version);
	return `${apiMajor}.${generation}.${patch}${hotfix === undefined ? '' : `+hotfix.${hotfix}`}`;
}
