// The Minecraft address a site prints and pings, parsed from a string. Pure:
// no network, no environment read of its own, so a browser bundle (which only
// wants to display the address) and a server (which wants to connect to it) can
// share the same rules and the same tests.

export const DEFAULT_MINECRAFT_PORT = 25565;

export interface ServerEndpoint {
    // Hostname to connect to and to send in the Server List Ping handshake.
    host: string;
    port: number;
    // Exactly what a player should type into their client's server list. The
    // port is omitted when it is the default, because that is what a player is
    // told everywhere else and an explicit `:25565` invites a typo.
    display: string;
}

// Format an already-validated host and port the way a player should type it.
export const displayAddress = (host: string, port: number): string =>
    port === DEFAULT_MINECRAFT_PORT ? host : `${host}:${port}`;

// Parse `host` or `host:port`. Returns null for anything that is not an address
// a player could actually use — unset, blank, or a malformed port. Null is the
// signal for the "address not published yet" state; the one thing a site must
// never do is print a plausible-looking placeholder someone might type.
export const parseServerAddress = (raw: string | undefined | null): ServerEndpoint | null => {
    const trimmed = (raw ?? '').trim();
    if (trimmed === '') {
        return null;
    }
    // A scheme is a configuration mistake rather than an address: the Minecraft
    // protocol has no URL form, so refuse rather than guess at what was meant.
    if (trimmed.includes('/') || trimmed.includes(' ')) {
        return null;
    }
    const separator = trimmed.lastIndexOf(':');
    if (separator === -1) {
        return {host: trimmed, port: DEFAULT_MINECRAFT_PORT, display: trimmed};
    }
    const host = trimmed.slice(0, separator);
    const portText = trimmed.slice(separator + 1);
    if (host === '' || !/^[0-9]{1,5}$/.test(portText)) {
        return null;
    }
    const port = Number(portText);
    if (port < 1 || port > 65535) {
        return null;
    }
    return {host, port, display: displayAddress(host, port)};
};

// Resolve the two shapes a caller can supply an address in — `ping('h', 25566)`
// and `ping('h:25566')` — to one endpoint. An explicit `port` argument wins
// over a port embedded in the string, so a caller passing both gets the one
// they wrote at the call site rather than a silent surprise.
export const resolveEndpoint = (
    host: string,
    port?: number
): ServerEndpoint | null => {
    const parsed = parseServerAddress(host);
    if (!parsed) {
        return null;
    }
    if (port === undefined) {
        return parsed;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return null;
    }
    return {host: parsed.host, port, display: displayAddress(parsed.host, port)};
};

// Read an address out of an environment variable. A function rather than a
// module constant so a caller can change the variable between calls — and so
// nothing caches a value that two bundles could disagree about.
export const endpointFromEnv = (
    variable = 'MINECRAFT_SERVER_ADDRESS',
    env: NodeJS.ProcessEnv = process.env
): ServerEndpoint | null => parseServerAddress(env[variable]);
