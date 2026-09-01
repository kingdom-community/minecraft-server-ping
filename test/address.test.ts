import {describe, expect, it} from 'vitest';

import {
    DEFAULT_MINECRAFT_PORT,
    displayAddress,
    endpointFromEnv,
    parseServerAddress,
    resolveEndpoint
} from '../src/address.js';

describe('parseServerAddress', () => {
    it('defaults the port when the address carries none', () => {
        expect(parseServerAddress('play.example.com')).toEqual({
            host: 'play.example.com',
            port: DEFAULT_MINECRAFT_PORT,
            display: 'play.example.com'
        });
    });

    it('omits the default port from what a player is told to type', () => {
        expect(parseServerAddress('play.example.com:25565')?.display).toBe('play.example.com');
    });

    it('keeps a non-default port, which a player does have to type', () => {
        expect(parseServerAddress('play.example.com:25566')).toEqual({
            host: 'play.example.com',
            port: 25566,
            display: 'play.example.com:25566'
        });
    });

    it('trims surrounding whitespace', () => {
        expect(parseServerAddress('  play.example.com  ')?.host).toBe('play.example.com');
    });

    // Every one of these must produce the "not published yet" state rather than
    // something a player might type.
    it.each([
        ['unset', undefined],
        ['null', null],
        ['empty', ''],
        ['whitespace', '   '],
        ['a URL', 'https://play.example.com'],
        ['a trailing slash', 'play.example.com/'],
        ['a non-numeric port', 'play.example.com:minecraft'],
        ['an out-of-range port', 'play.example.com:99999'],
        ['port zero', 'play.example.com:0'],
        ['a bare port', ':25565'],
        ['an embedded space', 'play example.com']
    ])('returns null for %s', (_label, value) => {
        expect(parseServerAddress(value as string | undefined | null)).toBeNull();
    });
});

describe('displayAddress', () => {
    it('drops the default port and keeps any other', () => {
        expect(displayAddress('h', DEFAULT_MINECRAFT_PORT)).toBe('h');
        expect(displayAddress('h', 25566)).toBe('h:25566');
    });
});

describe('resolveEndpoint', () => {
    it('accepts a bare host', () => {
        expect(resolveEndpoint('play.example.com'))
            .toEqual({host: 'play.example.com', port: 25565, display: 'play.example.com'});
    });

    it('accepts a host:port string', () => {
        expect(resolveEndpoint('play.example.com:25566')?.port).toBe(25566);
    });

    it('accepts a separate port argument', () => {
        expect(resolveEndpoint('play.example.com', 25566))
            .toEqual({host: 'play.example.com', port: 25566, display: 'play.example.com:25566'});
    });

    it('lets an explicit port argument win over one embedded in the string', () => {
        expect(resolveEndpoint('play.example.com:25566', 25567)?.port).toBe(25567);
    });

    it.each([0, 65536, -1, 1.5, Number.NaN])('returns null for the unusable port %s', (port) => {
        expect(resolveEndpoint('play.example.com', port)).toBeNull();
    });

    it('returns null when the host itself is unusable', () => {
        expect(resolveEndpoint('https://play.example.com', 25565)).toBeNull();
    });
});

describe('endpointFromEnv', () => {
    it('reads the default variable name', () => {
        expect(endpointFromEnv('MINECRAFT_SERVER_ADDRESS', {MINECRAFT_SERVER_ADDRESS: 'a.example.com'})?.host)
            .toBe('a.example.com');
    });

    it('reads whatever variable name it is given', () => {
        expect(endpointFromEnv('MY_SERVER', {MY_SERVER: 'b.example.com:25566'})?.port).toBe(25566);
    });

    it('is null when the variable is unset or unusable', () => {
        expect(endpointFromEnv('MISSING', {})).toBeNull();
        expect(endpointFromEnv('BAD', {BAD: 'https://x'})).toBeNull();
    });
});
