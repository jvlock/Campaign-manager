import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const packageDir = dirname(require.resolve('@xyflow/react/package.json'));

for (const file of ['index.js', 'index.mjs']) {
  test(`${file}: resize delivery is deferred, coalesced, and cancelled on cleanup`, () => {
    const source = readFileSync(join(packageDir, 'dist/esm', file), 'utf8');
    const start = source.indexOf('function createFrameResizeObserver(');
    assert.notEqual(start, -1, 'The React Flow resize patch must be installed');
    const helper = source.slice(start, source.indexOf('function useResizeHandler(', start));
    const frames = new Map();
    let nextFrame = 0;
    let nativeCallback;
    class NativeObserver {
      constructor(callback) { nativeCallback = callback; }
      disconnect() {}
      unobserve() {}
    }
    const createObserver = runInNewContext(`${helper}; createFrameResizeObserver`, {
      ResizeObserver: NativeObserver,
      requestAnimationFrame(callback) {
        frames.set(++nextFrame, callback);
        return nextFrame;
      },
      cancelAnimationFrame(id) { frames.delete(id); },
    });
    const flush = () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback());
    };
    const batches = [];
    const observer = createObserver((entries) => batches.push(entries));
    const a = {};
    const b = {};
    nativeCallback([{ target: a, size: 1 }, { target: b, size: 2 }]);
    nativeCallback([{ target: a, size: 3 }]);
    assert.equal(batches.length, 0, 'No layout writes during native notification');
    assert.equal(frames.size, 1);
    observer.unobserve(b);
    flush();
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 1);
    assert.equal(batches[0][0].size, 3, 'Use the latest size');
    nativeCallback([{ target: a, size: 4 }]);
    observer.disconnect();
    assert.equal(frames.size, 0);
    flush();
    assert.equal(batches.length, 1, 'No callback after unmount');

    createObserver(() => { throw new Error('real application error'); });
    nativeCallback([{ target: a }]);
    assert.throws(flush, /real application error/, 'Do not hide real errors');
  });
}