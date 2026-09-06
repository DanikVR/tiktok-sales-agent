/*!
 * Commerce Agents — загрузчик виджета-консультанта на сайт клиента. Вставка одной строкой:
 *   <script async src="https://ВАШ-ДОМЕН/comag.js" data-shop="СЛАГ"></script>
 *
 * Что делает: рисует кнопку-пузырь (или открывает панель по data-open="1"), панель — изолированный
 * iframe /embed/commerce/:slug (стили сайта не ломают виджет). Собирает контекст страницы (URL,
 * заголовок, JSON-LD товара) и передаёт его виджету. Ведёт first-party идентификатор посетителя
 * (localStorage comag_vid, 30 дней) — по нему покупки со страницы «спасибо» привязываются к диалогу.
 *
 * Мост в сторону сайта (postMessage от iframe):
 *   addToCart {url, platformId?}  — Shopify: POST /cart/add.js; WooCommerce: ?add-to-cart=; иначе переход на товар.
 *   open {url}                    — открыть товар/чекаут в новой вкладке.
 *   expand/collapse               — на телефоне панель на весь экран.
 *
 * Пиксель покупки (страница «спасибо»):
 *   comag('purchase', { orderId, total, currency, items: [{ id, qty, price }] })
 *
 * Опции на теге: data-position="bottom-right|bottom-left", data-accent="#RRGGBB", data-lang="ru", data-open="1".
 */
