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
// only while the packet itself is still incomplete, so the caller keeps
// reading. Once the whole packet has arrived, everything inside it is read
// against the packet's own end rather than the buffer's: a packet id, string
// length or string that does not fit is never going to arrive, so it throws as
// a malformed peer instead of waiting out the caller's timeout.
export const readStatusResponse = (buffer: Buffer): string | null => {
    const length = decodeVarInt(buffer, 0);
    if (!length) {
        return null;
    }
    const packetEnd = length.bytesRead + length.value;
    if (buffer.length < packetEnd) {
        return null;
    }
    const packet = buffer.subarray(0, packetEnd);
    const packetId = decodeVarInt(packet, length.bytesRead);
    if (!packetId) {
        throw new Error('status response packet ends before its packet id');
    }
    if (packetId.value !== 0x00) {
        throw new Error(`unexpected packet id 0x${packetId.value.toString(16)}`);
    }
    const jsonStart = length.bytesRead + packetId.bytesRead;
    const jsonLength = decodeVarInt(packet, jsonStart);
    if (!jsonLength) {
        throw new Error('status response packet ends before its JSON length');
    }
    const bodyStart = jsonStart + jsonLength.bytesRead;
    if (packet.length < bodyStart + jsonLength.value) {
        throw new Error(
            `status response claims ${jsonLength.value} bytes of JSON ` +
            `but its packet holds ${packet.length - bodyStart}`
        );
    }
    return packet.subarray(bodyStart, bodyStart + jsonLength.value).toString('utf8');
};
