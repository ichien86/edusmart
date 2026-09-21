import assert from 'assert';

const testQueue = [];
let totalPassed = 0;
let totalFailed = 0;
const failures = [];

export function describe(name, fn) {
  const suite = { name, tests: [], beforeEaches: [] };
  const currentSuiteContext = {
    beforeEach: (hook) => suite.beforeEaches.push(hook),
    it: (testName, testFn) => suite.tests.push({ name: testName, fn: testFn }),
  };

  // Run the definition block
  globalThis._currentSuite = currentSuiteContext;
  fn();
  globalThis._currentSuite = null;

  testQueue.push(suite);
}

export function beforeEach(fn) {
  if (globalThis._currentSuite) {
    globalThis._currentSuite.beforeEach(fn);
  }
}

export function it(name, fn) {
  if (globalThis._currentSuite) {
    globalThis._currentSuite.it(name, fn);
  }
}

export function expect(actual) {
  const matchers = {
    toBe(expected) {
      assert.strictEqual(actual, expected);
    },
    toEqual(expected) {
      assert.deepStrictEqual(actual, expected);
    },
    toBeDefined() {
      assert.notStrictEqual(actual, undefined, 'Expected value to be defined');
    },
    toBeUndefined() {
      assert.strictEqual(actual, undefined, 'Expected value to be undefined');
    },
    toBeNull() {
      assert.strictEqual(actual, null, 'Expected value to be null');
    },
    toBeGreaterThanOrEqual(expected) {
      assert(actual >= expected, `Expected ${actual} >= ${expected}`);
    },
    toBeLessThan(expected) {
      assert(actual < expected, `Expected ${actual} < ${expected}`);
    },
    toHaveLength(expected) {
      assert.strictEqual(actual?.length, expected, `Expected length ${expected} but got ${actual?.length}`);
    },
    toContain(expected) {
      if (Array.isArray(actual) || typeof actual === 'string') {
        assert(actual.includes(expected), `Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`);
      } else {
        throw new Error(`toContain called on non-collection: ${typeof actual}`);
      }
    },
    toHaveProperty(prop) {
      assert(actual && prop in actual, `Expected object to have property "${prop}"`);
    },
    toThrow(expected) {
      assert.throws(actual, expected);
    },
    toThrowError(expected) {
      assert.throws(actual, expected);
    },
  };

  const negatedMatchers = {
    toBe(expected) {
      assert.notStrictEqual(actual, expected);
    },
    toEqual(expected) {
      assert.notDeepStrictEqual(actual, expected);
    },
    toHaveProperty(prop) {
      assert(!(actual && prop in actual), `Expected object NOT to have property "${prop}"`);
    },
    toThrow() {
      assert.doesNotThrow(actual);
    },
    toThrowError() {
      assert.doesNotThrow(actual);
    },
  };

  return {
    ...matchers,
    not: negatedMatchers,
  };
}

export async function runAllTests() {
  for (const suite of testQueue) {
    console.log(`\n📦 ${suite.name}`);
    for (const test of suite.tests) {
      for (const hook of suite.beforeEaches) {
        await hook();
      }
      try {
        const res = test.fn();
        if (res && typeof res.then === 'function') {
          await res;
        }
        console.log(`  ✅ ${test.name}`);
        totalPassed++;
      } catch (err) {
        console.error(`  ❌ ${test.name}`);
        console.error(`     ${err.message}`);
        totalFailed++;
        failures.push({ suite: suite.name, test: test.name, error: err });
      }
    }
  }

  console.log('\n========================================');
  console.log(`📊 Hasil Pengujian: ${totalPassed} Lulus, ${totalFailed} Gagal`);
  console.log('========================================\n');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

