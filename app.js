/* ═══════════════════════════════════════════════════════════════
   HAZEM.ERP SYSTEM MANAGER — منطق التطبيق كاملاً (SPA خالص بدون build step)
   ═══════════════════════════════════════════════════════════════ */

// ─────────── ١) تهيئة Supabase ───────────
// حارس الإعداد: لو المفاتيح لسه ماتحطتش نظهر شاشة تعليمات بدل صفحة بيضاء
const _cfgOk = /^https:\/\/.+\.supabase\.co\/?$/.test(HAZEM_SUPABASE_URL || '') && (HAZEM_SUPABASE_KEY || '').length > 50;
const sb = _cfgOk ? window.supabase.createClient(HAZEM_SUPABASE_URL, HAZEM_SUPABASE_KEY) : null;
if (!_cfgOk) {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:#FFFFFF;color:#141210;font-family:inherit;direction:rtl">' +
      '<div style="max-width:560px;background:#FAF6F1;border:1px solid #E7DDD1;border-top:4px solid #B42318;border-radius:16px;padding:32px;line-height:2">' +
      '<h1 style="color:#B42318;margin:0 0 12px">⚙️ خطوة واحدة باقية — إعداد الاتصال</h1>' +
      '<p>تطبيق <b>HAZEM.ERP SYSTEM MANAGER</b> شغال، بس محتاج مفاتيح مشروع Supabase الجديد:</p>' +
      '<ol style="margin:0;padding-right:20px">' +
      '<li>افتح مشروعك في Supabase ← <b>Project Settings ← API</b></li>' +
      '<li>انسخ <b>Project URL</b> و <b>anon public key</b></li>' +
      '<li>افتح ملف <code style="color:#7B4B26">config.js</code> والصقهما مكان الكلمتين المؤقتتين</li>' +
      '<li>ارفع الملف على GitHub وحدّث الصفحة</li>' +
      '</ol><p style="color:#7A6A5C;font-size:13px;margin-bottom:0">ولا تنسى تشغيل ملف schema.sql في SQL Editor مرة واحدة قبل أول استخدام.</p>' +
      '</div></div>';
  });
  throw new Error('HAZEM.ERP SYSTEM MANAGER: config.js غير مُعدّ بعد');
}

// حالة عامة
const state = { tenant: null, user: null, items: [], parties: [] };

// ─────────── ٢) أدوات مساعدة ───────────
const $  = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// رسائل Toast عربية
function toast(msg, ok = true) {
  const t = document.createElement('div');
  t.className = 'toast ' + (ok ? 'ok' : 'err');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
const fmt = (n) => Number(n || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// نافذة منبثقة
function openModal(html) { $('#modal-body').innerHTML = html; $('#modal-overlay').classList.remove('hidden'); }
function closeModal() { $('#modal-overlay').classList.add('hidden'); }
$('#modal-overlay').addEventListener('click', e => { if (e.target.id === 'modal-overlay') closeModal(); });

// تبديل الشاشات الرئيسية
function showScreen(id) {
  ['auth-screen', 'onboarding-screen', 'app-screen'].forEach(x =>
    $('#' + x).classList.toggle('hidden', x !== id));
  // المرحلة 19: زر المساعد الذكي يظهر فقط داخل شاشة التطبيق (بعد الدخول)
  const fab = document.getElementById('assistant-fab');
  if (fab) fab.classList.toggle('hidden', id !== 'app-screen');
}

// ─────────── ٣) المصادقة ───────────
$('#btn-login').onclick = async () => {
  const { error } = await sb.auth.signInWithPassword({
    email: $('#auth-email').value.trim(), password: $('#auth-password').value });
  if (error) return toast('فشل الدخول: ' + error.message, false);
  await boot();
};

$('#btn-signup').onclick = async () => {
  const { error } = await sb.auth.signUp({
    email: $('#auth-email').value.trim(), password: $('#auth-password').value });
  if (error) return toast('فشل إنشاء الحساب: ' + error.message, false);
  toast('تم إنشاء الحساب — سجّل الدخول الآن (أو أكّد بريدك إن كان التأكيد مفعّلاً)');
};

$('#btn-logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };

// ─────────── ٤) الإقلاع والتحقق من العضوية ───────────
async function boot() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return showScreen('auth-screen');
  state.user = user;

  // 🛠️ إظهار زر لوحة المطوّر لمالك النظام فقط (حسب إيميله في config.js)
  if (typeof HAZEM_OWNER_EMAIL !== 'undefined' && state.user && state.user.email &&
      state.user.email.toLowerCase() === String(HAZEM_OWNER_EMAIL).trim().toLowerCase()) {
    const nb = $('#nav-dev'); if (nb) nb.classList.remove('hidden');
  }

  // دفعة C: نجلب role أيضاً لتحديد صلاحيات الإدارة في الواجهة (الفرض النهائي عند القاعدة عبر RLS/RPC)
  // ونقيّد الاستعلام بعضوية المستخدم الحالي تحديداً (eq user_id) — وإلا فـ limit(1) قد يلتقط
  // عضوية شخص آخر من نفس الشركة (سياسة memberships_select تسمح برؤية كل أعضاء الشركة).
  const { data: ms } = await sb.from('memberships').select('tenant_id, role, tenants(name, logo_url)')
    .eq('user_id', user.id).limit(1);
  if (!ms || ms.length === 0) return showScreen('onboarding-screen');

  state.tenant = ms[0].tenant_id;
  state.myRole = ms[0].role || 'member';
  state.tenantName = ms[0].tenants.name;
  state.logoUrl = ms[0].tenants.logo_url || null;
  $('#company-title').textContent = state.tenantName;
  applyBrandLogo();
  loadTaxSettings(); // بيانات زاتكا (تدرّج آمن — لا تكسر الإقلاع)
  if (typeof window.loadPeriodLock === 'function') window.loadPeriodLock(); // المرحلة 16: قفل الفترة (تدرّج آمن)
  if (typeof window.loadP2SettingsBoot === 'function') window.loadP2SettingsBoot(); // المرحلة 17: زاتكا P2 (تدرّج آمن)
  showScreen('app-screen');
  await refreshDashboard();
  await Promise.all([loadItems(), loadParties(), loadInvoices()]);
}

// إنشاء الشركة (onboarding) عبر RPC
$('#btn-create-company').onclick = async () => {
  const name = $('#company-name').value.trim();
  if (!name) return toast('أدخل اسم الشركة', false);
  const { error } = await sb.rpc('create_company', {
    p_name: name, p_currency: $('#company-currency').value.trim() || 'SAR' });
  if (error) return toast('فشل إنشاء الشركة: ' + error.message, false);
  toast('تم إنشاء شركتك بنجاح');
  await boot();
};

// ─────────── ٥) التنقل بين التبويبات ───────────
// أسماء التبويبات لشريط العنوان الكلاسيكي
const TAB_TITLES = {
  dashboard: 'لوحة المؤشرات', items: 'الأصناف', parties: 'العملاء والموردون',
  invoices: 'فواتير المبيعات', reports: 'التقارير', settings: 'الإعدادات', dev: 'لوحة المطوّر',
  accounts: 'شجرة الحسابات', journal: 'قيود اليومية', vouchers: 'السندات والخزن',
  purchases: 'المشتريات', returns: 'مرتجعات المبيعات', quotes: 'عروض الأسعار',
  warehouses: 'المستودعات والجرد', pos: 'نقطة البيع — الكاشير', shifts: 'ورديات الكاشير',
  posrep: 'تقرير مدفوعات نقاط البيع', poshourly: 'المبيعات بالساعة', // ترقية POS+
  users: 'المستخدمون والصلاحيات', branches: 'الفروع',
  employees: 'الموظفون', hr: 'الموارد البشرية والرواتب',
  assets: 'الأصول الثابتة', // المرحلة 13
  barcode: 'ملصقات الباركود', // المرحلة 14
  expenses: 'المصروفات ومراكز التكلفة', // المرحلة 15
  einvoices: 'الفوترة الإلكترونية — زاتكا ٢', // المرحلة 17
  integrations: 'التكاملات — سلة/زد + API', // المرحلة 18
  manufacturing: 'التصنيع — قوائم المكونات وأوامر التصنيع', // المرحلة 19
  crm: 'CRM — العملاء المحتملون والمتابعات', // المرحلة 19
};

// دالة عامة لتبديل التبويب — يستدعيها السايدبار وشريط القوائم الكلاسيكي
function switchTab(tabName) {
  if (!TAB_TITLES[tabName] || !$('#tab-' + tabName)) return;
  $$('.nav-btn').forEach(x => x.classList.toggle('active', x.dataset.tab === tabName));
  // تظليل بند السايدبار المطابق للتبويب الحالي (تصميم Manager)
  $$('.mb-leaf[data-tab]').forEach(x => x.classList.toggle('active', x.dataset.tab === tabName));
  $$('.tab').forEach(t => t.classList.add('hidden'));
  $('#tab-' + tabName).classList.remove('hidden');
  const _sb = $('.sidebar'); if (_sb) _sb.classList.remove('open');
  const wt = $('#window-title');
  if (wt) wt.textContent = (typeof t === 'function' ? t('tab_' + tabName) : TAB_TITLES[tabName]) || TAB_TITLES[tabName];
  window.__currentTab = tabName;
  _tabbarOpen(tabName); // شريط تبويبات الشاشات المفتوحة (أسلوب Manager.io)
  if (tabName === 'dashboard') refreshDashboard();
  if (tabName === 'reports') loadReports();
  if (tabName === 'settings') { loadSettings(); loadTaxSettings(); if (typeof window.loadPeriodLockBox === 'function') window.loadPeriodLockBox(); }
  if (tabName === 'dev') loadDevPanel();
  if (tabName === 'accounts') loadAccounts();
  if (tabName === 'journal') loadJournal();
  if (tabName === 'vouchers') loadVouchers();
  if (tabName === 'purchases') loadPurchases();
  if (tabName === 'returns') loadSalesReturns();
  if (tabName === 'quotes') loadQuotes();
  if (tabName === 'warehouses') loadWarehouses();
  if (tabName === 'pos') loadPos();
  if (tabName === 'shifts') loadShifts();
  if (tabName === 'users') loadUsers();
  if (tabName === 'branches') loadBranches();
  // المرحلة 12 (hr.js — تُعرَّف بعد app.js؛ الحارس يحمي أول إقلاع)
  if (tabName === 'employees' && typeof loadEmployees === 'function') loadEmployees();
  if (tabName === 'hr' && typeof loadHr === 'function') loadHr();
  // المرحلة 13 (assets.js — تُعرَّف بعد app.js؛ الحارس يحمي أول إقلاع)
  if (tabName === 'assets' && typeof loadAssets === 'function') loadAssets();
  // المرحلة 14 (procurement.js — تُعرَّف بعد app.js؛ الحارس يحمي أول إقلاع)
  if (tabName === 'barcode' && typeof loadBarcodeTab === 'function') loadBarcodeTab();
  // المرحلة 15: المصروفات + مراكز التكلفة + الفواتير المتكررة + تذكيرات التحصيل
  if (tabName === 'expenses' && typeof loadExpensesTab === 'function') loadExpensesTab();
  // المرحلة 17: الفوترة الإلكترونية — زاتكا الجيل الثاني (zatca2.js — حارس التعريف)
  if (tabName === 'einvoices' && typeof loadEinvoicesTab === 'function') loadEinvoicesTab();
  // المرحلة 18: التكاملات (سلة/زد) + API مفتوح (integrations.js — حارس التعريف)
  if (tabName === 'integrations' && typeof loadIntegrationsTab === 'function') loadIntegrationsTab();
  // المرحلة 19: التصنيع (BOM) + CRM (manufacturing.js / crm.js — حارس التعريف)
  if (tabName === 'manufacturing' && typeof loadManufacturingTab === 'function') loadManufacturingTab();
  if (tabName === 'crm' && typeof loadCrmTab === 'function') loadCrmTab();
  // ترقية POS+ (pos-plus.js — تُعرَّف بعد app.js؛ الحارس يحمي أول إقلاع)
  if (tabName === 'posrep' && typeof loadPosPaymentsReport === 'function') loadPosPaymentsReport();
  if (tabName === 'poshourly' && typeof loadPosHourly === 'function') loadPosHourly();
}
window.switchTab = switchTab;

// ─────────── ٤-ز) تعدد اللغات (i18n foundation) — دفعة زاتكا/VAT ───────────
// إعادة رسم التبويب الحالي بعد تبديل اللغة (تحديث عنوان النافذة الكلاسيكية)
window.__rerenderCurrentTab = () => { if (window.__currentTab) switchTab(window.__currentTab); };
// زر اللغة في شريط القوائم: يبدّل عربي ⇄ English ويحدّث الاتجاه rtl/ltr
const _btnLang = $('#btn-lang');
if (_btnLang) _btnLang.onclick = () => setLang(currentLang() === 'ar' ? 'en' : 'ar');
// تطبيق اللغة المحفوظة فور تحميل الصفحة (الافتراضي عربي RTL)
if (typeof applyI18nStatic === 'function') {
  document.documentElement.lang = currentLang();
  document.documentElement.dir = currentLang() === 'ar' ? 'rtl' : 'ltr';
  applyI18nStatic();
}

$$('.nav-btn').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
// زر ☰: على الموبايل يفتح/يغلق السايدبار كـ drawer، وعلى سطح المكتب يطويه لأيقونات
$('#btn-menu').onclick = () => {
  const sb = $('.sidebar');
  if (window.innerWidth <= 768) { if (sb) sb.classList.toggle('open'); }
  else $('#app-screen').classList.toggle('collapsed');
};

// ─────────── ٥-أ) الشريط الجانبي الداكن (تصميم Manager.io) ───────────
// المجموعات تُطوى/تُفتح بالنقر على عنوانها
$$('.sb-head').forEach(head => {
  head.addEventListener('click', () => {
    const g = head.closest('.sb-group');
    if (g) g.classList.toggle('open');
  });
});

// إغلاق الـ drawer على الموبايل (يُستدعى أيضاً عند اختيار أي بند)
function closeAllMenus() {
  const sb = $('.sidebar');
  if (sb) sb.classList.remove('open');
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllMenus(); });

// ─────────── ٥-ب) شريط تبويبات الشاشات المفتوحة (أسلوب Manager.io) ───────────
const __openTabs = [];
function _tabTitle(name) {
  return (typeof t === 'function' ? t('tab_' + name) : '') || TAB_TITLES[name] || name;
}
function _tabbarRender() {
  const bar = $('#tabbar');
  if (!bar) return;
  bar.innerHTML = __openTabs.map(name => `
    <span class="tb-chip${name === window.__currentTab ? ' active' : ''}" data-tab="${name}">
      <span class="tb-chip-lbl">${esc(_tabTitle(name))}</span>
      <button class="tb-chip-x" data-close="${name}" title="${typeof t === 'function' ? t('btn_close') : '×'}">×</button>
    </span>`).join('');
}
function _tabbarOpen(name) {
  if (!__openTabs.includes(name)) __openTabs.push(name);
  _tabbarRender();
}
function _tabbarClose(name) {
  const i = __openTabs.indexOf(name);
  if (i === -1) return;
  __openTabs.splice(i, 1);
  // إغلاق التبويب النشط يعيد للوحة المؤشرات
  if (name === window.__currentTab) { _tabbarRender(); switchTab('dashboard'); return; }
  _tabbarRender();
}
const _tabbar = $('#tabbar');
if (_tabbar) _tabbar.addEventListener('click', (e) => {
  const x = e.target.closest('.tb-chip-x');
  if (x) { e.stopPropagation(); _tabbarClose(x.dataset.close); return; }
  const chip = e.target.closest('.tb-chip');
  if (chip) switchTab(chip.dataset.tab);
});

// عناصر القوائم: تبويب أو إجراء
$$('.mb-leaf').forEach(leaf => {
  if (leaf.disabled) return; // البنود المعطلة «قريباً 🚧» لا تفعل شيئاً
  leaf.addEventListener('click', () => {
    closeAllMenus();
    if (leaf.dataset.report) return openReport(leaf.dataset.report); // تبويب التقارير + تاب فرعي
    if (leaf.dataset.tab) {
      switchTab(leaf.dataset.tab);
      // المرحلة 15: بنود المصروفات تحمل data-sub لفتح التاب الفرعي المطلوب
      if (leaf.dataset.tab === 'expenses' && leaf.dataset.sub && window.switchExSub) switchExSub(leaf.dataset.sub);
      return;
    }
    if (leaf.dataset.action === 'print-preview') return previewCurrentView(); // دفعة B
    if (leaf.dataset.action === 'export-excel') return exportCurrentViewExcel(); // دفعة B
    if (leaf.dataset.action === 'logout') return $('#btn-logout').click();
    if (leaf.dataset.action === 'opening-entry') return openOpeningEntry();
    if (leaf.dataset.action === 'tax-settings') return openTaxSettings();
    // ترقية POS+: إعدادات الطابعة (pos-plus.js — حارس التعريف)
    if (leaf.dataset.action === 'pos-settings') return window.openPosSettings && window.openPosSettings();
    if (leaf.dataset.action === 'voucher-receipt') return openVoucher('receipt');
    if (leaf.dataset.action === 'voucher-payment') return openVoucher('payment');
    if (leaf.dataset.action === 'voucher-transfer') return openVoucher('transfer');
    if (leaf.dataset.action === 'purchase-invoice') return openPurchaseInvoice();
    // المرحلة 14: أمر شراء + إشعار دائن/مدين (procurement.js — حارس التعريف)
    if (leaf.dataset.action === 'purchase-order') return window.openPurchaseOrder && window.openPurchaseOrder();
    if (leaf.dataset.action === 'credit-note') return window.openCreditNote && window.openCreditNote();
    if (leaf.dataset.action === 'purchase-return') return openPurchaseReturn();
    if (leaf.dataset.action === 'sales-return') return openSalesReturn();
    if (leaf.dataset.action === 'quote') return openQuote();
    if (leaf.dataset.action === 'warehouses') return openWarehouses('list');
    if (leaf.dataset.action === 'stock-transfer') return openWarehouses('transfer');
    if (leaf.dataset.action === 'stock-count') return openWarehouses('count');
    if (leaf.dataset.action === 'sysinfo') return openModal(`
      <h3>🖥️ معلومات النظام</h3>
      <div class="table-wrap"><table><tbody>
        <tr><td style="color:#7A6A5C">النظام</td><td style="font-weight:700">HAZEM.ERP SYSTEM MANAGER</td></tr>
        <tr><td style="color:#7A6A5C">الشركة</td><td>${esc(state.tenantName || '—')}</td></tr>
        <tr><td style="color:#7A6A5C">المستخدم</td><td dir="ltr">${esc(state.user?.email || '—')}</td></tr>
        <tr><td style="color:#7A6A5C">الإصدار</td><td>1.0.0</td></tr>
        <tr><td style="color:#7A6A5C">التاريخ</td><td>${new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}</td></tr>
      </tbody></table></div>
      <div class="modal-actions"><button class="btn btn-gold" onclick="closeModal()">موافق</button></div>`);
    if (leaf.dataset.action === 'about') return openModal(`
      <h3 style="text-align:center">HAZEM.ERP SYSTEM MANAGER</h3>
      <p style="text-align:center;color:var(--muted);line-height:2.2;margin:0">
        الإصدار 1.0.0<br>نظام محاسبة وإدارة متكامل<br>
        <span style="font-size:12px">جميع الحقوق محفوظة © ${new Date().getFullYear()}</span></p>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn btn-gold" onclick="closeModal()">موافق</button></div>`);
  });
});

// بند «تحميل نسخة من البرنامج» يظهر للمالك فقط — يتزامن مع ظهور #nav-dev
function _syncDevMenuItem() {
  const dl = $('#mb-dev-dl');
  if (dl) dl.classList.toggle('hidden', !$('#nav-dev') || $('#nav-dev').classList.contains('hidden'));
}
new MutationObserver(_syncDevMenuItem)
  .observe($('#nav-dev'), { attributes: true, attributeFilter: ['class'] });
_syncDevMenuItem();

// زر ✕ في شريط العنوان الكلاسيكي ينقل للداشبورد (شكلي)
const _wc = $('#win-close');
if (_wc) _wc.onclick = () => switchTab('dashboard');

// ─────────── ٥-ب) الاختصار السري للمالك: Ctrl+Alt+H — بوابة دخول مستقلة للوحة المطوّر ───────────
// البوابة بتطلب الإيميل والباسوورد وتتحقق منهم فعلياً من Supabase،
// ولازم الإيميل يكون إيميل المالك — غير كده ممنوع نهائياً.
// والحماية مضاعفة من قاعدة البيانات (الدوال نفسها بترفض غير المالك).

const _ownerEmail = () => (typeof HAZEM_OWNER_EMAIL !== 'undefined' ? String(HAZEM_OWNER_EMAIL) : '').trim().toLowerCase();

// فتح اللوحة بعد نجاح التحقق
function _openDevPanel() {
  const nb = $('#nav-dev');
  if (nb) nb.classList.remove('hidden');
  if ($('#app-screen').classList.contains('hidden')) showScreen('app-screen');
  $$('.nav-btn').forEach(x => x.classList.remove('active'));
  if (nb) nb.classList.add('active');
  $$('.tab').forEach(t => t.classList.add('hidden'));
  const devTab = $('#tab-dev');
  if (devTab) { devTab.classList.remove('hidden'); loadDevPanel(); }
  toast('🛠️ أهلاً بك في لوحة المطوّر');
}

// بوابة الدخول المستقلة (إيميل + باسوورد)
function _showDevGate() {
  openModal(`
    <h3 style="text-align:center">🔐 بوابة مالك النظام</h3>
    <p style="color:var(--muted);font-size:13px;text-align:center;margin-bottom:16px">
      هذه المنطقة خاصة بمالك HAZEM.ERP SYSTEM MANAGER فقط — سجّل بياناتك للمتابعة</p>
    <label class="lbl">البريد الإلكتروني</label>
    <input type="email" id="dg-email" dir="ltr" autocomplete="username">
    <label class="lbl">كلمة المرور</label>
    <input type="password" id="dg-pass" dir="ltr" autocomplete="current-password">
    <div class="modal-actions">
      <button id="dg-enter" class="btn btn-gold">🔓 دخول</button>
      <button id="dg-cancel" class="btn btn-ghost">إلغاء</button>
    </div>`);
  $('#dg-email').focus();
  $('#dg-cancel').onclick = closeModal;
  const tryEnter = async () => {
    const email = $('#dg-email').value.trim();
    const pass = $('#dg-pass').value;
    if (!email || !pass) return toast('أدخل البريد وكلمة المرور', false);
    const btn = $('#dg-enter'); btn.disabled = true; btn.textContent = '⏳ جاري التحقق...';
    try {
      // تحقق حقيقي من Supabase — الباسوورد الغلط بيرفض هنا
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) { btn.disabled = false; btn.textContent = '🔓 دخول'; return toast('بيانات الدخول غير صحيحة', false); }
      // لازم يكون إيميل المالك تحديداً
      if (!data.user || (data.user.email || '').toLowerCase() !== _ownerEmail()) {
        await sb.auth.signOut(); // رجّع الحالة زي ما كانت
        btn.disabled = false; btn.textContent = '🔓 دخول';
        return toast('⛔ هذه اللوحة خاصة بمالك النظام فقط', false);
      }
      state.user = data.user;
      closeModal();
      _openDevPanel();
    } catch (err) {
      btn.disabled = false; btn.textContent = '🔓 دخول';
      toast('حدث خطأ: ' + err.message, false);
    }
  };
  $('#dg-enter').onclick = tryEnter;
  $('#dg-pass').onkeydown = (ev) => { if (ev.key === 'Enter') tryEnter(); };
}

