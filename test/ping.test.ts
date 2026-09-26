import {afterEach, describe, expect, it} from 'vitest';

import {ping, pingEndpoint, PingError} from '../src/ping.js';
import {encodeVarInt} from '../src/varint.js';
import {listen, listenWithStatus, statusResponseFor, type StubServer} from './stubServer.js';

let stub: StubServer | null = null;

const start = async (server: Promise<StubServer>): Promise<number> => {
    stub = await server;
    return stub.port;
};

afterEach(async () => {
    const running = stub;
    stub = null;
    await running?.close();
});

const LIVE_PAYLOAD = {
    description: 'An Open Minecraft Server',
    players: {online: 3, max: 20, sample: []},
    version: {name: 'Spigot 26.1.2', protocol: 775}
};

describe('pingEndpoint', () => {
    it('completes a real handshake/request/response exchange over TCP', async () => {
        const port = await start(listenWithStatus(LIVE_PAYLOAD));
        const result = await pingEndpoint({host: '127.0.0.1', port, display: '127.0.0.1'}, {timeoutMs: 3000});
        expect(result.payload).toEqual(LIVE_PAYLOAD);
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('reassembles a response split across several TCP chunks', async () => {
        const response = statusResponseFor({players: {online: 0, max: 20}});
        const port = await start(listen((socket) => {
            socket.on('data', () => {
                socket.write(response.subarray(0, 2));
                setTimeout(() => socket.write(response.subarray(2)), 10);
            });
        }));

        await expect(pingEndpoint({host: '127.0.0.1', port, display: '127.0.0.1'}, {timeoutMs: 3000}))
            .resolves.toMatchObject({payload: {players: {online: 0, max: 20}}});
    });

    it('rejects when the peer accepts the socket and then says nothing', async () => {
        // Accept and stall: the worst case, because it is the one a
        // connect-only timeout would miss.
        const port = await start(listen(() => {}));

        await expect(pingEndpoint({host: '127.0.0.1', port, display: '127.0.0.1'}, {timeoutMs: 150}))
            .rejects.toThrow(/timed out/);
    });

    it('rejects as unreachable when the peer accepts the socket and then hangs up', async () => {
        // A proxy in front of a stopped server: accepted, so not a refusal, and
        // over long before the deadline, so not a stall either. The stub waits
        // for the handshake before ending, so the client's writes are read
        // rather than answered with a reset. `once`, because the two client
        // writes may arrive as one segment or as two and ending twice is an
        // error on the stub's own socket.
        const port = await start(listen((socket) => {
            socket.once('data', () => socket.end());
        }));

        const error = await pingEndpoint(
            {host: '127.0.0.1', port, display: '127.0.0.1'},
            {timeoutMs: 2000}
        ).catch((thrown: unknown) => thrown);

        expect(error).toBeInstanceOf(PingError);
        expect((error as PingError).reason).toBe('unreachable');
        expect((error as PingError).message).toMatch(/closed before a status response/);
    });

    it('carries the timeout reason on the error it rejects with, not only in the message', async () => {
        // `timeout` and `unreachable` are the two a caller is most likely to
        // confuse, and only the discriminant tells them apart in code.
        const port = await start(listen(() => {}));

        const error = await pingEndpoint(
            {host: '127.0.0.1', port, display: '127.0.0.1'},
            {timeoutMs: 300}
        ).catch((thrown: unknown) => thrown);

        expect(error).toBeInstanceOf(PingError);
        expect((error as PingError).reason).toBe('timeout');
    });

    it('rejects when the connection is refused', async () => {
        // Bind and immediately close, so the port is known to have nothing on it.
        const port = await start(listen(() => {}));
        await stub!.close();

        await expect(pingEndpoint({host: '127.0.0.1', port, display: '127.0.0.1'}, {timeoutMs: 1000}))
            .rejects.toThrow();
    });

    it('gives up rather than reading an unbounded response', async () => {
        const port = await start(listen((socket) => {
            // Claim a huge packet and then pour bytes in. A caller must not be
            // held to a peer's word about how much it is about to send.
            socket.on('data', () => {
                socket.write(encodeVarInt(0x7fffffff));
                const flood = Buffer.alloc(4096);
                for (let i = 0; i < 8; i += 1) {
                    socket.write(flood);
                }
            });
        }));

        await expect(pingEndpoint(
            {host: '127.0.0.1', port, display: '127.0.0.1'},
            {timeoutMs: 2000, maxResponseBytes: 1024}
        )).rejects.toThrow(/too large/);
    });
});

describe('ping', () => {
    it('returns a parsed status rather than raw JSON', async () => {
        const port = await start(listenWithStatus(LIVE_PAYLOAD));
        const outcome = await ping('127.0.0.1', port, {timeoutMs: 3000});

        expect(outcome).toMatchObject({
            online: true,
            host: '127.0.0.1',
            port,
            address: `127.0.0.1:${port}`,
            motd: 'An Open Minecraft Server',
            version: 'Spigot 26.1.2',
            protocolVersion: 775,
            players: {online: 3, max: 20, sample: []},
            favicon: null,
            raw: LIVE_PAYLOAD
        });
        expect(outcome.online && outcome.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('accepts the port inside the host string', async () => {
        const port = await start(listenWithStatus(LIVE_PAYLOAD));
        const outcome = await ping(`127.0.0.1:${port}`, undefined, {timeoutMs: 3000});
        expect(outcome.online).toBe(true);
        expect(outcome.port).toBe(port);
    });

    it('lets an explicit port argument win over one embedded in the host string', async () => {
        // Port 1 is where the ping would land if the string won, and nothing
        // can be listening there, so losing the precedence rule shows up as a
        // failed ping rather than as a quietly different connection.
        const port = await start(listenWithStatus(LIVE_PAYLOAD));

        const outcome = await ping('127.0.0.1:1', port, {timeoutMs: 3000});
        expect(outcome).toMatchObject({online: true, port, address: `127.0.0.1:${port}`});
    });

    // The whole point of the outcome type: none of these throw.
    it('reports an unreachable server as a value, not an exception', async () => {
        const port = await start(listen(() => {}));
        await stub!.close();

        const outcome = await ping('127.0.0.1', port, {timeoutMs: 1000});
        expect(outcome).toMatchObject({
            online: false,
            reason: 'unreachable',
            address: `127.0.0.1:${port}`
        });
        expect(outcome.online === false && outcome.error).toBeInstanceOf(PingError);
    });

    it('reports a stalled server as a timeout, distinct from unreachable', async () => {
        const port = await start(listen(() => {}));

        const outcome = await ping('127.0.0.1', port, {timeoutMs: 150});
        expect(outcome).toMatchObject({online: false, reason: 'timeout'});
    });

    it('reports a peer that hangs up part-way through its answer as unreachable', async () => {
        // Half a framed response and then a hang-up. `readStatusResponse`
        // correctly says "not a whole packet yet", so nothing here is
        // malformed — the close is what decides the outcome.
        const response = statusResponseFor(LIVE_PAYLOAD);
        const port = await start(listen((socket) => {
            socket.once('data', () => {
                socket.write(response.subarray(0, 4));
                socket.end();
            });
        }));

        const outcome = await ping('127.0.0.1', port, {timeoutMs: 2000});
        expect(outcome).toMatchObject({online: false, reason: 'unreachable'});
        expect(outcome.online === false && outcome.error.message)
            .toMatch(/closed before a status response/);
    });

    it('reports a peer that answers with the wrong packet id as malformed', async () => {
        const port = await start(listen((socket) => {
            socket.on('data', () => {
                const body = Buffer.concat([encodeVarInt(0x01), encodeVarInt(0)]);
                socket.write(Buffer.concat([encodeVarInt(body.length), body]));
            });
        }));

        const outcome = await ping('127.0.0.1', port, {timeoutMs: 2000});
        expect(outcome).toMatchObject({online: false, reason: 'malformed'});
        expect(outcome.online === false && outcome.error.message).toMatch(/unexpected packet id/);
    });

    it('reports a whole packet with no JSON in it as malformed, not as a timeout', async () => {
        // A complete one-byte packet holding only its packet id, then silence.
        // The peer has answered, just not with a status, so waiting out the
        // timer would misreport a wrong port as a wedged server. The deadline
        // is generous so a timeout cannot win the race on a slow runner.
        const port = await start(listen((socket) => {
            socket.once('data', () => socket.write(Buffer.from([0x01, 0x00])));
        }));

        const outcome = await ping('127.0.0.1', port, {timeoutMs: 2000});
        expect(outcome).toMatchObject({online: false, reason: 'malformed'});
        expect(outcome.online === false && outcome.error.message)
            .toMatch(/ends before its JSON length/);
    });

    it('reports a well-framed packet holding invalid JSON as malformed', async () => {
        const port = await start(listen((socket) => {
            socket.on('data', () => {
                const json = Buffer.from('{not json', 'utf8');
                const body = Buffer.concat([encodeVarInt(0x00), encodeVarInt(json.length), json]);
                socket.write(Buffer.concat([encodeVarInt(body.length), body]));
            });
        }));

        expect(await ping('127.0.0.1', port, {timeoutMs: 2000}))
            .toMatchObject({online: false, reason: 'malformed'});
    });

    it('reports valid JSON that is not a status object as malformed', async () => {
        const port = await start(listenWithStatus('just a string'));

        expect(await ping('127.0.0.1', port, {timeoutMs: 2000}))
            .toMatchObject({online: false, reason: 'malformed'});
    });

    it('reports an address it cannot even parse without opening a socket', async () => {
        const outcome = await ping('https://play.example.com');
        expect(outcome).toMatchObject({
            online: false,
            reason: 'invalid-address',
            host: null,
            port: null,
            address: null
        });
    });
});
