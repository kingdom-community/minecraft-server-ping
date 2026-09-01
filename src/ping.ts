// Minecraft Server List Ping, by hand over Node's built-in `net`. No
// dependency: the protocol is a handful of varints and one JSON blob, and a
// socket and a JSON parser are both already in the standard library.
//
// Server-side only. There is no browser equivalent — the protocol is raw TCP,
// not HTTP, so a page that wants this number has to ask a Node process for it.

import {Socket} from 'node:net';

import {resolveEndpoint, type ServerEndpoint} from './address.js';
import {handshakePacket, readStatusResponse, statusRequestPacket} from './protocol.js';
import {parseStatusPayload, type ServerStatus} from './status.js';

// A couple of seconds. A caller almost always renders "offline" until told
// otherwise, so a slow server costs nothing but this timer — and a player
// staring at a server list would have given up by now anyway.
export const PING_TIMEOUT_MS = 2000;

// A status response is a few hundred bytes; a favicon pushes it to a few
// kilobytes. Anything beyond this is a peer that is not answering the protocol,
// and reading it unbounded would be a memory sink on a socket somebody else
// controls.
export const MAX_RESPONSE_BYTES = 262144;

// Why a ping did not produce a status. The split that matters to a caller is
// "there is nothing there to talk to" (`unreachable`, `timeout`) versus "there
// is something there and it is not speaking this protocol" (`malformed`) — the
// first is an ordinary offline server, the second is usually a wrong port.
export type PingFailureReason =
    // The address could not be parsed into a host and port at all.
    | 'invalid-address'
    // Refused, unresolvable, or closed before it answered.
    | 'unreachable'
    // Accepted the socket and then said nothing within the timeout.
    | 'timeout'
    // Answered, but not with a Server List Ping status.
    | 'malformed';

export class PingError extends Error {
    readonly reason: PingFailureReason;

    constructor(reason: PingFailureReason, message: string, options?: {cause?: unknown}) {
        super(message);
        this.name = 'PingError';
        this.reason = reason;
        if (options && 'cause' in options) {
            // Assigned rather than passed to super() so this compiles and runs
            // on targets predating ES2022 error causes.
            (this as {cause?: unknown}).cause = options.cause;
        }
    }
}

export interface PingOptions {
    // One timer covers connect, write and read together: the question a ping
    // answers is "can a player connect right now", and a server that accepts a
    // socket and then says nothing fails it just as surely as a refusal.
    timeoutMs?: number;
    // Hard ceiling on the bytes read from the peer before giving up.
    maxResponseBytes?: number;
}

export interface PingSuccess extends ServerStatus {
    online: true;
    host: string;
    port: number;
    // The address as a player should type it: the port is dropped when it is
    // the default one their client would assume.
    address: string;
    // Round trip from opening the socket to holding a parsed status, in
    // milliseconds. Includes the TCP handshake, so it is a fair proxy for what
    // a player's connection will feel like, not just server-side think time.
    latencyMs: number;
    // The status JSON exactly as the server sent it, for fields this package
    // does not model. Servers put all sorts of things here.
    raw: unknown;
}

export interface PingFailure {
    online: false;
    host: string | null;
    port: number | null;
    address: string | null;
    reason: PingFailureReason;
    // The underlying failure, kept rather than discarded: `reason` is what a
    // caller branches on, this is what they put in a log line.
    error: PingError;
}

export type PingOutcome = PingSuccess | PingFailure;

const asPingError = (error: unknown, reason: PingFailureReason): PingError => {
    if (error instanceof PingError) {
        return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return new PingError(reason, message, {cause: error});
};

export interface RawPingResult {
    payload: unknown;
    latencyMs: number;
}

// Open a socket, complete the exchange, and resolve with the status JSON as the
// server sent it. Rejects with a `PingError` on every failure path; `ping()`
// wraps this and turns those into values instead.
export const pingEndpoint = (
    endpoint: ServerEndpoint,
    options: PingOptions = {}
): Promise<RawPingResult> =>
    new Promise((resolve, reject) => {
        const timeoutMs = options.timeoutMs ?? PING_TIMEOUT_MS;
        const maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
        const socket = new Socket();
        const startedAt = Date.now();
        let received = Buffer.alloc(0);
        let settled = false;

        const finish = (error: PingError | null, payload?: unknown) => {
            if (settled) {
                return;
            }
            settled = true;
            socket.destroy();
            if (error) {
                reject(error);
            } else {
                resolve({payload, latencyMs: Date.now() - startedAt});
            }
        };

        socket.setTimeout(timeoutMs);
        socket.on('timeout', () => finish(new PingError(
            'timeout',
            `server list ping to ${endpoint.display} timed out after ${timeoutMs}ms`
        )));
        socket.on('error', (error) => finish(asPingError(error, 'unreachable')));
        socket.on('close', () => finish(new PingError(
            'unreachable',
            `connection to ${endpoint.display} closed before a status response`
        )));

        socket.on('data', (chunk) => {
            received = Buffer.concat([received, chunk]);
            if (received.length > maxResponseBytes) {
                finish(new PingError('malformed', 'status response too large'));
                return;
            }
            try {
                const json = readStatusResponse(received);
                if (json === null) {
                    // Not a whole packet yet. Keep reading.
                    return;
                }
                finish(null, JSON.parse(json));
            } catch (error) {
                finish(asPingError(error, 'malformed'));
            }
        });

        socket.connect(endpoint.port, endpoint.host, () => {
            socket.write(handshakePacket(endpoint));
            socket.write(statusRequestPacket());
        });
    });

// Ping a server and describe what came back.
//
// This never rejects. Whether a server is up is a fact about the world, not an
// exceptional condition in the caller's program, so it arrives as a value: check
// `outcome.online`, and on a failure `outcome.reason` says which kind it was.
//
//   ping('play.example.com')
//   ping('play.example.com', 25566)
//   ping('play.example.com:25566', undefined, {timeoutMs: 5000})
export const ping = async (
    host: string,
    port?: number,
    options: PingOptions = {}
): Promise<PingOutcome> => {
    const endpoint = resolveEndpoint(host, port);
    if (!endpoint) {
        const error = new PingError(
            'invalid-address',
            `"${host}" is not a usable Minecraft server address`
        );
        return {online: false, host: null, port: null, address: null, reason: error.reason, error};
    }
    try {
        const {payload, latencyMs} = await pingEndpoint(endpoint, options);
        const status = parseStatusPayload(payload);
        if (!status) {
            throw new PingError(
                'malformed',
                `${endpoint.display} answered with something that is not a status response`
            );
        }
        return {
            ...status,
            online: true,
            host: endpoint.host,
            port: endpoint.port,
            address: endpoint.display,
            latencyMs,
            raw: payload
        };
    } catch (error) {
        const pingError = asPingError(error, 'unreachable');
        return {
            online: false,
            host: endpoint.host,
            port: endpoint.port,
            address: endpoint.display,
            reason: pingError.reason,
            error: pingError
        };
    }
};
