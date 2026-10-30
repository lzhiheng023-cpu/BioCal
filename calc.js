/*!
 * BioCal · 化学浓度计算器 — 计算核心
 * 纯函数，不依赖 DOM：浏览器挂到 window.CalcCore，Node 下走 module.exports。
 *
 * 内部基准单位：c = mol/L，V = L，m = g（对应 M = g/mol）
 * 关系式：c = m / (M · V)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CalcCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FIELDS = ['c', 'V', 'm'];
  const MAX_HISTORY = 10;

  const UNITS = {
    c: ['M', 'mM', 'μM'],
    V: ['L', 'mL'],
    m: ['g', 'mg']
  };

  const DEFAULT_UNITS = { c: 'mM', V: 'mL', m: 'mg' };

  /* 显示值 = 基准值 × factor */
  const FACTORS = {
    c: { M: 1, mM: 1e3, μM: 1e6 },
    V: { L: 1, mL: 1e3 },
    m: { g: 1, mg: 1e3 }
  };

  const DECIMAL_RE = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

  function isKnownUnit(field, unit) {
    const table = FACTORS[field];
    return !!table && Object.prototype.hasOwnProperty.call(table, unit);
  }

  function unitFactor(field, unit) {
    if (!isKnownUnit(field, unit)) {
      throw new Error('unknown unit: ' + field + '/' + unit);
    }
    return FACTORS[field][unit];
  }

  /** 显示值 → 基准值 */
  function toBase(field, value, unit) {
    return value / unitFactor(field, unit);
  }

  /** 基准值 → 显示值 */
  function fromBase(field, value, unit) {
    return value * unitFactor(field, unit);
  }

  /**
   * 解析用户输入（键盘/记录回填）。仅接受非负十进制或科学计数法，
   * 空串、负数、NaN、Infinity 一律返回 NaN。
   */
  function parseValue(raw) {
    if (raw === null || raw === undefined) return NaN;
    const s = String(raw).trim();
    if (!DECIMAL_RE.test(s)) return NaN;
    const n = Number(s);
    return isFinite(n) && n >= 0 ? n : NaN;
  }

  /** 结果格式化：抹掉浮点尾差，极小/极大值转科学计数法 */
  function fmt(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '';
    if (n === 0) return '0';
    if (Math.abs(n) < 1e-10 || Math.abs(n) >= 1e12) return n.toExponential(5);
    return parseFloat(n.toFixed(10)).toString();
  }

  function compute(M, values, target) {
    if (target === 'c') return values.m / (M * values.V);
    if (target === 'V') return values.m / (values.c * M);
    if (target === 'm') return values.c * M * values.V;
    return NaN;
  }

  /** 求目标量前的前置条件：M 合法且除数不为 0 */
  function canCompute(M, values, target) {
    if (typeof M !== 'number' || !isFinite(M) || M <= 0) return false;
    if (!values || typeof values !== 'object') return false;
    if (target === 'c') return values.V > 0;
    if (target === 'V') return values.c > 0;
    return target === 'm';
  }

  /** 已填字段列表（忽略非法值） */
  function filledFields(values) {
    if (!values || typeof values !== 'object') return [];
    return FIELDS.filter(function (f) {
      return typeof values[f] === 'number' && isFinite(values[f]) && values[f] >= 0;
    });
  }

  /** 依据“填 2 求 1”规则推断待求字段 */
  function resolveTarget(values) {
    const filled = filledFields(values);
    if (filled.length < 2) return { ok: false, code: 'NEED_TWO' };
    if (filled.length > 2) return { ok: false, code: 'TOO_MANY' };
    const target = FIELDS.filter(function (f) { return filled.indexOf(f) === -1; })[0];
    return { ok: true, target: target };
  }

  /**
   * 统一求解入口。
   * @returns {{ok:true, value:number} | {ok:false, code:string}}
   */
  function solve(M, values, target) {
    if (typeof M !== 'number' || !isFinite(M) || M <= 0) {
      return { ok: false, code: 'MISSING_M' };
    }
    if (FIELDS.indexOf(target) === -1) return { ok: false, code: 'INVALID_TARGET' };
    if (!canCompute(M, values, target)) return { ok: false, code: 'DIV_ZERO' };
    const value = compute(M, values, target);
    if (!isFinite(value) || value < 0) return { ok: false, code: 'OUT_OF_RANGE' };
    return { ok: true, value: value };
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  /**
   * 移液建议：把目标体积（μL）拆成 1000 μL 移液器的若干次。
   * 不能整除时额外给出“整枪 + 余量”的替代方案。
   */
  function pipetteSplit(volumeUl) {
    if (typeof volumeUl !== 'number' || !isFinite(volumeUl) || volumeUl <= 0) return null;

    const n = Math.max(1, Math.ceil(volumeUl / 1000));
    const eachUl = round1(volumeUl / n);
    let alt = null;

    if (Math.abs(volumeUl / n - Math.round(volumeUl / n)) > 1e-9) {
      const whole = Math.floor(volumeUl / 1000);
      const restUl = round1(volumeUl - whole * 1000);
      if (whole >= 1 && restUl > 0 && restUl < 1000) {
        alt = { whole: whole, restUl: restUl };
      }
    }

    return { n: n, eachUl: eachUl, alt: alt };
  }

  /** 历史记录单位快照兜底 */
  function sanitizeUnits(units) {
    const out = Object.assign({}, DEFAULT_UNITS);
    if (!units || typeof units !== 'object') return out;
    FIELDS.forEach(function (f) {
      if (isKnownUnit(f, units[f])) out[f] = units[f];
    });
    return out;
  }

  /** 移液方案结构校验：允许为空，非空时必须是 pipetteSplit 的合法输出 */
  function isValidPipette(p) {
    if (p === null || p === undefined) return true;
    if (typeof p !== 'object') return false;
    if (!Number.isInteger(p.n) || p.n < 1) return false;
    if (typeof p.eachUl !== 'number' || !isFinite(p.eachUl) || p.eachUl <= 0) return false;
    if (p.alt === null || p.alt === undefined) return true;
    if (typeof p.alt !== 'object') return false;
    return Number.isInteger(p.alt.whole) && p.alt.whole >= 1 &&
      typeof p.alt.restUl === 'number' && isFinite(p.alt.restUl) &&
      p.alt.restUl > 0 && p.alt.restUl < 1000;
  }

  function sanitizePipette(p) {
    if (!isValidPipette(p) || p === null || p === undefined) return null;
    return {
      n: p.n,
      eachUl: p.eachUl,
      alt: p.alt ? { whole: p.alt.whole, restUl: p.alt.restUl } : null
    };
  }

  /** 单条记录结构校验（数值均为基准单位） */
  function isValidEntry(e) {
    if (!e || typeof e !== 'object') return false;
    if (!FIELDS.concat('M').every(function (f) {
      return typeof e[f] === 'number' && isFinite(e[f]) && e[f] >= 0;
    })) return false;
    if (!(e.M > 0)) return false;
    if (FIELDS.indexOf(e.solved) === -1) return false;
    return typeof e.ts === 'number' && isFinite(e.ts) && e.ts > 0;
  }

  /** 清洗 localStorage 中的历史记录，丢弃损坏条目并限制条数 */
  function sanitizeHistory(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(isValidEntry)
      .slice(0, MAX_HISTORY)
      .map(function (e) {
        return {
          c: e.c,
          V: e.V,
          m: e.m,
          M: e.M,
          solved: e.solved,
          units: sanitizeUnits(e.units),
          ts: e.ts,
          pipette: sanitizePipette(e.pipette)
        };
      });
  }

  function sameEntry(a, b) {
    return !!a && !!b &&
      a.c === b.c && a.V === b.V && a.m === b.m && a.M === b.M && a.solved === b.solved;
  }

  /** 新记录插入队首；与上一条完全相同时不重复写入 */
  function addHistory(list, entry) {
    const next = Array.isArray(list) ? list.slice() : [];
    if (!isValidEntry(entry)) return { list: next, added: false };

    const clean = {
      c: entry.c,
      V: entry.V,
      m: entry.m,
      M: entry.M,
      solved: entry.solved,
      units: sanitizeUnits(entry.units),
      ts: entry.ts,
      pipette: entry.solved === 'V' ? sanitizePipette(entry.pipette) : null
    };

    if (sameEntry(next[0], clean)) return { list: next, added: false };
    next.unshift(clean);
    if (next.length > MAX_HISTORY) next.length = MAX_HISTORY;
    return { list: next, added: true };
  }

  /** 相对时间文案 */
  function relativeTime(ts, now) {
    const base = typeof now === 'number' ? now : Date.now();
    const diffMin = Math.floor((base - ts) / 60000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return diffMin + '分钟前';
    if (diffMin < 1440) return Math.floor(diffMin / 60) + '小时前';
    return Math.floor(diffMin / 1440) + '天前';
  }

  return {
    FIELDS: FIELDS,
    MAX_HISTORY: MAX_HISTORY,
    UNITS: UNITS,
    DEFAULT_UNITS: DEFAULT_UNITS,
    unitFactor: unitFactor,
    isKnownUnit: isKnownUnit,
    toBase: toBase,
    fromBase: fromBase,
    parseValue: parseValue,
    fmt: fmt,
    compute: compute,
    canCompute: canCompute,
    resolveTarget: resolveTarget,
    solve: solve,
    pipetteSplit: pipetteSplit,
    relativeTime: relativeTime,
    sanitizeUnits: sanitizeUnits,
    isValidPipette: isValidPipette,
    sanitizePipette: sanitizePipette,
    sanitizeHistory: sanitizeHistory,
    addHistory: addHistory,
    isValidEntry: isValidEntry,
    sameEntry: sameEntry
  };
});
