import {describe, expect, it} from 'vitest';

import {flattenChatComponent, parseStatusPayload, stripFormattingCodes} from '../src/status.js';

// A payload a real Server List Ping returns, captured verbatim so the parsing
// is tested against the wire rather than against an idea of it.
const LIVE_PAYLOAD = {
    description: {text: '', extra: ['An Open Minecraft Server']},
    players: {max: 20, online: 1, sample: [{id: '0a9fa342-3139-49d7-8acb-fcf4d9c1f0ef', name: 'ExamplePlayer'}]},
    version: {name: 'Spigot 26.1.2', protocol: 775},
    enforcesSecureChat: true
};

describe('parseStatusPayload', () => {
    it('reads a live server payload', () => {
        expect(parseStatusPayload(LIVE_PAYLOAD)).toEqual({
            motd: 'An Open Minecraft Server',
            version: 'Spigot 26.1.2',
            protocolVersion: 775,
            players: {
                online: 1,
                max: 20,
                sample: [{id: '0a9fa342-3139-49d7-8acb-fcf4d9c1f0ef', name: 'ExamplePlayer'}]
            },
            favicon: null
        });
    });

    it('accepts a plain-string description as well as a chat component', () => {
        expect(parseStatusPayload({description: 'A Minecraft Server'})?.motd).toBe('A Minecraft Server');
    });

    it('strips legacy section-sign formatting codes out of the text', () => {
        const status = parseStatusPayload({description: '§6Gold §rPlain', version: {name: '§a1.21'}});
        expect(status?.motd).toBe('Gold Plain');
        expect(status?.version).toBe('1.21');
    });

    it('passes a favicon data URI through untouched', () => {
        const favicon = 'data:image/png;base64,iVBORw0KGgo=';
        expect(parseStatusPayload({favicon})?.favicon).toBe(favicon);
    });

    it('degrades a missing or wrong-typed field to null rather than failing the whole status', () => {
        const status = parseStatusPayload({players: {online: 'lots'}});
        expect(status).toEqual({
            motd: null,
            version: null,
            protocolVersion: null,
            players: null,
            favicon: null
        });
    });

    it('drops sample entries that are not player-shaped, keeping the rest', () => {
        const status = parseStatusPayload({
            players: {online: 2, max: 20, sample: ['nonsense', {name: 'Someone'}, null]}
        });
        expect(status?.players?.sample).toEqual([{id: '', name: 'Someone'}]);
    });

    it('treats a sample that is not an array as no sample at all', () => {
        expect(parseStatusPayload({players: {online: 0, max: 20, sample: 'nope'}})?.players?.sample)
            .toEqual([]);
    });

    it.each([['a string', 'nope'], ['null', null], ['a number', 7], ['an array', []]])(
        'returns null for %s, which is not a status object at all',
        (_label, payload) => {
            expect(parseStatusPayload(payload)).toBeNull();
        }
    );

    // An object with nothing in it is still a status object: every field is
    // absent, so every field is null, and none of that is a failure.
    it('reads an empty object as a status with every field null', () => {
        expect(parseStatusPayload({})).toEqual({
            motd: null,
            version: null,
            protocolVersion: null,
            players: null,
            favicon: null
        });
    });

    // The same row for each field the parser reads: absent, null, the wrong
    // type, and empty. The peer chooses what arrives, so each shape has to
    // degrade to null on that field alone rather than failing the status.
    describe('version', () => {
        it.each([
            ['null', null],
            ['a bare string rather than an object', '1.21.4'],
            ['a number', 769],
            ['an object without a name', {protocol: 769}],
            ['a non-string name', {name: 1214}],
            ['an empty name', {name: ''}],
            ['a whitespace-only name', {name: '   '}]
        ])('is null when the server sends %s', (_label, version) => {
            expect(parseStatusPayload({version})?.version).toBeNull();
        });

        it('trims the whitespace around a name', () => {
            expect(parseStatusPayload({version: {name: '  Paper 1.21.4  '}})?.version).toBe('Paper 1.21.4');
        });

        it('is an empty string, not null, when the name was nothing but formatting codes', () => {
            // Characterization: the emptiness check runs before the strip here,
            // where for `motd` it runs after. See #8.
            expect(parseStatusPayload({version: {name: '§a§l'}})?.version).toBe('');
        });
    });

    describe('protocolVersion', () => {
        it.each([
            ['no version object', {}],
            ['a version object without a protocol', {version: {name: '1.21.4'}}],
            ['a string protocol', {version: {protocol: '769'}}],
            ['an infinite protocol', {version: {protocol: Number.POSITIVE_INFINITY}}],
            ['a NaN protocol', {version: {protocol: Number.NaN}}]
        ])('is null when the server sends %s', (_label, payload) => {
            expect(parseStatusPayload(payload)?.protocolVersion).toBeNull();
        });

        it('is read independently of the version name, so one can be null without the other', () => {
            expect(parseStatusPayload({version: {protocol: 769}})).toMatchObject({
                version: null,
                protocolVersion: 769
            });
        });

        it('truncates a fractional protocol number rather than rejecting it', () => {
            expect(parseStatusPayload({version: {protocol: 769.9}})?.protocolVersion).toBe(769);
        });
    });

    describe('players', () => {
        it.each([
            ['null', null],
            ['a bare string rather than an object', 'lots'],
            ['a number', 4],
            ['an array', [4, 20]],
            ['only an online count', {online: 4}],
            ['only a max', {max: 20}],
            ['string counts', {online: '4', max: '20'}],
            ['an infinite count', {online: Number.POSITIVE_INFINITY, max: 20}],
            ['a NaN count', {online: 4, max: Number.NaN}]
        ])('is null as a whole when the server sends %s', (_label, players) => {
            expect(parseStatusPayload({players})?.players).toBeNull();
        });

        it('fills in an empty sample when the counts are present and the sample is absent', () => {
            expect(parseStatusPayload({players: {online: 4, max: 20}})?.players)
                .toEqual({online: 4, max: 20, sample: []});
        });

        it('accepts zero for both counts, which is what an empty server reports', () => {
            expect(parseStatusPayload({players: {online: 0, max: 0}})?.players)
                .toEqual({online: 0, max: 0, sample: []});
        });

        it('truncates fractional counts rather than rejecting them', () => {
            expect(parseStatusPayload({players: {online: 2.9, max: 20.1}})?.players)
                .toMatchObject({online: 2, max: 20});
        });

        it('treats a null sample as no sample at all', () => {
            expect(parseStatusPayload({players: {online: 0, max: 20, sample: null}})?.players?.sample)
                .toEqual([]);
        });

        it('keeps a sample entry whose id is not a string, with the id blanked', () => {
            expect(parseStatusPayload({players: {online: 1, max: 20, sample: [{id: 7, name: 'Someone'}]}})
                ?.players?.sample).toEqual([{id: '', name: 'Someone'}]);
        });

        it('drops a sample entry that has an id but no name', () => {
            expect(parseStatusPayload({players: {online: 1, max: 20, sample: [{id: 'abc'}]}})
                ?.players?.sample).toEqual([]);
        });
    });

    describe('motd', () => {
        it.each([
            ['null', null],
            ['an empty string', ''],
            ['a whitespace-only string', '   '],
            ['only formatting codes', '§6§l§r'],
            ['a number', 42],
            ['a component without text', {bold: true}],
            ['a component whose text is not a string', {text: 5}],
            ['an empty array', []]
        ])('is null when the description is %s', (_label, description) => {
            expect(parseStatusPayload({description})?.motd).toBeNull();
        });

        it('trims the whitespace around the text', () => {
            expect(parseStatusPayload({description: '  padded  '})?.motd).toBe('padded');
        });

        it('flattens a description that is an array of parts', () => {
            expect(parseStatusPayload({description: ['An ', {text: 'Open'}, ' Server']})?.motd)
                .toBe('An Open Server');
        });

        it('reads a component whose only content is its extra', () => {
            expect(parseStatusPayload({description: {extra: 'tail'}})?.motd).toBe('tail');
        });

        it('strips formatting codes that were split across component parts', () => {
            // The codes are per-part here, so the join has to happen before the
            // strip or a code at a part boundary would survive.
            expect(parseStatusPayload({description: {text: '§6Gold ', extra: [{text: '§rPlain'}]}})?.motd)
                .toBe('Gold Plain');
        });
    });

    describe('favicon', () => {
        it.each([
            ['null', null],
            ['an empty string', ''],
            ['a number', 1],
            ['an object', {}],
            ['an array', ['data:image/png;base64,']]
        ])('is null when the server sends %s', (_label, favicon) => {
            expect(parseStatusPayload({favicon})?.favicon).toBeNull();
        });

        it('does not validate the data URI, so a non-image string passes through as sent', () => {
            // Pass-through is the contract: the value is not decoded here, so
            // it is not checked here either.
            expect(parseStatusPayload({favicon: 'not a data uri'})?.favicon).toBe('not a data uri');
        });
    });

    it('degrades each bad field on its own while the good ones are still read', () => {
        expect(parseStatusPayload({
            description: 'Up',
            version: 'not an object',
            players: {online: 4, max: 20},
            favicon: ''
        })).toEqual({
            motd: 'Up',
            version: null,
            protocolVersion: null,
            players: {online: 4, max: 20, sample: []},
            favicon: null
        });
    });
});

describe('flattenChatComponent', () => {
    it('walks a nested extra tree in order', () => {
        expect(flattenChatComponent({text: 'a', extra: [{text: 'b', extra: [{text: 'c'}]}, 'd']}))
            .toBe('abcd');
    });

    it('ignores nodes it does not understand', () => {
        expect(flattenChatComponent({bold: true})).toBe('');
    });
});

describe('stripFormattingCodes', () => {
    it('removes colour and style codes in both cases', () => {
        expect(stripFormattingCodes('§ared §lbold §Kobf')).toBe('red bold obf');
    });
});
