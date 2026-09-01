// The protocol's number and string encodings. Pure and socket-free, so the
// wire format is unit-testable without a server.

// Varints are 7 bits of payload per byte, high bit set while more follow.
export const encodeVarInt = (value: number): Buffer => {
    const bytes: number[] = [];
    // Coerce to the unsigned 32-bit two's-complement pattern so a negative
    // protocol version encodes as the five bytes the protocol expects.
    let remaining = value >>> 0;
    do {
        let byte = remaining & 0x7f;
        remaining >>>= 7;
        if (remaining !== 0) {
            byte |= 0x80;
        }
        bytes.push(byte);
    } while (remaining !== 0);
    return Buffer.from(bytes);
};

export interface VarIntRead {
    value: number;
    bytesRead: number;
}

// Read a varint from `buffer` at `offset`. Returns null when the buffer does
// not yet hold a complete one — the caller is streaming, so "not yet" is an
// ordinary answer rather than an error. Throws only on a varint longer than the
// five bytes a 32-bit value can occupy, which is a malformed peer.
export const decodeVarInt = (buffer: Buffer, offset = 0): VarIntRead | null => {
    let value = 0;
    let bytesRead = 0;
    for (;;) {
        if (offset + bytesRead >= buffer.length) {
            return null;
        }
        const byte = buffer[offset + bytesRead];
        value |= (byte & 0x7f) << (7 * bytesRead);
        bytesRead += 1;
        if ((byte & 0x80) === 0) {
            return {value: value >>> 0, bytesRead};
        }
        if (bytesRead >= 5) {
            throw new Error('varint too long');
        }
    }
};

// Length-prefixed UTF-8, the protocol's string form.
export const encodeString = (value: string): Buffer => {
    const encoded = Buffer.from(value, 'utf8');
    return Buffer.concat([encodeVarInt(encoded.length), encoded]);
};

// Prefix a packet body with its own length, which is how every packet goes out.
export const framePacket = (body: Buffer): Buffer =>
    Buffer.concat([encodeVarInt(body.length), body]);
