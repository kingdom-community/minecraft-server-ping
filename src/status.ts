// The pure translation from a Server List Ping's JSON into a usable shape.
// Dependency-free and socket-free, so the parsing rules are unit-testable
// without a server.

export interface PlayerSample {
    id: string;
    name: string;
}

export interface PlayerCounts {
    online: number;
    max: number;
    // The handful of names a server volunteers with its counts. Optional in the
    // protocol and often empty or absent, so an empty array is the normal case
    // rather than a sign of anything.
    sample: PlayerSample[];
}

export interface ServerStatus {
    // The message of the day, flattened to plain text with legacy colour codes
    // removed. Null when the server sent none, or sent only formatting.
    motd: string | null;
    // The Minecraft version string the server reports, e.g. "1.21.4". This is
    // the only honest source for it: a hard-coded value would go stale the first
    // time the server updates. Null when the server omitted it, or sent only
    // formatting.
    version: string | null;
    // The numeric protocol version, which is what actually decides whether a
    // given client can join. Null when the server omitted it.
    protocolVersion: number | null;
    players: PlayerCounts | null;
    // A `data:image/png;base64,...` URI, ready to drop into an <img src>. Null
    // when the server has no server-icon.png. Not decoded or re-encoded here:
    // it is passed through exactly as the server sent it.
    favicon: string | null;
}

// Minecraft's legacy section-sign colour codes. They are formatting, not text,
// and rendering them raw puts things like "§6Welcome" on the page.
export const stripFormattingCodes = (value: string): string =>
    value.replace(/§[0-9a-fk-orA-FK-OR]/g, '');

// A server's `description` is either a plain string or a chat component tree
// ({text, extra: [...]}), and both forms are in the wild. Flatten to text.
//
// Walked with an explicit stack rather than by recursion. The tree's depth is
// chosen by the peer, and `extra` nested tens of thousands of levels deep fits
// under `maxResponseBytes` while overflowing the call stack — which would turn
// a hostile answer into a thrown RangeError from a parser that promises to
// degrade rather than fail. Depth is bounded by the heap instead.
export const flattenChatComponent = (node: unknown): string => {
    const parts: string[] = [];
    // Nodes still to visit, popped from the end, so children are pushed in
    // reverse to come out in document order.
    const pending: unknown[] = [node];
    while (pending.length > 0) {
        const current = pending.pop();
        if (typeof current === 'string') {
            parts.push(current);
        } else if (Array.isArray(current)) {
            for (let index = current.length - 1; index >= 0; index -= 1) {
                pending.push(current[index]);
            }
        } else if (current && typeof current === 'object') {
            const component = current as {text?: unknown; extra?: unknown};
            if (typeof component.text === 'string') {
                parts.push(component.text);
            }
            if (component.extra !== undefined && component.extra !== null) {
                pending.push(component.extra);
            }
        }
    }
    return parts.join('');
};

const asFiniteInt = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;

const asPlayerSample = (value: unknown): PlayerSample[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') {
            return [];
        }
        const {id, name} = entry as {id?: unknown; name?: unknown};
        return typeof name === 'string'
            ? [{id: typeof id === 'string' ? id : '', name}]
            : [];
    });
};

// Translate the ping's JSON into `ServerStatus`. Returns null when the payload
// is not even an object, which is the caller's signal that the peer answered
// with something that is not this protocol.
//
// Otherwise deliberately tolerant: the response comes from a server this code
// does not control, so a missing or wrong-typed field degrades that one field
// to null rather than failing the whole status.
export const parseStatusPayload = (payload: unknown): ServerStatus | null => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return null;
    }
    const body = payload as {
        version?: unknown;
        players?: unknown;
        description?: unknown;
        favicon?: unknown;
    };

    const versionNode = body.version as {name?: unknown; protocol?: unknown} | undefined;
    // Stripped before the emptiness check, the same order as `motd` below, so
    // a name that was nothing but formatting codes degrades to null rather
    // than to an empty string.
    const versionName = versionNode?.name;
    const version = typeof versionName === 'string'
        ? stripFormattingCodes(versionName).trim() || null
        : null;

    const playersNode = body.players as {online?: unknown; max?: unknown; sample?: unknown} | undefined;
    const online = asFiniteInt(playersNode?.online);
    const max = asFiniteInt(playersNode?.max);
    const players = online !== null && max !== null
        ? {online, max, sample: asPlayerSample(playersNode?.sample)}
        : null;

    const motdText = stripFormattingCodes(flattenChatComponent(body.description)).trim();

    return {
        motd: motdText === '' ? null : motdText,
        version,
        protocolVersion: asFiniteInt(versionNode?.protocol),
        players,
        favicon: typeof body.favicon === 'string' && body.favicon !== '' ? body.favicon : null
    };
};
