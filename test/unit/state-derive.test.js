'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { deriveStates, treeCondition, STATES } = require('../../main/derive');

const S = (pairs) => new Map(pairs);

test('running tree, no pids file → RUNNING', () => {
  const out = deriveStates({
    trees: new Map([['100', new Set([1, 2, 3])]]),
    procStates: S([[1, 'S'], [2, 'R'], [3, 'Sl']]),
    pidFiles: new Map(),
  });
  assert.equal(out.get('100').state, STATES.RUNNING);
  assert.equal(out.get('100').alive, 3);
});

test('fully frozen tree with pids file → SUSPENDED', () => {
  const out = deriveStates({
    trees: new Map([['100', new Set([1, 2])]]),
    procStates: S([[1, 'T'], [2, 'Tl']]),
    pidFiles: new Map([['100', [1, 2]]]),
  });
  assert.equal(out.get('100').state, STATES.SUSPENDED);
});

test('frozen tree WITHOUT pids file → FROZEN_EXTERN with warning', () => {
  const out = deriveStates({
    trees: new Map([['100', new Set([1])]]),
    procStates: S([[1, 'T']]),
    pidFiles: new Map(),
  });
  assert.equal(out.get('100').state, STATES.FROZEN_EXTERN);
  assert.ok(out.get('100').warning);
});

test('pids file but every pid dead → STALE (gamectl frozen semantics)', () => {
  const out = deriveStates({
    trees: new Map(),
    procStates: S([]),
    pidFiles: new Map([['100', [42, 43]]]),
  });
  assert.equal(out.get('100').state, STATES.STALE);
});

test('mixed tree with pids file → SUSPENDED but warns', () => {
  const out = deriveStates({
    trees: new Map([['100', new Set([1, 2])]]),
    procStates: S([[1, 'T'], [2, 'S']]),
    pidFiles: new Map([['100', [1, 2]]]),
  });
  assert.equal(out.get('100').state, STATES.SUSPENDED);
  assert.match(out.get('100').warning, /MIXED/);
});

test('running tree but leftover pids file → RUNNING with warning', () => {
  const out = deriveStates({
    trees: new Map([['100', new Set([1])]]),
    procStates: S([[1, 'S']]),
    pidFiles: new Map([['100', [1]]]),
  });
  assert.equal(out.get('100').state, STATES.RUNNING);
  assert.ok(out.get('100').warning);
});

test('two games park independently (the quick-resume property)', () => {
  const out = deriveStates({
    trees: new Map([['A', new Set([1, 2])], ['B', new Set([10, 11])]]),
    procStates: S([[1, 'T'], [2, 'T'], [10, 'S'], [11, 'R']]),
    pidFiles: new Map([['A', [1, 2]]]),
  });
  assert.equal(out.get('A').state, STATES.SUSPENDED);
  assert.equal(out.get('B').state, STATES.RUNNING);
});

test('zombies are ignored in tree condition', () => {
  assert.equal(treeCondition(new Set([1, 2]), S([[1, 'T'], [2, 'Z']])), 'FROZEN');
  assert.equal(treeCondition(new Set([1]), S([[1, 'Z']])), 'GONE');
});

test('pids-file processes alive but no AppId tree → still SUSPENDED', () => {
  const out = deriveStates({
    trees: new Map(),
    procStates: S([[5, 'T'], [6, 'T']]),
    pidFiles: new Map([['focused', [5, 6]]]),
  });
  assert.equal(out.get('focused').state, STATES.SUSPENDED);
});
