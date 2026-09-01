// The three packets of a Server List Ping, built and read as pure functions.
//
// The exchange, in order:
//   -> handshake  : packet id 0x00, protocol version, host, port, next state 1
//   -> request    : packet id 0x00, empty
//   <- response   : packet id 0x00, one length-prefixed UTF-8 JSON string
// Every packet is itself prefixed with its length as a varint.

import type {ServerEndpoint} from './address.js';
import {decodeVarInt, encodeString, encodeVarInt, framePacket} from './varint.js';

// The handshake's protocol version. -1 means "unspecified", which every server
// answers a status request for; sending a real version number would make an
// out-of-date client look incompatible to the server it is asking about.
export const UNSPECIFIED_PROTOCOL_VERSION = -1;

export const handshakePacket = (endpoint: ServerEndpoint): Buffer => {
    const port = Buffer.alloc(2);
    port.writeUInt16BE(endpoint.port);
    return framePacket(Buffer.concat([
        encodeVarInt(0x00),                            // packet id: handshake
        encodeVarInt(UNSPECIFIED_PROTOCOL_VERSION),    // protocol version
        encodeString(endpoint.host),                   // server address
        port,                                          // server port
        encodeVarInt(1)                                // next state: status
    ]));
};

// The status request carries nothing but its packet id.
export const statusRequestPacket = (): Buffer => framePacket(encodeVarInt(0x00));

// Pull the JSON string out of an accumulated response buffer. Returns null
// while the response is still incomplete, so the caller keeps reading.
export const readStatusResponse = (buffer: Buffer): string | null => {
    const length = decodeVarInt(buffer, 0);
    if (!length) {
        return null;
    }
    const packetEnd = length.bytesRead + length.value;
    if (buffer.length < packetEnd) {
        return null;
    }
    const packetId = decodeVarInt(buffer, length.bytesRead);
    if (!packetId) {
        return null;
    }
    if (packetId.value !== 0x00) {
        throw new Error(`unexpected packet id 0x${packetId.value.toString(16)}`);
    }
    const jsonStart = length.bytesRead + packetId.bytesRead;
    const jsonLength = decodeVarInt(buffer, jsonStart);
    if (!jsonLength) {
        return null;
    }
    const bodyStart = jsonStart + jsonLength.bytesRead;
    if (buffer.length < bodyStart + jsonLength.value) {
        return null;
    }
    return buffer.subarray(bodyStart, bodyStart + jsonLength.value).toString('utf8');
};
