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
