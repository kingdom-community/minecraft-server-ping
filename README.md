# @kingdom-community/minecraft-server-ping

A zero-dependency TypeScript implementation of the Minecraft **Server List
Ping** protocol — the exchange your game client performs when it shows a
server's MOTD and player count in the multiplayer list.

Point it at a host and it opens a TCP socket, speaks the
handshake/request/response exchange by hand over `node:net`, and hands back the
MOTD, player counts, version, favicon and round-trip latency. When the server is
down, silent, or answering with something that is not this protocol, that comes
back as a **value**, not an exception.

- No runtime dependencies. The protocol is a handful of varints and one JSON
  blob; a socket and a JSON parser are both already in the standard library.
- Node ESM and CommonJS builds, with types for both.
- The wire format is exported as pure functions, so you can test against it
  without a socket.

## Install

```bash
npm install @kingdom-community/minecraft-server-ping
```

Node 18 or newer. Server-side only — the protocol is raw TCP rather than HTTP,
so there is no browser equivalent; a web page that wants this number has to ask
a Node process for it.

## Usage

```ts
import {ping} from '@kingdom-community/minecraft-server-ping';

const result = await ping('play.example.com');

if (result.online) {
    console.log(result.address);          // "play.example.com"
    console.log(result.motd);             // "An Open Minecraft Server"
    console.log(result.version);          // "Paper 1.21.4"
    console.log(result.protocolVersion);  // 769
    console.log(result.players);          // {online: 4, max: 32, sample: [...]}
    console.log(result.favicon);          // "data:image/png;base64,..." or null
    console.log(result.latencyMs);        // 41
} else {
    console.log(result.reason);           // "unreachable" | "timeout" | "malformed" | "invalid-address"
    console.log(result.error.message);
}
```

`ping()` never rejects. Whether a server is up is a fact about the world, not an
exceptional condition in your program, so it arrives as a value.

### Addresses and ports

All three of these describe the same server:

```ts
await ping('play.example.com');                        // port defaults to 25565
await ping('play.example.com', 25566);
await ping('play.example.com:25566');
```

An explicit `port` argument wins over a port embedded in the string, so passing
both gets you the one you wrote at the call site rather than a silent surprise.

`parseServerAddress()` is the same rule on its own, with no network involved —
useful for validating configuration, and for printing an address:

```ts
import {parseServerAddress} from '@kingdom-community/minecraft-server-ping';

parseServerAddress('play.example.com:25565');
// {host: 'play.example.com', port: 25565, display: 'play.example.com'}
```

`display` is exactly what a player should type into their client. The port is
dropped when it is the default, because that is what they are told everywhere
else and an explicit `:25565` invites a typo. Anything that is not an address a
player could actually use — blank, a URL, a malformed or out-of-range port —
returns `null` rather than a plausible-looking value someone might try to type.

### Options

```ts
await ping('play.example.com', undefined, {
    timeoutMs: 5000,        // default 2000
    maxResponseBytes: 65536 // default 262144
});
```

`timeoutMs` covers connect, write and read together: the question a ping answers
is "can a player connect right now", and a server that accepts a socket and then
says nothing fails that just as surely as a refusal. The default is deliberately
short — most callers render "offline" until told otherwise, so a slow server
costs nothing but this timer.

`maxResponseBytes` is a hard ceiling on what is read from the peer. A status
response is a few hundred bytes and a favicon pushes it to a few kilobytes;
anything beyond that is not answering the protocol, and reading it unbounded
would be a memory sink on a socket somebody else controls.

### Failure reasons

`result.reason` distinguishes the two kinds of "no status", which usually want
different responses from you:

| `reason` | What happened | Usually means |
|---|---|---|
| `invalid-address` | The address could not be parsed at all. No socket was opened. | A configuration mistake. |
| `unreachable` | Refused, unresolvable, or closed before answering. | The server is off, or the host is wrong. |
| `timeout` | Accepted the socket, then said nothing inside `timeoutMs`. | The server is up but wedged, or the network is bad. |
| `malformed` | Answered, but not with a Server List Ping status. | Something else is listening — usually the wrong port. |

If you only care whether players can join, treat every failure the same and read
`result.online`.

### Lower layers

`ping()` is a thin shell over two lower layers, both exported:

```ts
import {
    pingEndpoint,        // the socket exchange; rejects with a PingError
    handshakePacket,     // the wire format, pure and testable
    statusRequestPacket,
    readStatusResponse,
    parseStatusPayload,  // ping JSON -> ServerStatus, no socket involved
    encodeVarInt,
    decodeVarInt
} from '@kingdom-community/minecraft-server-ping';

// The raw status JSON, exactly as the server sent it.
const {payload, latencyMs} = await pingEndpoint(
    {host: 'play.example.com', port: 25565, display: 'play.example.com'}
);
```

`ping()` also carries the untouched JSON on `result.raw`, for the fields this
package does not model — servers put all sorts of things there.

### Reading an address from the environment

```ts
import {endpointFromEnv} from '@kingdom-community/minecraft-server-ping';

const endpoint = endpointFromEnv();                       // MINECRAFT_SERVER_ADDRESS
const other = endpointFromEnv('MY_COMMUNITY_SERVER');     // or any name you like
```

| Variable | Default | Meaning |
|---|---|---|
| `MINECRAFT_SERVER_ADDRESS` | unset | `host` or `host:port`. Only read when you call `endpointFromEnv()`; nothing in this package reads the environment on its own. |

It reads the variable on every call rather than caching it at import time, so a
process that changes it — or a test that stubs it — gets the current value.

## The protocol, briefly

The exchange, in order:

```
-> handshake  : packet id 0x00, protocol version, host, port, next state 1
-> request    : packet id 0x00, empty
<- response   : packet id 0x00, one length-prefixed UTF-8 JSON string
```

Every packet is itself prefixed with its length as a varint, and varints are
7 bits of payload per byte with the high bit set while more follow.

The handshake sends protocol version **-1**, meaning "unspecified", which every
server answers a status request for. Sending a real version number would make an
out-of-date client look incompatible to the very server it is asking about.

## What this does not do

- **No SRV record lookup.** `play.example.com` is connected to directly on 25565
  unless you say otherwise. A client resolves `_minecraft._tcp.<host>` first;
  this does not, so pass the real host and port for a server that publishes one.
- **No legacy ping.** Only the modern (1.7+) protocol. Servers older than that
  speak a different, incompatible exchange.
- **No query protocol.** The UDP query port exposes plugin lists and a full
  player roster; this is TCP Server List Ping only.
- **No caching.** One call is one TCP connection. If a hundred visitors can
  trigger this, cache the result yourself — a few tens of seconds is plenty for a
  number that is stale in three anyway, and cache failures for the same window as
  successes, because an offline server is exactly when everyone refreshes.

## Development

```bash
npm install
npm test        # vitest, against a loopback stub that speaks the protocol back
npm run build   # ESM + CJS + type declarations into dist/
```

The tests need no network access and no running Minecraft server: they bind
`127.0.0.1` on an ephemeral port and answer with real, correctly framed packets.

## Origins

Extracted from the website and infrastructure stack behind a Minecraft community
server, generalised and released under MIT.

## License

MIT — see [LICENSE](LICENSE).
