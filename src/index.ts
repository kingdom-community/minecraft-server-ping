// Public surface. Three layers, smallest first:
//   ping()                        — ask a server how it is doing, get a value
//   pingEndpoint()                — the socket exchange, rejects on failure
//   handshakePacket()/varints/... — the wire format, pure and testable

export {
    ping,
    pingEndpoint,
    PingError,
    PING_TIMEOUT_MS,
    MAX_RESPONSE_BYTES,
    type PingFailureReason,
    type PingOptions,
    type PingOutcome,
    type PingSuccess,
    type PingFailure,
    type RawPingResult
} from './ping.js';

export {
    parseStatusPayload,
    flattenChatComponent,
    stripFormattingCodes,
    type ServerStatus,
    type PlayerCounts,
    type PlayerSample
} from './status.js';

export {
    DEFAULT_MINECRAFT_PORT,
    displayAddress,
    endpointFromEnv,
    parseServerAddress,
    resolveEndpoint,
    type ServerEndpoint
} from './address.js';

export {
    UNSPECIFIED_PROTOCOL_VERSION,
    handshakePacket,
    readStatusResponse,
    statusRequestPacket
} from './protocol.js';

export {
    decodeVarInt,
    encodeString,
    encodeVarInt,
    framePacket,
    type VarIntRead
} from './varint.js';
