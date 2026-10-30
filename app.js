/*!
 * BioCal · 化学浓度计算器 — 界面与交互
 * 依赖 calc.js 暴露的 window.CalcCore；无框架，直接操作 DOM。
 */
(function () {
  'use strict';

  const Core = window.CalcCore;
  if (!Core) return;

  const KEYS = {
    theme: 'chemcalc_theme',
    history: 'chemcalc_v4',
    wallpaper: 'chemcalc_wallpaper'
  };
  const FIELDS = Core.FIELDS;
  const FIELD_NAMES = { c: '浓度 c', V: '体积 V', m: '质量 m', M: '摩尔质量 M' };
  const THEME_ICONS = { auto: '◐', light: '☾', dark: '☀' };
  const THEME_LABELS = { auto: '主题：跟随系统', light: '主题：浅色', dark: '主题：深色' };
  const THEME_VALUES = { auto: '跟随系统', light: '浅色', dark: '深色' };
  const THEME_NEXT = { auto: 'light', light: 'dark', dark: 'auto' };
  const THEME_COLORS = { light: '#f0f4f8', dark: '#0f172a' };

  // ---- DOM ----
  const $ = (sel) => document.querySelector(sel);
  const appEl = $('.app');
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
  const clearHistoryBtn = $('#btn-clear-history');
  const historyList = $('#history-list');
  const historyTitle = $('#history-title');
  const historyModal = $('#history-modal');
  const historyPanel = $('#history-modal .modal-panel');
  const closeHistoryBtn = $('#btn-close-history');

  const settingsBtn = $('#btn-settings');
  const settingsModal = $('#settings-modal');
  const settingsPanel = $('#settings-modal .modal-panel');
  const closeSettingsBtn = $('#btn-close-settings');
  const settingsHistory = $('#settings-history');
  const settingsHistoryCount = $('#settings-history-count');
  const settingsSkin = $('#settings-skin');
  const settingsSkinState = $('#settings-skin-state');
  const settingsSkinClear = $('#settings-skin-clear');
  const settingsTheme = $('#settings-theme');
  const settingsThemeIcon = $('#settings-theme-icon');
  const settingsThemeValue = $('#settings-theme-value');
  const settingsClearAll = $('#settings-clearall');
  const wallpaperInput = $('#wallpaper-input');
  const wallpaperEl = $('#wallpaper');
  const metaThemeColor = $('meta[name="theme-color"]');

  // ---- 状态 ----
  let activeField = 'M';
  let derivedField = null;
  let currentCalc = null;
  let unitState = Object.assign({}, Core.DEFAULT_UNITS);
  let themeMode = 'auto';
  let records = [];
  let wallpaper = '';

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
    if (settingsThemeIcon) settingsThemeIcon.textContent = THEME_ICONS[themeMode];
    if (settingsThemeValue) settingsThemeValue.textContent = THEME_VALUES[themeMode];
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

  /** 记录中的移液信息：优先用保存值，旧记录则按体积重算 */
  function recordPipette(item) {
    if (item.pipette) return item.pipette;
    if (item.solved === 'V' && item.V > 0) return Core.pipetteSplit(item.V * 1e6);
    return null;
  }

  function pipetteMain(pipette) {
    return '移液 ' + Core.fmt(pipette.eachUl) + ' μL × ' + pipette.n + ' 次';
  }

  function pipetteAlt(pipette) {
    if (!pipette.alt) return '';
    return '备选 1000 μL × ' + pipette.alt.whole + ' 次 + ' +
      Core.fmt(pipette.alt.restUl) + ' μL × 1 次';
  }

  function renderHistory() {
    historyTitle.textContent = '计算记录 (' + records.length + '/' + Core.MAX_HISTORY + ')';
    settingsHistoryCount.textContent = records.length ? records.length + ' 条记录' : '暂无记录';
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

      const pipette = recordPipette(item);
      if (pipette) {
        const main = document.createElement('span');
        main.className = 'hi-pipette';
        main.textContent = pipetteMain(pipette);
        vals.appendChild(main);

        if (pipette.alt) {
          const alt = document.createElement('span');
          alt.className = 'hi-pipette alt';
          alt.textContent = pipetteAlt(pipette);
          vals.appendChild(alt);
        }
      }

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
      ts: Date.now(),
      // 体积结果同时保存移液方案，避免回看时信息缺失
      pipette: derivedField === 'V' ? Core.pipetteSplit(currentCalc.V * 1e6) : null
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
    saveBtn.textContent = '已保存';
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

  // ---- 弹窗 ----
  let lastFocused = null;

  function openModal(modal, panel) {
    resetBounce();
    lastFocused = document.activeElement;
    modal.classList.add('open');
    document.body.classList.add('modal-open');
    if (panel) panel.focus();
  }

  function closeModal(modal) {
    if (!modal.classList.contains('open')) return;
    modal.classList.remove('open');
    if (!document.querySelector('.modal.open')) {
      document.body.classList.remove('modal-open');
    }
    const target = lastFocused;
    lastFocused = null;
    if (target && document.contains(target) && typeof target.focus === 'function') {
      target.focus();
    }
  }

  function openHistory() {
    renderHistory();
    openModal(historyModal, historyPanel);
  }

  function closeHistory() {
    closeModal(historyModal);
  }

  function openSettings() {
    renderSettings();
    openModal(settingsModal, settingsPanel);
  }

  function closeSettings() {
    closeModal(settingsModal);
  }

  function renderSettings() {
    settingsHistoryCount.textContent = records.length ? records.length + ' 条记录' : '暂无记录';
    settingsThemeIcon.textContent = THEME_ICONS[themeMode];
    settingsThemeValue.textContent = THEME_VALUES[themeMode];
    settingsTheme.setAttribute('aria-label', THEME_LABELS[themeMode]);
    updateWallpaperUI();
  }

  // ---- 壁纸 ----
  function updateWallpaperUI() {
    const has = !!wallpaper;
    settingsSkinState.textContent = has ? '已设置 · 点按更换' : '默认背景';
    settingsSkinClear.hidden = !has;
  }

  function applyWallpaper(dataUrl) {
    wallpaper = dataUrl || '';
    if (wallpaperEl) {
      wallpaperEl.style.backgroundImage = wallpaper ? 'url("' + wallpaper + '")' : '';
    }
    document.body.classList.toggle('has-wallpaper', !!wallpaper);
    updateWallpaperUI();
  }

  function loadWallpaper() {
    const stored = readRaw(KEYS.wallpaper);
    return stored && stored.indexOf('data:image/') === 0 ? stored : '';
  }

  function persistWallpaper(dataUrl) {
    return writeRaw(KEYS.wallpaper, dataUrl);
  }

  function removeWallpaper() {
    try { localStorage.removeItem(KEYS.wallpaper); } catch (e) { /* ignore */ }
    applyWallpaper('');
  }

  function loadImageFile(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function renderWallpaper(img, maxDim, quality) {
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  async function handleWallpaperFile(file) {
    if (!file || !/^image\//.test(file.type)) {
      settingsSkinState.textContent = '请选择图片文件';
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      settingsSkinState.textContent = '图片过大（上限 25 MB）';
      return;
    }

    settingsSkinState.textContent = '正在处理…';
    try {
      const img = await loadImageFile(file);
      let dataUrl = renderWallpaper(img, 1600, 0.85);
      if (!persistWallpaper(dataUrl)) {
        dataUrl = renderWallpaper(img, 1100, 0.7);
        if (!persistWallpaper(dataUrl)) throw new Error('quota');
      }
      applyWallpaper(dataUrl);
      closeSettings();
      showHint('✓ 壁纸已更新', 'ok');
    } catch (e) {
      settingsSkinState.textContent = '处理失败，请换一张图片';
    }
  }

  // ---- 无滚动余量时的跟手阻尼 + 弹簧回中 ----
  const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const BOUNCE_LIMIT = 96;
  let bounceEnabled = false;
  let bounceOffset = 0;
  let bounceVelocity = 0;
  let bounceRaf = 0;
  let bounceLastFrame = 0;
  let dragState = null;
  let wheelTimer = 0;

  function hasOpenModal() {
    return !!document.querySelector('.modal.open');
  }

  function applyBounce(value) {
    bounceOffset = value;
    if (Math.abs(value) < 0.05) {
      bounceOffset = 0;
      appEl.style.transform = '';
      appEl.style.willChange = '';
      return;
    }
    appEl.style.transform = 'translate3d(0, ' + value.toFixed(2) + 'px, 0)';
    appEl.style.willChange = 'transform';
  }

  function resetBounce() {
    if (bounceRaf) cancelAnimationFrame(bounceRaf);
    bounceRaf = 0;
    bounceVelocity = 0;
    bounceLastFrame = 0;
    dragState = null;
    applyBounce(0);
  }

  function updateBounceState() {
    const fits = document.documentElement.scrollHeight <= window.innerHeight + 1;
    bounceEnabled = fits && !(motionQuery && motionQuery.matches);
    if (!bounceEnabled) resetBounce();
  }

  function bounceResistance(dy) {
    const abs = Math.abs(dy);
    const value = (abs * BOUNCE_LIMIT) / (BOUNCE_LIMIT + abs * 0.65);
    return Math.sign(dy) * Math.min(BOUNCE_LIMIT, value);
  }

  function bounceSpringFrame(now) {
    if (!bounceLastFrame) bounceLastFrame = now;
    const dt = Math.min(0.032, (now - bounceLastFrame) / 1000);
    bounceLastFrame = now;

    const accel = -220 * bounceOffset - 20 * bounceVelocity;
    bounceVelocity += accel * dt;
    bounceOffset += bounceVelocity * dt;

    if (Math.abs(bounceOffset) < 0.4 && Math.abs(bounceVelocity) < 1.5) {
      bounceRaf = 0;
      bounceLastFrame = 0;
      applyBounce(0);
      return;
    }

    appEl.style.transform = 'translate3d(0, ' + bounceOffset.toFixed(2) + 'px, 0)';
    appEl.style.willChange = 'transform';
    bounceRaf = requestAnimationFrame(bounceSpringFrame);
  }

  function startBounceSpring() {
    if (!bounceOffset) return;
    if (bounceRaf) cancelAnimationFrame(bounceRaf);
    bounceLastFrame = 0;
    bounceRaf = requestAnimationFrame(bounceSpringFrame);
  }

  function onTouchStart(e) {
    if (!bounceEnabled || hasOpenModal() || e.touches.length !== 1) return;
    resetBounce();
    dragState = { startY: e.touches[0].clientY, engaged: false };
  }

  function onTouchMove(e) {
    if (!dragState || !bounceEnabled || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - dragState.startY;
    if (!dragState.engaged) {
      if (Math.abs(dy) < 10) return;
      dragState.engaged = true;
    }
    if (e.cancelable) e.preventDefault();
    bounceVelocity = 0;
    applyBounce(bounceResistance(dy));
  }

  function onTouchEnd() {
    if (!dragState) return;
    const engaged = dragState.engaged;
    dragState = null;
    if (engaged) startBounceSpring();
  }

  function onWheel(e) {
    if (!bounceEnabled || hasOpenModal() || e.ctrlKey) return;
    e.preventDefault();
    if (bounceRaf) {
      cancelAnimationFrame(bounceRaf);
      bounceRaf = 0;
    }
    const next = bounceOffset + e.deltaY * 0.35;
    applyBounce(Math.max(-BOUNCE_LIMIT, Math.min(BOUNCE_LIMIT, next)));
    window.clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(startBounceSpring, 140);
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

  // ---- 事件绑定 ----
  inputCard.addEventListener('click', function (e) {
    const input = e.target.closest('input');
    if (!input) return;
    activeField = input.dataset.field;
    updateActiveStyles();
  });

  calcBtn.addEventListener('click', doCalculate);
  saveBtn.addEventListener('click', saveCurrentCalc);

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

  clearHistoryBtn.addEventListener('click', clearHistory);

  closeHistoryBtn.addEventListener('click', closeHistory);
  historyModal.addEventListener('click', function (e) {
    if (e.target === historyModal) closeHistory();
  });

  settingsBtn.addEventListener('click', openSettings);
  closeSettingsBtn.addEventListener('click', closeSettings);
  settingsModal.addEventListener('click', function (e) {
    if (e.target === settingsModal) closeSettings();
  });

  settingsHistory.addEventListener('click', function () {
    closeSettings();
    openHistory();
  });

  settingsSkin.addEventListener('click', function () {
    wallpaperInput.value = '';
    wallpaperInput.click();
  });

  settingsSkinClear.addEventListener('click', function (e) {
    e.stopPropagation();
    removeWallpaper();
  });

  wallpaperInput.addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) handleWallpaperFile(file);
  });

  settingsTheme.addEventListener('click', function () {
    themeMode = THEME_NEXT[themeMode];
    if (!writeRaw(KEYS.theme, themeMode)) showHint('⚠ 无法保存主题设置', 'warn');
    applyTheme();
    renderSettings();
  });

  settingsClearAll.addEventListener('click', function () {
    clearAllInputs();
    closeSettings();
    showHint('已清空当前输入', 'ok');
  });

  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd);
  document.addEventListener('touchcancel', onTouchEnd);
  window.addEventListener('wheel', onWheel, { passive: false });

  if (motionQuery) {
    if (motionQuery.addEventListener) motionQuery.addEventListener('change', updateBounceState);
    else if (motionQuery.addListener) motionQuery.addListener(updateBounceState);
  }

  historyList.addEventListener('click', function (e) {
    const btn = e.target.closest('.history-item');
    if (!btn) return;
    const item = records[Number(btn.dataset.idx)];
    if (!item) return;
    loadRecord(item);
    closeHistory();
  });

  document.addEventListener('keydown', function (e) {
    const openModalEl = document.querySelector('.modal.open');
    if (e.key === 'Escape' && openModalEl) {
      closeModal(openModalEl);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (openModalEl) return;

    if (e.key >= '0' && e.key <= '9') { handleKeyPress(e.key); return; }
    if (e.key === '.') { handleKeyPress('.'); return; }
    if (e.key === 'Backspace') { e.preventDefault(); handleKeyPress('backspace'); return; }
    if (e.key === 'Delete' || e.key === 'Escape') { handleKeyPress('clear'); return; }
    if (e.key === 'Enter') { doCalculate(); }
  });

  window.addEventListener('resize', function () {
    updateSegSliders();
    updateBounceState();
  });
  window.addEventListener('orientationchange', updateBounceState);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      updateSegSliders();
      updateBounceState();
    }).catch(function () {});
  }

  // ---- 初始化 ----
  themeMode = readTheme();
  applyTheme();
  wallpaper = loadWallpaper();
  applyWallpaper(wallpaper);
  records = loadRecords();
  renderHistory();
  updateUnitButtons();
  updateActiveStyles();
  updateDerivedStyle();
  updateMStatus();
  updateBounceState();

  // ---- Service Worker（file:// 下跳过） ----
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
