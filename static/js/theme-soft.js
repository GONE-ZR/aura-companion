/* ══════════════════════════════════════════════════════════════════════
   柔和流动主题 · 接入脚本
   ----------------------------------------------------------------------
   职责（很小，故意不做多）：
     ① 读 localStorage，把 body 的 data-soft / data-palette 摆好
     ② 提供全局 API：AuraSoft.enable() / .disable() / .setPalette('violet')
   ----------------------------------------------------------------------
   ★ 与 settings.js 的关系：
     --acc-h/s/l 由 settings.js 写在 **html 元素 inline style** 上。
     本脚本写预设配色时也写 html 的 inline style（同一位置、同一机制），
     所以「设置面板的主题色滑块」和「预设配色」不会互相打架。
   ══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var KEY_ON  = 'aura_soft';
  var KEY_PAL = 'aura_palette';

  /* 三套预设：紫 / 薄荷 / 暖橙 */
  var PALETTES = {
    violet: { h: 270, s: 74, l: 62, label: '紫' },
    mint:   { h: 166, s: 64, l: 48, label: '薄荷' },
    amber:  { h: 32,  s: 90, l: 58, label: '暖橙' }
  };

  function read(key, fallback) {
    try {
      var v = global.localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function write(key, val) {
    try { global.localStorage.setItem(key, val); } catch (e) {}
  }

  function apply() {
    var body = document.body;
    if (!body) return;

    var on = read(KEY_ON, '1') === '1';
    if (on) body.setAttribute('data-soft', '1');
    else body.removeAttribute('data-soft');

    var p = read(KEY_PAL, 'violet');
    if (!PALETTES[p]) p = 'violet';
    body.setAttribute('data-palette', p);
  }

  /* 预设配色：写 html 的 inline style，和 settings.js 同一位置 */
  function setPalette(name) {
    var p = PALETTES[name];
    if (!p) return false;
    var r = document.documentElement.style;
    r.setProperty('--acc-h', p.h);
    r.setProperty('--acc-s', p.s);
    r.setProperty('--acc-l', p.l);
    write(KEY_PAL, name);
    document.body.setAttribute('data-palette', name);
    return true;
  }

  function enable()  { write(KEY_ON, '1');  apply(); }
  function disable() { write(KEY_ON, '0');  apply(); }
  function toggle()  { write(KEY_ON, read(KEY_ON, '1') === '1' ? '0' : '1'); apply(); }

  global.AuraSoft = {
    enable: enable,
    disable: disable,
    toggle: toggle,
    setPalette: setPalette,
    palettes: PALETTES,
    apply: apply
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})(window);
