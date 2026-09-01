// Print a server's status. Run against the built package:
//
//   npm run build && node examples/status.mjs play.example.com
//   node examples/status.mjs play.example.com 25566

import {ping} from '../dist/esm/index.js';

const [host = 'play.example.com', port] = process.argv.slice(2);

const result = await ping(host, port ? Number(port) : undefined, {timeoutMs: 3000});

if (!result.online) {
    console.log(`${host} is offline (${result.reason}): ${result.error.message}`);
    process.exit(1);
}

console.log(`address  ${result.address}`);
console.log(`motd     ${result.motd ?? '(none)'}`);
console.log(`version  ${result.version ?? '(unreported)'}`);
console.log(`players  ${result.players ? `${result.players.online}/${result.players.max}` : '(unreported)'}`);
console.log(`icon     ${result.favicon ? `${result.favicon.length} bytes` : '(none)'}`);
console.log(`latency  ${result.latencyMs}ms`);