// الاختصار: Ctrl + Alt + H
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey && e.altKey && (e.key === 'h' || e.key === 'H' || e.code === 'KeyH'))) return;
  e.preventDefault();
  // لو المالك مسجل دخول أصلاً بإيميله — يفتح مباشرة بدون البوابة
  const myEmail = (state.user && state.user.email || '').toLowerCase();
  if (myEmail && myEmail === _ownerEmail()) return _openDevPanel();
  // غير كده — بوابة الإيميل والباسوورد
  _showDevGate();
});

// ─────────── ٦) لوحة المؤشرات ───────────
async function refreshDashboard() {
  const count = async (table, filter) => {
    let q = sb.from(table).select('*', { count: 'exact', head: true });
    if (filter) q = filter(q);
    return (await q).count || 0;
  };
  const [items, customers, suppliers, invoices] = await Promise.all([
    count('items'),
    count('parties', q => q.eq('kind', 'customer')),
    count('parties', q => q.eq('kind', 'supplier')),
    count('sales_invoices'),
  ]);
  $('#c-items').textContent = items;
  $('#c-customers').textContent = customers;
  $('#c-suppliers').textContent = suppliers;
  $('#c-invoices').textContent = invoices;

  // إجمالي مبيعات الشهر الحالي
  const first = new Date(); first.setDate(1);
  const { data } = await sb.from('sales_invoices')
    .select('total').gte('created_at', first.toISOString());
  $('#c-sales').textContent = fmt((data || []).reduce((s, r) => s + Number(r.total), 0));

  // ── بطاقات KPI بأسلوب Manager (نفس مصادر البيانات الحالية) ──
  const _set = (id, v) => { const el = $(id); if (el) el.textContent = fmt(v); };
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [{ data: todayInv }, { data: todayVch }] = await Promise.all([
      sb.from('sales_invoices').select('total').gte('created_at', today.toISOString()),
      sb.from('vouchers').select('voucher_type, amount').gte('created_at', today.toISOString()),
    ]);
    _set('#c-today-sales', (todayInv || []).reduce((s, r) => s + Number(r.total), 0));
    _set('#c-today-receipts', (todayVch || []).filter(v => v.voucher_type === 'receipt').reduce((s, v) => s + Number(v.amount), 0));
    _set('#c-today-payments', (todayVch || []).filter(v => v.voucher_type === 'payment').reduce((s, v) => s + Number(v.amount), 0));
  } catch (_) { /* KPIs اليوم تبقى 0.00 عند أي خطأ */ }

  try {
    // رصيد الخزائن: حسابات 11xx من سطور القيود (نفس منطق تبويب السندات والخزن)
    if (!state.accounts || !state.accounts.length) await loadAccounts();
    const treasIds = new Set(treasuryAccounts().map(a => a.id));
    const { data: lines } = await sb.from('journal_entry_lines').select('account_id, debit, credit');
    _set('#c-treasury', (lines || []).filter(l => treasIds.has(l.account_id))
      .reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0));
  } catch (_) { /* يبقى 0.00 عند أي خطأ */ }

  try {
    // المتأخرات: أرصدة العملاء المدينة من v_party_balances (نفس عرض العملاء والموردون)
    if (!state.parties.length) await loadParties();
    const custIds = new Set(state.parties.filter(p => p.kind === 'customer').map(p => p.id));
    const { data: pbals } = await sb.from('v_party_balances').select('party_id, balance');
    _set('#c-overdue', (pbals || []).filter(b => custIds.has(b.party_id) && Number(b.balance) > 0)
      .reduce((s, b) => s + Number(b.balance), 0));
  } catch (_) { /* يبقى 0.00 عند أي خطأ */ }

  try {
    // صافي ربح الشهر: نفس محرك قائمة الدخل (إيرادات − مصروفات منذ بداية الشهر)
    const g = await _glData();
    const sums = _glSums(g.accs, g.lines, first.toISOString().slice(0, 10), undefined);
    let rev = 0, exp = 0;
    g.accs.forEach(a => {
      const s = sums[a.id] || { d: 0, c: 0 };
      if (a.kind === 'revenue') rev += s.c - s.d;
      if (a.kind === 'expense') exp += s.d - s.c;
    });
    _set('#c-net-profit', rev - exp);
  } catch (_) { /* يبقى 0.00 عند أي خطأ */ }
}

// ─────────── ٧) الأصناف ───────────
async function loadItems() {
  const [{ data: items }, { data: bals }] = await Promise.all([
    sb.from('items').select('*').order('name'),
    sb.from('v_item_balances').select('item_id, balance'),
  ]);
  state.items = items || [];
  const balMap = {};
  (bals || []).forEach(b => balMap[b.item_id] = (balMap[b.item_id] || 0) + Number(b.balance));
  $('#tbl-items').innerHTML = state.items.map(i => `
    <tr>
      <td>${esc(i.sku)}</td><td>${esc(i.name)}</td><td>${esc(i.unit)}</td>
      <td>${fmt(i.sale_price)}</td><td>${fmt(balMap[i.id] || 0)}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="editItem('${i.id}')">تعديل</button>
        <button class="btn btn-danger" onclick="delItem('${i.id}')">حذف</button>
      </td>
    </tr>`).join('');
}

window.editItem = (id) => itemForm(state.items.find(i => i.id === id));
$('#btn-add-item').onclick = () => itemForm(null);

function itemForm(item) {
  openModal(`
    <h3>${item ? 'تعديل صنف' : 'صنف جديد'}</h3>
    <input id="f-sku" placeholder="الكود" value="${esc(item?.sku)}">
    <input id="f-name" placeholder="اسم الصنف" value="${esc(item?.name)}">
    <input id="f-unit" placeholder="الوحدة" value="${esc(item?.unit || 'حبة')}">
    <input id="f-price" type="number" step="0.0001" placeholder="سعر البيع" value="${item?.sale_price ?? 0}">
    <div style="display:flex;gap:6px;align-items:center">
      <input id="f-barcode" dir="ltr" placeholder="الباركود (اختياري)" value="${esc(item?.barcode || '')}" style="flex:1;margin-bottom:0">
      <button class="btn btn-ghost btn-sm" id="f-bcgen" title="توليد باركود داخلي (EAN-13 يبدأ بـ 200)">توليد</button>
    </div>
    <div class="modal-actions">
      <button class="btn btn-gold" id="f-save">حفظ</button>
      <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
    </div>`);
  // توليد باركود داخلي (المرحلة 14 — procurement.js)
  $('#f-bcgen').onclick = () => {
    if (typeof makeInternalBarcode !== 'function') return;
    $('#f-barcode').value = makeInternalBarcode(Date.now() % 1e9);
  };
  $('#f-save').onclick = async () => {
    const rec = { sku: $('#f-sku').value.trim(), name: $('#f-name').value.trim(),
      unit: $('#f-unit').value.trim(), sale_price: Number($('#f-price').value) || 0,
      barcode: $('#f-barcode').value.trim() || null };
    if (!rec.name) return toast('اسم الصنف مطلوب', false);
    // تدرّج آمن: لو عمود barcode لم يُهجَّر بعد نحفظ بدونه
    if (rec.barcode === null) delete rec.barcode;
    let r;
    if (item) r = await sb.from('items').update(rec).eq('id', item.id);
    else r = await sb.from('items').insert({ ...rec, tenant_id: state.tenant });
    // تدرّج آمن: عمود barcode غير مهجَّر بعد → إعادة المحاولة بدونه
    if (r.error && rec.barcode && /barcode/i.test(r.error.message)) {
      delete rec.barcode;
      if (item) r = await sb.from('items').update(rec).eq('id', item.id);
      else r = await sb.from('items').insert({ ...rec, tenant_id: state.tenant });
      if (!r.error) toast('تنبيه: حُفظ الصنف بدون باركود — نفّذ hazem-procurement.sql', false);
    }
    if (r.error) return toast('خطأ: ' + r.error.message, false);
    toast('تم الحفظ بنجاح'); closeModal(); loadItems();
  };
}

window.delItem = async (id) => {
  if (!confirm('حذف هذا الصنف؟')) return;
  const { error } = await sb.from('items').delete().eq('id', id);
  if (error) return toast('لا يمكن الحذف: ' + error.message, false);
  toast('تم الحذف'); loadItems();
};

// ─────────── ٨) استيراد من آفاق ───────────
$('#btn-import-afaq').onclick = () => $('#file-afaq').click();

$('#file-afaq').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const rows = await parseAfaqFile(file);
    if (!rows.length) return toast('لم يتم العثور على أصناف صالحة في الملف', false);
    previewAfaq(rows);
  } catch (err) { toast('فشل قراءة الملف: ' + err.message, false); }
};

// قراءة ملف آفاق: CSV (بترميز Windows-1256 محتمل) أو XLSX
async function parseAfaqFile(file) {
  let rows = [];
  if (/\.csv$/i.test(file.name)) {
    const buf = await file.arrayBuffer();
    // نجرّب UTF-8 أولاً، وإذا ظهر حرف الاستبدال U+FFFD نستخدم windows-1256
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('\uFFFD')) text = new TextDecoder('windows-1256').decode(buf);
    rows = text.split(/\r?\n/).map(l => l.split(/[؛;]/));
  } else {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  }
  // تنسيق آفاق (من اليمين): الفرع؛الكود؛اسم الصنف؛(فارغ)؛الوحدة؛الكمية؛المخزن
  const out = [];
  for (const r of rows) {
    if (!r || r.length < 6) continue;
    const sku = String(r[1] ?? '').trim();
    const name = String(r[2] ?? '').trim();
    const unit = String(r[4] ?? '').trim() || 'حبة';
    let qty = parseFloat(String(r[5] ?? '').replace(/[,،]/g, ''));
    // تخطَّ صفوف الترويسة والتذييل
    if (!name || !sku || isNaN(qty)) continue;
    if (qty < 0) qty = 0; // الكميات السالبة → صفر
    out.push({ sku, name, unit, qty });
  }
  return out;
}

