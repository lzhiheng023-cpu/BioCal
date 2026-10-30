'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../calc.js');

const closeTo = (actual, expected, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) < eps, `${actual} ≉ ${expected}`);
};

function entry(overrides) {
  return Object.assign({
    c: 0.001,
    V: 0.01,
    m: 0.0018016,
    M: 180.16,
    solved: 'm',
    units: { c: 'mM', V: 'mL', m: 'mg' },
    ts: 1700000000000
  }, overrides);
}

test('单位换算：显示值 ↔ 基准值', () => {
  assert.equal(Core.toBase('c', 1000, 'mM'), 1);
  assert.equal(Core.toBase('c', 1e6, 'μM'), 1);
  assert.equal(Core.toBase('V', 500, 'mL'), 0.5);
  assert.equal(Core.toBase('m', 250, 'mg'), 0.25);
  assert.equal(Core.fromBase('m', 0.0005, 'mg'), 0.5);
  assert.throws(() => Core.unitFactor('c', 'nM'));
});

test('核心公式 c = m / (M·V)', () => {
  const r = Core.solve(180.16, { m: 0.18, V: 0.001 }, 'c');
  assert.equal(r.ok, true);
  closeTo(r.value, 0.9991119005328597);
});

test('核心公式 V = m / (c·M)', () => {
  const r = Core.solve(180.16, { m: 0.18, c: 1 }, 'V');
  assert.equal(r.ok, true);
  closeTo(r.value, 0.0009991119005328597);
});

test('核心公式 m = c·M·V', () => {
  const r = Core.solve(180.16, { c: 0.001, V: 0.01 }, 'm');
  assert.equal(r.ok, true);
  closeTo(r.value, 0.0018016);
});

test('三式互推：求出的值能反解回原值', () => {
  const M = 58.44;
  const c = 0.5;
  const V = 0.02;
  const m = Core.solve(M, { c, V }, 'm');
  assert.equal(m.ok, true);
  const back = Core.solve(M, { m: m.value, V }, 'c');
  assert.equal(back.ok, true);
  closeTo(back.value, c);
});

test('目标字段推断：恰好缺 1 个才可计算', () => {
  assert.deepEqual(Core.resolveTarget({ c: 1, V: 0.5 }), { ok: true, target: 'm' });
  assert.deepEqual(Core.resolveTarget({ c: 1, m: 2 }), { ok: true, target: 'V' });
  assert.deepEqual(Core.resolveTarget({ V: 1, m: 2 }), { ok: true, target: 'c' });
  assert.deepEqual(Core.resolveTarget({ c: 1 }), { ok: false, code: 'NEED_TWO' });
  assert.deepEqual(Core.resolveTarget({}), { ok: false, code: 'NEED_TWO' });
  assert.deepEqual(Core.resolveTarget({ c: 1, V: 2, m: 3 }), { ok: false, code: 'TOO_MANY' });
});

test('求解失败原因可区分', () => {
  assert.equal(Core.solve(0, { V: 1, m: 1 }, 'c').code, 'MISSING_M');
  assert.equal(Core.solve(NaN, { V: 1, m: 1 }, 'c').code, 'MISSING_M');
  assert.equal(Core.solve(100, { V: 0, m: 1 }, 'c').code, 'DIV_ZERO');
  assert.equal(Core.solve(100, { c: 0, m: 1 }, 'V').code, 'DIV_ZERO');
  assert.equal(Core.solve(100, { c: 1, V: 1 }, 'x').code, 'INVALID_TARGET');
  assert.equal(Core.canCompute(100, {}, 'm'), true);
});

test('输入解析：只接受非负十进制 / 科学计数法', () => {
  assert.equal(Core.parseValue('12.5'), 12.5);
  assert.equal(Core.parseValue('12.'), 12);
  assert.equal(Core.parseValue('.5'), 0.5);
  assert.equal(Core.parseValue(' 42 '), 42);
  assert.equal(Core.parseValue('1e3'), 1000);
  assert.equal(Core.parseValue('1E-3'), 0.001);
  assert.equal(Core.parseValue('0'), 0);
  assert.ok(Number.isNaN(Core.parseValue('')));
  assert.ok(Number.isNaN(Core.parseValue('   ')));
  assert.ok(Number.isNaN(Core.parseValue('-1')));
  assert.ok(Number.isNaN(Core.parseValue('1.2.3')));
  assert.ok(Number.isNaN(Core.parseValue('abc')));
  assert.ok(Number.isNaN(Core.parseValue('Infinity')));
  assert.ok(Number.isNaN(Core.parseValue(null)));
});

