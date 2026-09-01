import {describe, expect, it} from 'vitest';

import {decodeVarInt, encodeString, encodeVarInt, framePacket} from '../src/varint.js';

describe('encodeVarInt', () => {
    it.each([
        [0, [0x00]],
        [1, [0x01]],
        [127, [0x7f]],
        [128, [0x80, 0x01]],
        [255, [0xff, 0x01]],
        [25565, [0xdd, 0xc7, 0x01]],
        // -1 is the "unspecified protocol version" the handshake sends, and it
        // is five bytes of two's complement rather than one byte of 0xff.
        [-1, [0xff, 0xff, 0xff, 0xff, 0x0f]]
    ])('encodes %i', (value, expected) => {
        expect([...encodeVarInt(value)]).toEqual(expected);
    });
});

describe('varint round trips', () => {
    it('round-trips the values the protocol actually carries', () => {
        for (const value of [0, 1, 127, 128, 300, 25565, 2097151]) {
            expect(decodeVarInt(encodeVarInt(value))?.value).toBe(value);
        }
    });

    // The encoder works on the unsigned 32-bit pattern, so the decoder gives
    // back that pattern rather than the negative number. That is what the
    // protocol means by these bytes, and the handshake never reads one back.
    it('round-trips a negative value as its unsigned 32-bit pattern', () => {
        expect(decodeVarInt(encodeVarInt(-1))?.value).toBe(0xffffffff);
    });

    it('round-trips every boundary where the encoding grows a byte', () => {
        for (const boundary of [0x7f, 0x80, 0x3fff, 0x4000, 0x1fffff, 0x200000, 0xfffffff, 0x10000000]) {
            const read = decodeVarInt(encodeVarInt(boundary));
            expect(read?.value).toBe(boundary);
            expect(read?.bytesRead).toBe(encodeVarInt(boundary).length);
        }
    });

    it('round-trips at a non-zero offset and reports how far it read', () => {
        const buffer = Buffer.concat([Buffer.from([0xaa, 0xbb]), encodeVarInt(300)]);
        expect(decodeVarInt(buffer, 2)).toEqual({value: 300, bytesRead: 2});
    });
});

describe('decodeVarInt', () => {
    it('returns null when the buffer does not yet hold a whole varint', () => {
        expect(decodeVarInt(Buffer.from([0x80]))).toBeNull();
    });

    it('returns null on an empty buffer rather than guessing at zero', () => {
        expect(decodeVarInt(Buffer.alloc(0))).toBeNull();
    });

    it('throws on a varint longer than a 32-bit value can occupy', () => {
        expect(() => decodeVarInt(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x01])))
            .toThrow(/varint too long/);
    });
});

describe('encodeString', () => {
    it('is a varint length followed by UTF-8 bytes', () => {
        expect([...encodeString('hi')]).toEqual([0x02, 0x68, 0x69]);
    });

    it('counts bytes rather than characters', () => {
        const encoded = encodeString('é');
        expect(encoded[0]).toBe(2);
        expect(encoded.length).toBe(3);
    });
});

describe('framePacket', () => {
    it('prefixes a body with its own length', () => {
        expect([...framePacket(Buffer.from([1, 2, 3]))]).toEqual([0x03, 1, 2, 3]);
    });
});
