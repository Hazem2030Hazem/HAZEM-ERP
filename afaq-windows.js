/* ═══════════════════════════════════════════════════════════════
   HAZEM.ERP — دفعة AFAQ Desktop (v25)
   مدير نوافذ كلاسيكي (سحب/إغلاق/تصغير/تكبير + z-index) + شريط قوائم
   كلاسيكي كامل + ساعة أنالوج حية + نافذتا «فاتورة مبيعات» و«كشف حساب».
   • لا يكسر أي معرّفات app.js — يغلّف switchTab فقط لتظهر الشاشات
     داخل نوافذ منبثقة بدل التنقل بالصفحات.
   • كل بنود القوائم تمر عبر qbMenuDispatch الموجود في app.js؛ البنود
     التي لا وظيفة لها بعد تفتح نافذة «قيد التطوير» وتُسجَّل stub.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const T = (k) => (typeof window.t === 'function' ? window.t(k) : k);
  const escH = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── سجلّ البنود المؤجلة (stubs) — يظهر في التقرير ووحدة التحكم ── */
  const stubs = new Set();
  window.__afaqStubs = stubs;

  /* ═══════════ 1) مدير النوافذ ═══════════ */
  let zTop = 100;
  const openWins = new Set();

  function focusWin(w) {
    openWins.forEach(x => x.classList.remove('active'));
    w.classList.add('active');
    w.style.zIndex = ++zTop;
  }

  function afaqOpenWindow(opts) {
    const desk = $('#afaq-desk');
    const w = document.createElement('div');
    w.className = 'afx-win';
    const n = openWins.size;
    const wid = 1100, hei = 640;
    w.style.width = Math.min(opts.w || wid, desk.clientWidth - 20) + 'px';
    w.style.height = Math.min(opts.h || hei, desk.clientHeight - 16) + 'px';
    w.style.left = Math.max(4, (desk.clientWidth - (opts.w || wid)) / 2 + (n % 5) * 26) + 'px';
    w.style.top = Math.max(4, 12 + (n % 5) * 24) + 'px';

    const title = document.createElement('div');
    title.className = 'afx-win-title';
    title.innerHTML = `<span class="afx-wt-txt">${escH(opts.title)}</span>
      <span class="afx-win-btns">
        <button class="afx-b-min" title="_">_</button>
        <button class="afx-b-max" title="▢">▢</button>
        <button class="afx-b-close" title="✕">✕</button>
      </span>`;
    const body = document.createElement('div');
    body.className = 'afx-win-body';
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);
    w.appendChild(title); w.appendChild(body);
    desk.appendChild(w);
    openWins.add(w);
    focusWin(w);

    const close = () => {
      openWins.delete(w);
      if (opts.onClose) { try { opts.onClose(); } catch (e) { console.error(e); } }
      w.remove();
    };
    w.querySelector('.afx-b-close').onclick = (e) => { e.stopPropagation(); close(); };
    w.querySelector('.afx-b-min').onclick = (e) => { e.stopPropagation(); w.classList.toggle('min'); w.style.height = 'auto'; };
    let maximized = false; const prev = {};
    w.querySelector('.afx-b-max').onclick = (e) => {
      e.stopPropagation();
      if (!maximized) {
        prev.left = w.style.left; prev.top = w.style.top; prev.width = w.style.width; prev.height = w.style.height;
        w.style.left = '2px'; w.style.top = '2px';
        w.style.width = (desk.clientWidth - 6) + 'px'; w.style.height = (desk.clientHeight - 6) + 'px';
      } else { Object.assign(w.style, prev); }
      maximized = !maximized;
    };
    w.addEventListener('mousedown', () => focusWin(w), true);

    // سحب من شريط العنوان
    title.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const r = w.getBoundingClientRect(), d = desk.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      const mv = (ev) => {
        let L = ev.clientX - d.left - ox, Tp = ev.clientY - d.top - oy;
        L = Math.max(-r.width + 60, Math.min(L, d.width - 60));
        Tp = Math.max(0, Math.min(Tp, d.height - 30));
        w.style.left = L + 'px'; w.style.top = Tp + 'px';
      };
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
      e.preventDefault();
    });
    w.close = close;
    return w;
  }
  window.afaqOpenWindow = afaqOpenWindow;

  function afaqStub(label) {
    stubs.add(label);
    afaqOpenWindow({
      title: label, w: 420, h: 240,
      body: `<div class="afx-stub"><div class="ic">🚧</div>
        <h3>${escH(T('afx_stub_title'))}</h3>
        <p>${escH(label)}</p><p style="color:#777;font-size:12px">${escH(T('afx_stub_body'))}</p>
        <button class="afx-btn" onclick="this.closest('.afx-win').close()">${escH(T('afx_btn_exit'))}</button></div>`,
    });
  }
  window.afaqStub = afaqStub;

  /* ═══════════ 2) تغليف switchTab: الشاشات تفتح داخل نوافذ ═══════════ */
  const tabWins = new Map(); // tab → win
  const park = () => $('#afaq-park');

  function openTabWindow(tab, sec) {
    let w = tabWins.get(tab);
    if (w && document.body.contains(w)) { focusWin(w); return w; }
    const TT = (typeof TAB_TITLES !== 'undefined') ? TAB_TITLES : {};
    const title = TT[tab] || ($('#window-title') || {}).textContent || tab;
    w = afaqOpenWindow({
      title, body: sec, w: 1120, h: 660,
      onClose: () => {
        tabWins.delete(tab);
        sec.classList.add('hidden');
        park().appendChild(sec);
      },
    });
    tabWins.set(tab, w);
    return w;
  }

  if (typeof window.switchTab === 'function') {
    const _origSwitchTab = window.switchTab;
    window.switchTab = function (tab) {
      _origSwitchTab(tab);
      // الشاشات داخل النوافذ تبقى ظاهرة حتى لو أخفاها التبديل العام
      $$('.afx-win-body > section.tab').forEach(s => s.classList.remove('hidden'));
      const sec = document.getElementById('tab-' + tab);
      if (sec) openTabWindow(tab, sec);
    };
  }

  // نقل كل الشاشات إلى موقف الانتظار عند الإقلاع
  $$('.main > section.tab').forEach(s => park().appendChild(s));

  /* ═══════════ 3) شجرة القوائم (مطابقة للصور المرجعية) ═══════════ */
  // item: {k مفتاح i18n، sc اختصار، red، ds dataset لـ qbMenuDispatch، afaq نافذة خاصة، sub بنود فرعية، stub}
  const M = (k, extra) => Object.assign({ k }, extra || {});
  const SEP = { sep: true };

  const MENUS = [
    { k: 'afx_m_system', red: true, items: [
      M('afx_sys_companies', { sc: 'Alt+O', ds: { action: 'sysinfo' } }),
      M('afx_sys_branches', { sc: 'Alt+B', ds: { tab: 'branches' } }),
      M('afx_sys_years', { sc: 'Alt+F', ds: { tab: 'settings' } }),
      M('afx_sys_periods', { ds: { tab: 'settings' } }),
      M('afx_sys_currencies', { sc: 'Alt+R', ds: { tab: 'settings' } }),
      M('afx_sys_countries', { stub: 1 }), M('afx_sys_cities', { stub: 1 }),
      M('afx_sys_regions', { stub: 1 }), M('afx_sys_nats', { stub: 1 }),
      SEP,
      M('afx_sys_doctypes', { stub: 1 }), M('afx_sys_docclass', { stub: 1 }),
      M('afx_sys_supgrps', { stub: 1 }), M('afx_sys_suppliers', { ds: { tab: 'parties' } }),
      M('afx_sys_custgrps', { stub: 1 }), M('afx_sys_customers', { ds: { tab: 'parties' } }),
      M('afx_sys_sponsors', { stub: 1 }), M('afx_sys_emps', { ds: { tab: 'employees' } }),
      M('afx_sys_empbranch', { stub: 1 }),
      SEP,
      M('afx_sys_sms', { stub: 1 }),
      M('afx_sys_activeyear', { sc: 'Alt+Y', red: true, stub: 1 }),
      M('afx_sys_users', { sc: 'Alt+U', ds: { tab: 'users' } }),
      M('afx_sys_alertcfg', { stub: 1 }), M('afx_sys_alerts', { stub: 1 }),
      M('afx_sys_device', { ds: { action: 'pos-settings' } }),
      { k: 'afx_sys_db', red: true, sub: [
        M('afx_sys_backup', { ds: { action: 'export-excel' } }),
        M('afx_sys_restore', { red: true, stub: 1 }),
        M('afx_sys_dbcfg', { stub: 1 }),
      ]},
      M('afx_sys_logout', { sc: 'Alt+L', ds: { action: 'logout' } }),
      M('afx_sys_exit', { sc: 'Alt+F4', ds: { action: 'logout' } }),
    ]},
    { k: 'afx_m_settings', items: [
      { k: 'afx_set_books', sub: [
        M('afx_set_coa', { red: true, ds: { tab: 'accounts' } }),
        M('afx_set_cost', { red: true, ds: { tab: 'expenses', sub: 'ccs' } }),
        M('afx_set_openbal', { ds: { action: 'opening-entry' } }),
        M('afx_set_finstmt', { ds: { report: 'balance' } }),
        M('afx_set_journals', { ds: { tab: 'journal' } }),
      ]},
      M('afx_set_general', { red: true, ds: { tab: 'settings' } }),
      M('mi_tax_settings', { ds: { action: 'tax-settings' } }),
    ]},
    { k: 'afx_m_gl', items: [
      M('afx_gl_entry', { sc: 'Alt+J', red: true, ds: { tab: 'journal' } }),
      M('afx_gl_post', { ds: { tab: 'journal' } }),
    ]},
    { k: 'afx_m_cash', items: [
      { k: 'afx_cash_cash', sub: [
        M('afx_gr_rcash', { ds: { action: 'voucher-receipt' } }),
        M('afx_gr_pcash', { ds: { action: 'voucher-payment' } }),
      ]},
      { k: 'afx_cash_banks', sub: [
        M('afx_gr_rbank', { ds: { action: 'voucher-receipt' } }),
        M('afx_gr_pbank', { ds: { action: 'voucher-payment' } }),
      ]},
      SEP,
      M('afx_cash_receipt', { ds: { action: 'voucher-receipt' } }),
      M('afx_cash_payment', { ds: { action: 'voucher-payment' } }),
      M('afx_cash_transfers', { ds: { action: 'voucher-transfer' } }),
      M('afx_cash_receive_tr', { ds: { action: 'voucher-transfer' } }),
    ]},
    { k: 'afx_m_inv', items: [
      M('afx_iv_wh', { ds: { action: 'warehouses' } }),
      M('afx_iv_items', { red: true, ds: { tab: 'items' } }),
      { k: 'afx_iv_more', sub: [
        M('afx_iv_units', { stub: 1 }), M('afx_iv_groups', { stub: 1 }),
        M('afx_iv_comp', { ds: { tab: 'manufacturing' } }), M('afx_iv_specs', { stub: 1 }),
        M('afx_iv_levels', { stub: 1 }), M('afx_iv_itemcos', { stub: 1 }),
        M('afx_iv_max', { stub: 1 }), M('afx_iv_more2', { stub: 1 }),
      ]},
      SEP,
      M('afx_iv_openbal', { red: true, stub: 1 }),
      M('afx_iv_assemble', { ds: { tab: 'manufacturing' } }),
      M('afx_iv_disassemble', { stub: 1 }), M('afx_iv_pack', { stub: 1 }),
      M('afx_iv_rcv', { red: true, stub: 1 }), M('afx_iv_issue', { red: true, stub: 1 }),
      M('afx_iv_transfer', { ds: { action: 'stock-transfer' } }),
      M('afx_iv_transfer_rcv', { stub: 1 }), M('afx_iv_receive', { stub: 1 }),
      M('afx_iv_destroy', { stub: 1 }),
      M('afx_iv_count_rec', { ds: { action: 'stock-count' } }),
      M('afx_iv_count', { red: true, ds: { action: 'stock-count' } }),
      M('afx_iv_hold', { stub: 1 }), M('afx_iv_unhold', { stub: 1 }),
      M('afx_iv_bal', { ds: { report: 'stock' } }), M('afx_iv_cost', { stub: 1 }),
      M('afx_iv_serial', { sc: 'Ctrl+F7', stub: 1 }),
      M('afx_iv_barcode', { ds: { tab: 'barcode' } }),
      M('afx_iv_prices', { red: true, ds: { tab: 'items' } }),
      M('afx_iv_post', { stub: 1 }),
    ]},
    { k: 'afx_m_purch', items: [
      M('afx_pu_orders', { ds: { action: 'purchase-order' } }),
      M('afx_pu_deals', { ds: { tab: 'purchases' } }),
      SEP,
      M('afx_pu_inv', { red: true, ds: { action: 'purchase-invoice' } }),
      M('afx_pu_ret', { ds: { action: 'purchase-return' } }),
      M('afx_pu_notes', { ds: { action: 'credit-note' } }),
      M('afx_pu_review', { sc: 'Ctrl+Alt+U', ds: { tab: 'purchases' } }),
    ]},
    { k: 'afx_m_sales', items: [
      M('afx_sa_compol', { stub: 1 }), M('afx_sa_comm', { stub: 1 }),
      SEP,
      M('afx_sa_quotes', { ds: { action: 'quote' } }),
      M('afx_sa_orders', { ds: { tab: 'quotes' } }),
      M('afx_sa_inv', { red: true, afaq: 'sinv' }),
      M('afx_sa_ret', { ds: { action: 'sales-return' } }),
      M('afx_sa_notes', { ds: { action: 'credit-note' } }),
      M('afx_sa_review', { sc: 'Ctrl+Alt+S', ds: { tab: 'invoices' } }),
      M('afx_sa_prices', { ds: { tab: 'items' } }),
      M('afx_sa_offers', { stub: 1 }),
    ]},
    { k: 'afx_m_pos', red: true, items: [
      M('afx_pos_ops', { ds: { tab: 'users' } }),
      M('afx_pos_screen', { ds: { tab: 'pos' } }),
      SEP,
      M('afx_pos_open', { sc: 'Alt+P', red: true, ds: { tab: 'pos' } }),
      M('afx_pos_close', { ds: { tab: 'shifts' } }),
      M('afx_pos_shifts', { ds: { tab: 'shifts' } }),
      M('afx_pos_cfg', { ds: { action: 'pos-settings' } }),
      SEP,
      { k: 'afx_pos_reps', sub: [
        M('afx_pos_rinv', { ds: { tab: 'posrep' } }),
        M('afx_pos_rprofit', { ds: { tab: 'poshourly' } }),
        M('afx_pos_rtrack', { red: true, stub: 1 }),
      ]},
    ]},
    { k: 'afx_m_glrep', red: true, items: [
      M('afx_gr_stmt', { red: true, afaq: 'stmt' }),
      M('afx_gr_daily', { ds: { tab: 'journal' } }),
      SEP,
      M('afx_gr_stmt_cur', { ds: { report: 'stmt' } }),
      M('afx_gr_trial', { red: true, ds: { report: 'trial' } }),
      M('afx_gr_income', { red: true, ds: { report: 'income' } }),
      M('afx_gr_balance', { ds: { report: 'balance' } }),
      M('afx_gr_balances', { ds: { report: 'trial' } }),
      SEP,
      M('afx_gr_journal', { ds: { tab: 'journal' } }),
      M('afx_gr_rcash', { ds: { tab: 'vouchers' } }), M('afx_gr_pcash', { ds: { tab: 'vouchers' } }),
      M('afx_gr_rbank', { ds: { tab: 'vouchers' } }), M('afx_gr_pbank', { ds: { tab: 'vouchers' } }),
      M('afx_gr_receipts', { ds: { tab: 'vouchers' } }), M('afx_gr_transfers_v', { ds: { tab: 'vouchers' } }),
      M('afx_gr_transfers', { ds: { tab: 'vouchers' } }),
      SEP,
      M('afx_gr_cc_tx', { ds: { tab: 'expenses', sub: 'ccs' } }),
      M('afx_gr_cc_levels', { stub: 1 }), M('afx_gr_cc_acc', { stub: 1 }), M('afx_gr_acc_cc', { stub: 1 }),
    ]},
    { k: 'afx_m_reports', red: true, items: [
      { k: 'afx_rp_items', sub: [
        M('afx_rp_items_bal', { ds: { report: 'stock' } }), M('afx_rp_items_card', { ds: { report: 'stock' } }),
        M('afx_rp_items_val', { ds: { report: 'stock' } }), M('afx_rp_items_moves', { ds: { report: 'stock' } }),
      ]},
      { k: 'afx_rp_purch', sub: [
        M('mi_purch_rep', { ds: { report: 'purch' } }), M('afx_rp_purch_rep', { ds: { report: 'ps' } }),
        M('afx_rp_po_open', { ds: { report: 'poopen' } }),
      ]},
      { k: 'afx_rp_sales', sub: [
        M('afx_rp_sales_rep', { ds: { report: 'sales' } }), M('afx_rp_pos_pay', { ds: { tab: 'posrep' } }),
        M('afx_rp_pos_hour', { ds: { tab: 'poshourly' } }),
      ]},
      { k: 'afx_rp_suppliers', sub: [ M('afx_rp_purch_rep', { ds: { report: 'ps' } }) ]},
      { k: 'afx_rp_customers', sub: [
        M('afx_rp_aging', { ds: { report: 'aging' } }), M('mi_stmt', { ds: { report: 'stmt' } }),
      ]},
      { k: 'afx_rp_reps', sub: [ M('afx_sa_comm', { stub: 1 }) ]},
      { k: 'afx_rp_tax', sub: [
        M('afx_rp_vat', { ds: { report: 'vat' } }), M('afx_rp_vatledger', { ds: { report: 'vatledger' } }),
      ]},
      { k: 'afx_rp_admin', sub: [
        M('afx_rp_cashflow', { ds: { report: 'cashflow' } }), M('afx_rp_margin', { ds: { report: 'margin' } }),
      ]},
      { k: 'afx_rp_users', red: true, sub: [ M('afx_rp_users', { stub: 1 }) ]},
    ]},
    { k: 'afx_m_integrated', red: true, items: [
      M('afx_ig_einv', { red: true, ds: { tab: 'einvoices' } }),
      M('afx_ig_debit', { ds: { action: 'credit-note' } }),
      M('afx_ig_credit', { ds: { action: 'credit-note' } }),
    ]},
    { k: 'afx_m_help', items: [
      M('afx_hlp_guide', { stub: 1 }),
      M('mi_about', { ds: { action: 'about' } }),
    ]},
  ];

  /* ═══════════ 4) بناء شريط القوائم والقوائم المنسدلة ═══════════ */
  function dispatchItem(it, label) {
    if (it.afaq === 'sinv') return openAfaqSalesInvoice();
    if (it.afaq === 'stmt') return openAfaqStatement();
    if (it.stub || (!it.ds && !it.sub)) return afaqStub(label);
    if (it.ds) return window.qbMenuDispatch(it.ds);
  }

  function buildDrop(items, onPick) {
    const drop = document.createElement('div');
    drop.className = 'afx-drop';
    items.forEach(it => {
      if (it.sep) { const s = document.createElement('div'); s.className = 'afx-sep'; drop.appendChild(s); return; }
      const label = T(it.k);
      const d = document.createElement('div');
      d.className = 'afx-di' + (it.red ? ' red' : '') + (it.sub ? ' has-sub' : '');
      d.innerHTML = `<span class="txt">${escH(label)}</span>` +
        (it.sub ? '<span class="sub-arrow">◂</span>' : '') +
        (it.sc ? `<span class="sc">${escH(it.sc)}</span>` : '');
      if (it.sub) {
        d.appendChild(buildDrop(it.sub, onPick)).classList.add('afx-sub');
        // v26: القائمة الفرعية تفتح لفوق لو لا يوجد مكان كافٍ تحت
        d.addEventListener('mouseenter', () => {
          const sub = d.querySelector('.afx-sub');
          const need = Math.min(sub.scrollHeight, window.innerHeight - 96);
          const roomBelow = window.innerHeight - d.getBoundingClientRect().top - 10;
          d.classList.toggle('flip', roomBelow < need);
        });
      }
      else d.addEventListener('click', (e) => { e.stopPropagation(); onPick(); dispatchItem(it, label); });
      drop.appendChild(d);
    });
    return drop;
  }

  let openMenuBtn = null;
  function closeDrops() {
    $$('#afaq-menubar .afx-drop').forEach(d => d.remove());
    $$('#afaq-menubar .afx-mi.open').forEach(b => b.classList.remove('open'));
    openMenuBtn = null;
  }

  function buildMenubar() {
    const bar = $('#afaq-menubar');
    if (!bar) return;
    bar.innerHTML = '';
    const closeAnd = () => closeDrops();
    MENUS.forEach(m => {
      const b = document.createElement('button');
      b.className = 'afx-mi' + (m.red ? ' red' : '');
      b.textContent = T(m.k);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (openMenuBtn === b) return closeDrops();
        closeDrops();
        const drop = buildDrop(m.items, closeAnd);
        drop.style.insetInlineStart = '0';
        drop.style.top = '100%';
        b.style.position = 'relative';
        b.appendChild(drop);
        // v26: ارتفاع القائمة لا يتجاوز أسفل الشاشة أبداً — كل البنود reachable بالسكرول
        drop.style.maxHeight = Math.max(180, window.innerHeight - drop.getBoundingClientRect().top - 8) + 'px';
        b.classList.add('open');
        openMenuBtn = b;
      });
      bar.appendChild(b);
    });
    const sp = document.createElement('span'); sp.className = 'afx-spacer'; bar.appendChild(sp);
    const lang = document.createElement('button');
    lang.className = 'afx-lang'; lang.textContent = T('afx_lang');
    lang.onclick = () => window.setLang && window.setLang(window.currentLang() === 'ar' ? 'en' : 'ar');
    bar.appendChild(lang);
    const srch = document.createElement('input');
    srch.className = 'afx-search'; srch.placeholder = T('afx_search_ph');
    srch.setAttribute('data-i18n-ph', 'afx_search_ph');
    srch.addEventListener('input', () => showSearchResults(srch));
    srch.addEventListener('focus', () => showSearchResults(srch));
    bar.appendChild(srch);
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#afaq-menubar')) { closeDrops(); hideSearch(); }
    });
  }

  // بحث عن الشاشات: يبحث في كل بنود القوائم
  let srchBox = null;
  function flatItems() {
    const out = [];
    const walk = (items, path) => items.forEach(it => {
      if (it.sep) return;
      const label = T(it.k);
      if (it.sub) walk(it.sub, path + ' › ' + label);
      else out.push({ it, label, path });
    });
    MENUS.forEach(m => walk(m.items, T(m.k)));
    return out;
  }
  function showSearchResults(input) {
    hideSearch();
    const q = input.value.trim();
    if (!q) return;
    const hits = flatItems().filter(x => x.label.includes(q)).slice(0, 12);
    srchBox = document.createElement('div');
    srchBox.className = 'afx-drop';
    srchBox.style.cssText = 'position:absolute;top:100%;inset-inline-end:0;z-index:300;max-height:320px;overflow:auto';
    (hits.length ? hits : [{ label: '—', it: null }]).forEach(h => {
      const d = document.createElement('div');
      d.className = 'afx-di';
      d.innerHTML = `<span class="txt">${escH(h.path ? h.path + ' › ' + h.label : h.label)}</span>`;
      if (h.it) d.onclick = () => { hideSearch(); input.value = ''; dispatchItem(h.it, h.label); };
      srchBox.appendChild(d);
    });
    input.parentElement.style.position = 'relative';
    input.parentElement.appendChild(srchBox);
  }
  function hideSearch() { if (srchBox) { srchBox.remove(); srchBox = null; } }

  /* ═══════════ 5) الساعة الأنالوج (SVG حية) ═══════════ */
  function buildClock() {
    const wrap = $('#afx-clock-wrap');
    if (!wrap) return;
    const nums = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n, i) => {
      const a = (i * 30 - 90) * Math.PI / 180;
      const x = 60 + 44 * Math.cos(a), y = 60 + 44 * Math.sin(a);
      return `<text x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}" font-size="11" font-weight="700"
        fill="#fff" text-anchor="middle">${n}</text>`;
    }).join('');
    wrap.innerHTML = `
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="56" fill="#4A76C4" stroke="#2C4E92" stroke-width="3"/>
        <circle cx="60" cy="60" r="50" fill="#5B86D4"/>
        ${nums}
        <line id="afx-h-h" x1="60" y1="60" x2="60" y2="34" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
        <line id="afx-h-m" x1="60" y1="60" x2="60" y2="22" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
        <line id="afx-h-s" x1="60" y1="64" x2="60" y2="18" stroke="#E33" stroke-width="1.6" stroke-linecap="round"/>
        <circle cx="60" cy="60" r="3.2" fill="#fff" stroke="#2C4E92"/>
      </svg>`;
    const tick = () => {
      const d = new Date();
      const s = d.getSeconds(), m = d.getMinutes(), h = d.getHours() % 12;
      const set = (id, deg) => { const el = document.getElementById(id); if (el) el.setAttribute('transform', `rotate(${deg} 60 60)`); };
      set('afx-h-s', s * 6); set('afx-h-m', m * 6 + s * 0.1); set('afx-h-h', h * 30 + m * 0.5);
    };
    tick(); setInterval(tick, 1000);
  }

  /* ═══════════ 6) اللوحة الجانبية: تعبئة بيانات النظام ═══════════ */
  function fillSysinfo() {
    const st = (typeof state !== 'undefined' && state) ? state : {};
    const name = st.tenantName || ($('#company-title') || {}).textContent || '';
    // v26: الاسم الكامل للشركة من بيانات المستأجر، وإلا الافتراضي الكامل
    const full = (name && name !== '—') ? name : 'HAZEM.ERP SYSTEM MANAGER';
    $('#afx-si-company').textContent = full;
    $('#afx-header-company').textContent = full;
    const email = st.user && st.user.email;
    if (email) $('#afx-si-user').textContent = email.split('@')[0];
    const yr = new Date().getFullYear();
    $('#afx-si-fy').textContent = String(yr);
    $('#afx-si-date').textContent = `(${yr}/12/31)(${yr}/01/01)`;
    $('#afx-si-server').textContent = location.hostname || 'local';
  }
  setInterval(fillSysinfo, 2500);

  /* ═══════════ 7) عملات زخرفية على سطح المكتب (SVG من صنعنا) ═══════════ */
  function scatterCoins() {
    const desk = $('#afaq-desk');
    if (!desk) return;
    // v26: النسر + اسم البرنامج watermark محفور في الخلفية
    const wm = document.createElement('div');
    wm.className = 'afx-watermark';
    wm.innerHTML = '<img src="logo.png" alt="">' +
      '<div class="wm-txt">HAZEM.ERP<br>SYSTEM MANAGER</div>';
    desk.appendChild(wm);
    const sym = ['$', '﷼', '€', '£'];
    for (let i = 0; i < 9; i++) {
      const c = document.createElement('div');
      c.className = 'afx-coin';
      const sz = 40 + Math.round(Math.random() * 70);
      c.style.cssText = `width:${sz}px;height:${sz}px;font-size:${Math.round(sz * 0.45)}px;
        left:${Math.random() * 88}%;top:${Math.random() * 82}%;transform:rotate(${Math.random() * 60 - 30}deg)`;
      c.textContent = sym[i % sym.length];
      desk.appendChild(c);
    }
  }

  /* ═══════════ 8) نافذة فاتورة مبيعات (مطابقة للمرجع) ═══════════ */
  function st() { return (typeof state !== 'undefined' && state) ? state : { items: [], parties: [], invoices: [], accounts: [] }; }
  function today() { return new Date().toISOString().slice(0, 10); }

  let sinvWin = null;
  function openAfaqSalesInvoice() {
    if (sinvWin && document.body.contains(sinvWin)) return focusWin(sinvWin);
    const S = st();
    const customers = (S.parties || []).filter(p => p.kind === 'customer');
    const itemOpts = (S.items || []).map(i =>
      `<option value="${i.id}" data-price="${i.sale_price || 0}" data-name="${escH(i.name)}">${escH(i.name)}</option>`).join('');
    const custOpts = customers.map(p =>
      `<option value="${p.id}" data-bal="${p.balance || 0}">${escH(p.name)}</option>`).join('');
    const invCount = (S.invoices || []).length;

    const el = document.createElement('div');
    el.innerHTML = `
      <div class="afx-sinv-toolbar">
        <span class="nav-arrows">
          <button class="afx-btn" id="as-first" title="الأولى">|◂</button>
          <button class="afx-btn" id="as-prev" title="السابقة">◂</button>
          <button class="afx-btn" id="as-next" title="التالية">▸</button>
          <button class="afx-btn" id="as-last" title="الأخيرة">▸|</button>
        </span>
        <span style="flex:1"></span>
        <button class="afx-btn">${T('afx_sinv_import_all')}</button>
        <button class="afx-btn">${T('afx_sinv_import')}</button>
        <button class="afx-btn" id="as-export">${T('afx_sinv_export')}</button>
        <button class="afx-btn" id="as-print-issue">${T('afx_sinv_print_issue')}</button>
      </div>
      <div class="afx-sinv-form">
        <div class="afx-sinv-side">
          <span class="afx-lbl">${T('afx_sinv_status')}</span><span style="font-weight:800;color:#1B5E20">${T('afx_sinv_approved')}</span>
          <span class="afx-lbl">${T('afx_sinv_policy')}</span><input type="checkbox" checked>
          <span class="afx-lbl">${T('afx_sinv_src_no')}</span><input id="as-srcno" style="width:70px">
          <span class="afx-lbl">${T('afx_sinv_view_entry')}</span><button class="afx-btn" id="as-view-entry" style="min-width:0">📒</button>
        </div>
        <div class="cols">
          <span class="afx-lbl">${T('afx_sinv_number')}</span><input id="as-num" dir="ltr" style="width:90px" value="${invCount + 1}">
          <span class="afx-lbl">${T('afx_sinv_date')}</span><input id="as-date" type="datetime-local" dir="ltr" value="${today()}T12:00">
          <span class="afx-lbl">${T('afx_sinv_wh')}</span><input value="${T('afx_sinv_wh_main')}">
          <span class="afx-lbl">${T('afx_sinv_customer')}</span>
          <span><select id="as-customer" style="width:70%">${custOpts}</select>
            <input id="as-cust-bal" dir="ltr" style="width:26%" readonly title="الرصيد"></span>
          <span class="afx-lbl">${T('afx_sinv_rep')}</span><input>
          <span class="afx-lbl">${T('afx_sinv_currency')}</span><input value="${T('afx_sinv_sar')}">
          <span class="afx-lbl">${T('afx_sinv_rate')}</span><input dir="ltr" value="1">
          <span class="afx-lbl">${T('afx_sinv_source')}</span><input value="${T('afx_sinv_src_free')}">
          <span class="afx-lbl">${T('afx_sinv_desc')}</span><input id="as-desc" style="grid-column:span 1">
        </div>
      </div>
      <table class="afx-grid" id="as-grid">
        <thead><tr>
          <th>${T('afx_sinv_m')}</th><th>${T('afx_sinv_code')}</th><th>${T('afx_sinv_item')}</th>
          <th>${T('afx_sinv_unit')}</th><th>${T('afx_sinv_qty')}</th><th>${T('afx_sinv_price')}</th>
          <th>${T('afx_sinv_total')}</th><th>${T('afx_sinv_net')}</th><th>${T('afx_sinv_desc')}</th><th>${T('afx_sinv_store')}</th>
        </tr></thead>
        <tbody></tbody>
      </table>
      <button class="afx-btn" id="as-addline" style="margin-top:4px">+ ${T('btn_add_line') || 'إضافة سطر'}</button>
      <fieldset class="afx-sec"><legend>${T('afx_sinv_payments')}</legend>
        <table class="afx-grid"><thead><tr>
          <th>${T('afx_sinv_serial')}</th><th>${T('afx_sinv_paymethod')}</th><th>${T('afx_sinv_accname')}</th>
          <th>${T('afx_sinv_amount')}</th><th>${T('afx_sinv_due')}</th><th>${T('afx_sinv_paper')}</th>
          <th>${T('afx_sinv_bank')}</th><th>${T('afx_sinv_payee')}</th>
        </tr></thead><tbody><tr>
          <td>1</td><td><select><option>${T('afx_sinv_credit')}</option><option>نقدي</option><option>شبكة</option></select></td>
          <td><input></td><td><input id="as-pay-amt" dir="ltr"></td><td><input type="date" value="${today()}"></td>
          <td><input></td><td><input></td><td><input></td>
        </tr></tbody></table>
      </fieldset>
      <div class="afx-sinv-foot">
        <span class="f"><b>${T('afx_sinv_gtotal')}</b><input id="as-total" dir="ltr" readonly></span>
        <span class="f">${T('afx_sinv_disc')}<input id="as-disc" dir="ltr" value="0"></span>
        <span class="f">${T('afx_sinv_discpct')}<input dir="ltr" value="0" style="width:44px"></span>
        <span class="f"><b>${T('afx_sinv_net')}</b><input id="as-net" dir="ltr" readonly></span>
        <span class="f">${T('afx_sinv_paid')}<input id="as-paid" class="afx-paid" dir="ltr" value="0"></span>
        <span class="f">${T('afx_sinv_remain')}<input id="as-remain" dir="ltr" readonly></span>
        <span class="f">${T('afx_sinv_vat')}<input id="as-vat" dir="ltr" readonly></span>
        <span class="f">${T('afx_sinv_expenses')}<input dir="ltr" value="0" style="width:60px"></span>
      </div>
      <div class="afx-sinv-actions">
        <button class="afx-btn afx-green" id="as-save">${T('afx_btn_add')}</button>
        <button class="afx-btn" disabled>${T('afx_btn_edit')}</button>
        <button class="afx-btn" disabled>${T('afx_btn_del')}</button>
        <button class="afx-btn" id="as-print">${T('afx_btn_print')}</button>
        <button class="afx-btn" id="as-track">${T('afx_btn_track')}</button>
        <button class="afx-btn" id="as-lang">${T('afx_lang')}</button>
        <button class="afx-btn" id="as-exit">${T('afx_btn_exit')}</button>
      </div>`;

    sinvWin = afaqOpenWindow({ title: T('afx_sinv_title'), body: el, w: 1180, h: 700,
      onClose: () => { sinvWin = null; } });

    const q = (s) => el.querySelector(s);
    const fmtN = (n) => (Number(n || 0)).toLocaleString('en-US', { maximumFractionDigits: 2 });

    function addLine() {
      const tb = q('#as-grid tbody');
      const tr = document.createElement('tr');
      const m = tb.children.length + 1;
      tr.innerHTML = `<td>${m}</td><td class="c-code" dir="ltr"></td>
        <td><select class="c-item">${itemOpts}</select></td>
        <td><select><option>PCS</option><option>BOX</option></select></td>
        <td><input class="c-qty" type="number" min="0" step="any" value="1" dir="ltr"></td>
        <td><input class="c-price" type="number" min="0" step="any" dir="ltr"></td>
        <td class="c-total" dir="ltr">0</td><td class="c-net" dir="ltr">0</td>
        <td><input class="c-desc"></td><td>${T('afx_sinv_wh_main')}</td>`;
      tb.appendChild(tr);
      const sel = tr.querySelector('.c-item');
      const sync = () => {
        tr.querySelector('.c-price').value = sel.selectedOptions[0]?.dataset.price ?? 0;
        tr.querySelector('.c-code').textContent = sel.selectedOptions[0]?.dataset.name?.slice(0, 10) || '';
        calc();
      };
      sel.onchange = sync; sync();
      tr.querySelectorAll('input').forEach(i => i.oninput = calc);
    }
    function lines() {
      return Array.from(el.querySelectorAll('#as-grid tbody tr')).map(tr => ({
        item_id: tr.querySelector('.c-item').value,
        qty: Number(tr.querySelector('.c-qty').value),
        price: Number(tr.querySelector('.c-price').value),
        tax_category: 'standard',
      }));
    }
    function calc() {
      const sum = window.summarizeLines(lines());
      const disc = Number(q('#as-disc').value || 0);
      const net = Math.max(0, sum.total - disc);
      const paid = Number(q('#as-paid').value || 0);
      q('#as-total').value = fmtN(sum.total);
      q('#as-vat').value = fmtN(sum.tax_amount);
      q('#as-net').value = fmtN(net);
      q('#as-remain').value = fmtN(net - paid);
      q('#as-pay-amt').value = fmtN(net);
      return { sum, net };
    }
    q('#as-addline').onclick = addLine;
    q('#as-disc').oninput = calc; q('#as-paid').oninput = calc;
    addLine();

    // رصيد العميل
    const syncBal = () => { q('#as-cust-bal').value = q('#as-customer').selectedOptions[0]?.dataset.bal ?? 0; };
    q('#as-customer').onchange = syncBal; syncBal();

    // إضافة = حفظ وترحيل عبر نفس RPC المستخدم في app.js + الحقول الضريبية
    q('#as-save').onclick = async () => {
      const L = lines();
      if (typeof sb === 'undefined' || !sb) return window.toast && toast('لا يوجد اتصال بقاعدة البيانات', false);
      if (!customers.length) return window.toast && toast(T('afx_sinv_customer'), false);
      if (!L.length || L.some(l => !l.qty || l.qty <= 0))
        return window.toast && toast(T('msg_check_lines'), false);
      const { sum } = calc();
      const { data, error } = await sb.rpc('post_sales_invoice', {
        p_customer: q('#as-customer').value,
        p_lines: L.map(({ item_id, qty, price }) => ({ item_id, qty, price })),
      });
      if (error) return window.toast && toast('فشل الترحيل: ' + error.message, false);
      window.toast && toast(`تم ترحيل فاتورة المبيعات رقم ${data} بنجاح`);
      await window.applyInvoiceTaxMeta('sales', data, {
        invoice_type: 'simplified', buyer_vat_number: null, sum, lines: L });
      if (window.loadInvoices) window.loadInvoices();
      sinvWin.dataset.lastInv = data;
    };
    q('#as-print').onclick = () => {
      const id = sinvWin.dataset.lastInv;
      if (id && window.previewDoc) return window.previewDoc('sales_invoice', id);
      window.qbMenuDispatch({ action: 'print-preview' });
    };
    q('#as-print-issue').onclick = () => q('#as-print').click();
    q('#as-export').onclick = () => window.qbMenuDispatch({ action: 'export-excel' });
    q('#as-track').onclick = () => afaqStub(T('afx_btn_track'));
    q('#as-lang').onclick = () => window.setLang && window.setLang(window.currentLang() === 'ar' ? 'en' : 'ar');
    q('#as-exit').onclick = () => sinvWin.close();
    q('#as-view-entry').onclick = () => window.qbMenuDispatch({ tab: 'journal' });
    // تنقل بين الفواتير
    const invs = () => st().invoices || [];
    let cur = invs().length - 1;
    const showInv = (i) => {
      const L = invs(); if (!L.length) return;
      cur = Math.max(0, Math.min(i, L.length - 1));
      q('#as-num').value = L[cur].number ?? L[cur].id ?? (cur + 1);
    };
    q('#as-first').onclick = () => showInv(0);
    q('#as-prev').onclick = () => showInv(cur - 1);
    q('#as-next').onclick = () => showInv(cur + 1);
    q('#as-last').onclick = () => showInv(invs().length - 1);
  }
  window.openAfaqSalesInvoice = openAfaqSalesInvoice;

  /* ═══════════ 9) نافذة كشف حساب (مطابقة للمرجع) ═══════════ */
  let stmtWin = null;
  function openAfaqStatement() {
    if (stmtWin && document.body.contains(stmtWin)) return focusWin(stmtWin);
    const S = st();
    const accs = S.accounts || [];
    const el = document.createElement('div');
    el.innerHTML = `
      <div class="afx-stmt-sec">
        <div class="h"><span>${T('afx_stmt_date')}</span><span>▾</span></div>
        <div class="b" style="display:flex;gap:18px;align-items:center">
          <span class="afx-lbl">${T('afx_stmt_from')}</span>
          <input type="datetime-local" id="ast-from" dir="ltr" value="${new Date().getFullYear()}-01-01T00:00">
          <span class="afx-lbl">${T('afx_stmt_to')}</span>
          <input type="datetime-local" id="ast-to" dir="ltr" value="${new Date().getFullYear()}-12-31T23:59">
        </div>
      </div>
      <div class="afx-stmt-sec closed"><div class="h"><span>${T('afx_stmt_branches')}</span><span>▸</span></div>
        <div class="b"><label><input type="checkbox" checked> ${T('afx_branch')}</label></div></div>
      <div class="afx-stmt-sec">
        <div class="h"><span>${T('afx_stmt_accounts')}</span><span>▾</span></div>
        <div class="b">
          <div style="display:flex;gap:26px;align-items:center;margin-bottom:6px">
            <label><input type="radio" name="ast-mode" checked> ${T('afx_stmt_cum')}</label>
            <label><input type="radio" name="ast-mode"> ${T('afx_stmt_period')}</label>
            <span style="flex:1"></span>
            <span class="afx-lbl">${T('afx_stmt_search')}</span><input id="ast-search">
            <label style="font-size:11px;color:#555"><input type="checkbox"> ${T('afx_stmt_fetch')}</label>
          </div>
          <div style="max-height:220px;overflow:auto;border:1px solid #AAB2BF">
          <table class="afx-grid" id="ast-grid"><thead><tr>
            <th>${T('afx_stmt_accno')}</th><th>${T('afx_stmt_accname')}</th><th>${T('afx_stmt_parent')}</th>
            <th>${T('afx_stmt_instmt')}</th><th>${T('afx_stmt_usetype')}</th><th>${T('afx_stmt_pick')}</th>
          </tr></thead><tbody>
            ${accs.map(a => `<tr>
              <td dir="ltr">${escH(a.code || '')}</td><td>${escH(a.name || '')}</td>
              <td>${escH(a.parent_name || '')}</td><td>ميزانية</td><td>عام</td>
              <td style="text-align:center"><input type="checkbox" class="ast-pick" data-id="${a.id}"></td>
            </tr>`).join('')}
          </tbody></table></div>
          <div style="display:flex;gap:6px;margin-top:6px">
            <button class="afx-btn" id="ast-clear">${T('afx_stmt_clear')}</button>
            <button class="afx-btn" id="ast-choose">${T('afx_stmt_choose')}</button>
            <button class="afx-btn" id="ast-fromstmt" style="color:#C00000">${T('afx_stmt_fromstmt')}</button>
            <button class="afx-btn" id="ast-all">${T('afx_stmt_all')}</button>
            <button class="afx-btn" id="ast-none">${T('afx_stmt_none')}</button>
            <button class="afx-btn" id="ast-invert">${T('afx_stmt_invert')}</button>
          </div>
        </div>
      </div>
      <div class="afx-stmt-sec closed"><div class="h"><span>${T('afx_stmt_type')}</span><span>▸</span></div>
        <div class="b"><label><input type="checkbox" checked> ${T('afx_stmt_cum')}</label></div></div>
      <div class="afx-stmt-sec closed"><div class="h"><span>${T('afx_stmt_more')}</span><span>▸</span></div>
        <div class="b">—</div></div>
      <div class="afx-sinv-actions">
        <button class="afx-btn afx-green" id="ast-print">${T('afx_btn_print')}</button>
        <button class="afx-btn" id="ast-lang">${T('afx_lang')}</button>
        <button class="afx-btn" id="ast-exit">${T('afx_btn_exit')}</button>
      </div>`;

    stmtWin = afaqOpenWindow({ title: T('afx_stmt_title'), body: el, w: 1000, h: 640,
      onClose: () => { stmtWin = null; } });
    const q = (s) => el.querySelector(s);
    el.querySelectorAll('.afx-stmt-sec > .h').forEach(h =>
      h.onclick = () => h.parentElement.classList.toggle('closed'));
    const picks = () => Array.from(el.querySelectorAll('.ast-pick'));
    q('#ast-all').onclick = () => picks().forEach(c => c.checked = true);
    q('#ast-none').onclick = () => picks().forEach(c => c.checked = false);
    q('#ast-invert').onclick = () => picks().forEach(c => c.checked = !c.checked);
    q('#ast-clear').onclick = () => { q('#ast-search').value = ''; filter(''); };
    q('#ast-choose').onclick = () => picks().filter(c => !c.closest('tr').style.display).forEach(c => c.checked = true);
    q('#ast-fromstmt').onclick = () => q('#ast-all').click();
    const filter = (txt) => el.querySelectorAll('#ast-grid tbody tr').forEach(tr =>
      tr.style.display = tr.textContent.includes(txt) ? '' : 'none');
    q('#ast-search').oninput = (e) => filter(e.target.value.trim());
    // طباعة → تقرير كشف الحساب الموجود (reports.js) داخل نافذة
    q('#ast-print').onclick = () => window.qbMenuDispatch({ report: 'stmt' });
    q('#ast-lang').onclick = () => window.setLang && window.setLang(window.currentLang() === 'ar' ? 'en' : 'ar');
    q('#ast-exit').onclick = () => stmtWin.close();
  }
  window.openAfaqStatement = openAfaqStatement;

  /* ═══════════ 10) الاختصارات ═══════════ */
  const SHORTCUTS = {
    'alt+o': { action: 'sysinfo' }, 'alt+b': { tab: 'branches' }, 'alt+f': { tab: 'settings' },
    'alt+r': { tab: 'settings' }, 'alt+u': { tab: 'users' }, 'alt+l': { action: 'logout' },
    'alt+j': { tab: 'journal' }, 'alt+p': { tab: 'pos' },
    'ctrl+alt+s': { tab: 'invoices' }, 'ctrl+alt+u': { tab: 'purchases' },
  };
  document.addEventListener('keydown', (e) => {
    if ($('#app-screen') && $('#app-screen').classList.contains('hidden')) return;
    const combo = (e.ctrlKey ? 'ctrl+' : '') + (e.altKey ? 'alt+' : '') + e.key.toLowerCase();
    if (e.ctrlKey && e.key === 'F7') { e.preventDefault(); return afaqStub(T('afx_iv_serial')); }
    if (SHORTCUTS[combo]) {
      if (e.target.closest('input,textarea,select') && combo !== 'alt+l') return;
      e.preventDefault();
      window.qbMenuDispatch(SHORTCUTS[combo]);
    }
  });

  /* ═══════════ 11) إقلاع ═══════════ */
  buildMenubar(); buildClock(); scatterCoins(); fillSysinfo();
  // إعادة بناء القوائم عند تبديل اللغة
  const _rerender = window.__rerenderCurrentTab;
  window.__rerenderCurrentTab = function () {
    if (_rerender) _rerender();
    buildMenubar(); fillSysinfo();
  };
})();