test('结果格式化：消除浮点尾差并按量级切换科学计数法', () => {
  assert.equal(Core.fmt(0), '0');
  assert.equal(Core.fmt(0.1 + 0.2), '0.3');
  assert.equal(Core.fmt(1 / 3), '0.3333333333');
  assert.equal(Core.fmt(123.456), '123.456');
  assert.equal(Core.fmt(1e-12), '1.00000e-12');
  assert.equal(Core.fmt(1e12), '1.00000e+12');
  assert.equal(Core.fmt(NaN), '');
  assert.equal(Core.fmt(Infinity), '');
});

test('移液提示：均分与“整枪 + 余量”备选方案', () => {
  assert.deepEqual(Core.pipetteSplit(1000), { n: 1, eachUl: 1000, alt: null });
  assert.deepEqual(Core.pipetteSplit(1500), { n: 2, eachUl: 750, alt: null });
  assert.deepEqual(Core.pipetteSplit(2000), { n: 2, eachUl: 1000, alt: null });
  assert.deepEqual(Core.pipetteSplit(2500), {
    n: 3,
    eachUl: 833.3,
    alt: { whole: 2, restUl: 500 }
  });
  assert.deepEqual(Core.pipetteSplit(250), { n: 1, eachUl: 250, alt: null });
  assert.equal(Core.pipetteSplit(0), null);
  assert.equal(Core.pipetteSplit(-5), null);
  assert.equal(Core.pipetteSplit(NaN), null);
});

test('相对时间文案', () => {
  const now = 1700000000000;
  assert.equal(Core.relativeTime(now - 30 * 1000, now), '刚刚');
  assert.equal(Core.relativeTime(now - 5 * 60000, now), '5分钟前');
  assert.equal(Core.relativeTime(now - 90 * 60000, now), '1小时前');
  assert.equal(Core.relativeTime(now - 3 * 86400000, now), '3天前');
  assert.equal(Core.relativeTime(now + 60000, now), '刚刚');
});

test('历史记录：去重、上限 10 条、拒绝非法条目', () => {
  let list = [];
  for (let i = 0; i < 12; i++) {
    const r = Core.addHistory(list, entry({ ts: 1700000000000 + i, m: i + 1 }));
    assert.equal(r.added, true);
    list = r.list;
  }
  assert.equal(list.length, Core.MAX_HISTORY);
  assert.equal(list[0].m, 12);

  const dup = Core.addHistory(list, list[0]);
  assert.equal(dup.added, false);
  assert.equal(dup.list.length, list.length);

  const bad = Core.addHistory(list, entry({ M: 0 }));
  assert.equal(bad.added, false);
});

test('历史记录清洗：丢弃损坏数据并兜底单位', () => {
  const raw = [
    entry({ units: { c: 'nM', V: 'mL', m: 'kg' } }),
    entry({ M: -1 }),
    entry({ solved: 'x' }),
    entry({ ts: 'yesterday' }),
    entry({ c: '1' }),
    null,
    'oops'
  ];
  const clean = Core.sanitizeHistory(raw);
  assert.equal(clean.length, 1);
  assert.deepEqual(clean[0].units, { c: 'mM', V: 'mL', m: 'mg' });
  assert.deepEqual(Core.sanitizeHistory('not-an-array'), []);
  assert.deepEqual(Core.sanitizeHistory(null), []);
});

test('记录单位归一化不改变基准值', () => {
  const base = 0.00075; // 0.75 mL
  const shown = Core.fromBase('V', base, 'mL');
  assert.equal(shown, 0.75);
  closeTo(Core.toBase('V', shown, 'mL'), base);
});

test('体积记录的移液方案可保存、清洗并随记录读取', () => {
  const split = Core.pipetteSplit(2500);
  assert.deepEqual(split, { n: 3, eachUl: 833.3, alt: { whole: 2, restUl: 500 } });
  assert.equal(Core.isValidPipette(split), true);
  assert.equal(Core.isValidPipette(null), true);
  assert.equal(Core.isValidPipette({ n: 0, eachUl: 100 }), false);
  assert.equal(Core.isValidPipette({ n: 2, eachUl: Number.NaN }), false);
  assert.equal(Core.isValidPipette({ n: 2, eachUl: 500, alt: { whole: 1, restUl: 1000 } }), false);

  const added = Core.addHistory([], entry({ solved: 'V', V: 0.0025, pipette: split }));
  assert.equal(added.added, true);
  assert.deepEqual(added.list[0].pipette, split);

  const cleaned = Core.sanitizeHistory([entry({ solved: 'V', V: 0.0025, pipette: split })]);
  assert.deepEqual(cleaned[0].pipette, split);

  // 损坏的移液信息只丢弃该字段，不丢整条计算记录
  const broken = Core.sanitizeHistory([entry({ solved: 'V', V: 0.0025, pipette: { n: 0 } })]);
  assert.equal(broken.length, 1);
  assert.equal(broken[0].pipette, null);

  // 非体积结果不保存移液信息
  const mass = Core.addHistory([], entry({ solved: 'm', pipette: split }));
  assert.equal(mass.list[0].pipette, null);
});