// معاينة أول 10 أصناف قبل التنفيذ
function previewAfaq(rows) {
  openModal(`
    <h3>معاينة الاستيراد — ${rows.length} صنفاً (أول 10)</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>الكود</th><th>الاسم</th><th>الوحدة</th><th>الكمية الافتتاحية</th></tr></thead>
      <tbody>${rows.slice(0, 10).map(r =>
        `<tr><td>${esc(r.sku)}</td><td>${esc(r.name)}</td><td>${esc(r.unit)}</td><td>${fmt(r.qty)}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="modal-actions">
      <button class="btn btn-gold" id="imp-run">تنفيذ الاستيراد (${rows.length})</button>
      <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
    </div>`);
  $('#imp-run').onclick = () => runAfaqImport(rows);
}

// تنفيذ: زرع items + حركة افتتاحية في المخزن الرئيسي
async function runAfaqImport(rows) {
  const { data: wh } = await sb.from('warehouses').select('id').eq('is_main', true).limit(1).single();
  if (!wh) return toast('لم يتم العثور على المخزن الرئيسي', false);

  let ok = 0, fail = 0;
  for (const r of rows) {
    // إدخال الصنف (تجاهل التكرار عبر upsert)
    const { data: item, error } = await sb.from('items')
      .upsert({ tenant_id: state.tenant, sku: r.sku, name: r.name, unit: r.unit },
              { onConflict: 'tenant_id,sku' })
      .select('id').single();
    if (error) { fail++; continue; }
    if (r.qty > 0) {
      const { error: e2 } = await sb.from('stock_movements').insert({
        tenant_id: state.tenant, item_id: item.id, warehouse_id: wh.id,
        qty: r.qty, reason: 'opening' });
      if (e2) { fail++; continue; }
    }
    ok++;
  }
  closeModal();
  toast(`اكتمل الاستيراد: ${ok} ناجح، ${fail} فاشل`, fail === 0);
  loadItems();
}

// ─────────── ٩) العملاء والموردون ───────────
async function loadParties() {
  const [{ data: parties }, { data: bals }] = await Promise.all([
    sb.from('parties').select('*').order('name'),
    sb.from('v_party_balances').select('party_id, balance'),
  ]);
  state.parties = parties || [];
  const balMap = {};
  (bals || []).forEach(b => balMap[b.party_id] = Number(b.balance));
  $('#tbl-parties').innerHTML = state.parties.map(p => `
    <tr>
      <td>${esc(p.name)}</td><td>${esc(p.phone)}</td>
      <td>${p.kind === 'customer' ? t('kind_customer') : t('kind_supplier')}</td>
      <td>${fmt(balMap[p.id] || 0)}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="editParty('${p.id}')">${t('btn_edit')}</button>
        <button class="btn btn-danger" onclick="delParty('${p.id}')">${t('btn_delete')}</button>
      </td>
    </tr>`).join('');
  // تحديث قائمة العملاء في كشف الحساب
  $('#stmt-party').innerHTML = state.parties
    .filter(p => p.kind === 'customer')
    .map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
}

window.editParty = (id) => partyForm(state.parties.find(p => p.id === id));
$('#btn-add-party').onclick = () => partyForm(null);

function partyForm(p) {
  openModal(`
    <h3>${p ? 'تعديل' : 'إضافة عميل/مورد'}</h3>
    <input id="f-pname" placeholder="الاسم" value="${esc(p?.name)}">
    <input id="f-pphone" placeholder="الجوال" value="${esc(p?.phone)}">
    <select id="f-pkind">
      <option value="customer" ${p?.kind === 'customer' ? 'selected' : ''}>عميل</option>
      <option value="supplier" ${p?.kind === 'supplier' ? 'selected' : ''}>مورد</option>
    </select>
    <div class="modal-actions">
      <button class="btn btn-gold" id="f-psave">حفظ</button>
      <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
    </div>`);
  $('#f-psave').onclick = async () => {
    const rec = { name: $('#f-pname').value.trim(), phone: $('#f-pphone').value.trim(),
      kind: $('#f-pkind').value };
    if (!rec.name) return toast(t('msg_name_req'), false);
    let r;
    if (p) r = await sb.from('parties').update(rec).eq('id', p.id);
    else r = await sb.from('parties').insert({ ...rec, tenant_id: state.tenant });
    if (r.error) return toast(t('msg_error') + ': ' + r.error.message, false);
    toast(t('msg_saved')); closeModal(); loadParties();
  };
}

window.delParty = async (id) => {
  if (!confirm(t('msg_delete_confirm_party'))) return;
  const { error } = await sb.from('parties').delete().eq('id', id);
  if (error) return toast(t('msg_delete_fail') + ': ' + error.message, false);
  toast(t('msg_deleted')); loadParties();
};

// ─────────── ١٠) فواتير المبيعات ───────────
async function loadInvoices() {
  const { data } = await sb.from('sales_invoices')
    .select('*, parties(name)').order('number', { ascending: false });
  $('#tbl-invoices').innerHTML = (data || []).map(v => `
    <tr>
      <td>${v.number}</td>
      <td>${new Date(v.created_at).toLocaleDateString('ar-EG')}</td>
      <td>${esc(v.parties?.name)}</td>
      <td>${fmt(v.total)}</td>
      <td>${v.status === 'posted' ? 'مرحّلة' : esc(v.status)}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="previewDoc('sales_invoice','${v.id}')">🖨️ معاينة</button>
          <button class="btn btn-ghost btn-sm" onclick="if(window.posReprint)posReprint('${v.id}')" title="إعادة طباعة إيصال حراري">🧾</button></td>
    </tr>`).join('');
}

$('#btn-new-invoice').onclick = () => {
  const customers = state.parties.filter(p => p.kind === 'customer');
  if (!customers.length) return toast('أضف عميلاً أولاً', false);
  if (!state.items.length) return toast('أضف صنفاً أولاً', false);
  invoiceForm();
};

function invoiceForm() {
  const itemOpts = () => state.items.map(i =>
    `<option value="${i.id}" data-price="${i.sale_price}">${esc(i.name)}</option>`).join('');

  openModal(`
    <h3>${t('frm_new_sales_invoice')}</h3>
    <label class="lbl">${t('frm_customer')}</label>
    <select id="inv-customer">
      ${state.parties.filter(p => p.kind === 'customer')
        .map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
    </select>
    <label class="lbl">${t('inv_type')}</label>
    <select id="inv-type">
      <option value="simplified">${t('inv_type_simplified')}</option>
      <option value="standard">${t('inv_type_standard')}</option>
    </select>
    <div id="inv-buyer-vat-box" class="hidden">
      <label class="lbl">${t('buyer_vat_number')}</label>
      <input id="inv-buyer-vat" dir="ltr" style="text-align:left" maxlength="15" placeholder="3xxxxxxxxxxxx3">
    </div>
    <p style="color:#7A6A5C;font-size:12px;margin:6px 0">💡 الأسعار المدخلة شاملة ضريبة القيمة المضافة — تُستخرج الضريبة تلقائياً حسب تصنيف كل بند.</p>
    <input id="inv-barcode" dir="ltr" placeholder="${t('bc_scan_ph')}" style="margin:4px 0">
    <div id="inv-lines"></div>
    <button class="btn btn-ghost btn-sm" id="inv-add-line">${t('btn_add_line')}</button>
    <div class="je-totals" style="margin-top:10px">
      <span class="t-d">${t('tot_subtotal')}: <span id="inv-subtotal">0</span></span>
      <span class="t-c">${t('tot_vat')}: <span id="inv-tax">0</span></span>
      <span class="je-balance ok">${t('tot_gross')}: <span id="inv-total">0</span></span>
    </div>
    <div class="modal-actions">
      <button class="btn btn-gold" id="inv-save">${t('btn_save_post')}</button>
      <button class="btn btn-ghost" onclick="closeModal()">${t('btn_cancel')}</button>
    </div>`);
  $('#modal-body').classList.add('modal-lg');
  // إظهار حقل الرقم الضريبي للمشتري في الفاتورة الضريبية B2B فقط
  $('#inv-type').onchange = () =>
    $('#inv-buyer-vat-box').classList.toggle('hidden', $('#inv-type').value !== 'standard');

  // سطر ديناميكي
  const addLine = () => {
    const d = document.createElement('div');
    d.className = 'inv-line';
    d.innerHTML = `
      <select class="ln-item">${itemOpts()}</select>
      <input class="ln-qty" type="number" min="0" step="any" value="1" placeholder="الكمية">
      <input class="ln-price" type="number" min="0" step="any" placeholder="السعر (شامل الضريبة)">
      <select class="ln-tax-cat" title="${t('tax_cat')}">
        <option value="standard">${t('tax_cat_standard')}</option>
        <option value="zero">${t('tax_cat_zero')}</option>
        <option value="exempt">${t('tax_cat_exempt')}</option>
        <option value="out_of_scope">${t('tax_cat_out')}</option>
      </select>
      <button class="del-line" title="حذف السطر">✕</button>`;
    const sel = d.querySelector('.ln-item');
    const priceIn = d.querySelector('.ln-price');
    // تعبئة السعر الافتراضي من سعر بيع الصنف
    const syncPrice = () => priceIn.value = sel.selectedOptions[0]?.dataset.price ?? 0;
    sel.onchange = () => { syncPrice(); calcTotal(); };
    syncPrice();
    d.querySelectorAll('input').forEach(i => i.oninput = calcTotal);
    d.querySelector('.ln-tax-cat').onchange = calcTotal;
    d.querySelector('.del-line').onclick = () => { d.remove(); calcTotal(); };
    $('#inv-lines').appendChild(d);
    calcTotal();
  };

  // حساب الإجماليات لحظياً (صافي + ضريبة + إجمالي شامل) حسب تصنيف كل بند
  function calcTotal() {
    const s = summarizeLines($$('#inv-lines .inv-line').map(l => ({
      qty: l.querySelector('.ln-qty').value,
      price: l.querySelector('.ln-price').value,
      tax_category: l.querySelector('.ln-tax-cat').value,
    })));
    $('#inv-subtotal').textContent = fmt(s.subtotal);
    $('#inv-tax').textContent = fmt(s.tax_amount);
    $('#inv-total').textContent = fmt(s.total);
  }

  $('#inv-add-line').onclick = addLine;
  addLine();
  // المرحلة 14: إدخال بالباركود — Enter يضيف سطراً بالصنف مباشرة
  $('#inv-barcode').onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    const q = e.target.value.trim();
    if (!q) return;
    const it = state.items.find(i => i.barcode === q || i.sku === q);
    if (!it) return toast(t('bc_not_found'), false);
    addLine();
    const rows = $$('#inv-lines .inv-line');
    const sel = rows[rows.length - 1].querySelector('.ln-item');
    sel.value = it.id;
    sel.dispatchEvent(new Event('change'));
    e.target.value = '';
    e.target.focus();
  };

  // الحفظ عبر RPC فقط (كتابة تشغيلية حساسة) — ثم الحقول الضريبية بتدرّج آمن
  $('#inv-save').onclick = async () => {
    const invType = $('#inv-type').value;
    const buyerVat = $('#inv-buyer-vat').value.trim();
    // الفاتورة الضريبية B2B تتطلب الرقم الضريبي للمشتري
    if (invType === 'standard' && !isValidVatNumber(buyerVat))
      return toast(t('buyer_vat_required') + ' — ' + t('tax_invalid_vat'), false);
    const lines = $$('#inv-lines .inv-line').map(l => ({
      item_id: l.querySelector('.ln-item').value,
      qty: Number(l.querySelector('.ln-qty').value),
      price: Number(l.querySelector('.ln-price').value),
      tax_category: l.querySelector('.ln-tax-cat').value,
    }));
    if (!lines.length || lines.some(l => !l.qty || l.qty <= 0))
      return toast(t('msg_check_lines'), false);
    const sum = summarizeLines(lines);
    const { data, error } = await sb.rpc('post_sales_invoice', {
      p_customer: $('#inv-customer').value,
      p_lines: lines.map(({ item_id, qty, price }) => ({ item_id, qty, price })) });
    if (error) return toast('فشل الترحيل: ' + error.message, false);
    closeModal();
    toast(`تم ترحيل فاتورة المبيعات رقم ${data} بنجاح`);
    // الحقول الضريبية + قيد الضريبة — لا تكسر الترحيل لو لم تُنفَّذ هجرات SQL بعد
    await applyInvoiceTaxMeta('sales', data, {
      invoice_type: invType, buyer_vat_number: buyerVat || null, sum, lines });
    loadInvoices();
  };
}

// ─────────── ١٠-ز) زاتكا الجيل الأول + ضريبة القيمة المضافة (دفعة ZATCA/VAT) ───────────
// قرارات التصميم (موثقة):
//   • بيانات المنشأة الضريبية تُحفظ كأعمدة على tenants (hazem-zatca-vat.sql) —
//     لا جدول جديد، فلا RLS إضافية. القراءة/الكتابة بتدرّج آمن لو لم تُنفَّذ الهجرة.
//   • أسعار البنود شاملة الضريبة (انظر vat.js) — إجمالي الفاتورة من RPC القائم
//     لا يتغير، والضريبة تُستخرج وتُرحَّل بقيد تسوية مستقل (immutable).
//   • حساب الضريبة 2200 يُنشأ من SQL أو من الواجهة عند أول حفظ للإعدادات.

state.tax = state.tax || { tax_name: '', vat_number: '', cr_number: '', national_address: '' };

// بحث مرن عن حساب بالكود أو الاسم (لتدرّج آمن مع اختلاف البذور)
function _findAccount(pred) { return (state.accounts || []).find(pred) || null; }
const _vatAccount = () => _findAccount(a => String(a.code) === '2200');
const _salesAccount = () => _findAccount(a => String(a.code).startsWith('4') && a.kind === 'revenue')
  || _findAccount(a => a.kind === 'revenue');
const _purchAccount = () => _findAccount(a => String(a.code).startsWith('5'))
  || _findAccount(a => a.kind === 'expense');

// إنشاء حساب 2200 إن لم يوجد (تدرّج آمن — الفشل لا يكسر شيئاً)
async function ensureVatAccount() {
  if (!state.accounts || !state.accounts.length) await loadAccounts();
  if (_vatAccount()) return _vatAccount();
  const { error } = await sb.from('accounts').insert({
    tenant_id: state.tenant, code: '2200',
    name: 'ضريبة القيمة المضافة المستحقة', kind: 'liability' });
  if (!error) await loadAccounts();
  return _vatAccount();
}

// تحميل الإعدادات الضريبية من tenants (بتدرّج آمن لو الأعمدة غير موجودة بعد)
async function loadTaxSettings() {
  const { data, error } = await sb.from('tenants')
    .select('tax_name, vat_number, cr_number, national_address').eq('id', state.tenant).single();
  if (!error && data) state.tax = { ...state.tax, ...data };
  const x = state.tax;
  if ($('#tax-name')) {
    $('#tax-name').value = x.tax_name || '';
    $('#tax-vat-number').value = x.vat_number || '';
    $('#tax-cr-number').value = x.cr_number || '';
    $('#tax-national-address').value = x.national_address || '';
  }
}

// فتح الإعدادات الضريبية من القائمة: تبويب الإعدادات + تمرير للصندوق
window.openTaxSettings = () => {
  switchTab('settings');
  setTimeout(() => $('#tax-settings-box')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
};

// حفظ الإعدادات الضريبية + ضمان وجود حساب الضريبة
$('#btn-save-tax').onclick = async () => {
  const rec = {
    tax_name: $('#tax-name').value.trim(),
    vat_number: $('#tax-vat-number').value.trim(),
    cr_number: $('#tax-cr-number').value.trim(),
    national_address: $('#tax-national-address').value.trim(),
  };
  if (rec.vat_number && !isValidVatNumber(rec.vat_number))
    return toast(t('tax_invalid_vat'), false);
  const { error } = await sb.from('tenants').update(rec).eq('id', state.tenant);
  if (error) return toast(t('tax_save_failed') + ': ' + error.message, false);
  state.tax = { ...state.tax, ...rec };
  await ensureVatAccount();
  toast(t('tax_saved'));
};

// ─── ما بعد ترحيل الفاتورة: الحقول الضريبية + تصنيف البنود + قيد الضريبة ───
// كل خطوة مستقلة ومغلفة بمحاولة — فشل أيٍّ منها (هجرة لم تُنفَّذ) لا يكسر الترحيل.
async function applyInvoiceTaxMeta(kind, number, { invoice_type, buyer_vat_number, sum, lines }) {
  const isSales = kind === 'sales';
  const invTable = isSales ? 'sales_invoices' : 'purchase_invoices';
  const lnTable = isSales ? 'sales_invoice_lines' : 'purchase_invoice_lines';
  const priceCol = isSales ? 'price' : 'cost';
  try {
    const { data: inv } = await sb.from(invTable).select('id').eq('number', number)
      .order('created_at', { ascending: false }).limit(1).single();
    if (!inv) return;
    // (أ) ترويسة الفاتورة: النوع + الإجماليات الضريبية
    const hdr = { subtotal: sum.subtotal, tax_amount: sum.tax_amount, total_with_tax: sum.total };
    if (isSales) { hdr.invoice_type = invoice_type; hdr.buyer_vat_number = buyer_vat_number; }
    await sb.from(invTable).update(hdr).eq('id', inv.id); // يُتجاهل الخطأ بصمت (تدرّج آمن)
    // (ب) تصنيف البنود: مطابقة بالصنف+الكمية+السعر (multiset) ثم تحديث tax_category
    try {
      const { data: dbLines } = await sb.from(lnTable)
        .select('id, item_id, qty, ' + priceCol).eq('invoice_id', inv.id);
      const pool = (lines || []).map(l => ({ ...l }));
      for (const dl of (dbLines || [])) {
        const i = pool.findIndex(l => l.item_id === dl.item_id &&
          Number(l.qty) === Number(dl.qty) && Number(l[priceCol] ?? l.price) === Number(dl[priceCol]));
        const cat = i >= 0 ? pool.splice(i, 1)[0].tax_category : 'standard';
        await sb.from(lnTable).update({ tax_category: cat }).eq('id', dl.id);
      }
    } catch (e) { /* العمود غير موجود بعد — لا شيء */ }
    // (ج) قيد تسوية الضريبة المستقل (لا يُعدَّل أي قيد قائم)
    if (sum.tax_amount > 0) {
      const vatAcc = await ensureVatAccount();
      const counter = isSales ? _salesAccount() : _purchAccount();
      if (vatAcc && counter) {
        const memo = (isSales ? 'ضريبة مخرجات فاتورة مبيعات رقم ' : 'ضريبة مدخلات فاتورة شراء رقم ') + number;
        const jLines = isSales
          ? [{ account_id: counter.id, party_id: null, debit: sum.tax_amount, credit: 0 },
             { account_id: vatAcc.id, party_id: null, debit: 0, credit: sum.tax_amount }]
          : [{ account_id: vatAcc.id, party_id: null, debit: sum.tax_amount, credit: 0 },
             { account_id: counter.id, party_id: null, debit: 0, credit: sum.tax_amount }];
        const { error } = await sb.rpc('post_manual_entry', { p_tenant: state.tenant, p_memo: memo, p_lines: jLines });
        if (error) toast('تنبيه: الفاتورة رُحّلت لكن قيد الضريبة فشل: ' + error.message, false);
      } else if (!vatAcc) {
        toast('تنبيه: حساب الضريبة 2200 غير موجود — رُحّلت الفاتورة بدون قيد ضريبة', false);
      }
    }
  } catch (e) { /* تدرّج آمن — لا نكسر الترحيل الناجح أبداً */ }
}

// ─── إقرار ضريبة القيمة المضافة لفترة ───
// جلب فواتير بأعمدة ضريبية، مع رجوع آمن للأعمدة الأساسية إن لم تُهجَّر بعد
async function _fetchInvoicesTax(table) {
  const full = await sb.from(table)
    .select('id, number, total, subtotal, tax_amount, created_at').order('created_at');
  if (!full.error) return full.data || [];
  const basic = await sb.from(table).select('id, number, total, created_at').order('created_at');
  return basic.data || [];
}

// تجميع فواتير فترة إلى خلايا الإقرار حسب التصنيف (من البنود إن توفر تصنيفها)
async function _vatSide(invTable, lnTable, priceCol, from, to) {
  const invs = (await _fetchInvoicesTax(invTable)).filter(v => _inPeriod(v.created_at, from, to));
  const hasTaxCols = invs.length ? invs[0].subtotal !== undefined : true;
  const cells = { standard: { net: 0, tax: 0 }, zero: { net: 0, tax: 0 },
                  exempt: { net: 0, tax: 0 }, out_of_scope: { net: 0, tax: 0 } };
  // محاولة التجميع من البنود (أدق — يميز التصنيفات داخل الفاتورة الواحدة)
  let byLine = null;
  try {
    const r = await sb.from(lnTable).select('invoice_id, qty, ' + priceCol + ', tax_category');
    if (!r.error) byLine = r.data || [];
  } catch (e) { byLine = null; }
  const ids = new Set(invs.map(v => v.id));
  if (byLine && hasTaxCols && byLine.some(l => l.tax_category)) {
    const grp = {};
    byLine.filter(l => ids.has(l.invoice_id)).forEach(l => {
      const s = grp[l.invoice_id] = grp[l.invoice_id] || [];
      s.push(l);
    });
    Object.values(grp).forEach(lines => {
      const s = summarizeLines(lines, priceCol);
      ['standard', 'zero', 'exempt', 'out_of_scope'].forEach(c => {
        cells[c].net = r2(cells[c].net + s[c].net);
        cells[c].tax = r2(cells[c].tax + s[c].tax);
      });
    });
  } else {
    // رجوع: الفاتورة ككل (خاضعة شاملة ما لم توجد أعمدة ضريبية)
    invs.forEach(v => {
      const t2 = invoiceVat(v);
      const c = cells[t2.cat] ? t2.cat : 'standard';
      cells[c].net = r2(cells[c].net + t2.net);
      cells[c].tax = r2(cells[c].tax + t2.tax);
    });
  }
  return cells;
}

let _vatReturnData = null; // آخر إقرار معروض (للطباعة/التصدير)

async function runVatReturn() {
  const from = $('#rep-vat-from').value, to = $('#rep-vat-to').value;
  const sales = await _vatSide('sales_invoices', 'sales_invoice_lines', 'price', from, to);
  const purch = await _vatSide('purchase_invoices', 'purchase_invoice_lines', 'cost', from, to);
  // المرحلة 15: ضريبة مدخلات سندات المصروفات تدخل خلايا مشتريات الإقرار (تدرّج آمن)
  try {
    const { data: exps } = await sb.from('expenses').select('amount, tax_amount, expense_date');
    (exps || []).filter(e => _inPeriod(e.expense_date, from, to)).forEach(e => {
      const tax = Number(e.tax_amount) || 0;
      if (tax > 0) {
        purch.standard.net = r2(purch.standard.net + (Number(e.amount) || 0) - tax);
        purch.standard.tax = r2(purch.standard.tax + tax);
      }
    });
  } catch (e) { /* جدول المصروفات غير موجود بعد — نفّذ hazem-expenses.sql */ }
  // خلايا المشتريات في الإقرار: خاضعة (قابلة للخصم) + معفاة؛ الصفري يُعرض مع الخاضع بصافيه
  const outTax = sales.standard.tax;
  const inTax = purch.standard.tax;
  const netDue = r2(outTax - inTax);
  _vatReturnData = { from, to, sales, purch, outTax, inTax, netDue };

  const row = (lbl, c) => `<tr><td>${esc(lbl)}</td><td>${fmt(c.net)}</td><td>${fmt(c.tax)}</td></tr>`;
  $('#tbl-vat-sales').innerHTML =
    row(t('vat_std_sales'), sales.standard) +
    row(t('vat_zero_sales'), sales.zero) +
    row(t('vat_exempt_sales'), sales.exempt) +
    row(t('vat_out_sales'), sales.out_of_scope);
  $('#tbl-vat-purch').innerHTML =
    row(t('vat_std_purch'), purch.standard) +
    row(t('vat_exempt_purch'), purch.exempt);
  $('#vat-out-tax').textContent = fmt(outTax);
  $('#vat-in-tax').textContent = fmt(inTax);
  $('#vat-net-due').textContent = fmt(netDue);
  const cls = netDue >= 0 ? 't-c' : 't-d';
  $('#vat-return-totals').innerHTML =
    `<span class="t-d">${t('vat_sales_sec')}: ${fmt(outTax)}</span>
     <span class="${cls}">${t('vat_net_due')}: ${fmt(netDue)}</span>
     <span class="je-balance ok">${netDue >= 0 ? 'مستحقة للهيئة' : 'رصيد دائن يُرحَّل'}</span>`;
}
$('#btn-rep-vat').onclick = runVatReturn;

// مستند الإقرار للمعاينة/الطباعة/Excel (يستخدم محرك المعاينة القائم)
function _vatReturnDoc() {
  const d = _vatReturnData;
  if (!d) { toast('اعرض الإقرار أولاً بزر «عرض الإقرار»', false); return null; }
  const row = (lbl, c) => [lbl, { txt: fmt(c.net), num: c.net }, { txt: fmt(c.tax), num: c.tax }];
  return {
    title: t('vat_return_title'),
    meta: [[t('vat_period_from'), d.from || '—'], [t('vat_period_to'), d.to || '—'],
           [t('tax_vat_number'), state.tax.vat_number || '—'],
           [t('tax_cr_number'), state.tax.cr_number || '—']],
    tables: [
      { caption: t('vat_sales_sec'), head: ['', t('col_net'), t('col_vat')], rows: [
        row(t('vat_std_sales'), d.sales.standard), row(t('vat_zero_sales'), d.sales.zero),
        row(t('vat_exempt_sales'), d.sales.exempt), row(t('vat_out_sales'), d.sales.out_of_scope)] },
      { caption: t('vat_purch_sec'), head: ['', t('col_net'), t('col_vat')], rows: [
        row(t('vat_std_purch'), d.purch.standard), row(t('vat_exempt_purch'), d.purch.exempt)] },
    ],
    totals: [t('vat_sales_sec') + ': ' + fmt(d.outTax),
             t('vat_purch_sec') + ': ' + fmt(d.inTax),
             t('vat_net_due') + ': ' + fmt(d.netDue)],
    note: t('vat_return_note'),
    fileName: 'vat-return-' + (d.from || '') + '_' + (d.to || ''),
  };
}
$('#btn-vat-print').onclick = () => { const d = _vatReturnDoc(); if (d) openPrintPreview(d); };
$('#btn-vat-excel').onclick = () => { const d = _vatReturnDoc(); if (d) exportDocExcel(d); };

// ─── دفتر أستاذ الضريبة (حساب 2200) مربوطاً بالقيود اليومية ───
async function runVatLedger() {
  const from = $('#rep-vatledger-from').value, to = $('#rep-vatledger-to').value;
  if (!state.accounts || !state.accounts.length) await loadAccounts();
  const vatAcc = _vatAccount();
  if (!vatAcc) {
    $('#tbl-vat-ledger').innerHTML = `<tr><td colspan="5" style="color:#B42318">${esc(t('vat_no_account'))}</td></tr>`;
    $('#vat-ledger-totals').innerHTML = '';
    return;
  }
  const { data, error } = await sb.from('journal_entry_lines')
    .select('debit, credit, journal_entries(created_at, memo)')
    .eq('account_id', vatAcc.id);
  if (error) return toast('خطأ: ' + error.message, false);
  const rows = (data || [])
    .filter(l => _inPeriod(l.journal_entries?.created_at, from, to))
    .sort((x, y) => new Date(x.journal_entries.created_at) - new Date(y.journal_entries.created_at));
  let run = 0, td = 0, tc = 0;
  $('#tbl-vat-ledger').innerHTML = rows.map(l => {
    run += Number(l.credit) - Number(l.debit); // التزام: الدائن موجب
    td += Number(l.debit); tc += Number(l.credit);
    return `<tr>
      <td>${new Date(l.journal_entries.created_at).toLocaleDateString('ar-EG')}</td>
      <td>${esc(l.journal_entries.memo || '')}</td>
      <td>${fmt(l.debit)}</td><td>${fmt(l.credit)}</td><td>${fmt(run)}</td></tr>`;
  }).join('') || `<tr><td colspan="5" style="color:#7A6A5C">${esc(t('vat_no_data'))}</td></tr>`;
  $('#vat-ledger-totals').innerHTML = `
    <span class="t-d">${t('col_debit')}: ${fmt(td)}</span>
    <span class="t-c">${t('col_credit')}: ${fmt(tc)}</span>
    <span class="je-balance ok">${t('col_balance')}: ${fmt(run)}</span>`;
}
$('#btn-rep-vatledger').onclick = runVatLedger;

// ─────────── ١١) تقارير ───────────
async function loadReports() {
  // (أ) أرصدة الأصناف مشتقة من stock_movements عبر view
  const { data: bals } = await sb.from('v_item_balances').select('*');
  $('#tbl-item-balances').innerHTML = (bals || []).map(b =>
    `<tr><td>${esc(b.item_name)}</td><td>${esc(b.warehouse_name)}</td><td>${fmt(b.balance)}</td></tr>`
  ).join('');
}

// (ب) كشف حساب عميل برصيد تراكمي
$('#btn-run-stmt').onclick = async () => {
  const pid = $('#stmt-party').value;
  if (!pid) return toast('اختر عميلاً', false);
  const { data, error } = await sb.from('journal_entry_lines')
    .select('debit, credit, journal_entries(created_at, memo)')
    .eq('party_id', pid);
  if (error) return toast('خطأ: ' + error.message, false);
  (data || []).sort((a, b) =>
    new Date(a.journal_entries.created_at) - new Date(b.journal_entries.created_at));
  let run = 0;
  $('#tbl-statement').innerHTML = (data || []).map(l => {
    run += Number(l.debit) - Number(l.credit);
    return `<tr>
      <td>${new Date(l.journal_entries.created_at).toLocaleDateString('ar-EG')}</td>
      <td>${esc(l.journal_entries.memo)}</td>
      <td>${fmt(l.debit)}</td><td>${fmt(l.credit)}</td><td>${fmt(run)}</td></tr>`;
  }).join('');
};

// ─────────── ١١-أ٢) التقارير الكبرى — دفعة A ───────────
// قرار التنفيذ: حساب client-side من الجداول الموجودة (نفس نمط loadAccounts و
// بطاقات الخزن في loadVouchers اللذين يجمعان journal_entry_lines في المتصفح).
// لا SQL جديد ولا views: كل الاستعلامات قراءة فقط ومحمية بسياسات RLS الحالية
// (is_member عبر state.tenant) — فلا حاجة لأي migration ولا خطر على العزل.
// القيود المحاسبية تُقرأ فقط ولا تُعدَّل أبداً.

// التابات الفرعية داخل تبويب التقارير (نفس نمط switchPurchSub/switchWhSub)
const REPORT_SUBS = ['stock', 'stmt', 'trial', 'income', 'balance', 'sales', 'purch', 'vat', 'vatledger',
  'ps', 'poopen', // المرحلة 14: مشتريات حسب المورد + أوامر شراء مفتوحة
  'aging', 'cashflow', 'margin']; // المرحلة 16: أعمار الذمم + التدفقات النقدية + هامش الربح
function switchReportSub(sub) {
  if (!REPORT_SUBS.includes(sub)) sub = 'stock';
  $$('#tab-reports .sub-tab').forEach(b => b.classList.toggle('active', b.dataset.sub === sub));
  REPORT_SUBS.forEach(s => $('#rep-pane-' + s).classList.toggle('hidden', s !== sub));
}
$$('#tab-reports .sub-tab').forEach(b => b.onclick = () => switchReportSub(b.dataset.sub));
// بنود القوائم «تقارير الحسابات» و«التقارير»: تفتح التبويب على التاب الفرعي المطلوب
window.openReport = (sub) => { switchTab('reports'); switchReportSub(sub); };

// تاريخ محلي بصيغة ISO (YYYY-MM-DD) — لتعبئة حقول الفترة افتراضياً
const _isoDate = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
  '-' + String(d.getDate()).padStart(2, '0');

// هل يقع تاريخ (ISO/ timestamptz) داخل الفترة [from, to] شاملةً الطرفين؟
function _inPeriod(iso, from, to) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (from && t < new Date(from + 'T00:00:00').getTime()) return false;
  if (to && t > new Date(to + 'T23:59:59.999').getTime()) return false;
  return true;
}

// الفترة الافتراضية: أول الشهر الحالي → اليوم
function _defaultPeriod(fromId, toId) {
  const now = new Date();
  $('#' + fromId).value = _isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  $('#' + toId).value = _isoDate(now);
}
_defaultPeriod('rep-trial-from', 'rep-trial-to');
_defaultPeriod('rep-income-from', 'rep-income-to');
_defaultPeriod('rep-sales-from', 'rep-sales-to');
_defaultPeriod('rep-purch-from', 'rep-purch-to');
_defaultPeriod('rep-vat-from', 'rep-vat-to');
_defaultPeriod('rep-vatledger-from', 'rep-vatledger-to');
$('#rep-bs-date').value = _isoDate(new Date());

// جلب الحسابات + سطور القيود (مع تاريخ القيد) — أساس التقارير المالية الثلاثة
async function _glData() {
  const [{ data: accs, error: e1 }, { data: lines, error: e2 }] = await Promise.all([
    sb.from('accounts').select('id, code, name, kind').order('code'),
    sb.from('journal_entry_lines').select('account_id, debit, credit, journal_entries(created_at)'),
  ]);
  if (e1 || e2) throw new Error((e1 || e2).message);
  return { accs: accs || [], lines: lines || [] };
}

// تجميع مدين/دائن لكل حساب ضمن فترة (from/to اختياريان — null يعني بلا حد)
function _glSums(accs, lines, from, to) {
  const sums = {};
  accs.forEach(a => sums[a.id] = { d: 0, c: 0 });
  lines.forEach(l => {
    if (!_inPeriod(l.journal_entries?.created_at, from, to)) return;
    const s = sums[l.account_id] = sums[l.account_id] || { d: 0, c: 0 };
    s.d += Number(l.debit); s.c += Number(l.credit);
  });
  return sums;
}

// ─── (١) ميزان المراجعة: كل الحسابات مدين/دائن/رصيد + إجماليات متوازنة ───
async function runTrialBalance() {
  const from = $('#rep-trial-from').value, to = $('#rep-trial-to').value;
  let g;
  try { g = await _glData(); } catch (err) { return toast('خطأ: ' + err.message, false); }
  const sums = _glSums(g.accs, g.lines, from, to);
  let td = 0, tc = 0;
  $('#tbl-rep-trial').innerHTML = g.accs.map(a => {
    const s = sums[a.id] || { d: 0, c: 0 };
    td += s.d; tc += s.c;
    const bal = s.d - s.c;
    return `<tr>
      <td>${esc(a.code)}</td><td>${esc(a.name)}</td>
      <td>${fmt(s.d)}</td><td>${fmt(s.c)}</td>
      <td style="font-weight:700;color:${bal >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(bal)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="color:#7A6A5C">لا توجد حسابات بعد</td></tr>';
  const ok = Math.abs(td - tc) < 0.0001;
  $('#rep-trial-totals').innerHTML = `
    <span class="t-d">إجمالي مدين: ${fmt(td)}</span>
    <span class="t-c">إجمالي دائن: ${fmt(tc)}</span>
    <span class="je-balance ${ok ? 'ok' : 'bad'}">${ok ? 'الميزان متوازن ✓' : 'غير متوازن ✗ — الفرق ' + fmt(td - tc)}</span>`;
}
$('#btn-rep-trial').onclick = runTrialBalance;

// ─── (٢) قائمة الدخل: إيرادات − مصروفات = صافي ربح/خسارة الفترة ───
async function runIncomeStatement() {
  const from = $('#rep-income-from').value, to = $('#rep-income-to').value;
  let g;
  try { g = await _glData(); } catch (err) { return toast('خطأ: ' + err.message, false); }
  const sums = _glSums(g.accs, g.lines, from, to);
  let totalRev = 0, totalExp = 0;
  const row = (a, amount) => `<tr><td>${esc(a.code)}</td><td>${esc(a.name)}</td>
    <td style="font-weight:700">${fmt(amount)}</td></tr>`;
  $('#tbl-rep-income-rev').innerHTML = g.accs.filter(a => a.kind === 'revenue').map(a => {
    const s = sums[a.id] || { d: 0, c: 0 };
    const bal = s.c - s.d; // طبيعة الإيراد دائنة
    totalRev += bal;
    return row(a, bal);
  }).join('') || '<tr><td colspan="3" style="color:#7A6A5C">لا توجد حسابات إيرادات</td></tr>';
  $('#tbl-rep-income-exp').innerHTML = g.accs.filter(a => a.kind === 'expense').map(a => {
    const s = sums[a.id] || { d: 0, c: 0 };
    const bal = s.d - s.c; // طبيعة المصروف مدينة
    totalExp += bal;
    return row(a, bal);
  }).join('') || '<tr><td colspan="3" style="color:#7A6A5C">لا توجد حسابات مصروفات</td></tr>';
  const net = totalRev - totalExp;
  $('#rep-income-net').innerHTML = `
    <span class="t-d">إجمالي الإيرادات: ${fmt(totalRev)}</span>
    <span class="t-c">إجمالي المصروفات: ${fmt(totalExp)}</span>
    <span class="je-balance ${net >= 0 ? 'ok' : 'bad'}">${net >= 0 ? 'صافي ربح' : 'صافي خسارة'}: ${fmt(Math.abs(net))}</span>`;
}
$('#btn-rep-income').onclick = runIncomeStatement;

// ─── (٣) الميزانية العمومية حتى تاريخ: أصول = التزامات + حقوق ملكية + صافي ربح الفترة ───
async function runBalanceSheet() {
  const to = $('#rep-bs-date').value;
  let g;
  try { g = await _glData(); } catch (err) { return toast('خطأ: ' + err.message, false); }
  const sums = _glSums(g.accs, g.lines, null, to); // من البداية حتى التاريخ
  const row = (a, amount) => `<tr><td>${esc(a.code)}</td><td>${esc(a.name)}</td>
    <td style="font-weight:700">${fmt(amount)}</td></tr>`;
  let ta = 0, tl = 0, te = 0, rev = 0, exp = 0;
  $('#tbl-rep-bs-assets').innerHTML = g.accs.filter(a => a.kind === 'asset').map(a => {
    const s = sums[a.id] || { d: 0, c: 0 };
    ta += s.d - s.c;
    return row(a, s.d - s.c);
  }).join('') || '<tr><td colspan="3" style="color:#7A6A5C">لا توجد حسابات أصول</td></tr>';
  $('#tbl-rep-bs-liab').innerHTML = g.accs.filter(a => a.kind === 'liability').map(a => {
    const s = sums[a.id] || { d: 0, c: 0 };
    tl += s.c - s.d;
    return row(a, s.c - s.d);
  }).join('') || '<tr><td colspan="3" style="color:#7A6A5C">لا توجد حسابات التزامات</td></tr>';
  $('#tbl-rep-bs-equity').innerHTML = g.accs.filter(a => a.kind === 'equity').map(a => {
    const s = sums[a.id] || { d: 0, c: 0 };
    te += s.c - s.d;
    return row(a, s.c - s.d);
  }).join('') || '<tr><td colspan="3" style="color:#7A6A5C">لا توجد حسابات حقوق ملكية</td></tr>';
  g.accs.forEach(a => {
    const s = sums[a.id] || { d: 0, c: 0 };
    if (a.kind === 'revenue') rev += s.c - s.d;
    if (a.kind === 'expense') exp += s.d - s.c;
  });
  const netProfit = rev - exp; // صافي ربح/خسارة الفترة حتى ذلك التاريخ
  const otherSide = tl + te + netProfit;
  const ok = Math.abs(ta - otherSide) < 0.0001;
  $('#rep-bs-totals').innerHTML = `
    <span class="t-d">إجمالي الأصول: ${fmt(ta)}</span>
    <span class="t-c">الالتزامات + حقوق الملكية + صافي الربح (${fmt(netProfit)}): ${fmt(otherSide)}</span>
    <span class="je-balance ${ok ? 'ok' : 'bad'}">${ok ? 'المعادلة متوازنة ✓' : 'غير متوازنة ✗ — الفرق ' + fmt(ta - otherSide)}</span>`;
}
$('#btn-rep-bs').onclick = runBalanceSheet;

// ─── (٤+٥) تقارير المبيعات/المشتريات: إجمالي + عدد + متوسط + أصناف + أطراف ───
// kind: 'sales' (sales_invoices/lines بسعر price) أو 'purch' (purchase_invoices/lines بتكلفة cost)
async function runTradeReport(kind) {
  const isSales = kind === 'sales';
  const from = $('#rep-' + kind + '-from').value, to = $('#rep-' + kind + '-to').value;
  const invTable = isSales ? 'sales_invoices' : 'purchase_invoices';
  const lnTable = isSales ? 'sales_invoice_lines' : 'purchase_invoice_lines';
  const priceCol = isSales ? 'price' : 'cost';

  const { data: invs, error: e1 } = await sb.from(invTable)
    .select('id, number, total, created_at, parties(name)');
  if (e1) return toast('خطأ: ' + e1.message, false);
  // سطور الأصناف: قد لا تتوفر لكل المستندات — نتدرّج بأمان دون كسر التقرير
  const lr = await sb.from(lnTable)
    .select('qty, ' + priceCol + ', items(name), ' + invTable + '(created_at)');

  const invList = (invs || []).filter(v => _inPeriod(v.created_at, from, to));
  const total = invList.reduce((s, v) => s + Number(v.total), 0);
  const count = invList.length;
  $('#rep-' + kind + '-total').textContent = fmt(total);
  $('#rep-' + kind + '-count').textContent = fmt(count);
  $('#rep-' + kind + '-avg').textContent = fmt(count ? total / count : 0);

  // أكثر الأصناف (كمية/قيمة) — مرتبة تنازلياً بالقيمة
  if (lr.error) {
    $('#tbl-rep-' + kind + '-items').innerHTML =
      '<tr><td colspan="3" style="color:#7A6A5C">تفصيل الأصناف غير متاح لهذه المستندات</td></tr>';
  } else {
    const byItem = {};
    (lr.data || []).forEach(l => {
      if (!_inPeriod(l[invTable]?.created_at, from, to)) return;
      const name = l.items?.name || '—';
      const s = byItem[name] = byItem[name] || { qty: 0, val: 0 };
      s.qty += Number(l.qty);
      s.val += Number(l.qty) * Number(l[priceCol]);
    });
    const items = Object.entries(byItem).sort((a, b) => b[1].val - a[1].val);
    $('#tbl-rep-' + kind + '-items').innerHTML = items.map(([name, s]) =>
      `<tr><td>${esc(name)}</td><td>${fmt(s.qty)}</td><td>${fmt(s.val)}</td></tr>`
    ).join('') || '<tr><td colspan="3" style="color:#7A6A5C">لا توجد حركات في هذه الفترة</td></tr>';
  }

  // التوزيع حسب الطرف (عميل/مورد) — مرتب تنازلياً بالإجمالي
  const byParty = {};
  invList.forEach(v => {
    const name = v.parties?.name || '—';
    const s = byParty[name] = byParty[name] || { n: 0, t: 0 };
    s.n++; s.t += Number(v.total);
  });
  const parties = Object.entries(byParty).sort((a, b) => b[1].t - a[1].t);
  $('#tbl-rep-' + kind + (isSales ? '-cust' : '-supp')).innerHTML = parties.map(([name, s]) =>
    `<tr><td>${esc(name)}</td><td>${fmt(s.n)}</td><td>${fmt(s.t)}</td></tr>`
  ).join('') || '<tr><td colspan="3" style="color:#7A6A5C">لا توجد فواتير في هذه الفترة</td></tr>';
}
$('#btn-rep-sales').onclick = () => runTradeReport('sales');
$('#btn-rep-purch').onclick = () => runTradeReport('purch');

// ─────────── ١١-ب) الهوية والإعدادات — شعار الشركة لكل مستأجر ───────────
// 🔒 الشعار الرسمي (النسر) ثابت في كل الواجهات — ملك للبرنامج ولا يتغير أبداً.
// شعار الشركة المرفوع يظهر فقط داخل لوحة حسابها (بجانب اسم الشركة في الأعلى).

// تطبيق شعار الشركة على لوحتها فقط — لا يمس هوية النظام الرسمية
function applyBrandLogo() {
  const tl = $('#tenant-logo');
  if (!tl) return;
  if (state.logoUrl) { tl.src = state.logoUrl; tl.classList.remove('hidden'); }
  else { tl.removeAttribute('src'); tl.classList.add('hidden'); }
}

// تعبئة شاشة الإعدادات
function loadSettings() {
  $('#set-company-name').textContent = state.tenantName || '—';
  const prev = $('#set-logo-preview');
  if (state.logoUrl) { prev.src = state.logoUrl; prev.classList.remove('hidden'); $('#no-logo-msg').classList.add('hidden'); }
  else { prev.removeAttribute('src'); prev.classList.add('hidden'); $('#no-logo-msg').classList.remove('hidden'); }
  $('#logo-file-name').textContent = '';
  $('#set-logo-file').value = '';
}

let _logoFile = null;

// زر اختيار الصورة يفتح مربع حوار الملفات
$('#btn-pick-logo').onclick = () => $('#set-logo-file').click();

// معاينة فورية عند اختيار ملف
$('#set-logo-file').onchange = (e) => {
  const f = e.target.files[0];
  if (!f) { _logoFile = null; return; }
  const okExt = /\.(png|jpe?g|svg|webp)$/i.test(f.name);
  if (!okExt) { _logoFile = null; return toast('صيغة غير مدعومة — المسموح: PNG / JPG / SVG / WebP', false); }
  if (f.size > 2 * 1024 * 1024) { _logoFile = null; return toast('حجم الصورة أكبر من 2 ميجا', false); }
  _logoFile = f;
  $('#logo-file-name').textContent = '📎 ' + f.name + ' (' + Math.round(f.size / 1024) + ' ك.ب)';
  const rd = new FileReader();
  rd.onload = () => { const p = $('#set-logo-preview'); p.src = rd.result; p.classList.remove('hidden'); $('#no-logo-msg').classList.add('hidden'); };
  rd.readAsDataURL(f);
};

// حفظ الشعار: رفع على Storage ثم تحديث tenants.logo_url
$('#btn-save-logo').onclick = async () => {
  if (!_logoFile) return toast('اختر صورة أولاً بزر «اختيار صورة»', false);
  const ext = (_logoFile.name.match(/\.([a-z0-9]+)$/i) || [null, 'png'])[1].toLowerCase();
  const path = state.tenant + '/logo.' + ext;
  const { error: upErr } = await sb.storage.from('logos').upload(path, _logoFile, { upsert: true });
  if (upErr) return toast('فشل رفع الصورة: ' + upErr.message + ' — تأكد أنك نفّذت ملف hazem-branding.sql', false);
  const { data: pub } = sb.storage.from('logos').getPublicUrl(path);
  const url = pub.publicUrl + '?v=' + Date.now(); // كسر الكاش ليظهر الجديد فوراً
  const { error: tErr } = await sb.from('tenants').update({ logo_url: url }).eq('id', state.tenant);
  if (tErr) return toast('فشل حفظ الرابط: ' + tErr.message, false);
  state.logoUrl = url;
  _logoFile = null;
  applyBrandLogo();
  loadSettings();
  toast('تم حفظ شعار شركتك — هيظهر في لوحتك فقط ✅');
};

// إزالة شعار الشركة (الشعار الرسمي للنظام لا يتأثر — ثابت دائماً)
$('#btn-reset-logo').onclick = async () => {
  const { error } = await sb.from('tenants').update({ logo_url: null }).eq('id', state.tenant);
  if (error) return toast('فشلت الإزالة: ' + error.message, false);
  state.logoUrl = null;
  applyBrandLogo();
  loadSettings();
  toast('تمت إزالة شعار الشركة من لوحتك');
};

// ─────────── ١١-ج) تصدير نسخة كاملة من البرنامج (ZIP) ───────────
// المالك يجهّز نسخة جاهزة للحرق على فلاشة/DVD/CD وتسليمها للعملاء.
// ملاحظة: config.js لا يُجلب من السيرفر — يولَّد قالب نظيف بلا مفاتيح.

function loadDownloadTab() {
  const st = $('#dl-status');
  if (st) st.textContent = '';
  if (!$('#dl-version').value.trim()) $('#dl-version').value = '1.0.0';
}

// ─────────── ١١-د) لوحة المطوّر — لمالك النظام فقط ───────────
// البيانات تجي من دوال security definer في hazem-dev-panel.sql
// والحماية النهائية في فحص الإيميل داخل الدالة نفسها في قاعدة البيانات.
async function loadDevPanel() {
  // تهيئة قسم تحميل النسخة (صار جزءاً من لوحة المطوّر)
  loadDownloadTab();

  // (أ) إحصائيات المنصة
  const { data: stats, error: e1 } = await sb.rpc('dev_platform_stats');
  if (e1) {
    const msg = /غير مصرح/.test(e1.message)
      ? 'غير مصرح — تأكد أن الإيميل في hazem-dev-panel.sql و config.js هو نفس إيميل دخولك'
      : 'فشل جلب إحصائيات المنصة: ' + e1.message;
    return toast(msg, false);
  }
  $('#dv-tenants').textContent  = fmt(stats.tenants);
  $('#dv-users').textContent    = fmt(stats.users);
  $('#dv-invoices').textContent = fmt(stats.invoices);
  $('#dv-parties').textContent  = fmt(stats.parties);
  $('#dv-items').textContent    = fmt(stats.items);

  // (ب) قائمة الشركات المشتركة
  const { data: companies, error: e2 } = await sb.rpc('dev_list_companies');
  if (e2) return toast('فشل جلب قائمة الشركات: ' + e2.message, false);
  $('#dv-companies').innerHTML = (companies || []).map(c => `
    <tr>
      <td>${esc(c.company_name)}</td>
      <td>${c.created_at ? new Date(c.created_at).toLocaleDateString('ar-EG') : '—'}</td>
      <td>${fmt(c.members)}</td>
      <td>${fmt(c.invoices_count)}</td>
    </tr>`).join('') || '<tr><td colspan="4" style="color:#7A6A5C">لا توجد شركات بعد</td></tr>';
}

// قالب config.js للنسخة المُصدَّرة (بدون أي مفاتيح حقيقية)
const DL_CONFIG_TEMPLATE =
'/* ═══════════════════════════════════════════════\n' +
'   HAZEM.ERP SYSTEM MANAGER — ملف إعداد الاتصال بقاعدة البيانات\n' +
'   ضع مفاتيح مشروع Supabase الخاص بك في السطرين التاليين:\n' +
'   (Project Settings ← API ← Project URL و anon public key)\n' +
'   ═══════════════════════════════════════════════ */\n' +
'const HAZEM_SUPABASE_URL = "PUT_YOUR_URL";      // ← رابط المشروع، مثال: https://xxxx.supabase.co\n' +
'const HAZEM_SUPABASE_KEY = "PUT_YOUR_ANON_KEY"; // ← مفتاح anon public\n';

// صفحة Launcher «ابدأ-هنا.html» بنفس الهوية البصرية
function dlLauncherHtml(version, customer) {
  return '<!DOCTYPE html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="UTF-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'<title>HAZEM.ERP SYSTEM MANAGER — ابدأ هنا</title>\n<style>\n' +
'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#FFFFFF;color:#1C1712;font-family:Tahoma,Arial,sans-serif;direction:rtl;padding:20px;box-sizing:border-box}\n' +
'.card{max-width:560px;width:100%;background:#FAF6F1;border:1px solid #E7DDD1;border-top:5px solid #B42318;border-radius:18px;padding:36px;text-align:center;box-shadow:0 10px 30px rgba(28,23,18,.08)}\n' +
'img.logo{width:110px;height:110px;object-fit:contain;margin-bottom:14px}\n' +
'h1{margin:0 0 4px;color:#1C1712;font-size:26px}h1 span{color:#B42318}\n' +
'.sub{color:#7B4B26;margin:0 0 22px;font-size:14px}\n' +
'.btn{display:block;background:#B42318;color:#fff;text-decoration:none;font-weight:700;font-size:18px;padding:14px;border-radius:12px;margin-bottom:14px}\n' +
'.links a{color:#7B4B26;text-decoration:none;font-size:13px;margin:0 8px}\n' +
'.meta{color:#7A6A5C;font-size:12px;margin-top:18px;line-height:1.9}\n' +
'</style>\n</head>\n<body>\n<div class="card">\n' +
'<img class="logo" src="logo.png" alt="HAZEM.ERP" onerror="this.style.display=\'none\'">\n' +
'<h1>HAZEM.ERP <span>SYSTEM MANAGER</span></h1>\n' +
'<p class="sub">نظام محاسبة وإدارة مخزون متكامل</p>\n' +
'<a class="btn" href="index.html">🚀 تشغيل البرنامج</a>\n' +
'<div class="links"><a href="اقرأني-التثبيت.txt">📖 دليل التثبيت</a> · <a href="VERSION.txt">ℹ️ معلومات الإصدار</a></div>\n' +
'<div class="meta">الإصدار: ' + esc(version) + (customer ? '<br>مرخَّص لصالح: ' + esc(customer) : '') + '</div>\n' +
'</div>\n</body>\n</html>\n';
}

// دليل التثبيت العربي «اقرأني-التثبيت.txt»
function dlReadmeTxt(version, customer, dateStr) {
  return [
'═══════════════════════════════════════════════════════',
'   HAZEM.ERP SYSTEM MANAGER — دليل التثبيت خطوة بخطوة',
'═══════════════════════════════════════════════════════',
'',
'الإصدار: ' + version + (customer ? '   |   مرخَّص لصالح: ' + customer : '') + '   |   تاريخ التصدير: ' + dateStr,
'',
'النسخة تحتوي: كل ملفات النظام + قاعدة البيانات (schema.sql و hazem-branding.sql) + هذا الدليل.',
'',
'── الخطوة 1: إنشاء مشروع Supabase مجاني ──',
'1) افتح https://supabase.com وأنشئ حساباً مجانياً.',
'2) اضغط New Project واختر اسماً وكلمة مرور لقاعدة البيانات واحفظها.',
'',
'── الخطوة 2: إنشاء قاعدة البيانات ──',
'1) داخل المشروع افتح SQL Editor من القائمة الجانبية.',
'2) افتح ملف schema.sql بنص عادي، انسخ محتواه كاملاً والصقه في SQL Editor ثم اضغط Run.',
'3) كرر نفس الخطوة مع ملف hazem-branding.sql (مرة واحدة فقط لكل ملف).',
'',
'── الخطوة 3: ضبط ملف config.js ──',
'1) في Supabase افتح: Project Settings ← API.',
'2) انسخ Project URL وضعه مكان PUT_YOUR_URL في ملف config.js.',
'3) انسخ anon public key وضعه مكان PUT_YOUR_ANON_KEY في نفس الملف.',
'',
'── الخطوة 4: النشر والتشغيل ──',
'اختر أحد الخيارات:',
'أ) GitHub Pages: أنشئ مستودعاً مجانياً، ارفع كل الملفات، وفعّل Pages من الإعدادات.',
'ب) أي استضافة ملفات ثابتة (Netlify / Vercel / استضافة عادية): ارفع الملفات كما هي.',
'ج) تشغيل محلي: شغّل سيرفر بسيطاً في المجلد مثل: python -m http.server ثم افتح المتصفح على العنوان الظاهر.',
'',
'── الخطوة 5: أول استخدام ──',
'1) افتح الموقع، اضغط «إنشاء حساب جديد» وسجّل بريدك وكلمة مرور.',
'2) أنشئ شركتك من شاشة البداية وابدأ العمل فوراً.',
'',
'ملاحظة: لتشغيل البرنامج يحتاج العميل اتصالاً بالإنترنت (قاعدة البيانات سحابية).',
'بالتوفيق! — فريق HAZEM.ERP SYSTEM MANAGER',
  ].join('\r\n');
}

// جمع الملفات من المسارات النسبية وبناء حزمة ZIP وتحميلها
$('#btn-build-package').onclick = async () => {
  const version = $('#dl-version').value.trim() || '1.0.0';
  const customer = $('#dl-customer').value.trim();
  const includeLogo = $('#dl-include-logo').checked;
  const st = $('#dl-status');
  const setStatus = (t) => { st.textContent = t; };
  try {
    if (typeof JSZip === 'undefined') throw new Error('مكتبة الضغط JSZip لم تُحمَّل — تحقق من الاتصال بالإنترنت');

    setStatus('⏳ جاري جمع الملفات...');
    const files = ['index.html', 'app.js', 'styles.css', 'schema.sql', 'hazem-branding.sql'];
    if (includeLogo) files.push('logo.png');

    const zip = new JSZip();
    for (const f of files) {
      const res = await fetch(f);
      if (!res.ok) throw new Error('تعذر جلب الملف: ' + f);
      zip.file(f, await res.blob());
    }

    // config.js: قالب نظيف بدون مفاتيح حقيقية
    zip.file('config.js', DL_CONFIG_TEMPLATE);

    // ملفات إضافية داخل الحزمة
    const dateStr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
    zip.file('اقرأني-التثبيت.txt', dlReadmeTxt(version, customer, dateStr));
    zip.file('ابدأ-هنا.html', dlLauncherHtml(version, customer));
    zip.file('VERSION.txt',
      'HAZEM.ERP SYSTEM MANAGER\r\n' +
      'الإصدار: ' + version + '\r\n' +
      'تاريخ التصدير: ' + dateStr + '\r\n' +
      'المرخَّص له: ' + (customer || 'غير محدد') + '\r\n');

    setStatus('⏳ جاري الضغط...');
    const blob = await zip.generateAsync({ type: 'blob' });

    // تحميل عبر رابط مؤقت
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = 'H-ERP-SYSTEM-MANAGER-v' + version + '.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    setStatus('تم ✅ — تم تحميل النسخة ' + a.download);
    toast('تم تجهيز النسخة وتحميلها بنجاح ✅');
  } catch (err) {
    setStatus('❌ فشل التجهيز');
    toast('فشل تجهيز النسخة: ' + err.message, false);
  }
};

// ─────────── ١١-هـ) الأستاذ العام: شجرة الحسابات + قيود اليومية ───────────
const ACCOUNT_KINDS = {
  asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية',
  revenue: 'إيرادات', expense: 'مصروفات',
};
let _glSeeded = false; // زرع الحسابات الافتراضية مرة واحدة لكل جلسة

async function loadAccounts() {
  // زرع شجرة الحسابات الافتراضية عند أول فتح (الدالة idempotent)
  if (!_glSeeded) {
    const { error } = await sb.rpc('seed_default_accounts', { p_tenant: state.tenant });
    if (error) toast('تعذر تجهيز الحسابات الافتراضية: ' + error.message, false);
    else _glSeeded = true;
  }
  const [{ data: accs }, { data: lines }] = await Promise.all([
    sb.from('accounts').select('*').order('code'),
    sb.from('journal_entry_lines').select('account_id, debit, credit'),
  ]);
  state.accounts = accs || [];
  const sums = {};
  (lines || []).forEach(l => {
    const s = sums[l.account_id] = sums[l.account_id] || { d: 0, c: 0 };
    s.d += Number(l.debit); s.c += Number(l.credit);
  });
  $('#tbl-accounts').innerHTML = state.accounts.map(a => {
    const s = sums[a.id] || { d: 0, c: 0 };
    return `<tr>
      <td>${esc(a.code)}</td><td>${esc(a.name)}</td>
      <td>${ACCOUNT_KINDS[a.kind] || esc(a.kind || '—')}</td>
      <td>${fmt(s.d)}</td><td>${fmt(s.c)}</td><td>${fmt(s.d - s.c)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" style="color:#7A6A5C">لا توجد حسابات بعد</td></tr>';
}

$('#btn-add-account').onclick = () => {
  openModal(`
    <h3>حساب جديد</h3>
    <label class="lbl">الكود (4 أرقام)</label>
    <input id="f-acode" inputmode="numeric" maxlength="4" placeholder="مثال: 1120">
    <label class="lbl">اسم الحساب</label>
    <input id="f-aname" placeholder="اسم الحساب">
    <label class="lbl">النوع</label>
    <select id="f-akind">
      ${Object.entries(ACCOUNT_KINDS).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}
    </select>
    <div class="modal-actions">
      <button class="btn btn-gold" id="f-asave">حفظ</button>
      <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
    </div>`);
  $('#f-asave').onclick = async () => {
    const rec = { p_tenant: state.tenant, p_code: $('#f-acode').value.trim(),
      p_name: $('#f-aname').value.trim(), p_kind: $('#f-akind').value };
    if (!rec.p_code || !rec.p_name) return toast('أدخل الكود والاسم', false);
    const { error } = await sb.rpc('add_account', rec);
    if (error) return toast('خطأ: ' + error.message, false);
    toast('تمت إضافة الحساب بنجاح'); closeModal(); loadAccounts();
  };
};

// ─── قيود اليومية: القائمة ───
async function loadJournal() {
  const [{ data: entries }, { data: lines }] = await Promise.all([
    sb.from('journal_entries').select('*')
      .order('number', { ascending: false }).limit(50),
    sb.from('journal_entry_lines').select('entry_id, debit, credit'),
  ]);
  const sums = {};
  (lines || []).forEach(l => {
    const s = sums[l.entry_id] = sums[l.entry_id] || { d: 0, c: 0 };
    s.d += Number(l.debit); s.c += Number(l.credit);
  });
  $('#tbl-journal').innerHTML = (entries || []).map(e => {
    const s = sums[e.id] || { d: 0, c: 0 };
    return `<tr>
      <td>${e.number}</td>
      <td>${new Date(e.created_at).toLocaleDateString('ar-EG')}</td>
      <td>${esc(e.memo || '—')}</td>
      <td>${fmt(s.d)}</td><td>${fmt(s.c)}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="viewEntry('${e.id}')">عرض</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" style="color:#7A6A5C">لا توجد قيود بعد</td></tr>';
}

// تفاصيل قيد (قراءة فقط — السطور لا تُعدَّل ولا تُحذف)
window.viewEntry = async (id) => {
  const { data, error } = await sb.from('journal_entry_lines')
    .select('debit, credit, accounts(code, name), parties(name)')
    .eq('entry_id', id);
  if (error) return toast('خطأ: ' + error.message, false);
  openModal(`
    <h3>تفاصيل القيد</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>الحساب</th><th>الطرف</th><th>مدين</th><th>دائن</th></tr></thead>
      <tbody>${(data || []).map(l => `<tr>
        <td>${esc(l.accounts?.code)} — ${esc(l.accounts?.name)}</td>
        <td>${esc(l.parties?.name || '—')}</td>
        <td>${fmt(l.debit)}</td><td>${fmt(l.credit)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="modal-actions"><button class="btn btn-gold" onclick="closeModal()">إغلاق</button></div>`);
};

// ─── نموذج قيد (جديد / افتتاحي) ───
async function entryForm(opening = false) {
  if (!state.accounts || !state.accounts.length) await loadAccounts();
  if (!state.accounts.length) return toast('أضف حساباً أولاً من شجرة الحسابات', false);
  if (!state.parties.length) await loadParties();

  const accOpts = () => state.accounts.map(a =>
    `<option value="${a.id}">${esc(a.code)} — ${esc(a.name)}</option>`).join('');
  const partyOpts = () => '<option value="">— بدون طرف —</option>' + state.parties.map(p =>
    `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const today = new Date().toISOString().slice(0, 10);

  openModal(`
    <h3>${opening ? 'قيد افتتاحي' : 'قيد يومية جديد'}</h3>
    <div class="row">
      <div><label class="lbl">التاريخ</label><input type="date" id="je-date" value="${today}"></div>
      <div><label class="lbl">البيان</label><input id="je-memo" placeholder="بيان القيد" value="${opening ? 'قيد افتتاحي' : ''}"></div>
      <div><label class="lbl">مركز التكلفة (اختياري)</label><select id="je-cc"><option value="">— بدون —</option></select></div>
    </div>
    <div id="je-lines"></div>
    <button class="btn btn-ghost btn-sm" id="je-add-line">+ إضافة سطر</button>
    <div class="je-totals">
      <span class="t-d">إجمالي مدين: <span id="je-total-d">0</span></span>
      <span class="t-c">إجمالي دائن: <span id="je-total-c">0</span></span>
      <span class="je-balance bad" id="je-balance">غير متوازن ✗</span>
    </div>
    <div class="modal-actions">
      <button class="btn btn-gold" id="je-save" disabled>حفظ وترحيل</button>
      <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
    </div>`);
  // توسيع النافذة لسطور القيد
  $('#modal-body').classList.add('modal-lg');

  // المرحلة 15: تعبئة مراكز التكلفة (تحميل كسول — تدرّج آمن لو الجدول غير موجود بعد)
  (async () => {
    try {
      if (!state.costCenters) {
        const { data } = await sb.from('cost_centers').select('id, code, name').order('code');
        state.costCenters = data || [];
      }
      const sel = $('#je-cc');
      if (sel) sel.innerHTML = '<option value="">— بدون —</option>' +
        (state.costCenters || []).map(c => `<option value="${c.id}">${esc(c.code)} — ${esc(c.name)}</option>`).join('');
    } catch (e) { /* نفّذ hazem-expenses.sql أولاً */ }
  })();  const addLine = () => {
    const d = document.createElement('div');
    d.className = 'je-line';
    d.innerHTML = `
      <select class="je-acc">${accOpts()}</select>
      <select class="je-party">${partyOpts()}</select>
      <input class="je-debit" type="number" min="0" step="any" placeholder="مدين">
      <input class="je-credit" type="number" min="0" step="any" placeholder="دائن">
      <button class="del-line" title="حذف السطر">✕</button>`;
    // مدين/دائن متبادلان: تعبئة أحدهما تصفّر الآخر
    const dIn = d.querySelector('.je-debit'), cIn = d.querySelector('.je-credit');
    dIn.oninput = () => { if (Number(dIn.value) > 0) cIn.value = ''; recalc(); };
    cIn.oninput = () => { if (Number(cIn.value) > 0) dIn.value = ''; recalc(); };
    d.querySelector('.del-line').onclick = () => { d.remove(); recalc(); };
    $('#je-lines').appendChild(d);
    recalc();
  };

  function recalc() {
    let td = 0, tc = 0, n = 0;
    $$('#je-lines .je-line').forEach(l => {
      td += Number(l.querySelector('.je-debit').value) || 0;
      tc += Number(l.querySelector('.je-credit').value) || 0;
      n++;
    });
    $('#je-total-d').textContent = fmt(td);
    $('#je-total-c').textContent = fmt(tc);
    const balanced = n >= 2 && td > 0 && td === tc;
    const ind = $('#je-balance');
    ind.textContent = balanced ? 'متوازن ✓' : 'غير متوازن ✗';
    ind.className = 'je-balance ' + (balanced ? 'ok' : 'bad');
    $('#je-save').disabled = !balanced;
  }

  $('#je-add-line').onclick = addLine;
  addLine(); addLine();

  $('#je-save').onclick = async () => {
    const ccId = $('#je-cc') ? ($('#je-cc').value || null) : null;
    const lines = $$('#je-lines .je-line').map(l => ({
      account_id: l.querySelector('.je-acc').value,
      party_id: l.querySelector('.je-party').value || null,
      debit: Number(l.querySelector('.je-debit').value) || 0,
      credit: Number(l.querySelector('.je-credit').value) || 0,
      ...(ccId ? { cost_center_id: ccId } : {}),
    }));
    // المرحلة 16: رفض الترحيل في فترة مقفلة (القيد يُحفظ بتاريخه الحالي — نفحص تاريخ النموذج)
    if (typeof window.checkPeriodLock === 'function' &&
        window.checkPeriodLock(($('#je-date') && $('#je-date').value) || new Date().toISOString().slice(0, 10))) return;
    // المرحلة 15: ترحيل مع محاولة تمرير مركز التكلفة والرجوع الآمن بدونه
    if (ccId && typeof window.__postEntryWithCc === 'function') {
      const posted = await window.__postEntryWithCc($('#je-memo').value.trim(), lines);
      if (!posted) return;
      closeModal();
      toast(`تم ترحيل القيد رقم ${posted?.number ?? ''} بنجاح`);
      return loadJournal();
    }
    const { data, error } = await sb.rpc('post_manual_entry', {
      p_tenant: state.tenant, p_memo: $('#je-memo').value.trim(), p_lines: lines });
    if (error) return toast('فشل الترحيل: ' + error.message, false);
    closeModal();
    toast(`تم ترحيل القيد رقم ${data?.number ?? ''} بنجاح`);
    loadJournal();
  };
}

$('#btn-new-entry').onclick = () => entryForm(false);
window.openOpeningEntry = () => entryForm(true);

// إعادة ضبط قياس النافذة المنبثقة عند الإغلاق
const _origCloseModal = closeModal;
closeModal = function () { $('#modal-body').classList.remove('modal-lg'); _origCloseModal(); };
window.closeModal = closeModal;

// ─────────── ١١-و) المعاملات المالية: السندات والخزن ───────────
// أنواع السندات واتجاهات قيودها (المنطق النهائي في دالة create_voucher):
//   receipt:  مدين حساب الخزينة (to) / دائن الحساب المقابل 1200 العملاء (from)
//   payment:  مدين الحساب المقابل 2100 الموردون (from) / دائن الخزينة (to)
//   transfer: مدين الخزينة المحوَّل إليها (to) / دائن المحوَّل منها (from)
const VOUCHER_TYPES = { receipt: 'سند قبض', payment: 'سند صرف', transfer: 'تحويل بين الخزن' };
// الحساب المقابل الافتراضي لكل نوع حسب كوده في شجرة الحسابات
const VOUCHER_COUNTER_CODE = { receipt: '1200', payment: '2100' };

// حسابات الخزن/الصناديق: أصول أكوادها تبدأ بـ 11 (1100 النقدية، 1110 البنك...)
function treasuryAccounts() {
  return (state.accounts || []).filter(a => a.kind === 'asset' && String(a.code).startsWith('11'));
}

// تحميل التبويب: بطاقات أرصدة الخزن + جدول السندات
async function loadVouchers() {
  // ضمان وجود الحسابات والأطراف (زرع الحسابات الافتراضية عند الحاجة)
  if (!state.accounts || !state.accounts.length) await loadAccounts();
  if (!state.parties.length) await loadParties();

  const [{ data: vouchers }, { data: lines }] = await Promise.all([
    sb.from('vouchers').select('*, parties(name)').order('number', { ascending: false }).limit(100),
    sb.from('journal_entry_lines').select('account_id, debit, credit'),
  ]);

  // بطاقات أرصدة الخزن من سطور القيود (مدين - دائن)
  const sums = {};
  (lines || []).forEach(l => {
    sums[l.account_id] = (sums[l.account_id] || 0) + Number(l.debit) - Number(l.credit);
  });
  $('#vch-treasury-cards').innerHTML = treasuryAccounts().map(a => `
    <div class="card treasury-card">
      <div class="card-num">${fmt(sums[a.id] || 0)}</div>
      <div class="card-lbl">${esc(a.code)} — ${esc(a.name)}</div>
    </div>`).join('') ||
    '<div class="card"><div class="card-lbl">لا توجد حسابات خزن (11xx) — أضفها من شجرة الحسابات</div></div>';

  // جدول السندات — الأحدث أولاً
  state.vouchers = vouchers || []; // يستخدمه محرك المعاينة (دفعة B)
  $('#tbl-vouchers').innerHTML = (vouchers || []).map(v => `
    <tr>
      <td>${v.number}</td>
      <td>${new Date(v.created_at).toLocaleDateString('ar-EG')}</td>
      <td>${VOUCHER_TYPES[v.voucher_type] || esc(v.voucher_type)}</td>
      <td>${esc(v.parties?.name || '—')}</td>
      <td>${fmt(v.amount)}</td>
      <td>${esc(v.memo || '—')}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="previewVoucher('${v.id}')">🖨️ معاينة</button></td>
    </tr>`).join('') || '<tr><td colspan="7" style="color:#7A6A5C">لا توجد سندات بعد</td></tr>';
}

// نموذج سند (قبض / صرف / تحويل)
async function voucherForm(type) {
  if (!VOUCHER_TYPES[type]) return;
  if (!state.accounts || !state.accounts.length) await loadAccounts();
  if (!state.parties.length) await loadParties();

  const treas = treasuryAccounts();
  if (!treas.length) return toast('لا توجد حسابات خزن (11xx) — أضفها من شجرة الحسابات أولاً', false);

  const treasOpts = () => treas.map(a =>
    `<option value="${a.id}">${esc(a.code)} — ${esc(a.name)}</option>`).join('');

  let partyField = '';
  let counterAcc = null;
  if (type !== 'transfer') {
    // الحساب المقابل: 1200 العملاء للقبض / 2100 الموردون للصرف
    counterAcc = state.accounts.find(a => a.code === VOUCHER_COUNTER_CODE[type]);
    if (!counterAcc) return toast('حساب ' + VOUCHER_COUNTER_CODE[type] + ' غير موجود — زرع الحسابات الافتراضية من شجرة الحسابات', false);
    if (!state.parties.length) return toast('أضف عميلاً/مورداً أولاً من شاشة العملاء والموردون', false);
    // قبض: العملاء أولاً / صرف: الموردون أولاً — مع إتاحة كل الأطراف
    const preferred = type === 'receipt' ? 'customer' : 'supplier';
    const sorted = [...state.parties].sort((a, b) =>
      (a.kind === preferred ? 0 : 1) - (b.kind === preferred ? 0 : 1));
    partyField = `
      <label class="lbl">${type === 'receipt' ? 'الطرف (العميل)' : 'الطرف (المورد)'}</label>
      <select id="vch-party">
        ${sorted.map(p => `<option value="${p.id}">${esc(p.name)} (${p.kind === 'customer' ? 'عميل' : 'مورد'})</option>`).join('')}
      </select>`;
  }

  const isTransfer = type === 'transfer';
  openModal(`
    <h3>${VOUCHER_TYPES[type]}</h3>
    ${partyField}
    <div class="row">
      ${isTransfer ? `<div><label class="lbl">من خزينة</label><select id="vch-from">${treasOpts()}</select></div>` : ''}
      <div><label class="lbl">${isTransfer ? 'إلى خزينة' : (type === 'receipt' ? 'الخزينة/البنك المستلِم' : 'الخزينة/البنك المدفوع منه')}</label>
        <select id="vch-to">${treasOpts()}</select></div>
    </div>
    <label class="lbl">المبلغ</label>
    <input id="vch-amount" type="number" min="0" step="any" placeholder="0.00">
    <label class="lbl">البيان</label>
    <input id="vch-memo" placeholder="بيان السند (اختياري)">
    <div class="modal-actions">
      <button class="btn btn-gold" id="vch-save">حفظ السند</button>
      <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
    </div>`);
  $('#vch-amount').focus();

  $('#vch-save').onclick = async () => {
    const amount = Number($('#vch-amount').value) || 0;
    if (amount <= 0) return toast('أدخل مبلغاً أكبر من صفر', false);
    const fromAcc = isTransfer ? $('#vch-from').value : counterAcc.id;
    const toAcc = isTransfer ? $('#vch-to').value : $('#vch-to').value;
    if (isTransfer && fromAcc === toAcc) return toast('لا يمكن التحويل من حساب إلى نفسه — اختر خزنتين مختلفتين', false);
    const { data, error } = await sb.rpc('create_voucher', {
      p_tenant: state.tenant,
      p_type: type,
      p_party: isTransfer ? null : $('#vch-party').value,
      p_from_account: fromAcc,
      p_to_account: toAcc,
      p_amount: amount,
      p_memo: $('#vch-memo').value.trim() || null,
    });
    if (error) return toast('فشل حفظ السند: ' + error.message, false);
    closeModal();
    toast(`تم حفظ ${VOUCHER_TYPES[type]} رقم ${data?.number ?? ''} بنجاح`);
    loadVouchers();
  };
}

$('#btn-vch-receipt').onclick = () => voucherForm('receipt');
$('#btn-vch-payment').onclick = () => voucherForm('payment');
$('#btn-vch-transfer').onclick = () => voucherForm('transfer');

// بنود قائمة «معاملات مالية» الكلاسيكية: تفتح التبويب ثم نموذج السند مباشرة
window.openVoucher = (type) => { switchTab('vouchers'); voucherForm(type); };

// ─────────── ١١-ز) المشتريات + المرتجعات + عروض الأسعار ───────────
// قرار التصميم: مرتجعات المشتريات تعيش داخل تبويب «المشتريات» كتاب-فرعي بجانب
// فواتير الشراء، ومرتجعات المبيعات في تبويب مستقل «المرتجعات» لأن زرها وبند
// قائمتها في المبيعات — كده كل مستند جنب أقرب شاشة له.
//
// اتجاهات القيود (المنطق النهائي في hazem-purchases.sql):
//   فاتورة شراء:    مدين 1300 المخزون  / دائن 2100 الموردون + مخزون موجب
//   مرتجع مشتريات:  مدين 2100 الموردون / دائن 1300 المخزون  + مخزون سالب
//   مرتجع مبيعات:   مدين 4100 المبيعات / دائن 1200 العملاء  + مخزون موجب
//   عرض أسعار:      بلا قيد وبلا مخزون
const DOC_KINDS = {
  purchase_invoice: { title: 'فاتورة شراء جديدة',   party: 'supplier', partyLbl: 'المورد',
    priceField: 'cost',  priceLbl: 'التكلفة', rpc: 'create_purchase_invoice',
    done: (d) => `تم حفظ فاتورة الشراء رقم ${d?.number ?? ''} بنجاح (الإجمالي ${fmt(d?.total)})` },
  purchase_return:  { title: 'مرتجع مشتريات جديد',  party: 'supplier', partyLbl: 'المورد',
    priceField: 'cost',  priceLbl: 'التكلفة', rpc: 'create_purchase_return',
    done: (d) => `تم حفظ مرتجع المشتريات رقم ${d?.number ?? ''} بنجاح` },
  sales_return:     { title: 'مرتجع مبيعات جديد',   party: 'customer', partyLbl: 'العميل',
    priceField: 'price', priceLbl: 'السعر',   rpc: 'create_sales_return',
    done: (d) => `تم حفظ مرتجع المبيعات رقم ${d?.number ?? ''} بنجاح` },
  quote:            { title: 'عرض أسعار جديد',      party: 'customer', partyLbl: 'العميل',
    priceField: 'price', priceLbl: 'السعر',   rpc: 'create_quote',
    done: (d) => `تم حفظ عرض الأسعار رقم ${d?.number ?? ''} بنجاح` },
};

// ─── تحميل الجداول ───
async function loadPurchases() {
  const [{ data: invs }, { data: rets }] = await Promise.all([
    sb.from('purchase_invoices').select('*, parties(name)').order('number', { ascending: false }),
    sb.from('purchase_returns').select('*, parties(name)').order('number', { ascending: false }),
  ]);
  $('#tbl-purchases').innerHTML = (invs || []).map(v => `
    <tr>
      <td>${v.number}</td>
      <td>${new Date(v.created_at).toLocaleDateString('ar-EG')}</td>
      <td>${esc(v.parties?.name)}</td>
      <td>${fmt(v.total)}</td>
      <td>${v.status === 'posted' ? 'مرحّلة' : esc(v.status)}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="previewDoc('purchase_invoice','${v.id}')">🖨️ معاينة</button></td>
    </tr>`).join('') || '<tr><td colspan="6" style="color:#7A6A5C">لا توجد فواتير شراء بعد</td></tr>';
  $('#tbl-purchase-returns').innerHTML = (rets || []).map(v => `
    <tr>
      <td>${v.number}</td>
      <td>${new Date(v.created_at).toLocaleDateString('ar-EG')}</td>
      <td>${esc(v.parties?.name)}</td>
      <td>${fmt(v.total)}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="previewDoc('purchase_return','${v.id}')">🖨️ معاينة</button></td>
    </tr>`).join('') || '<tr><td colspan="5" style="color:#7A6A5C">لا توجد مرتجعات مشتريات بعد</td></tr>';
}

async function loadSalesReturns() {
  const { data } = await sb.from('sales_returns')
    .select('*, parties(name)').order('number', { ascending: false });
  $('#tbl-sales-returns').innerHTML = (data || []).map(v => `
    <tr>
      <td>${v.number}</td>
      <td>${new Date(v.created_at).toLocaleDateString('ar-EG')}</td>
      <td>${esc(v.parties?.name)}</td>
      <td>${fmt(v.total)}</td>
      <td>${esc(v.memo || '—')}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="previewDoc('sales_return','${v.id}')">🖨️ معاينة</button></td>
    </tr>`).join('') || '<tr><td colspan="6" style="color:#7A6A5C">لا توجد مرتجعات مبيعات بعد</td></tr>';
}

const QUOTE_STATUS = { open: 'مفتوح', converted: 'محوَّل لفاتورة', cancelled: 'ملغي' };

async function loadQuotes() {
  const { data } = await sb.from('quotes')
    .select('*, parties(name)').order('number', { ascending: false });
  state.quotes = data || [];
  $('#tbl-quotes').innerHTML = state.quotes.map(q => `
    <tr>
      <td>${q.number}</td>
      <td>${new Date(q.created_at).toLocaleDateString('ar-EG')}</td>
      <td>${esc(q.parties?.name)}</td>
      <td>${fmt(q.total)}</td>
      <td>${QUOTE_STATUS[q.status] || esc(q.status)}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="previewDoc('quote','${q.id}')">🖨️ معاينة</button>${q.status === 'open' ? `
        <button class="btn btn-gold btn-sm" onclick="convertQuote('${q.id}')">تحويل لفاتورة</button>
        <button class="btn btn-danger" onclick="cancelQuote('${q.id}')">إلغاء</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" style="color:#7A6A5C">لا توجد عروض أسعار بعد</td></tr>';
}

// ─── تحويل / إلغاء عرض الأسعار ───
window.convertQuote = async (id) => {
  const q = (state.quotes || []).find(x => x.id === id);
  if (!q) return;
  if (!confirm(`تحويل عرض الأسعار رقم ${q.number} إلى فاتورة مبيعات حقيقية؟\nسيتم ترحيل القيد وتخفيض المخزون.`)) return;
  const { data, error } = await sb.rpc('convert_quote_to_invoice', { p_tenant: state.tenant, p_quote: id });
  if (error) return toast('فشل التحويل: ' + error.message, false);
  toast(`تم التحويل ✅ — فاتورة المبيعات رقم ${data?.invoice_number ?? ''}`);
  loadQuotes();
  loadInvoices();
  loadItems(); // تحديث الأرصدة بعد حركة المخزون
};

window.cancelQuote = async (id) => {
  const q = (state.quotes || []).find(x => x.id === id);
  if (!q) return;
  if (!confirm(`إلغاء عرض الأسعار رقم ${q.number}؟`)) return;
  const { error } = await sb.rpc('cancel_quote', { p_tenant: state.tenant, p_quote: id });
  if (error) return toast('فشل الإلغاء: ' + error.message, false);
  toast(`تم إلغاء عرض الأسعار رقم ${q.number}`);
  loadQuotes();
};

// ─── نموذج مستند موحد (فاتورة شراء / مرتجع / عرض أسعار) ───
async function docForm(kind) {
  const K = DOC_KINDS[kind];
  if (!K) return;
  const isPurchInv = kind === 'purchase_invoice'; // الضريبة على فواتير الشراء فقط في هذه الدفعة
  if (!state.parties.length) await loadParties();
  if (!state.items.length) await loadItems();
  const parties = state.parties.filter(p => p.kind === K.party);
  if (!parties.length) return toast(`أضف ${K.party === 'supplier' ? 'مورداً' : 'عميلاً'} أولاً`, false);
  if (!state.items.length) return toast('أضف صنفاً أولاً', false);

  const itemOpts = () => state.items.map(i =>
    `<option value="${i.id}" data-price="${i.sale_price}">${esc(i.name)}</option>`).join('');

  openModal(`
    <h3>${K.title}</h3>
    <label class="lbl">${K.partyLbl}</label>
    <select id="doc-party">
      ${parties.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
    </select>
    ${isPurchInv ? `<p style="color:#7A6A5C;font-size:12px;margin:6px 0">💡 التكاليف المدخلة شاملة الضريبة — تُستخرج ضريبة المدخلات تلقائياً حسب تصنيف كل بند.</p>` : ''}
    <input id="doc-barcode" dir="ltr" placeholder="${t('bc_scan_ph')}" style="margin:4px 0">
    <div id="doc-lines"></div>
    <button class="btn btn-ghost btn-sm" id="doc-add-line">+ إضافة سطر</button>
    <div class="inv-total">الإجمالي: <span id="doc-total">0</span></div>
    ${isPurchInv ? `<div class="je-totals" style="margin-top:8px">
      <span class="t-d">${t('tot_subtotal')}: <span id="doc-subtotal">0</span></span>
      <span class="t-c">${t('tot_vat')}: <span id="doc-tax">0</span></span>
    </div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-gold" id="doc-save">حفظ وترحيل</button>
      <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
    </div>`);
  $('#modal-body').classList.add('modal-lg');

  // سطر ديناميكي: صنف + كمية + (تكلفة|سعر) + إجمالي سطر لحظي
  const addLine = () => {
    const d = document.createElement('div');
    d.className = 'inv-line doc-line';
    d.innerHTML = `
      <select class="ln-item">${itemOpts()}</select>
      <input class="ln-qty" type="number" min="0" step="any" value="1" placeholder="الكمية">
      <input class="ln-price" type="number" min="0" step="any" placeholder="${K.priceLbl}${isPurchInv ? ' (شامل الضريبة)' : ''}">
      ${isPurchInv ? `<select class="ln-tax-cat" title="${t('tax_cat')}">
        <option value="standard">${t('tax_cat_standard')}</option>
        <option value="zero">${t('tax_cat_zero')}</option>
        <option value="exempt">${t('tax_cat_exempt')}</option>
        <option value="out_of_scope">${t('tax_cat_out')}</option>
      </select>` : ''}
      <span class="ln-sum" style="font-weight:700;color:#7B4B26">0</span>
      <button class="del-line" title="حذف السطر">✕</button>`;
    const sel = d.querySelector('.ln-item');
    const priceIn = d.querySelector('.ln-price');
    const syncPrice = () => { if (!priceIn.value) priceIn.value = sel.selectedOptions[0]?.dataset.price ?? 0; };
    sel.onchange = () => { priceIn.value = sel.selectedOptions[0]?.dataset.price ?? 0; calcTotal(); };
    syncPrice();
    d.querySelectorAll('input').forEach(i => i.oninput = calcTotal);
    if (isPurchInv) d.querySelector('.ln-tax-cat').onchange = calcTotal;
    d.querySelector('.del-line').onclick = () => { d.remove(); calcTotal(); };
    $('#doc-lines').appendChild(d);
    calcTotal();
  };

  // حساب إجمالي كل سطر وإجمالي المستند لحظياً
  function calcTotal() {
    let t = 0;
    $$('#doc-lines .doc-line').forEach(l => {
      const sum = (Number(l.querySelector('.ln-qty').value) || 0) *
                  (Number(l.querySelector('.ln-price').value) || 0);
      l.querySelector('.ln-sum').textContent = fmt(sum);
      t += sum;
    });
    $('#doc-total').textContent = fmt(t);
    if (isPurchInv) {
      const s = summarizeLines($$('#doc-lines .doc-line').map(l => ({
        qty: l.querySelector('.ln-qty').value, price: l.querySelector('.ln-price').value,
        tax_category: l.querySelector('.ln-tax-cat').value })));
      $('#doc-subtotal').textContent = fmt(s.subtotal);
      $('#doc-tax').textContent = fmt(s.tax_amount);
    }
  }

  $('#doc-add-line').onclick = addLine;
  addLine();
  // المرحلة 14: إدخال بالباركود — Enter يضيف سطراً بالصنف مباشرة
  $('#doc-barcode').onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    const q = e.target.value.trim();
    if (!q) return;
    const it = state.items.find(i => i.barcode === q || i.sku === q);
    if (!it) return toast(t('bc_not_found'), false);
    addLine();
    const rows = $$('#doc-lines .doc-line');
    const sel = rows[rows.length - 1].querySelector('.ln-item');
    sel.value = it.id;
    sel.dispatchEvent(new Event('change'));
    e.target.value = '';
    e.target.focus();
  };

  // الحفظ عبر RPC فقط (كتابة تشغيلية حساسة — القيد والمخزون داخل الدالة ذرياً)
  $('#doc-save').onclick = async () => {
    const lines = $$('#doc-lines .doc-line').map(l => ({
      item_id: l.querySelector('.ln-item').value,
      qty: Number(l.querySelector('.ln-qty').value),
      [K.priceField]: Number(l.querySelector('.ln-price').value),
      ...(isPurchInv ? { tax_category: l.querySelector('.ln-tax-cat').value } : {}),
    }));
    if (!lines.length) return toast('أضف سطراً واحداً على الأقل', false);
    if (lines.some(l => !l.qty || l.qty <= 0))
      return toast('تحقق من السطور (كمية > 0)', false);
    if (lines.some(l => l[K.priceField] < 0))
      return toast(K.priceLbl + ' لا يمكن أن يكون سالباً', false);
    const params = { p_tenant: state.tenant, p_lines: lines };
    if (K.party === 'supplier') params.p_supplier = $('#doc-party').value;
    else params.p_customer = $('#doc-party').value;
    const { data, error } = await sb.rpc(K.rpc, params);
    if (error) return toast('فشل الحفظ: ' + error.message, false);
    closeModal();
    toast(K.done(data));
    // فاتورة الشراء: الحقول الضريبية + قيد ضريبة المدخلات (تدرّج آمن)
    if (isPurchInv && data && data.number != null) {
      const sum = summarizeLines(lines, 'cost');
      await applyInvoiceTaxMeta('purch', data.number, { sum, lines });
    }
    // تحديث الجداول والمخزون بعد كل عملية ناجحة
    loadItems();
    if (kind === 'purchase_invoice' || kind === 'purchase_return') loadPurchases();
    if (kind === 'sales_return') loadSalesReturns();
    if (kind === 'quote') loadQuotes();
  };
}

// أزرار التبويبات
$('#btn-new-purchase').onclick = () => docForm('purchase_invoice');
$('#btn-new-purchase-return').onclick = () => docForm('purchase_return');
$('#btn-new-sales-return').onclick = () => docForm('sales_return');
$('#btn-new-quote').onclick = () => docForm('quote');

// بنود القوائم الكلاسيكية: تفتح التبويب المناسب وتفتح النموذج مباشرة (نمط السندات)
window.openPurchaseInvoice = () => { switchTab('purchases'); docForm('purchase_invoice'); };
window.openPurchaseReturn  = () => { switchTab('purchases'); switchPurchSub('pr'); docForm('purchase_return'); };
window.openSalesReturn     = () => { switchTab('returns'); docForm('sales_return'); };
window.openQuote           = () => { switchTab('quotes'); docForm('quote'); };

// التابات الفرعية داخل تبويب المشتريات
function switchPurchSub(sub) {
  $$('#tab-purchases .sub-tab').forEach(b => b.classList.toggle('active', b.dataset.sub === sub));
  ['pi', 'pr', 'po', 'cdn'].forEach(s => {
    const p = $('#purch-pane-' + s);
    if (p) p.classList.toggle('hidden', s !== sub);
  });
  // المرحلة 14: أوامر الشراء + الإشعارات (procurement.js — حارس التعريف)
  if (sub === 'po' && typeof loadPurchaseOrders === 'function') loadPurchaseOrders();
  if (sub === 'cdn' && typeof loadCreditNotes === 'function') loadCreditNotes();
}
$$('#tab-purchases .sub-tab').forEach(b => b.onclick = () => switchPurchSub(b.dataset.sub));

// ─────────── ١١-ح) المخازن: المستودعات + التحويل + الجرد ───────────
// قرارات التصميم (المنطق النهائي في hazem-warehouse-pos.sql):
//   • الأرصدة مشتقة من stock_movements عبر v_item_balances — لا يوجد رصيد مُخزَّن.
//   • التحويل = حركتان ذريتان (transfer_out سالبة + transfer_in موجبة بنفس ref_id).
//   • الجرد = حركة تسوية adjustment بالفرق (فعلي - دفتري) لكل صنف مختلف فقط.
//   • البنود الثلاثة في القائمة تفتح تبويباً واحداً «tab-warehouses» بتابات فرعية.
let _whSub = 'list'; // التاب الفرعي الحالي

function switchWhSub(sub) {
  _whSub = sub;
  $$('#tab-warehouses .sub-tab').forEach(b => b.classList.toggle('active', b.dataset.sub === sub));
  $('#wh-pane-list').classList.toggle('hidden', sub !== 'list');
  $('#wh-pane-transfer').classList.toggle('hidden', sub !== 'transfer');
  $('#wh-pane-count').classList.toggle('hidden', sub !== 'count');
  if (sub === 'transfer') loadTransfers();
  if (sub === 'count') loadCount();
}
$$('#tab-warehouses .sub-tab').forEach(b => b.onclick = () => switchWhSub(b.dataset.sub));
window.openWarehouses = (sub) => { switchTab('warehouses'); switchWhSub(sub || 'list'); };

// تحميل المستودعات + الأرصدة المجمعة (للاستخدام في التابات الثلاثة)
async function loadWarehouses() {
  const [{ data: whs }, { data: bals }] = await Promise.all([
    sb.from('warehouses').select('*').order('name'),
    sb.from('v_item_balances').select('item_id, warehouse_id, balance'),
  ]);
  state.warehouses = whs || [];
  state.balances = bals || [];

  // جدول المستودعات: عدد الأصناف ذات الرصيد + إجمالي القطع
  const stats = {};
  state.balances.forEach(b => {
    const s = stats[b.warehouse_id] = stats[b.warehouse_id] || { items: 0, qty: 0 };
    if (Number(b.balance) !== 0) { s.items++; s.qty += Number(b.balance); }
  });
  $('#tbl-warehouses').innerHTML = state.warehouses.map(w => {
    const s = stats[w.id] || { items: 0, qty: 0 };
    return `<tr>
      <td>${esc(w.name)}</td>
      <td>${w.is_main ? '⭐ رئيسي' : 'فرعي'}</td>
      <td>${fmt(s.items)}</td><td>${fmt(s.qty)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" style="color:#7A6A5C">لا توجد مستودعات بعد</td></tr>';

  // تحديث قوائم المستودعات في الجرد
  $('#count-wh').innerHTML = state.warehouses.map(w =>
    `<option value="${w.id}">${esc(w.name)}</option>`).join('');
}

// رصيد صنف في مستودع (من الأرصدة المشتقة المحمّلة)
function balanceOf(itemId, whId) {
  return (state.balances || [])
    .filter(b => b.item_id === itemId && b.warehouse_id === whId)
    .reduce((s, b) => s + Number(b.balance), 0);
}

// ─── إضافة مستودع ───
$('#btn-add-warehouse').onclick = () => {
  openModal(`
    <h3>مستودع جديد</h3>
    <label class="lbl">اسم المستودع</label>
    <input id="f-whname" placeholder="مثال: مخزن الفرع الثاني">
    <div class="modal-actions">
      <button class="btn btn-gold" id="f-whsave">حفظ</button>
      <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
    </div>`);
  $('#f-whname').focus();
  $('#f-whsave').onclick = async () => {
    const name = $('#f-whname').value.trim();
    if (!name) return toast('اسم المستودع مطلوب', false);
    const { error } = await sb.rpc('add_warehouse', { p_tenant: state.tenant, p_name: name });
    if (error) return toast('خطأ: ' + error.message, false);
    toast('تمت إضافة المستودع «' + name + '» بنجاح');
    closeModal(); loadWarehouses();
  };
};

// ─── التحويل بين المستودعات: سجل التحويلات الأخيرة ───
async function loadTransfers() {
  // نجمع الحركتين (خروج/دخول) بـ ref_id المشترك لعرض «من → إلى»
  const { data: mvts } = await sb.from('stock_movements')
    .select('item_id, warehouse_id, qty, reason, ref_id, created_at, items(name), warehouses(name)')
    .in('reason', ['transfer_out', 'transfer_in'])
    .order('created_at', { ascending: false }).limit(200);
  const pairs = {};
  (mvts || []).forEach(m => {
    const p = pairs[m.ref_id] = pairs[m.ref_id] || {};
    if (m.reason === 'transfer_out') { p.out = m; p.date = m.created_at; }
    else p.in = m;
  });
  const rows = Object.values(pairs).filter(p => p.out && p.in).slice(0, 50);
  $('#tbl-transfers').innerHTML = rows.map(p => `
    <tr>
      <td>${new Date(p.date).toLocaleDateString('ar-EG')}</td>
      <td>${esc(p.out.items?.name)}</td>
      <td>${esc(p.out.warehouses?.name)}</td>
      <td>${esc(p.in.warehouses?.name)}</td>
      <td>${fmt(p.in.qty)}</td>
    </tr>`).join('') || '<tr><td colspan="5" style="color:#7A6A5C">لا توجد تحويلات بعد</td></tr>';
}

// ─── نموذج تحويل جديد (مع الرصيد المتاح في المصدر لحظياً) ───
$('#btn-new-transfer').onclick = async () => {
  if (!state.warehouses || !state.warehouses.length) await loadWarehouses();
  if (!state.items.length) await loadItems();
  if (state.warehouses.length < 2) return toast('أضف مستودعاً ثانياً أولاً من تبويب «المستودعات»', false);
  if (!state.items.length) return toast('أضف صنفاً أولاً', false);

  const whOpts = () => state.warehouses.map(w =>
    `<option value="${w.id}">${esc(w.name)}${w.is_main ? ' ⭐' : ''}</option>`).join('');

  openModal(`
    <h3>تحويل بين المستودعات</h3>
    <label class="lbl">الصنف</label>
    <select id="tr-item">${state.items.map(i =>
      `<option value="${i.id}">${esc(i.name)}</option>`).join('')}</select>
    <div class="row">
      <div><label class="lbl">من مستودع</label><select id="tr-from">${whOpts()}</select></div>
      <div><label class="lbl">إلى مستودع</label><select id="tr-to">${whOpts()}</select></div>
    </div>
    <div class="logo-note" id="tr-avail">الرصيد المتاح في المصدر: —</div>
    <label class="lbl">الكمية</label>
    <input id="tr-qty" type="number" min="0" step="any" value="1">
    <div class="modal-actions">
      <button class="btn btn-gold" id="tr-save">تنفيذ التحويل</button>
      <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
    </div>`);
  // الوجهة الافتراضية: أول مستودع مختلف عن المصدر
  $('#tr-to').selectedIndex = state.warehouses.length > 1 ? 1 : 0;

  const syncAvail = () => {
    const avail = balanceOf($('#tr-item').value, $('#tr-from').value);
    $('#tr-avail').textContent = 'الرصيد المتاح في المصدر: ' + fmt(avail);
    $('#tr-avail').style.borderRightColor = avail > 0 ? 'var(--green)' : 'var(--red)';
    return avail;
  };
  $('#tr-item').onchange = syncAvail;
  $('#tr-from').onchange = syncAvail;
  syncAvail();

  $('#tr-save').onclick = async () => {
    const qty = Number($('#tr-qty').value) || 0;
    if (qty <= 0) return toast('أدخل كمية أكبر من صفر', false);
    if ($('#tr-from').value === $('#tr-to').value)
      return toast('لا يمكن التحويل من مستودع إلى نفسه', false);
    const { data, error } = await sb.rpc('transfer_stock', {
      p_tenant: state.tenant, p_item: $('#tr-item').value,
      p_from_wh: $('#tr-from').value, p_to_wh: $('#tr-to').value, p_qty: qty });
    if (error) return toast('فشل التحويل: ' + error.message, false);
    closeModal();
    toast(`تم تحويل ${fmt(qty)} من «${data?.item ?? ''}» بنجاح ✅`);
    await loadWarehouses(); // تحديث الأرصدة المشتقة
    loadTransfers();
    loadItems();
  };
};

// ─── الجرد: رصيد دفتري + عدد فعلي + فرق لحظي ───
async function loadCount() {
  if (!state.warehouses || !state.warehouses.length) await loadWarehouses();
  if (!state.items.length) await loadItems();
  const whId = $('#count-wh').value;
  $('#tbl-count').innerHTML = state.items.map(i => {
    const book = balanceOf(i.id, whId);
    return `<tr data-item="${i.id}" data-book="${book}">
      <td>${esc(i.name)}</td>
      <td class="cnt-book">${fmt(book)}</td>
      <td><input class="cnt-actual" type="number" min="0" step="any" value="${book}" style="margin:0;padding:8px;max-width:130px"></td>
      <td class="cnt-diff" style="font-weight:700">0</td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" style="color:#7A6A5C">لا توجد أصناف</td></tr>';
  // الفرق يتحدث لحظياً مع كل إدخال
  $$('#tbl-count .cnt-actual').forEach(inp => inp.oninput = () => {
    const tr = inp.closest('tr');
    const diff = (Number(inp.value) || 0) - Number(tr.dataset.book);
    const cell = tr.querySelector('.cnt-diff');
    cell.textContent = (diff > 0 ? '+' : '') + fmt(diff);
    cell.style.color = diff === 0 ? 'var(--muted)' : (diff > 0 ? 'var(--green)' : 'var(--red)');
  });
}
$('#count-wh').onchange = loadCount;

// اعتماد التسوية: adjust_stock للأصناف المختلفة فقط
$('#btn-apply-count').onclick = async () => {
  const whId = $('#count-wh').value;
  if (!whId) return toast('اختر مستودعاً أولاً', false);
  const changed = $$('#tbl-count tr[data-item]').map(tr => ({
    item_id: tr.dataset.item,
    book: Number(tr.dataset.book),
    counted: Number(tr.querySelector('.cnt-actual').value) || 0,
  })).filter(r => r.counted !== r.book);
  if (!changed.length) return toast('لا توجد فروقات — كل الأصناف مطابقة للدفتري ✅');
  if (!confirm(`اعتماد تسوية الجرد لـ ${changed.length} صنفاً مختلفاً؟\nسيتم تسجيل حركة تسوية بالفرق لكل منها.`)) return;
  let ok = 0, failed = [];
  for (const r of changed) {
    const { data, error } = await sb.rpc('adjust_stock', {
      p_tenant: state.tenant, p_item: r.item_id, p_wh: whId,
      p_counted: r.counted, p_memo: 'تسوية جرد' });
    if (error) failed.push(error.message);
    else if (Number(data?.diff ?? 0) !== (r.counted - r.book)) failed.push('فرق غير متوقع');
    else ok++;
  }
  if (failed.length) toast('بعض التسويات فشلت: ' + failed[0], false);
  else toast(`تم اعتماد تسوية الجرد لـ ${ok} صنفاً بنجاح ✅`);
  await loadWarehouses();
  loadCount();
  loadItems();
};

// ─────────── ١١-ط) نقاط البيع: شاشة الكاشير + الورديات ───────────
// قرارات التصميم (المنطق النهائي في hazem-warehouse-pos.sql):
//   • «عميل نقدي» يُنشأ تلقائياً أول مرة (customer_id إلزامي) والقيد نقدي:
//     مدين 1100 الخزينة / دائن 4100 المبيعات (بدون طرف) + مخزون سالب من
//     المستودع الافتراضي، والفاتورة مرتبطة بالوردية عبر shift_id.
//   • الوردية لكل مستخدم — لا يمكن فتح ورديتين مفتوحتين لنفس الكاشير.
let _cart = []; // سلة الكاشير الحالية [{item_id, name, price, qty}]

// ورديتي المفتوحة حالياً (إن وجدت)
async function myOpenShift() {
  const { data } = await sb.from('pos_shifts').select('*')
    .eq('cashier', state.user.id).eq('status', 'open')
    .order('number', { ascending: false }).limit(1);
  return (data || [])[0] || null;
}

async function loadPos() {
  if (!state.items.length) await loadItems();
  state.shift = await myOpenShift();
  const open = !!state.shift;
  $('#pos-open').classList.toggle('hidden', open);
  $('#pos-screen').classList.toggle('hidden', !open);
  if (open) {
    $('#pos-shift-no').textContent = state.shift.number;
    renderPosGrid();
    renderCart();
  }
}

// فتح وردية
$('#btn-open-shift').onclick = async () => {
  const cash = Number($('#shift-opening-cash').value) || 0;
  if (cash < 0) return toast('الرصيد الافتتاحي لا يمكن أن يكون سالباً', false);
  const { data, error } = await sb.rpc('open_shift', { p_tenant: state.tenant, p_opening_cash: cash });
  if (error) return toast('فشل فتح الوردية: ' + error.message, false);
  toast(`تم فتح الوردية رقم ${data?.number ?? ''} — بالتوفيق! 🟢`);
  _cart = [];
  loadPos();
};
$('#shift-opening-cash').onkeydown = (e) => { if (e.key === 'Enter') $('#btn-open-shift').click(); };

// شبكة الأصناف القابلة للضغط
function renderPosGrid() {
  const q = ($('#pos-search').value || '').trim();
  // المرحلة 14: البحث يشمل الباركود أيضاً
  const items = state.items.filter(i => !q || i.name.includes(q) || (i.sku || '').includes(q)
    || (i.barcode || '').includes(q));
  $('#pos-grid').innerHTML = items.map(i => `
    <button class="pos-item" data-id="${i.id}">
      <span class="pos-item-name">${esc(i.name)}</span>
      <span class="pos-item-price">${fmt(i.sale_price)}</span>
    </button>`).join('') || '<div style="color:var(--muted);padding:20px">لا توجد أصناف مطابقة</div>';
  $$('#pos-grid .pos-item').forEach(b => b.onclick = () => addToCart(b.dataset.id));
}
$('#pos-search').oninput = renderPosGrid;
// المرحلة 14: مسح/كتابة باركود مطابق تماماً + Enter يضيف الصنف للسلة مباشرة
$('#pos-search').onkeydown = (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim();
  if (!q) return;
  const it = state.items.find(i => i.barcode === q || i.sku === q);
  if (!it) return;
  addToCart(it.id);
  e.target.value = '';
  renderPosGrid();
  e.target.focus();
};

// السلة
function addToCart(itemId) {
  const item = state.items.find(i => i.id === itemId);
  if (!item) return;
  const line = _cart.find(l => l.item_id === itemId);
  if (line) line.qty++;
  else _cart.push({ item_id: item.id, name: item.name, price: Number(item.sale_price) || 0, qty: 1 });
  renderCart();
}

window.posLineQty = (itemId, delta) => {
  const line = _cart.find(l => l.item_id === itemId);
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) _cart = _cart.filter(l => l.item_id !== itemId);
  renderCart();
};

window.posLineDel = (itemId) => {
  _cart = _cart.filter(l => l.item_id !== itemId);
  renderCart();
};

function cartTotal() { return _cart.reduce((s, l) => s + l.qty * l.price, 0); }

// ترقية POS+: وصول محروس للسلة والشبكة من pos-plus.js (تعليق/استرجاع + صنف جديد)
window.posCartGet = () => _cart;
window.posCartSet = (c) => { _cart = Array.isArray(c) ? c : []; renderCart(); };
window.posCartTotal = cartTotal;
window.renderPosGrid = renderPosGrid;

function renderCart() {
  $('#pos-cart-lines').innerHTML = _cart.map(l => `
    <div class="cart-line">
      <span class="cart-name">${esc(l.name)}</span>
      <span class="cart-qty">
        <button class="qty-btn" onclick="posLineQty('${l.item_id}', 1)">+</button>
        <b>${fmt(l.qty)}</b>
        <button class="qty-btn" onclick="posLineQty('${l.item_id}', -1)">−</button>
      </span>
      <span class="cart-sum">${fmt(l.qty * l.price)}</span>
      <button class="del-line" onclick="posLineDel('${l.item_id}')" title="حذف">✕</button>
    </div>`).join('') || '<div style="color:var(--muted);padding:14px;text-align:center">السلة فارغة — اضغط على صنف لإضافته</div>';
  $('#pos-total').textContent = fmt(cartTotal());
}
$('#btn-cart-clear').onclick = () => { _cart = []; renderCart(); };

// ─── التحصيل (F9): المدفوع نقداً + الباقي لحظياً ───
function openCheckout() {
  // ترقية POS+: شاشة الدفع المنقّس تحل محل التحصيل النقدي البسيط (حارس تعريف)
  if (typeof window.posPlusCheckout === 'function') return window.posPlusCheckout();
  if (!state.shift) return toast('لا توجد وردية مفتوحة — افتح وردية أولاً', false);
  if (!_cart.length) return toast('السلة فارغة — أضف صنفاً على الأقل', false);
  const total = cartTotal();
  openModal(`
    <h3>💵 تحصيل نقدي</h3>
    <div class="pos-total" style="text-align:center;font-size:30px;margin-bottom:14px">الإجمالي: ${fmt(total)}</div>
    <label class="lbl">المبلغ المدفوع نقداً</label>
    <input id="pay-paid" type="number" min="0" step="any" value="${total}" dir="ltr"
           style="text-align:center;font-size:24px;font-weight:700">
    <div class="je-totals" style="justify-content:center">
      <span>الباقي للعميل:</span>
      <span id="pay-change" class="je-balance ok" style="font-size:22px">0</span>
    </div>
    <div class="modal-actions" style="justify-content:center">
      <button class="btn btn-gold" id="pay-confirm" style="font-size:17px;padding:12px 30px">✅ تأكيد التحصيل</button>
      <button class="btn btn-ghost" onclick="closeModal()">إلغاء (Esc)</button>
    </div>`);
  const syncChange = () => {
    const change = (Number($('#pay-paid').value) || 0) - total;
    const el = $('#pay-change');
    el.textContent = fmt(change);
    el.className = 'je-balance ' + (change >= 0 ? 'ok' : 'bad');
    $('#pay-confirm').disabled = change < 0;
  };
  $('#pay-paid').oninput = syncChange;
  syncChange();
  $('#pay-paid').focus(); $('#pay-paid').select();
  $('#pay-paid').onkeydown = (e) => { if (e.key === 'Enter') $('#pay-confirm').click(); };

  $('#pay-confirm').onclick = async () => {
    const paid = Number($('#pay-paid').value) || 0;
    if (paid < total) return toast('المبلغ المدفوع أقل من الإجمالي', false);
    const lines = _cart.map(l => ({ item_id: l.item_id, qty: l.qty, price: l.price }));
    const btn = $('#pay-confirm'); btn.disabled = true; btn.textContent = '⏳ جاري الترحيل...';
    const { data, error } = await sb.rpc('pos_checkout', {
      p_tenant: state.tenant, p_shift: state.shift.id, p_lines: lines, p_paid: paid });
    if (error) { btn.disabled = false; btn.textContent = '✅ تأكيد التحصيل'; return toast('فشل التحصيل: ' + error.message, false); }
    _cart = [];
    renderCart();
    loadItems(); // تحديث الأرصدة بعد البيع
    openModal(`
      <h3 style="text-align:center">✅ تم البيع بنجاح</h3>
      <div class="table-wrap"><table><tbody>
        <tr><td style="color:var(--muted)">رقم الفاتورة</td><td style="font-weight:700;font-size:20px">${data?.invoice_number ?? '—'}</td></tr>
        <tr><td style="color:var(--muted)">الإجمالي</td><td style="font-weight:700">${fmt(data?.total)}</td></tr>
        <tr><td style="color:var(--muted)">المدفوع</td><td>${fmt(data?.paid)}</td></tr>
        <tr><td style="color:var(--muted)">الباقي للعميل</td>
            <td style="font-weight:700;font-size:24px;color:var(--green)">${fmt(data?.change)}</td></tr>
      </tbody></table></div>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn btn-gold" onclick="closeModal()">بيع جديد (F9)</button></div>`);
  };
}
$('#btn-pos-checkout').onclick = openCheckout;

// اختصار F9 للتحصيل (يعمل في شاشة الكاشير فقط)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'F9') return;
  if ($('#tab-pos').classList.contains('hidden')) return;
  e.preventDefault();
  // لو إيصال النجاح مفتوحاً: F9 يبدأ بيعاً جديداً
  if (!$('#modal-overlay').classList.contains('hidden')) { closeModal(); return; }
  openCheckout();
});

// ─── قفل الوردية: ملخص + رصيد ختامي ───
$('#btn-close-shift').onclick = async () => {
  // ترقية POS+: إقفال وردية Z-report كامل (جرد نقدية + توزيع طرق الدفع + طباعة)
  if (typeof window.posPlusCloseShift === 'function') return window.posPlusCloseShift();
  if (!state.shift) return toast('لا توجد وردية مفتوحة', false);
  // ملخص الوردية من فواتيرها
  const { data: invs } = await sb.from('sales_invoices').select('total')
    .eq('shift_id', state.shift.id);
  const count = (invs || []).length;
  const total = (invs || []).reduce((s, r) => s + Number(r.total), 0);
  const expected = Number(state.shift.opening_cash) + total;
  openModal(`
    <h3>🔒 قفل الوردية رقم ${state.shift.number}</h3>
    <div class="table-wrap"><table><tbody>
      <tr><td style="color:var(--muted)">عدد فواتير الوردية</td><td style="font-weight:700">${fmt(count)}</td></tr>
      <tr><td style="color:var(--muted)">إجمالي مبيعات الوردية</td><td style="font-weight:700">${fmt(total)}</td></tr>
      <tr><td style="color:var(--muted)">الرصيد الافتتاحي</td><td>${fmt(state.shift.opening_cash)}</td></tr>
      <tr><td style="color:var(--muted)">النقدية المتوقعة في الصندوق</td><td style="font-weight:700">${fmt(expected)}</td></tr>
    </tbody></table></div>
    <label class="lbl">الرصيد الختامي الفعلي (عدّ النقدية في الصندوق)</label>
    <input id="shift-closing-cash" type="number" min="0" step="any" value="${expected}" dir="ltr"
           style="text-align:center;font-size:22px;font-weight:700">
    <div class="modal-actions">
      <button class="btn btn-gold" id="btn-do-close-shift">🔒 تأكيد قفل الوردية</button>
      <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
    </div>`);
  $('#btn-do-close-shift').onclick = async () => {
    const cash = Number($('#shift-closing-cash').value) || 0;
    const { data, error } = await sb.rpc('close_shift', {
      p_tenant: state.tenant, p_shift: state.shift.id, p_closing_cash: cash });
    if (error) return toast('فشل قفل الوردية: ' + error.message, false);
    closeModal();
    const diff = Number(data?.cash_diff ?? 0);
    toast(`تم قفل الوردية رقم ${data?.number ?? ''} ✅ — ` +
      (diff === 0 ? 'الصندوق مطابق تماماً' : `فرق الصندوق: ${fmt(diff)}`), diff === 0);
    state.shift = null;
    _cart = [];
    loadPos();
  };
};

// ─────────── ١١-ي) ورديات الكاشير: الجدول ───────────
const SHIFT_STATUS = { open: '🟢 مفتوحة', closed: '⚫ مقفلة' };
async function loadShifts() {
  const { data } = await sb.from('pos_shifts').select('*')
    .order('number', { ascending: false }).limit(100);
  $('#tbl-shifts').innerHTML = (data || []).map(s => `
    <tr>
      <td>${s.number}</td>
      <td dir="ltr">${s.cashier === state.user?.id ? esc(state.user.email) + ' (أنت)' : esc(String(s.cashier).slice(0, 8)) + '…'}</td>
      <td>${new Date(s.opened_at).toLocaleString('ar-EG')}</td>
      <td>${s.closed_at ? new Date(s.closed_at).toLocaleString('ar-EG') : '—'}</td>
      <td>${fmt(s.opening_cash)}</td>
      <td>${s.closing_cash == null ? '—' : fmt(s.closing_cash)}</td>
      <td>${s.sales_total == null ? '—' : fmt(s.sales_total)}</td>
      <td>${SHIFT_STATUS[s.status] || esc(s.status)}</td>
    </tr>`).join('') || '<tr><td colspan="8" style="color:#7A6A5C">لا توجد ورديات بعد</td></tr>';
}

// ─────────── ١١-ص) دفعة B — محرك معاينة الطباعة الاحترافية ───────────
// قرارات التنفيذ:
//   • شاشة المعاينة غلاف مستقل (#pv-overlay) بشريط أدوات كلاسيكي — لا تستخدم
//     النافذة العامة لأن الورقة A4 تحتاج عرضاً شبه كامل.
//   • الطباعة وحفظ PDF كلاهما عبر window.print مع body.pv-printing وقواعد
//     @media print تخفي كل شيء عدا ورقة المستند — الأضمن للعربية RTL
//     (لا مكتبات PDF جديدة حسب القواعد).
//   • تصدير Excel عبر مكتبة xlsx المحمّلة مسبقاً (aoa_to_sheet).
//   • كل المحتوى يُبنى من البيانات الحية (state أو الجداول المعروضة) —
//     لا تغيير على أي استعلام قائم؛ الاستعلامات الجديدة الوحيدة قراءة سطور
//     المستند عند المعاينة (نفس جداول المصدر).
//   • buildDocSheetHtml / buildWatermarkHtml / docToAOA دوال نقية قابلة للاختبار.

// حالة المعاينة الحالية
let _pv = { zoom: 1, doc: null };

// خلية جدول المستند: نص عادي أو { txt, num } — num يُستخدم كرقم حقيقي في Excel
const _pvCellTxt = (c) => (c && typeof c === 'object') ? String(c.txt ?? '') : String(c ?? '');
const _pvCellNum = (c) => (c && typeof c === 'object' && c.num != null && !isNaN(c.num)) ? Number(c.num) : null;

// بناء HTML ورقة المستند كاملة: ترويسة (شعار+شركة+عنوان+تاريخ) + بيانات + جداول + إجماليات + تذييل النظام
// doc = { title, meta: [[lbl,val]...], tables: [{caption, head:[], rows:[[]]}], totals: [], note, fileName }
function buildDocSheetHtml(doc, opts = {}) {
  const company = opts.company || '';
  const logoUrl = opts.logoUrl || null;
  const dateStr = opts.dateStr || '';
  let h = '<div class="doc-head">';
  if (logoUrl) h += `<img class="doc-logo" src="${esc(logoUrl)}" alt="شعار الشركة">`;
  h += `<div class="doc-head-txt">
    <div class="doc-company">${esc(company)}</div>
    <div class="doc-title">${esc(doc.title || 'مستند')}</div>
    <div class="doc-date">${esc(dateStr)}</div>
  </div></div>`;
  if (doc.meta && doc.meta.length) {
    h += '<div class="doc-meta">' + doc.meta.map(([l, v]) =>
      `<div class="dm"><b>${esc(l)}:</b><span>${esc(_pvCellTxt(v))}</span></div>`).join('') + '</div>';
  }
  // المرحلة 15: فقرات نصية (خطابات التحصيل) — قبل الجداول
  if (doc.paragraphs && doc.paragraphs.length) {
    h += '<div class="doc-note" style="text-align:start;line-height:2">' +
      doc.paragraphs.map(p => `<p style="margin:0 0 6px">${esc(p)}</p>`).join('') + '</div>';
  }
  (doc.tables || []).forEach(t => {
    if (t.caption) h += `<div class="doc-caption">${esc(t.caption)}</div>`;
    h += '<table class="doc-table"><thead><tr>' +
      (t.head || []).map(c => `<th>${esc(_pvCellTxt(c))}</th>`).join('') +
      '</tr></thead><tbody>' +
      (t.rows || []).map(r => '<tr>' +
        r.map((c, ci) => c && typeof c === 'object' && c.colspan
          ? `<td colspan="${c.colspan}">${esc(_pvCellTxt(c))}</td>`
          : `<td>${esc(_pvCellTxt(c))}</td>`).join('') +
        '</tr>').join('') +
      '</tbody></table>';
  });
  if (doc.totals && doc.totals.length) {
    h += '<div class="doc-totals">' + doc.totals.map((t, i) =>
      `<span class="${i === doc.totals.length - 1 ? 'dt-net' : ''}">${esc(t)}</span>`).join('') + '</div>';
  }
  // المرحلة 15: فقرات ختامية (نص الخطاب الإنجليزي والتوقيع)
  if (doc.paragraphsAfter && doc.paragraphsAfter.length) {
    h += '<div class="doc-note" style="text-align:start;line-height:2">' +
      doc.paragraphsAfter.map(p => `<p style="margin:0 0 6px">${esc(p)}</p>`).join('') + '</div>';
  }
  if (doc.note) h += `<div class="doc-note">${esc(doc.note)}</div>`;
  if (doc.qrUrl) h += `<div class="doc-qr"><img src="${doc.qrUrl}" alt="QR"><div class="doc-qr-lbl">ZATCA QR</div></div>`;
  h += '<div class="doc-foot">أُنشئ بواسطة <b>HAZEM.ERP SYSTEM MANAGER</b> — نظام المحاسبة والإدارة</div>';
  return h;
}

// طبقة العلامة المائية: تُبنى فقط عند وجود نص — تتكرر قطرياً بشفافية خلف المحتوى
function buildWatermarkHtml(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  let spans = '';
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 3; x++) {
      const right = -6 + x * 36 + (y % 2) * 18; // إزاحة متناوبة بين الصفوف
      spans += `<span style="top:${y * 11 + 1}%;right:${right}%">${esc(t)}</span>`;
    }
  }
  return `<div class="pv-wm-layer">${spans}</div>`;
}

// تحويل المستند إلى صفوف Excel (AOA) — الأرقام الحقيقية تبقى أرقاماً
function docToAOA(doc, opts = {}) {
  const aoa = [];
  if (opts.company) aoa.push([opts.company]);
  aoa.push([doc.title || 'مستند']);
  if (opts.dateStr) aoa.push([opts.dateStr]);
  aoa.push([]);
  (doc.meta || []).forEach(([l, v]) => aoa.push([l, _pvCellNum(v) ?? _pvCellTxt(v)]));
  if (doc.meta && doc.meta.length) aoa.push([]);
  (doc.tables || []).forEach(t => {
    if (t.caption) aoa.push([t.caption]);
    aoa.push((t.head || []).map(_pvCellTxt));
    (t.rows || []).forEach(r => aoa.push(r.map(c => _pvCellNum(c) ?? _pvCellTxt(c))));
    aoa.push([]);
  });
  (doc.totals || []).forEach(t => aoa.push([t]));
  if (doc.note) aoa.push([doc.note]);
  aoa.push([], ['HAZEM.ERP SYSTEM MANAGER']);
  return aoa;
}

// ─── فتح/إغلاق شاشة المعاينة ───
function _pvOpts() {
  return {
    company: state.tenantName || '',
    logoUrl: state.logoUrl || null,
    dateStr: new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }),
  };
}

function renderPvSheet() {
  if (!_pv.doc) return;
  $('#pv-sheet').innerHTML = buildWatermarkHtml($('#pv-wm').value) + buildDocSheetHtml(_pv.doc, _pvOpts());
}

function openPrintPreview(doc) {
  _pv.doc = doc;
  _pv.zoom = 1;
  $('#pv-title').textContent = doc.title || 'معاينة';
  $('#pv-wm').value = '';
  renderPvSheet();
  _applyPvZoom();
  $('#pv-overlay').classList.remove('hidden');
}

function closePrintPreview() {
  $('#pv-overlay').classList.add('hidden');
  _pv.doc = null;
}

// ─── الزوم: يكبّر ورقة المعاينة فقط ───
function _applyPvZoom() {
  _pv.zoom = Math.min(2, Math.max(0.4, _pv.zoom));
  $('#pv-sheet').style.transform = 'scale(' + _pv.zoom + ')';
  $('#pv-zoom-lbl').textContent = Math.round(_pv.zoom * 100) + '%';
}

// ─── الطباعة: نخفي كل شيء عدا الورقة عبر body.pv-printing + @media print ───
function _pvPrint() {
  document.body.classList.add('pv-printing');
  const done = () => {
    document.body.classList.remove('pv-printing');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 5000); // احتياط لمتصفح لا يرسل afterprint
}

// ─── تصدير Excel لمستند/جدول ───
function exportDocExcel(doc) {
  if (!doc) return;
  if (typeof XLSX === 'undefined') return toast('مكتبة Excel لم تُحمَّل — تحقق من الاتصال بالإنترنت', false);
  const ws = XLSX.utils.aoa_to_sheet(docToAOA(doc, _pvOpts()));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (doc.title || 'مستند').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  XLSX.writeFile(wb, (doc.fileName || doc.title || 'document') + '.xlsx');
  toast('تم تصدير ملف Excel ✅');
}

// ─── شريط أدوات المعاينة ───
$('#pv-print').onclick = _pvPrint;
$('#pv-pdf').onclick = () => {
  toast('من نافذة الطباعة اختر «حفظ بتنسيق PDF» — الأضمن للعربية RTL');
  _pvPrint();
};
$('#pv-excel').onclick = () => exportDocExcel(_pv.doc);
$('#pv-zoom-in').onclick = () => { _pv.zoom += 0.1; _applyPvZoom(); };
$('#pv-zoom-out').onclick = () => { _pv.zoom -= 0.1; _applyPvZoom(); };
$('#pv-zoom-reset').onclick = () => { _pv.zoom = 1; _applyPvZoom(); };
$('#pv-wm').oninput = renderPvSheet; // العلامة المائية تُدرج فقط عند وجود نص
$('#pv-close').onclick = closePrintPreview;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#pv-overlay').classList.contains('hidden')) closePrintPreview();
});

// ─── تحويل جدول DOM معروض إلى بنية مستند (يُسقط أعمدة «إجراءات» والأزرار) ───
function _tableToPvTable(tableEl, caption) {
  const cellText = (cell) => {
    if (!cell) return '';
    const inp = cell.querySelector('input,select');
    if (inp) return inp.tagName === 'SELECT'
      ? (inp.selectedOptions[0]?.textContent.trim() || '')
      : String(inp.value ?? '');
    return cell.textContent.trim();
  };
  const headThs = [...tableEl.querySelectorAll('thead th')];
  const kept = headThs.map((th, i) => ({ i, t: th.textContent.trim() }))
    .filter(c => c.t !== '' && c.t !== 'إجراءات');
  const idx = kept.map(c => c.i);
  const nCols = Math.max(kept.length, 1);
  const rows = [...tableEl.querySelectorAll('tbody tr')].map(tr => {
    const cells = [...tr.children];
    if (cells.length === 1) // صف رسالة بعمود colspan («لا توجد بيانات»)
      return [{ txt: cellText(cells[0]), colspan: nCols }];
    return idx.map(i => cellText(cells[i]));
  }).filter(r => r.map(_pvCellTxt).join('').trim() !== '');
  return { caption: caption || '', head: kept.map(c => c.t), rows };
}

// ─── بناء مستند تقرير من المحتوى المعروض حالياً في تاب التقارير ───
function _reportDoc(sub) {
  const pane = $('#rep-pane-' + sub);
  if (!pane) return null;
  const title = (pane.querySelector('h3')?.textContent || 'تقرير').trim();
  // لازم بيانات حقيقية معروضة (صفوف بلا colspan = ليست رسالة «لا توجد بيانات»)
  const hasRows = [...pane.querySelectorAll('tbody tr')]
    .some(tr => !tr.querySelector('td[colspan]') && tr.textContent.trim() !== '');
  if (!hasRows) { toast('اعرض التقرير أولاً بزر «عرض» ثم افتح المعاينة', false); return null; }

  const meta = [];
  const fromEl = pane.querySelector('input[type="date"][id$="-from"]');
  const toEl = pane.querySelector('input[type="date"][id$="-to"]');
  if (fromEl && fromEl.value) meta.push(['من', fromEl.value]);
  if (toEl && toEl.value) meta.push(['إلى', toEl.value]);
  if (sub === 'balance' && $('#rep-bs-date').value) meta.push(['حتى تاريخ', $('#rep-bs-date').value]);
  if (sub === 'stmt') meta.push(['العميل', $('#stmt-party').selectedOptions[0]?.textContent || '—']);

  // الجداول: العنوان الفرعي من أقرب report-box (باستثناء عنوان التقرير نفسه)
  const tables = [...pane.querySelectorAll('.table-wrap table')].map(t => {
    let cap = t.closest('.report-box')?.querySelector('h3')?.textContent.trim() || '';
    if (cap === title) cap = '';
    return _tableToPvTable(t, cap);
  }).filter(t => t.rows.length);

  // بطاقات الملخص (تقارير المبيعات/المشتريات) → جدول ملخص
  const cards = [...pane.querySelectorAll('.cards .card')].map(c => ({
    num: c.querySelector('.card-num')?.textContent.trim() || '',
    lbl: c.querySelector('.card-lbl')?.textContent.trim() || '',
  })).filter(c => c.lbl);
  if (cards.length) tables.unshift({ caption: 'الملخص', head: cards.map(c => c.lbl), rows: [cards.map(c => c.num)] });

  // أسطر الإجماليات (je-totals)
  const totals = [...pane.querySelectorAll('.je-totals')]
    .flatMap(el => [...el.children].map(s => s.textContent.trim())).filter(Boolean);

  return { title, meta, tables, totals, fileName: title };
}

function previewReport(sub) { const d = _reportDoc(sub); if (d) openPrintPreview(d); }
function exportReportExcel(sub) { const d = _reportDoc(sub); if (d) exportDocExcel(d); }

// أزرار «معاينة / طباعة» في التقارير الخمسة + كشف الحساب — تحل محل window.print المؤقتة
$$('[data-rep-print]').forEach(b => b.onclick = () => previewReport(b.dataset.repPrint));
$('#btn-print-stmt').onclick = () => previewReport('stmt');

// ─── بندا «ملف»: معاينة/تصدير المحتوى الظاهر حالياً ───
function _activeTabSection() {
  return $$('.tab').find(t => !t.classList.contains('hidden')) || null;
}

// مستند الشاشة الظاهرة حالياً (جدولها الرئيسي) — أو تقرير التاب الفرعي النشط
function _currentViewDoc() {
  const sec = _activeTabSection();
  if (!sec) { toast('لا توجد شاشة ظاهرة', false); return null; }
  const tabName = sec.id.replace('tab-', '');
  if (tabName === 'reports') {
    const sub = $('#tab-reports .sub-tab.active')?.dataset.sub || 'stock';
    return _reportDoc(sub);
  }
  // تبويبات بتابات فرعية: نأخذ جدول اللوحة الظاهرة فقط
  let scope = sec;
  if (tabName === 'purchases')
    scope = $('#purch-pane-pr').classList.contains('hidden') ? $('#purch-pane-pi') : $('#purch-pane-pr');
  if (tabName === 'warehouses')
    scope = ['wh-pane-list', 'wh-pane-transfer', 'wh-pane-count']
      .map(id => $('#' + id)).find(p => !p.classList.contains('hidden')) || sec;
  const tbl = scope.querySelector('.table-wrap table');
  if (!tbl) { toast('لا يوجد جدول قابل للمعاينة في هذه الشاشة', false); return null; }
  const t = _tableToPvTable(tbl);
  if (!t.rows.length) { toast('لا توجد بيانات لعرضها في هذه الشاشة', false); return null; }
  const title = TAB_TITLES[tabName] || 'مستند';
  return { title, tables: [t], fileName: title };
}

function previewCurrentView() { const d = _currentViewDoc(); if (d) openPrintPreview(d); }
function exportCurrentViewExcel() { const d = _currentViewDoc(); if (d) exportDocExcel(d); }

// ─── معاينة المستندات التشغيلية (فواتير/مرتجعات/عروض أسعار) ───
// نقرأ الرأس والسطور من نفس جداول المصدر — بلا أي تغيير على الاستعلامات القائمة.
const PV_DOCS = {
  sales_invoice:    { table: 'sales_invoices',    lines: 'sales_invoice_lines',
    fk: ['invoice_id'], price: 'price', priceLbl: 'السعر', title: 'فاتورة مبيعات', partyLbl: 'العميل' },
  purchase_invoice: { table: 'purchase_invoices', lines: 'purchase_invoice_lines',
    fk: ['invoice_id', 'purchase_invoice_id'], price: 'cost', priceLbl: 'التكلفة', title: 'فاتورة شراء', partyLbl: 'المورد' },
  purchase_return:  { table: 'purchase_returns',  lines: 'purchase_return_lines',
    fk: ['return_id', 'purchase_return_id', 'invoice_id'], price: 'cost', priceLbl: 'التكلفة', title: 'مرتجع مشتريات', partyLbl: 'المورد' },
  sales_return:     { table: 'sales_returns',     lines: 'sales_return_lines',
    fk: ['return_id', 'sales_return_id', 'invoice_id'], price: 'price', priceLbl: 'السعر', title: 'مرتجع مبيعات', partyLbl: 'العميل' },
  quote:            { table: 'quotes',            lines: 'quote_lines',
    fk: ['quote_id'], price: 'price', priceLbl: 'السعر', title: 'عرض أسعار', partyLbl: 'العميل' },
};

window.previewDoc = async (kind, id) => {
  const K = PV_DOCS[kind];
  if (!K) return;
  const { data: d, error } = await sb.from(K.table).select('*, parties(name)').eq('id', id).single();
  if (error || !d) return toast('تعذر تحميل المستند: ' + (error ? error.message : 'غير موجود'), false);
  const isTaxInv = kind === 'sales_invoice' || kind === 'purchase_invoice';
  // سطور المستند: نجرّب أسماء العمود المرجعي المحتملة ونتدرّج بأمان دون كسر المعاينة
  // (للفواتير الضريبية نحاول جلب tax_category أولاً ثم نرجع بدونه)
  let lines = null;
  for (const fk of K.fk) {
    if (isTaxInv) {
      const rt = await sb.from(K.lines).select('qty, ' + K.price + ', tax_category, items(name)').eq(fk, id);
      if (!rt.error) { lines = rt.data || []; break; }
    }
    const r = await sb.from(K.lines).select('qty, ' + K.price + ', items(name)').eq(fk, id);
    if (!r.error) { lines = r.data || []; break; }
  }
  // ─── قالب الفاتورة الضريبية المتوافق مع زاتكا (الجيل الأول) ───
  if (isTaxInv) return _previewTaxInvoice(kind, K, d, lines);
  const meta = [
    ['الرقم', String(d.number)],
    ['التاريخ', new Date(d.created_at).toLocaleDateString('ar-EG')],
    [K.partyLbl, d.parties?.name || '—'],
  ];
  if (d.status) meta.push(['الحالة', d.status === 'posted' ? 'مرحّلة' : (QUOTE_STATUS[d.status] || d.status)]);
  if (d.memo) meta.push(['البيان', d.memo]);
  const tables = [];
  if (lines && lines.length) {
    tables.push({
      head: ['الصنف', 'الكمية', K.priceLbl, 'الإجمالي'],
      rows: lines.map(l => [
        l.items?.name || '—',
        { txt: fmt(l.qty), num: Number(l.qty) },
        { txt: fmt(l[K.price]), num: Number(l[K.price]) },
        { txt: fmt(Number(l.qty) * Number(l[K.price])), num: Number(l.qty) * Number(l[K.price]) },
      ]),
    });
  }
  openPrintPreview({
    title: K.title + ' رقم ' + d.number,
    meta, tables,
    totals: ['الإجمالي: ' + fmt(d.total)],
    note: lines === null ? 'تفصيل الأصناف غير متاح لهذا المستند'
      : (lines.length === 0 ? 'لا توجد سطور مسجلة لهذا المستند' : ''),
    fileName: K.title + '-' + d.number,
  });
};

// ─── قالب طباعة فاتورة ضريبية متوافق مع متطلبات زاتكا (الجيل الأول) ───
// يعرض: نوع الفاتورة بالعربي والإنجليزي، بيانات البائع الضريبية، بيانات المشتري،
// بنود بالضريبة لكل بند، إجمالي قبل/بعد الضريبة، ورمز QR بترميز TLV.
function _previewTaxInvoice(kind, K, d, lines) {
  const isSales = kind === 'sales_invoice';
  const invType = isSales ? (d.invoice_type || 'simplified') : null;
  const typeTitle = !isSales ? K.title
    : (invType === 'standard' ? t('tax_invoice_title') : t('simplified_invoice_title'));
  const gross = Number(d.total) || 0;
  // الإجماليات الضريبية: الأعمدة المخزنة أولاً، وإلا نحسبها من البنود (فواتير قديمة = خاضعة شاملة)
  let subtotal = d.subtotal != null ? Number(d.subtotal) : null;
  let taxAmt = d.tax_amount != null ? Number(d.tax_amount) : null;
  if ((subtotal == null || taxAmt == null) && lines && lines.length) {
    const s = summarizeLines(lines, K.price);
    subtotal = s.subtotal; taxAmt = s.tax_amount;
  }
  if (subtotal == null) { taxAmt = lineTax(gross, 'standard'); subtotal = r2(gross - taxAmt); }

  const meta = [
    [t('inv_number'), String(d.number)],
    [t('inv_date'), new Date(d.created_at).toLocaleString('ar-EG')],
    [t('inv_seller'), state.tax.tax_name || state.tenantName || '—'],
    [t('inv_vat_no') + ' (' + t('inv_seller') + ')', state.tax.vat_number || '—'],
  ];
  if (state.tax.cr_number) meta.push([t('tax_cr_number'), state.tax.cr_number]);
  meta.push([K.partyLbl + ' (' + t('inv_buyer') + ')', d.parties?.name || '—']);
  if (isSales && invType === 'standard') meta.push([t('buyer_vat_number'), d.buyer_vat_number || '—']);

  const tables = [];
  if (lines && lines.length) {
    tables.push({
      head: [t('col_desc'), t('col_qty'), t('col_price'), t('col_tax'), t('col_total')],
      rows: lines.map(l => {
        const lineGross = Number(l.qty) * Number(l[K.price]);
        const lt = lineTax(lineGross, l.tax_category || 'standard');
        return [
          (l.items?.name || '—') + (l.tax_category && l.tax_category !== 'standard'
            ? ' (' + t('tax_cat_' + (l.tax_category === 'out_of_scope' ? 'out' : l.tax_category)) + ')' : ''),
          { txt: fmt(l.qty), num: Number(l.qty) },
          { txt: fmt(l[K.price]), num: Number(l[K.price]) },
          { txt: fmt(lt), num: lt },
          { txt: fmt(lineGross), num: lineGross },
        ];
      }),
    });
  }

  // رمز QR: TLV(البائع، الرقم الضريبي، التوقيت ISO8601، الإجمالي شامل، الضريبة) → Base64 → QR
  let qrUrl = null, qrNote = '';
  if (state.tax.vat_number) {
    try {
      const tlv = zatcaTLV({
        seller: state.tax.tax_name || state.tenantName || '',
        vat: state.tax.vat_number,
        timestamp: new Date(d.created_at).toISOString(),
        total: gross.toFixed(2), tax: Number(taxAmt).toFixed(2),
      });
      // المرحلة 17: ترقية اختيارية لـ QR الجيل الثاني (Tags 6-8) — فقط عند تفعيل P2
      // ووجود فاتورة إلكترونية مولّدة لهذه الفاتورة في كاش zatca2.js.
      // الافتراضي يبقى TLV الجيل الأول (Tags 1-5) دون أي تغيير.
      const tlvP2 = (typeof zatcaP2UpgradeTLV === 'function') ? zatcaP2UpgradeTLV(d.id, tlv) : tlv;
      qrUrl = qrDataUrl(tlvP2, 5);
    } catch (e) { qrNote = 'تعذر توليد QR: ' + e.message; }
  } else {
    qrNote = 'أدخل الرقم الضريبي في الإعدادات الضريبية ليظهر رمز QR المتوافق مع زاتكا.';
  }

  openPrintPreview({
    title: typeTitle + ' — ' + t('inv_number') + ' ' + d.number,
    meta, tables,
    totals: [t('tot_subtotal') + ': ' + fmt(subtotal),
             t('tot_vat') + ': ' + fmt(taxAmt),
             t('tot_gross') + ': ' + fmt(gross)],
    note: qrNote || (lines === null ? 'تفصيل الأصناف غير متاح لهذا المستند' : ''),
    qrUrl,
    fileName: 'invoice-' + d.number,
  });
}

// ─── معاينة سند (قبض/صرف/تحويل) من السندات المحمّلة في التبويب ───
window.previewVoucher = (id) => {
  const v = (state.vouchers || []).find(x => x.id === id);
  if (!v) return toast('السند غير موجود في القائمة — أعد فتح تبويب السندات', false);
  // أسماء حسابات الخزن من state.accounts (أعمدة السند من/إلى — بأسمائها المحتملة)
  const accName = (keys) => {
    for (const k of keys) {
      if (!v[k]) continue;
      const a = (state.accounts || []).find(x => x.id === v[k]);
      if (a) return a.code + ' — ' + a.name;
    }
    return '—';
  };
  const type = VOUCHER_TYPES[v.voucher_type] || v.voucher_type;
  const meta = [
    ['الرقم', String(v.number)],
    ['التاريخ', new Date(v.created_at).toLocaleDateString('ar-EG')],
    ['النوع', type],
    ['الطرف', v.parties?.name || '—'],
  ];
  if (v.voucher_type === 'transfer') {
    meta.push(['من خزينة', accName(['from_account', 'from_account_id'])]);
    meta.push(['إلى خزينة', accName(['to_account', 'to_account_id'])]);
  } else {
    meta.push(['الخزينة/البنك', accName(['to_account', 'to_account_id'])]);
  }
  if (v.memo) meta.push(['البيان', v.memo]);
  openPrintPreview({
    title: type + ' رقم ' + v.number,
    meta,
    tables: [{ head: ['البيان', 'المبلغ'],
      rows: [[v.memo || type, { txt: fmt(v.amount), num: Number(v.amount) }]] }],
    totals: ['المبلغ: ' + fmt(v.amount)],
    fileName: type + '-' + v.number,
  });
};

// ─────────── ١١-ز) المستخدمون والصلاحيات + الفروع (دفعة C) ───────────
// المنطق النهائي في hazem-users.sql:
//   • الأدوار: owner | manager | accountant | cashier — والدور القديم «member»
//     يظل مسموحاً ويُعرض كـ«محاسب» (قرار موثّق: لا تحويل للبيانات القديمة).
//   • كل عمليات إدارة الأعضاء عبر RPCs من نوع security definer (نفس نمط create_company):
//     list_members / add_member_by_email / set_member_role / remove_member —
//     والقاعدة نفسها ترفض غير المالك حتى لو تخطّى أحد الواجهة.
//   • الفروع CRUD مباشر عبر RLS (سياسة branches_rw بنمط is_member حرفياً)،
//     وتعيين الرئيسي عبر set_main_branch (ذرّي) — والرئيسي لا يُحذف (واجهة + trigger).

// أسماء الأدوار المعروضة (member القديم = محاسب)
const ROLE_NAMES = { owner: 'مالك', manager: 'مدير', accountant: 'محاسب', cashier: 'كاشير', member: 'محاسب' };
const _isOwner = () => state.myRole === 'owner';

// ─── المستخدمون والصلاحيات ───
async function loadUsers() {
  const isOwner = _isOwner();
  $('#usr-add-box').classList.toggle('hidden', !isOwner);
  $('#usr-readonly-note').classList.toggle('hidden', isOwner);

  const { data: members, error } = await sb.rpc('list_members', { p_tenant: state.tenant });
  if (error) {
    $('#tbl-members').innerHTML = '<tr><td colspan="4" style="color:#B42318">تعذّر تحميل الأعضاء — تأكد من تنفيذ ملف hazem-users.sql في SQL Editor</td></tr>';
    return toast('فشل تحميل الأعضاء: ' + error.message, false);
  }

  $('#tbl-members').innerHTML = (members || []).map(m => {
    const isOwnerRow = m.role === 'owner';
    // خلية الدور: المالك ثابت لا يتغير — والقائمة المنسدلة للمالك فقط
    const roleCell = isOwnerRow
      ? '<b style="color:#B42318">👑 مالك</b>'
      : (isOwner
        ? `<select onchange="changeMemberRole('${esc(m.user_id)}', this.value)" style="width:auto;min-width:120px;margin:0">
             ${['manager', 'accountant', 'cashier'].map(r =>
               `<option value="${r}" ${m.role === r || (m.role === 'member' && r === 'accountant') ? 'selected' : ''}>${ROLE_NAMES[r]}</option>`).join('')}
           </select>`
        : esc(ROLE_NAMES[m.role] || m.role));
    // خلية الإجراءات: المالك لا يُحذف — وزر الحذف للمالك فقط
    const actCell = isOwnerRow
      ? '<span style="color:#7A6A5C;font-size:12px">لا يمكن حذفه</span>'
      : (isOwner
        ? `<button class="btn btn-danger" onclick="removeMember('${esc(m.user_id)}', '${esc(m.email)}')">حذف</button>`
        : '—');
    return `<tr>
      <td dir="ltr" style="text-align:right">${esc(m.email || m.user_id)}</td>
      <td>${roleCell}</td>
      <td>${m.joined_at ? new Date(m.joined_at).toLocaleDateString('ar-EG') : '—'}</td>
      <td>${actCell}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" style="color:#7A6A5C">لا يوجد أعضاء</td></tr>';
}

// ربط عضو جديد بالبريد (مالك فقط — والواجهة نفسها تخفي النموذج عن غيره)
$('#btn-add-member').onclick = async () => {
  if (!_isOwner()) return toast('غير مصرح: إضافة الأعضاء لمالك الشركة فقط', false);
  const email = $('#usr-email').value.trim();
  const role = $('#usr-role').value;
  if (!email) return toast('أدخل بريد المستخدم أولاً', false);
  const { error } = await sb.rpc('add_member_by_email', { p_tenant: state.tenant, p_email: email, p_role: role });
  if (error) return toast(error.message, false); // رسائل القاعدة عربية وإرشادية
  $('#usr-email').value = '';
  toast('تم ربط العضو «' + email + '» بدور ' + (ROLE_NAMES[role] || role) + ' ✅');
  loadUsers();
};

// تغيير دور عضو (مالك فقط — يتحقق الخادم أيضاً)
window.changeMemberRole = async (uid, role) => {
  const { error } = await sb.rpc('set_member_role', { p_tenant: state.tenant, p_user: uid, p_role: role });
  if (error) { toast('فشل تغيير الدور: ' + error.message, false); return loadUsers(); } // إعادة التحميل لعكس القائمة
  toast('تم تغيير الدور إلى «' + (ROLE_NAMES[role] || role) + '»');
  loadUsers();
};

// حذف عضو (غير المالك) مع تأكيد
window.removeMember = async (uid, email) => {
  if (!confirm(`حذف العضو «${email}» من الشركة؟\nسيفقد الوصول لبياناتها فوراً.`)) return;
  const { error } = await sb.rpc('remove_member', { p_tenant: state.tenant, p_user: uid });
  if (error) return toast('فشل الحذف: ' + error.message, false);
  toast('تم حذف العضو من الشركة');
  loadUsers();
};

// ─── الفروع ───
async function loadBranches() {
  const { data: branches, error } = await sb.from('branches')
    .select('*').order('is_main', { ascending: false }).order('created_at', { ascending: true });
  if (error) {
    $('#br-empty').classList.add('hidden');
    $('#br-list-box').classList.remove('hidden');
    $('#tbl-branches').innerHTML = '<tr><td colspan="5" style="color:#B42318">تعذّر تحميل الفروع — تأكد من تنفيذ ملف hazem-users.sql في SQL Editor</td></tr>';
    return toast('فشل تحميل الفروع: ' + error.message, false);
  }
  state.branches = branches || [];

  // أول استخدام ولا توجد فروع: زر «إنشاء الفرع الرئيسي» بضغطة واحدة
  const empty = state.branches.length === 0;
  $('#br-empty').classList.toggle('hidden', !empty);
  $('#br-list-box').classList.toggle('hidden', empty);
  if (empty) return;

  $('#tbl-branches').innerHTML = state.branches.map(b => `<tr>
    <td>${esc(b.name)}</td>
    <td>${esc(b.address) || '—'}</td>
    <td dir="ltr" style="text-align:right">${esc(b.phone) || '—'}</td>
    <td>${b.is_main ? '⭐ رئيسي' : 'فرعي'}</td>
    <td>
      <button class="btn btn-ghost btn-sm" onclick="editBranch('${b.id}')">تعديل</button>
      ${b.is_main
        ? '<span style="color:#7A6A5C;font-size:12px">الفرع الرئيسي لا يُحذف</span>'
        : `<button class="btn btn-ghost btn-sm" onclick="setMainBranch('${b.id}')">⭐ تعيين رئيسي</button>
           <button class="btn btn-danger" onclick="delBranch('${b.id}')">حذف</button>`}
    </td>
  </tr>`).join('');
}

// إنشاء الفرع الرئيسي بضغطة واحدة (أول استخدام)
$('#btn-create-main-branch').onclick = async () => {
  const { error } = await sb.from('branches')
    .insert({ tenant_id: state.tenant, name: 'الفرع الرئيسي', is_main: true });
  if (error) return toast('فشل الإنشاء: ' + error.message, false);
  toast('تم إنشاء الفرع الرئيسي ✅');
  loadBranches();
};

// نموذج إضافة/تعديل فرع
$('#btn-add-branch').onclick = () => branchForm(null);
window.editBranch = (id) => branchForm((state.branches || []).find(b => b.id === id));

function branchForm(branch) {
  openModal(`
    <h3>${branch ? 'تعديل فرع' : 'فرع جديد'}</h3>
    <label class="lbl">اسم الفرع</label>
    <input id="f-brname" placeholder="مثال: فرع الرياض" value="${esc(branch?.name)}">
    <label class="lbl">العنوان</label>
    <input id="f-braddr" placeholder="اختياري" value="${esc(branch?.address)}">
    <label class="lbl">الهاتف</label>
    <input id="f-brphone" placeholder="اختياري" dir="ltr" value="${esc(branch?.phone)}">
    <div class="modal-actions">
      <button class="btn btn-gold" id="f-brsave">حفظ</button>
      <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
    </div>`);
  $('#f-brname').focus();
  $('#f-brsave').onclick = async () => {
    const rec = { name: $('#f-brname').value.trim(),
      address: $('#f-braddr').value.trim() || null, phone: $('#f-brphone').value.trim() || null };
    if (!rec.name) return toast('اسم الفرع مطلوب', false);
    let r;
    if (branch) r = await sb.from('branches').update(rec).eq('id', branch.id);
    else r = await sb.from('branches').insert({ ...rec, tenant_id: state.tenant });
    if (r.error) return toast('خطأ: ' + r.error.message, false);
    toast('تم الحفظ بنجاح'); closeModal(); loadBranches();
  };
}

// تعيين فرع كرئيسي (ذرّي عبر RPC — الفرع الرئيسي يبقى واحداً دائماً)
window.setMainBranch = async (id) => {
  const b = (state.branches || []).find(x => x.id === id);
  if (!confirm(`تعيين «${b ? b.name : ''}» كفرع رئيسي؟`)) return;
  const { error } = await sb.rpc('set_main_branch', { p_branch: id });
  if (error) return toast('فشل التعيين: ' + error.message, false);
  toast('تم تعيين الفرع الرئيسي ⭐');
  loadBranches();
};

// حذف فرع (الرئيسي لا يُحذف — واجهة + trigger في القاعدة)
window.delBranch = async (id) => {
  const b = (state.branches || []).find(x => x.id === id);
  if (b && b.is_main) return toast('لا يمكن حذف الفرع الرئيسي — عيّن فرعاً آخر رئيسياً أولاً', false);
  if (!confirm(`حذف الفرع «${b ? b.name : ''}»؟`)) return;
  const { error } = await sb.from('branches').delete().eq('id', id);
  if (error) return toast('لا يمكن الحذف: ' + error.message, false);
  toast('تم حذف الفرع'); loadBranches();
};

// ─────────── ١٢) نقطة البداية ───────────
(async () => {
  if (HAZEM_SUPABASE_URL === 'PUT_YOUR_URL') {
    showScreen('auth-screen');
    return toast('عدّل config.js وضع رابط ومفتاح مشروع Supabase أولاً', false);
  }
  const { data: { session } } = await sb.auth.getSession();
  if (session) boot(); else showScreen('auth-screen');
})();
