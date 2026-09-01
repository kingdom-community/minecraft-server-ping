// A Minecraft server stub that speaks the protocol back over loopback.
//
// Loopback only: these bind 127.0.0.1 on an ephemeral port, so the suite needs
// no network access and no running Minecraft server.

import {createServer, type Server, type Socket} from 'node:net';

import {handshakePacket} from '../src/protocol.js';
import {encodeVarInt} from '../src/varint.js';

export interface StubServer {
    port: number;
    close: () => Promise<void>;
}

// Frame a JSON body the way a real server does: packet length, packet id 0x00,
// string length, UTF-8 body.
export const statusResponseFor = (payload: unknown): Buffer => {
    const json = Buffer.from(JSON.stringify(payload), 'utf8');
    const body = Buffer.concat([encodeVarInt(0x00), encodeVarInt(json.length), json]);
    return Buffer.concat([encodeVarInt(body.length), body]);
};

export const listen = (onConnection: (socket: Socket) => void): Promise<StubServer> =>
    new Promise((resolve) => {
        // Every accepted connection is tracked so teardown can destroy them.
        // server.close() only stops accepting; it then waits for live sockets,
        // and some tests deliberately leave one open.
        const accepted: Socket[] = [];
        const server: Server = createServer((socket) => {
            accepted.push(socket);
            onConnection(socket);
        });
        let closed = false;
        server.listen(0, '127.0.0.1', () => {
            resolve({
                port: (server.address() as {port: number}).port,
                close: async () => {
                    accepted.forEach((socket) => socket.destroy());
                    if (closed) {
                        return;
                    }
                    closed = true;
                    await new Promise<void>((done) => server.close(() => done()));
                }
            });
        });
    });

// A stub that completes the whole exchange: it waits for the handshake and the
// status request, then writes one framed status response.
export const listenWithStatus = (payload: unknown): Promise<StubServer> => {
    // The two client writes may be coalesced into one TCP segment or split
    // across several, so the stub counts bytes rather than `data` events. A
    // handshake for a loopback endpoint plus the two-byte status request is the
    // whole of what it should see before answering.
    const expectedBytes =
        handshakePacket({host: '127.0.0.1', port: 25565, display: '127.0.0.1'}).length + 2;
    return listen((socket) => {
        let received = 0;
        socket.on('data', (chunk) => {
            received += chunk.length;
            if (received >= expectedBytes) {
                socket.write(statusResponseFor(payload));
            }
        });
    });
};
