/* KTL guide page: icons, copy buttons and the device gallery's screen
   switcher. Plain script — this page is static, with no build step. */
(function () {
  'use strict';

  var ICONS = {
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1z"/>',
    signal: '<path d="M2 20h3v-5H2zM8 20h3V9H8zM14 20h3V4h-3zM20 20h2V11h-2z"/>',
    users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20c0-3.6 2.9-5.6 6.5-5.6s6.5 2 6.5 5.6"/><path d="M16.5 5.2a3.4 3.4 0 0 1 0 6.6M18 14.9c2.2.6 3.5 2.4 3.5 5.1"/>',
    bell: '<path d="M18 9a6 6 0 1 0-12 0c0 4.5-1.5 6-1.5 6h15S18 13.5 18 9z"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>',
    pencil: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/>',
    send: '<path d="M21 3 10.5 13.5M21 3l-6.8 18-3.7-7.5L3 9.8z"/>',
    check: '<path d="m4.5 12.5 5 5 10-11"/>'
  };

  document.querySelectorAll('[data-icon]').forEach(function (el) {
    var d = ICONS[el.getAttribute('data-icon')];
    if (!d) return;
    var s = el.getAttribute('data-icon-size') || 18;
    el.innerHTML = '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  });

  document.querySelectorAll('.code-copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var pre = btn.parentElement.querySelector('.code');
      var text = pre ? pre.textContent : '';
      try { if (navigator.clipboard) navigator.clipboard.writeText(text); } catch (e) { /* not allowed */ }
      if (btn.dataset.busy) return;
      btn.dataset.busy = '1';
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = 'Copy'; delete btn.dataset.busy; }, 1400);
    });
  });

  /* Device gallery: each frame shows a screenshot; the toggle swaps them. */
  var toggle = document.querySelector('[data-screen-toggle]');
  if (toggle) {
    toggle.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-screen]');
      if (!btn) return;
      var id = btn.getAttribute('data-screen');
      toggle.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-selected', String(b === btn)); });
      document.querySelectorAll('[data-shot]').forEach(function (img) {
        img.src = 'screens/' + img.getAttribute('data-shot') + '-' + id + '.png';
      });
    });
  }
})();
