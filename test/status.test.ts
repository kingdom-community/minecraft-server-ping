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

    // The same rule `motd` already follows: a field that carries no usable
    // text once formatting is gone is null, not '', so `version ?? fallback`
    // renders the fallback instead of a blank.
    it('nulls a version name that was nothing but formatting codes', () => {
        expect(parseStatusPayload({version: {name: '§a§l'}})?.version).toBeNull();
        expect(parseStatusPayload({version: {name: '  '}})?.version).toBeNull();
        expect(parseStatusPayload({version: {name: ' §a1.21 '}})?.version).toBe('1.21');
    });

    it('flattens a description nested deeper than the call stack allows', () => {
        // Each level is ten bytes on the wire, so this fits under the default
        // `maxResponseBytes` with room to spare — yet recursion would overflow
        // well before reaching the text at the bottom.
        let description: unknown = {text: 'bottom'};
        for (let depth = 0; depth < 100_000; depth += 1) {
            description = {extra: description};
        }
        expect(parseStatusPayload({description})?.motd).toBe('bottom');
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

    // The rows below walk each field the parser reads through the shapes a
    // server it does not control could send. Every one degrades that field
    // alone and leaves the rest of the status intact.
    it('nulls an empty or non-string favicon rather than passing it to an <img src>', () => {
        expect(parseStatusPayload({favicon: ''})?.favicon).toBeNull();
        expect(parseStatusPayload({favicon: 42})?.favicon).toBeNull();
        expect(parseStatusPayload({favicon: null})?.favicon).toBeNull();
    });

    it('nulls the version fields when version is not an object', () => {
        const status = parseStatusPayload({version: '1.21.4', description: 'still here'});
        expect(status?.version).toBeNull();
        expect(status?.protocolVersion).toBeNull();
        expect(status?.motd).toBe('still here');
        expect(parseStatusPayload({version: null})?.version).toBeNull();
    });

    it('reads the protocol version only from a number, truncating a fraction', () => {
        expect(parseStatusPayload({version: {name: '1.21', protocol: '775'}})?.protocolVersion).toBeNull();
        expect(parseStatusPayload({version: {name: '1.21', protocol: 775.9}})?.protocolVersion).toBe(775);
        expect(parseStatusPayload({version: {name: 1.21, protocol: 775}})).toMatchObject({
            version: null,
            protocolVersion: 775
        });
    });

    // A count without its ceiling (or the other way round) cannot render as
    // "3 / 20", so the pair is all or nothing.
    it('nulls the player counts unless both online and max are numbers', () => {
        expect(parseStatusPayload({players: {online: 3}})?.players).toBeNull();
        expect(parseStatusPayload({players: {online: 3, max: '20'}})?.players).toBeNull();
        expect(parseStatusPayload({players: {max: 20, sample: [{id: 'a', name: 'Someone'}]}})?.players)
            .toBeNull();
        expect(parseStatusPayload({players: null})?.players).toBeNull();
    });

    it('treats an absent sample as an empty one', () => {
        expect(parseStatusPayload({players: {online: 0, max: 20}})?.players)
            .toEqual({online: 0, max: 20, sample: []});
    });

    it('keeps a sample entry with a bad id but drops one with no name', () => {
        const status = parseStatusPayload({
            players: {online: 2, max: 20, sample: [{id: 7, name: 'Someone'}, {id: 'abc'}, {id: 'def', name: 9}]}
        });
        expect(status?.players?.sample).toEqual([{id: '', name: 'Someone'}]);
    });

    it('nulls a description that holds no text', () => {
        expect(parseStatusPayload({description: 42})?.motd).toBeNull();
        expect(parseStatusPayload({description: {text: 7}})?.motd).toBeNull();
        expect(parseStatusPayload({description: null})?.motd).toBeNull();
        expect(parseStatusPayload({description: {text: '', extra: []}})?.motd).toBeNull();
    });

    it.each([['a string', 'nope'], ['null', null], ['a number', 7], ['an array', []]])(
        'returns null for %s, which is not a status object at all',
        (_label, payload) => {
            expect(parseStatusPayload(payload)).toBeNull();
        }
    );
});

describe('flattenChatComponent', () => {
    it('walks a nested extra tree in order', () => {
        expect(flattenChatComponent({text: 'a', extra: [{text: 'b', extra: [{text: 'c'}]}, 'd']}))
            .toBe('abcd');
    });

    it('ignores nodes it does not understand', () => {
        expect(flattenChatComponent({bold: true})).toBe('');
    });

    it('treats a null extra as no children, keeping the node\'s own text', () => {
        expect(flattenChatComponent({text: 'a', extra: null})).toBe('a');
        expect(flattenChatComponent(null)).toBe('');
    });

    it('keeps document order when text sits beside and inside an extra array', () => {
        expect(flattenChatComponent(['a', {text: 'b', extra: ['c', {extra: 'd'}]}, ['e', 'f']]))
            .toBe('abcdef');
    });

    // Depth is peer-controlled: the walk must be bounded by the heap, not by
    // the call stack, for both ways a component can nest.
    it('walks an extra chain tens of thousands of levels deep', () => {
        let node: unknown = 'deep';
        for (let depth = 0; depth < 100_000; depth += 1) {
            node = {text: '', extra: node};
        }
        expect(flattenChatComponent(node)).toBe('deep');
    });

    it('walks arrays nested tens of thousands of levels deep', () => {
        let node: unknown = 'deep';
        for (let depth = 0; depth < 100_000; depth += 1) {
            node = [node];
        }
        expect(flattenChatComponent(node)).toBe('deep');
    });
});

describe('stripFormattingCodes', () => {
    it('removes colour and style codes in both cases', () => {
        expect(stripFormattingCodes('§ared §lbold §Kobf')).toBe('red bold obf');
    });
});
