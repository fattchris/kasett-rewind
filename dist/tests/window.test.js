import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CompactionWindow } from '../compaction/window.js';
function makeEvent(overrides = {}) {
    const { id, ...dataOverrides } = overrides;
    return {
        type: 'compaction',
        id: id ?? 'test-id',
        timestamp: new Date().toISOString(),
        data: {
            summary: 'Test summary',
            ...dataOverrides,
        },
    };
}
describe('CompactionWindow', () => {
    describe('constructor', () => {
        test('creates empty window with configured size', () => {
            const window = new CompactionWindow({ windowSize: 3 });
            assert.equal(window.size, 0);
            assert.deepEqual(window.getAll(), []);
        });
    });
    describe('push', () => {
        test('adds event to empty window', () => {
            const window = new CompactionWindow({ windowSize: 2 });
            const event = makeEvent();
            const dropped = window.push(event);
            assert.equal(dropped, undefined);
            assert.equal(window.size, 1);
        });
        test('adds multiple events within window size', () => {
            const window = new CompactionWindow({ windowSize: 3 });
            window.push(makeEvent({ summary: 'first' }));
            window.push(makeEvent({ summary: 'second' }));
            assert.equal(window.size, 2);
            assert.equal(window.getAll()[0].data.summary, 'first');
            assert.equal(window.getAll()[1].data.summary, 'second');
        });
        test('drops oldest when window is full', () => {
            const window = new CompactionWindow({ windowSize: 2 });
            window.push(makeEvent({ summary: 'first' }));
            window.push(makeEvent({ summary: 'second' }));
            const dropped = window.push(makeEvent({ summary: 'third' }));
            assert.equal(window.size, 2);
            assert.equal(dropped?.data.summary, 'first');
            assert.equal(window.getAll()[0].data.summary, 'second');
            assert.equal(window.getAll()[1].data.summary, 'third');
        });
        test('window size 1 always drops oldest', () => {
            const window = new CompactionWindow({ windowSize: 1 });
            window.push(makeEvent({ summary: 'first' }));
            const dropped = window.push(makeEvent({ summary: 'second' }));
            assert.equal(window.size, 1);
            assert.equal(dropped?.data.summary, 'first');
            assert.equal(window.getAll()[0].data.summary, 'second');
        });
    });
    describe('load', () => {
        test('loads events and trims to window size', () => {
            const window = new CompactionWindow({ windowSize: 2 });
            const events = [
                makeEvent({ summary: 'old' }),
                makeEvent({ summary: 'middle' }),
                makeEvent({ summary: 'recent' }),
            ];
            window.load(events);
            assert.equal(window.size, 2);
            assert.equal(window.getAll()[0].data.summary, 'middle');
            assert.equal(window.getAll()[1].data.summary, 'recent');
        });
        test('loads fewer events than window size', () => {
            const window = new CompactionWindow({ windowSize: 5 });
            window.load([makeEvent({ summary: 'only one' })]);
            assert.equal(window.size, 1);
        });
        test('loads empty array', () => {
            const window = new CompactionWindow({ windowSize: 2 });
            window.load([]);
            assert.equal(window.size, 0);
        });
    });
    describe('getLatest', () => {
        test('returns undefined for empty window', () => {
            const window = new CompactionWindow({ windowSize: 2 });
            assert.equal(window.getLatest(), undefined);
        });
        test('returns most recent event', () => {
            const window = new CompactionWindow({ windowSize: 3 });
            window.push(makeEvent({ summary: 'old' }));
            window.push(makeEvent({ summary: 'new' }));
            assert.equal(window.getLatest()?.data.summary, 'new');
        });
    });
    describe('getAll', () => {
        test('returns copy of events array', () => {
            const window = new CompactionWindow({ windowSize: 2 });
            window.push(makeEvent({ summary: 'test' }));
            const all = window.getAll();
            all.push(makeEvent({ summary: 'injected' }));
            assert.equal(window.size, 1);
        });
    });
    describe('serialize', () => {
        test('returns copies of events', () => {
            const window = new CompactionWindow({ windowSize: 2 });
            window.push(makeEvent({ summary: 'test' }));
            const serialized = window.serialize();
            assert.equal(serialized.length, 1);
            assert.equal(serialized[0].data.summary, 'test');
        });
    });
    describe('with kaspiett meta', () => {
        test('preserves kaspiett in events', () => {
            const window = new CompactionWindow({ windowSize: 2 });
            window.push(makeEvent({
                summary: 'test',
                kaspiett: {
                    main: 'building auth',
                    sub: ['OAuth', 'rate limiting', 'monitoring'],
                },
            }));
            const latest = window.getLatest();
            assert.ok(latest?.data.kaspiett);
            assert.equal(latest.data.kaspiett.main, 'building auth');
            assert.deepEqual(latest.data.kaspiett.sub, ['OAuth', 'rate limiting', 'monitoring']);
        });
    });
});
//# sourceMappingURL=window.test.js.map