import {describe, expect, it} from 'vitest';

import {handshakePacket, readStatusResponse, statusRequestPacket} from '../src/protocol.js';
import {decodeVarInt, encodeVarInt} from '../src/varint.js';
import {statusResponseFor} from './stubServer.js';

describe('handshakePacket', () => {
    it('is length-prefixed, starts with packet id 0x00, and ends with next-state 1', () => {
        const packet = handshakePacket({host: 'play.example.com', port: 25565, display: 'play.example.com'});
        const length = decodeVarInt(packet)!;
        expect(packet.length).toBe(length.bytesRead + length.value);
        expect(packet[length.bytesRead]).toBe(0x00);
        expect(packet[packet.length - 1]).toBe(0x01);
        // The host travels as a length-prefixed UTF-8 string and the port as a
        // big-endian unsigned short.
        expect(packet.includes(Buffer.from('play.example.com', 'utf8'))).toBe(true);
        expect(packet.readUInt16BE(packet.length - 3)).toBe(25565);
    });

    it('sends the port it was given, not the default', () => {
        const packet = handshakePacket({host: 'h', port: 25566, display: 'h:25566'});
        expect(packet.readUInt16BE(packet.length - 3)).toBe(25566);
    });

    it('sends -1 as the protocol version, so no server calls the client outdated', () => {
        const packet = handshakePacket({host: 'h', port: 25565, display: 'h'});
        const frame = decodeVarInt(packet)!;
        const packetId = decodeVarInt(packet, frame.bytesRead)!;
        const versionOffset = frame.bytesRead + packetId.bytesRead;
        expect([...packet.subarray(versionOffset, versionOffset + 5)])
            .toEqual([...encodeVarInt(-1)]);
    });
});

describe('statusRequestPacket', () => {
    it('is one byte of body: packet id 0x00', () => {
        expect([...statusRequestPacket()]).toEqual([0x01, 0x00]);
    });
});

describe('readStatusResponse', () => {
    it('returns null until the whole packet has arrived', () => {
        const full = statusResponseFor({version: {name: '1.21'}});
        expect(readStatusResponse(full.subarray(0, 3))).toBeNull();
        expect(readStatusResponse(full)).toBe(JSON.stringify({version: {name: '1.21'}}));
    });

    it('returns null on an empty buffer', () => {
        expect(readStatusResponse(Buffer.alloc(0))).toBeNull();
    });

    it('returns null when the frame is complete but the JSON body is not', () => {
        const full = statusResponseFor({description: 'a fairly long message of the day'});
        expect(readStatusResponse(full.subarray(0, full.length - 5))).toBeNull();
    });

    it('rejects a packet id that is not 0x00', () => {
        const body = Buffer.concat([encodeVarInt(0x01), encodeVarInt(0)]);
        const packet = Buffer.concat([encodeVarInt(body.length), body]);
        expect(() => readStatusResponse(packet)).toThrow(/unexpected packet id/);
    });

    it('reads a response whose length prefixes span more than one byte', () => {
        const payload = {description: 'x'.repeat(400)};
        expect(readStatusResponse(statusResponseFor(payload))).toBe(JSON.stringify(payload));
    });
});
