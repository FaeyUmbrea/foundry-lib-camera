# libCamera API types

TypeScript declarations for libCamera's public API. Foundry loads the installed
module at runtime; this package only supplies types for your integration.

Install the exact package version matching the libCamera release you support.
For example:

```sh
npm install --save-dev --save-exact @faeyumbrea/lib-camera-api-types@1.14.0
```

```ts
import type { ModuleApi } from '@faeyumbrea/lib-camera-api-types';

const camera = game.modules.get('lib-camera')?.api as ModuleApi | undefined;
if (!camera || camera.apiMajor !== 1) {
  throw new Error('This integration needs libCamera API 1.');
}
```

Use type-only imports. There is no JavaScript entry point in this package.
The second version number is the Foundry generation: `1.13.x` targets Foundry 13,
and `1.14.x` targets Foundry 14. A module hotfix such as `1.14.0.1` maps to npm
version `1.14.0-hotfix.1`; pin it explicitly rather than relying on a version range.

[Developer guides and released API references](https://docs.void.monster/lib-camera/)
cover registration, ownership, movement, and lifecycle handling.
