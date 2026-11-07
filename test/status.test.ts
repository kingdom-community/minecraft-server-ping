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

    // The field is documented as a PNG data URI ready for an <img src>, and
    // the string is the peer's choice. A remote URL here would have every
    // visitor's browser fetch from a host the server operator picked.
    it('nulls a favicon that is not a PNG data URI', () => {
        expect(parseStatusPayload({favicon: 'https://tracker.example/pixel.png'})?.favicon).toBeNull();
        expect(parseStatusPayload({favicon: 'javascript:alert(1)'})?.favicon).toBeNull();
        expect(parseStatusPayload({favicon: 'data:image/svg+xml;base64,PHN2Zz4='})?.favicon).toBeNull();
        expect(parseStatusPayload({favicon: 'data:image/png;base64,'})?.favicon).toBeNull();
        expect(parseStatusPayload({favicon: ' data:image/png;base64,iVBORw0KGgo='})?.favicon).toBeNull();
    });

    it('keeps the rest of the status when only the favicon is refused', () => {
        const status = parseStatusPayload({description: 'still here', favicon: 'https://tracker.example/'});
        expect(status?.motd).toBe('still here');
        expect(status?.favicon).toBeNull();
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

    // Servers fill the sample with lines of text for the hover box in a client's
    // server list, so these names carry colour codes just as a MOTD does.
    it('strips formatting codes out of a sample name, as it does the MOTD and version', () => {
        const status = parseStatusPayload({
            players: {online: 2, max: 20, sample: [
                {id: 'a', name: '§6Gold §rPlain'},
                {id: 'b', name: ' §x§f§f§0§0§0§0Welcome '}
            ]}
        });
        expect(status?.players?.sample).toEqual([
            {id: 'a', name: 'Gold Plain'},
            {id: 'b', name: 'Welcome'}
        ]);
    });

    it('leaves an ordinary player name and its id exactly as sent', () => {
        const sample = [{id: '0a9fa342-3139-49d7-8acb-fcf4d9c1f0ef', name: 'Example_Player1'}];
        expect(parseStatusPayload({players: {online: 1, max: 20, sample}})?.players?.sample)
            .toEqual(sample);
    });

    // The same rule `motd` and `version` follow, except that a list has no null
    // to degrade to: an entry with no text left is one with no name at all.
    it('drops a sample entry whose name was nothing but formatting or blank', () => {
        const status = parseStatusPayload({
            players: {online: 4, max: 20, sample: [
                {id: 'a', name: '§a§l'},
                {id: 'b', name: '  '},
                {id: 'c', name: ''},
                {id: 'd', name: 'Someone'}
            ]}
        });
        expect(status?.players?.sample).toEqual([{id: 'd', name: 'Someone'}]);
    });

    it('keeps the name as the server sent it in the raw payload it does not touch', () => {
        const payload = {players: {online: 1, max: 20, sample: [{id: 'a', name: '§6Gold'}]}};
        parseStatusPayload(payload);
        expect(payload.players.sample[0].name).toBe('§6Gold');
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

    // `§x` and the six digit pairs after it are one hex colour. Stripping only
    // the pairs leaves "§x" on the page.
    it('removes a hex colour whole, including its §x prefix, in both cases', () => {
        expect(stripFormattingCodes('§x§f§f§0§0§0§0Welcome')).toBe('Welcome');
        expect(stripFormattingCodes('§X§F§F§0§0§0§0Welcome')).toBe('Welcome');
    });

    it('leaves no §x in a MOTD or version that uses a hex colour', () => {
        const status = parseStatusPayload({
            description: '§x§f§f§0§0§0§0Welcome',
            version: {name: '§x§0§0§f§f§0§0Paper 1.21.4', protocol: 769}
        });
        expect(status?.motd).toBe('Welcome');
        expect(status?.version).toBe('Paper 1.21.4');
    });

    it('leaves text with no section sign exactly as it was', () => {
        expect(stripFormattingCodes(' 100% — ☃ 🏰 x&6 ')).toBe(' 100% — ☃ 🏰 x&6 ');
    });

    // The peer chooses this string. Removing only the inner pair of "§§6" would
    // join what was left into a working "§6", on a page that was promised none.
    it('leaves no working code behind when one is wrapped in another section sign', () => {
        expect(stripFormattingCodes('§§66Gold')).toBe('66Gold');
        expect(stripFormattingCodes('§§§aa')).toBe('a');
    });

    it('hides a section sign whose next character is not a code, along with that character', () => {
        expect(stripFormattingCodes('§zHello')).toBe('Hello');
        expect(stripFormattingCodes('Hello §#World')).toBe('Hello World');
    });

    it('removes a lone section sign at the end of the string', () => {
        expect(stripFormattingCodes('Welcome§')).toBe('Welcome');
    });

    // A code unit at a time would take half of the surrogate pair and leave the
    // other half on the page as an unprintable character.
    it('takes a character outside the basic plane whole after a section sign', () => {
        expect(stripFormattingCodes('§🏰Keep')).toBe('Keep');
    });

    it('degrades a MOTD and a version of nothing but stray section signs to null', () => {
        const status = parseStatusPayload({description: '§z§', version: {name: '§§', protocol: 769}});
        expect(status?.motd).toBeNull();
        expect(status?.version).toBeNull();
    });

    it('applies the same pairing across chat components, after they are flattened', () => {
        const status = parseStatusPayload({description: {text: '§', extra: ['zWelcome']}});
        expect(status?.motd).toBe('Welcome');
    });
});
