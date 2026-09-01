// The root package.json says "type": "module", which would make Node read the
// CommonJS build's .js files as ESM. A one-line package.json inside the CJS
// output directory overrides that for those files only — the standard way to
// ship both flavours from one source tree without a bundler.
import {writeFileSync} from 'node:fs';

writeFileSync('dist/cjs/package.json', `${JSON.stringify({type: 'commonjs'}, null, 2)}\n`);
