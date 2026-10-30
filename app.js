/*!
 * BioCal · 化学浓度计算器 — 界面与交互
 * 依赖 calc.js 暴露的 window.CalcCore；无框架，直接操作 DOM。
 */
(function () {
  'use strict';

  const Core = window.CalcCore;
  if (!Core) return;

  const KEYS = { theme: 'chemcalc_theme', history: 'chemcalc_v4' };
  const FIELDS = Core.FIELDS;
  const FIELD_NAMES = { c: '浓度 c', V: '体积 V', m: '质量 m', M: '摩尔质量 M' };
  const THEME_ICONS = { auto: '◐', light: '☾', dark: '☀' };
  const THEME_LABELS = { auto: '主题：跟随系统', light: '主题：浅色', dark: '主题：深色' };
  const THEME_NEXT = { auto: 'light', light: 'dark', dark: 'auto' };
  const THEME_COLORS = { light: '#f0f4f8', dark: '#0f172a' };

  // ---- DOM ----
  const $ = (sel) => document.querySelector(sel);
  const inputs = {
    c: $('#input-c'),
    V: $('#input-v'),
    m: $('#input-m'),
    M: $('#input-molar')
  };
  const groups = {
    c: $('.input-group[data-field="c"]'),
    V: $('.input-group[data-field="V"]'),
    m: $('.input-group[data-field="m"]')
  };
  const molarGroup = $('.input-group.input-molar');
  const inputCard = $('#input-card');
  const keypad = $('#keypad');
  const hintEl = $('#keypad-hint');
  const pipetteEl = $('#pipette-hint');
  const calcBtn = $('#btn-calc');
  const saveBtn = $('#btn-save');
  const themeBtn = $('#btn-theme');
  const clearAllBtn = $('#btn-clearall');
  const clearHistoryBtn = $('#btn-clear-history');
  const historyList = $('#history-list');
  const historyTitle = $('#history-title');
  const fsBtn = $('#btn-fullscreen');
  const metaThemeColor = $('meta[name="theme-color"]');

  // ---- 状态 ----
  let activeField = 'M';
  let derivedField = null;
  let currentCalc = null;
  let unitState = Object.assign({}, Core.DEFAULT_UNITS);
  let themeMode = 'auto';
  let records = [];

  // ---- 本地存储（隐私模式 / 配额满时不抛错） ----
  function readRaw(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function writeRaw(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }

  // ---- 提示条 ----
  function showHint(text, tone) {
    hintEl.textContent = text;
    hintEl.classList.toggle('warn', tone === 'warn');
    hintEl.classList.toggle('ok', tone === 'ok');
  }

  function updateHint() {
    if (!(readMolar() > 0) && activeField !== 'M') {
      showHint('⚠ 请先输入摩尔质量 M', 'warn');
      return;
    }
    showHint('正在输入: ' + (FIELD_NAMES[activeField] || activeField), '');
  }

  // ---- 主题：跟随系统 / 浅色 / 深色 ----
  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function systemPrefersDark() {
    return !!(darkQuery && darkQuery.matches);
  }

  function readTheme() {
    const stored = readRaw(KEYS.theme);
    return stored === 'light' || stored === 'dark' || stored === 'auto' ? stored : 'auto';
  }

  function effectiveTheme() {
    if (themeMode === 'auto') return systemPrefersDark() ? 'dark' : 'light';
    return themeMode;
  }

  function applyTheme() {
    const theme = effectiveTheme();
    document.documentElement.setAttribute('data-theme', theme);
    if (metaThemeColor) metaThemeColor.setAttribute('content', THEME_COLORS[theme]);
    if (themeBtn) {
      themeBtn.textContent = THEME_ICONS[themeMode];
      themeBtn.title = THEME_LABELS[themeMode];
      themeBtn.setAttribute('aria-label', THEME_LABELS[themeMode]);
    }
  }

  function onSystemThemeChange() {
    if (themeMode === 'auto') applyTheme();
  }

  if (darkQuery) {
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', onSystemThemeChange);
    else if (darkQuery.addListener) darkQuery.addListener(onSystemThemeChange);
  }

  // ---- 输入读写 ----
  function readMolar() {
    return Core.parseValue(inputs.M.value);
  }

  function readInput(field) {
    const display = Core.parseValue(inputs[field].value);
    if (!isFinite(display)) return NaN;
    return Core.toBase(field, display, unitState[field]);
  }

  function setDisplay(field, baseValue) {
    inputs[field].value = Core.fmt(Core.fromBase(field, baseValue, unitState[field]));
  }

  // ---- 视觉状态 ----
  function updateActiveStyles() {
    FIELDS.forEach(function (f) { groups[f].classList.remove('active'); });
    molarGroup.classList.remove('active');
    const group = activeField === 'M' ? molarGroup : groups[activeField];
    if (group) group.classList.add('active');
    updateHint();
  }

  function updateDerivedStyle() {
    FIELDS.forEach(function (f) { groups[f].classList.remove('derived'); });
    if (derivedField && groups[derivedField]) groups[derivedField].classList.add('derived');
    updateSaveBtn();
    updatePipetteHint();
  }

  function updateMStatus() {
    const missing = !(readMolar() > 0);
    FIELDS.forEach(function (f) { groups[f].classList.toggle('missing-M', missing); });
    updateHint();
  }

  function updateSaveBtn() {
    saveBtn.classList.toggle('ready', !!currentCalc);
    saveBtn.classList.remove('saved');
    saveBtn.textContent = '保存';
  }

  function updatePipetteHint() {
    let split = null;
    if (derivedField === 'V') {
      const shown = Core.parseValue(inputs.V.value);
      if (isFinite(shown) && shown > 0) {
        split = Core.pipetteSplit(Core.toBase('V', shown, unitState.V) * 1e6);
      }
    }

    pipetteEl.textContent = '';
    if (!split) {
      pipetteEl.classList.remove('visible');
      return;
    }

    const main = document.createElement('span');
    main.textContent = '移液提示：' + Core.fmt(split.eachUl) + ' μL × ' + split.n +
      ' 次（1000 μL 移液器）';
    pipetteEl.appendChild(main);

    if (split.alt) {
      const alt = document.createElement('span');
      alt.className = 'alt';
      alt.textContent = '或：1000 μL × ' + split.alt.whole + ' 次 + ' +
        Core.fmt(split.alt.restUl) + ' μL × 1 次';
      pipetteEl.appendChild(alt);
    }

    pipetteEl.classList.add('visible');
  }

  // ---- 单位滑块 ----
  function updateSegSliders() {
    document.querySelectorAll('.segmented').forEach(function (seg) {
      const active = seg.querySelector('.seg-option.active');
      const slider = seg.querySelector('.seg-slider');
      if (!active || !slider) return;
      slider.style.left = active.offsetLeft + 'px';
      slider.style.width = active.offsetWidth + 'px';
    });
  }

  function updateUnitButtons() {
    document.querySelectorAll('.segmented').forEach(function (seg) {
      const field = seg.dataset.unitField;
      seg.querySelectorAll('.seg-option').forEach(function (btn) {
        const isActive = btn.dataset.unit === unitState[field];
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    });
    updateSegSliders();
  }

  function onUnitToggle(field, newUnit) {
    if (unitState[field] === newUnit) return;

    const oldUnit = unitState[field];
    const shown = Core.parseValue(inputs[field].value);
    unitState[field] = newUnit;
    updateUnitButtons();

    if (derivedField === field) {
      if (isFinite(shown)) {
        const base = Core.toBase(field, shown, oldUnit);
        inputs[field].value = Core.fmt(Core.fromBase(field, base, newUnit));
      }
    } else if (derivedField) {
      // 改动非结果字段的单位，旧结果不再可信
      derivedField = null;
      currentCalc = null;
    }

    updateDerivedStyle();
    updateHint();
  }

  // ---- 计算 ----
  function doCalculate() {
    if (derivedField) {
      inputs[derivedField].value = '';
      derivedField = null;
    }
    currentCalc = null;

    const M = readMolar();
    if (!(M > 0)) {
      showHint('⚠ 请先输入摩尔质量 M', 'warn');
      updateDerivedStyle();
      return;
    }

    const values = {};
    FIELDS.forEach(function (f) {
      const base = readInput(f);
      if (isFinite(base)) values[f] = base;
      else if (inputs[f].value !== '') inputs[f].value = '';
    });

    const target = Core.resolveTarget(values);
    if (!target.ok) {
      showHint(target.code === 'NEED_TWO'
        ? '⚠ 请填入 2 个变量再计算'
        : '⚠ 请清空 1 个变量后再计算', 'warn');
      updateDerivedStyle();
      return;
    }

    const result = Core.solve(M, values, target.target);
    if (!result.ok) {
      showHint(result.code === 'DIV_ZERO'
        ? '⚠ 输入值不合法（除数为零）'
        : '⚠ 计算出错，请检查输入', 'warn');
      updateDerivedStyle();
      return;
    }

    setDisplay(target.target, result.value);
    derivedField = target.target;
    currentCalc = Object.assign({ c: 0, V: 0, m: 0 }, values, { M: M });
    currentCalc[target.target] = result.value;

    updateDerivedStyle();
    showHint('✓ 计算完成 — ' + FIELD_NAMES[target.target] + ' 已求出', 'ok');
  }

  // ---- 自定义键盘 ----
  function handleKeyPress(key) {
    if (!activeField) return;

    const input = inputs[activeField];
    let value = input.value;

    if (key === 'clear') {
      value = '';
    } else if (key === 'backspace') {
      value = value.slice(0, -1);
    } else if (key === '.') {
      if (value.indexOf('.') !== -1) return;
      if (value === '') value = '0';
      value += '.';
    } else {
      value = value === '0' ? key : value + key;
    }

    input.value = value;

    // 任何编辑都会让旧结果失效
    if (derivedField) {
      derivedField = null;
      currentCalc = null;
    }

    if (activeField === 'M') updateMStatus();
    updateDerivedStyle();
    updateHint();
  }

  // ---- 记录 ----
  function loadRecords() {
    let raw = [];
    try {
      raw = JSON.parse(readRaw(KEYS.history) || '[]');
    } catch (e) {
      raw = [];
    }
    return Core.sanitizeHistory(raw);
  }

  function persistRecords(next) {
    if (writeRaw(KEYS.history, JSON.stringify(next))) return true;
    showHint('⚠ 本地存储不可用，记录未保存', 'warn');
    return false;
  }

  function recordDisplay(item) {
    return {
      time: Core.relativeTime(item.ts),
      c: Core.fmt(Core.fromBase('c', item.c, item.units.c)),
      V: Core.fmt(Core.fromBase('V', item.V, item.units.V)),
      m: Core.fmt(Core.fromBase('m', item.m, item.units.m)),
      M: Core.fmt(item.M)
    };
  }

  function renderHistory() {
    historyTitle.textContent = '计算记录 (' + records.length + '/' + Core.MAX_HISTORY + ')';
    historyList.textContent = '';

    if (records.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = '暂无记录';
      historyList.appendChild(empty);
      return;
    }

    records.forEach(function (item, index) {
      const d = recordDisplay(item);
      const shown = { c: d.c, V: d.V, m: d.m };
      const units = { c: item.units.c, V: item.units.V, m: item.units.m };

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'history-item';
      btn.dataset.idx = String(index);

      const vals = document.createElement('div');
      vals.className = 'hi-vals';

      const head = document.createElement('strong');
      head.textContent = item.solved + ' = ' + shown[item.solved] + ' ' + units[item.solved];
      vals.appendChild(head);

      const parts = FIELDS
        .filter(function (f) { return f !== item.solved; })
        .map(function (f) { return f + '=' + shown[f] + ' ' + units[f]; });
      parts.push('M=' + d.M + ' g/mol');

      const sub = document.createElement('span');
      sub.textContent = parts.join(', ');
      vals.appendChild(sub);

      const time = document.createElement('div');
      time.className = 'hi-solved';
      time.textContent = d.time;

      btn.appendChild(vals);
      btn.appendChild(time);
      historyList.appendChild(btn);
    });
  }

  function loadRecord(item) {
    derivedField = null;
    currentCalc = null;
    unitState = Core.sanitizeUnits(item.units);
    updateUnitButtons();

    FIELDS.forEach(function (f) {
      inputs[f].value = Core.fmt(Core.fromBase(f, item[f], unitState[f]));
    });
    inputs.M.value = Core.fmt(item.M);

    updateDerivedStyle();
    updateActiveStyles();
    updateMStatus();
  }

  function saveCurrentCalc() {
    if (!currentCalc || !derivedField) return;

    const entry = {
      c: currentCalc.c,
      V: currentCalc.V,
      m: currentCalc.m,
      M: currentCalc.M,
      solved: derivedField,
      units: { c: unitState.c, V: unitState.V, m: unitState.m },
      ts: Date.now()
    };

    const result = Core.addHistory(records, entry);
    let saved = !result.added; // 与上一条完全重复：视为已保存

    if (result.added && persistRecords(result.list)) {
      records = result.list;
      renderHistory();
      saved = true;
    }

    if (!saved) return;

    saveBtn.classList.add('saved');
    saveBtn.textContent = '✓ 已保存';
    window.setTimeout(function () {
      saveBtn.classList.remove('saved');
      saveBtn.textContent = '保存';
    }, 1200);
  }

  function clearHistory() {
    records = [];
    persistRecords(records);
    renderHistory();
  }

  // ---- 清空 ----
  function clearAllInputs() {
    Object.keys(inputs).forEach(function (f) { inputs[f].value = ''; });
    derivedField = null;
    currentCalc = null;
    updateDerivedStyle();
    updateActiveStyles();
    updateMStatus();
  }

  // ---- 全屏 + 竖屏锁定（能力不足时直接隐藏入口） ----
  const fsEl = document.documentElement;
  const hasFsApi = !!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen);
  const hasLock = !!(window.screen &&
    ((screen.orientation && screen.orientation.lock) || typeof screen.lockOrientation === 'function'));

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function updateFullscreenBtn() {
    const active = !!fullscreenElement();
    fsBtn.textContent = active ? '✕' : '⛶';
    fsBtn.classList.toggle('fs-active', active);
    fsBtn.title = active ? '退出全屏' : '全屏模式';
    fsBtn.setAttribute('aria-label', fsBtn.title);
  }

  function lockPortrait() {
    const so = screen.orientation;
    if (so && so.lock) return so.lock('portrait').catch(function () {});
    if (typeof screen.lockOrientation === 'function') {
      try {
        return Promise.resolve(screen.lockOrientation('portrait'));
      } catch (e) {
        return Promise.reject(e);
      }
    }
    return Promise.reject(new Error('no-lock'));
  }

  if (!hasFsApi || !hasLock) {
    fsBtn.style.display = 'none';
  } else {
    updateFullscreenBtn();

    fsBtn.addEventListener('click', function () {
      if (!fullscreenElement()) {
        const request = fsEl.requestFullscreen
          ? fsEl.requestFullscreen()
          : fsEl.webkitRequestFullscreen();
        Promise.resolve(request).catch(function () {
          showHint('⚠ 全屏失败，请重试', 'warn');
        });
      } else if (document.exitFullscreen) {
        document.exitFullscreen();
        if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    });

    const onFullscreenChange = function () {
      updateFullscreenBtn();
      if (!fullscreenElement()) return;
      lockPortrait().catch(function () {
        if (window.matchMedia('(pointer: coarse)').matches) {
          if (document.exitFullscreen) document.exitFullscreen();
          showHint('⚠ 当前浏览器不支持竖屏全屏，建议添加到主屏幕使用', 'warn');
        }
      });
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  }

  // ---- 事件绑定 ----
  inputCard.addEventListener('click', function (e) {
    const input = e.target.closest('input');
    if (!input) return;
    activeField = input.dataset.field;
    updateActiveStyles();
  });

  calcBtn.addEventListener('click', doCalculate);
  saveBtn.addEventListener('click', saveCurrentCalc);
  clearAllBtn.addEventListener('click', clearAllInputs);

  keypad.addEventListener('click', function (e) {
    const btn = e.target.closest('button');
    if (btn) handleKeyPress(btn.dataset.key);
  });

  document.querySelectorAll('.segmented').forEach(function (seg) {
    seg.addEventListener('click', function (e) {
      const btn = e.target.closest('.seg-option');
      if (btn) onUnitToggle(seg.dataset.unitField, btn.dataset.unit);
    });
  });

  themeBtn.addEventListener('click', function () {
    themeMode = THEME_NEXT[themeMode];
    if (!writeRaw(KEYS.theme, themeMode)) showHint('⚠ 无法保存主题设置', 'warn');
    applyTheme();
  });

  clearHistoryBtn.addEventListener('click', clearHistory);

  historyList.addEventListener('click', function (e) {
    const btn = e.target.closest('.history-item');
    if (!btn) return;
    const item = records[Number(btn.dataset.idx)];
    if (item) loadRecord(item);
  });

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    if (e.key >= '0' && e.key <= '9') { handleKeyPress(e.key); return; }
    if (e.key === '.') { handleKeyPress('.'); return; }
    if (e.key === 'Backspace') { e.preventDefault(); handleKeyPress('backspace'); return; }
    if (e.key === 'Delete' || e.key === 'Escape') { handleKeyPress('clear'); return; }
    if (e.key === 'Enter') { doCalculate(); }
  });

  window.addEventListener('resize', updateSegSliders);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(updateSegSliders).catch(function () {});
  }

  // ---- 初始化 ----
  themeMode = readTheme();
  applyTheme();
  records = loadRecords();
  renderHistory();
  updateUnitButtons();
  updateActiveStyles();
  updateDerivedStyle();
  updateMStatus();

  // ---- Service Worker（file:// 下跳过） ----
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