(function () {
  var script = document.currentScript;
  if (!script) { var all = document.getElementsByTagName('script'); for (var i = all.length - 1; i >= 0; i--) { if (all[i].src && all[i].src.indexOf('comag.js') !== -1) { script = all[i]; break; } } }
  if (!script) return;
  var slug = script.getAttribute('data-shop') || script.getAttribute('data-widget');
  if (!slug) { console.warn('[comag] data-shop не задан'); return; }
  var origin; try { origin = new URL(script.src).origin; } catch (e) { origin = ''; }
  var position = (script.getAttribute('data-position') || 'bottom-right').toLowerCase() === 'bottom-left' ? 'bottom-left' : 'bottom-right';
  var accentAttr = script.getAttribute('data-accent') || '';
  var forcedLang = (script.getAttribute('data-lang') || '').trim();
  var Z = 2147483000;

  // ── идентификатор посетителя (first-party) ──
  function rnd() { var s = ''; var a = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (var i = 0; i < 24; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
  function vid() {
    try {
      var v = localStorage.getItem('comag_vid');
      if (!v) { v = 'v' + rnd(); localStorage.setItem('comag_vid', v); }
      document.cookie = 'comag_vid=' + v + '; path=/; max-age=' + (30 * 86400) + '; SameSite=Lax';
      return v;
    } catch (e) { return 'v' + rnd(); }
  }
  var visitorId = vid();
  var conversationId = null;
  try { conversationId = sessionStorage.getItem('comag_conv_' + slug) || null; } catch (e) {}

  // ── контекст страницы: товар по JSON-LD/OG ──
  function pageContext() {
    var ctx = { url: location.href, title: document.title, productTitle: null, productSku: null, productUrl: null, price: null };
    try {
      var scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < scripts.length; i++) {
        var data = JSON.parse(scripts[i].textContent || 'null');
        var stack = Array.isArray(data) ? data.slice() : [data];
        while (stack.length) {
          var n = stack.shift(); if (!n || typeof n !== 'object') continue;
          if (Array.isArray(n['@graph'])) stack = stack.concat(n['@graph']);
          var t = n['@type']; var types = Array.isArray(t) ? t : [t];
          if (types.indexOf('Product') !== -1 && n.name) {
            ctx.productTitle = String(n.name).slice(0, 200); ctx.productSku = n.sku ? String(n.sku) : null; ctx.productUrl = (n.offers && n.offers.url) || location.href;
            var o = Array.isArray(n.offers) ? n.offers[0] : n.offers; if (o && o.price) ctx.price = o.price;
            return ctx;
          }
        }
      }
      var ogType = document.querySelector('meta[property="og:type"]'); var ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogType && /product/i.test(ogType.getAttribute('content') || '') && ogTitle) { ctx.productTitle = ogTitle.getAttribute('content'); ctx.productUrl = location.href; }
    } catch (e) {}
    return ctx;
  }

  // ── адаптеры корзины сайта ──
  function addToCart(msg) {
    var url = msg.url || '';
    var m;
    if (url && (m = /[?&]variant=(\d+)/.exec(url))) {
      // Shopify: variant id из ссылки товара → AJAX-корзина магазина (same-origin).
      var fd = new FormData(); fd.append('id', m[1]); fd.append('quantity', String(msg.quantity || 1));
      fetch('/cart/add.js', { method: 'POST', body: fd, credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('shopify'); notify('added'); })
        .catch(function () { openUrl(url); });
      return;
    }
    if (url && (m = /[?&](?:add-to-cart|product_id)=(\d+)/.exec(url))) { openUrl(url); return; } // WooCommerce ссылка добавления
    if (msg.platformId && /^\d+$/.test(String(msg.platformId)) && /woocommerce|wp-content/i.test(document.documentElement.innerHTML.slice(0, 20000))) {
      openUrl(location.origin + '/?add-to-cart=' + msg.platformId + '&quantity=' + (msg.quantity || 1)); return;
    }
    if (url) openUrl(url);
  }
  function openUrl(url) { try { if (url.indexOf(location.origin) === 0) location.href = url; else window.open(url, '_blank', 'noopener'); } catch (e) {} }
  function notify(kind) { try { iframe.contentWindow.postMessage({ type: 'comag', action: 'host', kind: kind }, '*'); } catch (e) {} }

  // ── UI ──
  var corner = position === 'bottom-left' ? 'left:16px;' : 'right:16px;';
  var panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;bottom:16px;' + corner + 'z-index:' + Z + ';display:none;width:min(420px,calc(100vw - 32px));height:min(680px,calc(100vh - 32px));height:min(680px,calc(100dvh - 32px));border-radius:22px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.28);background:#fff;transition:opacity .18s ease,transform .18s ease;opacity:0;transform:translateY(12px) scale(.98);';
  var iframe = document.createElement('iframe');
  var lang = forcedLang || (document.documentElement.getAttribute('lang') || navigator.language || '').split('-')[0].toLowerCase();
  iframe.src = origin + '/embed/commerce/' + encodeURIComponent(slug) + '?lang=' + encodeURIComponent(lang) + '&vid=' + encodeURIComponent(visitorId) + (conversationId ? '&conv=' + encodeURIComponent(conversationId) : '');
  iframe.title = 'Shop assistant';
  iframe.allow = 'microphone; clipboard-write';
  iframe.setAttribute('frameborder', '0');
  iframe.style.cssText = 'border:0;width:100%;height:100%;display:block;background:transparent;';
  panel.appendChild(iframe);
  document.body.appendChild(panel);

  var launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Открыть ассистента магазина');
  launcher.style.cssText = 'position:fixed;bottom:18px;' + corner + 'z-index:' + Z + ';width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;box-shadow:0 12px 32px rgba(0,0,0,.28);background:' + (accentAttr || '#111827') + ';transition:transform .15s ease;';
  launcher.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16l-1.5 9.5a2 2 0 0 1-2 1.5H7.5a2 2 0 0 1-2-1.5L4 6z"/><path d="M8 6a4 4 0 0 1 8 0"/><path d="M9.5 12.5c.8 1 1.6 1.5 2.5 1.5s1.7-.5 2.5-1.5"/></svg>';
  launcher.onmouseenter = function () { launcher.style.transform = 'scale(1.06)'; };
  launcher.onmouseleave = function () { launcher.style.transform = 'none'; };
  document.body.appendChild(launcher);

  var isOpen = false, mobileFull = false;
  function open() {
    isOpen = true; panel.style.display = 'block'; launcher.style.display = 'none';
    requestAnimationFrame(function () { panel.style.opacity = '1'; panel.style.transform = 'none'; });
    if (window.innerWidth < 640) expand();
    try { iframe.contentWindow.postMessage({ type: 'comag', action: 'context', page: pageContext(), visitorId: visitorId }, '*'); } catch (e) {}
    try { fetch(origin + '/api/commerce/w/' + encodeURIComponent(slug) + '/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'widget_open', conversationId: conversationId }) }); } catch (e) {}
  }
  function close() { isOpen = false; panel.style.opacity = '0'; panel.style.transform = 'translateY(12px) scale(.98)'; setTimeout(function () { if (!isOpen) { panel.style.display = 'none'; launcher.style.display = 'flex'; collapse(); } }, 180); }
  function expand() { mobileFull = true; panel.style.cssText += 'inset:0;width:100%;height:100%;border-radius:0;'; }
  function collapse() { if (!mobileFull) return; mobileFull = false; panel.style.cssText = panel.style.cssText.replace(/inset:0;width:100%;height:100%;border-radius:0;/g, ''); panel.style.width = 'min(420px,calc(100vw - 32px))'; panel.style.height = 'min(680px,calc(100dvh - 32px))'; panel.style.borderRadius = '22px'; }

  launcher.addEventListener('click', open);
  window.addEventListener('message', function (e) {
    if (origin && e.origin !== origin) return;
    var d = e.data || {}; if (!d || d.type !== 'comag') return;
    if (d.action === 'close') close();
    else if (d.action === 'conversation' && d.conversationId) { conversationId = d.conversationId; try { sessionStorage.setItem('comag_conv_' + slug, conversationId); } catch (e2) {} }
    else if (d.action === 'addToCart') addToCart(d);
    else if (d.action === 'open' && d.url) openUrl(d.url);
    else if (d.action === 'ready') { try { iframe.contentWindow.postMessage({ type: 'comag', action: 'context', page: pageContext(), visitorId: visitorId }, '*'); } catch (e3) {} }
  });

  // ── публичный API страницы ──
  window.comag = function (cmd, payload) {
    if (cmd === 'open') open();
    else if (cmd === 'close') close();
    else if (cmd === 'purchase') {
      var p = payload || {};
      try {
        fetch(origin + '/api/commerce/w/' + encodeURIComponent(slug) + '/purchase', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
          body: JSON.stringify({ visitorId: visitorId, conversationId: conversationId, orderId: p.orderId, total: p.total, currency: p.currency, items: p.items || [] }) });
      } catch (e) {}
    }
  };
  if (script.getAttribute('data-open') === '1') setTimeout(open, 600);
})();
