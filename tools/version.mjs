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

/** npm ignores build metadata when identifying versions, so hotfixes need a prerelease suffix. */
export function typePackageVersion(version) {
	const { apiMajor, generation, patch, hotfix } = parseVersion(version);
	return `${apiMajor}.${generation}.${patch}${hotfix === undefined ? '' : `-hotfix.${hotfix}`}`;
}

/** Compare in module release order; -hotfix.N represents a later four-part release. */
export function compareTypePackageVersions(left, right) {
	const a = parseVersion(left.replace('-hotfix.', '.'));
	const b = parseVersion(right.replace('-hotfix.', '.'));
	for (const field of ['apiMajor', 'generation', 'patch', 'hotfix']) {
		const difference = (a[field] ?? -1) - (b[field] ?? -1);
		if (difference !== 0) return difference;
	}
	return 0;
}
