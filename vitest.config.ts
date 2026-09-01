import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        // Node, not jsdom: everything here is either a pure buffer function or a
        // real TCP socket against a loopback stub.
        environment: 'node',
        include: ['test/**/*.test.ts']
    }
});
