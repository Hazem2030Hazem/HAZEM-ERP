/* ═══════════════════════════════════════════════════════════════
   H. ERP SYSTEM MANAGER — منطق التطبيق كاملاً (SPA خالص بدون build step)
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
      '<p>تطبيق <b>H. ERP SYSTEM MANAGER</b> شغال، بس محتاج مفاتيح مشروع Supabase الجديد:</p>' +
      '<ol style="margin:0;padding-right:20px">' +
      '<li>افتح مشروعك في Supabase ← <b>Project Settings ← API</b></li>' +
      '<li>انسخ <b>Project URL</b> و <b>anon public key</b></li>' +
      '<li>افتح ملف <code style="color:#7B4B26">config.js</code> والصقهما مكان الكلمتين المؤقتتين</li>' +
      '<li>ارفع الملف على GitHub وحدّث الصفحة</li>' +
      '</ol><p style="color:#7A6A5C;font-size:13px;margin-bottom:0">ولا تنسى تشغيل ملف schema.sql في SQL Editor مرة واحدة قبل أول استخدام.</p>' +
      '</div></div>';
  });
  throw new Error('H. ERP SYSTEM MANAGER: config.js غير مُعدّ بعد');
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

  const { data: ms } = await sb.from('memberships').select('tenant_id, tenants(name, logo_url)').limit(1);
  if (!ms || ms.length === 0) return showScreen('onboarding-screen');

  state.tenant = ms[0].tenant_id;
  state.tenantName = ms[0].tenants.name;
  state.logoUrl = ms[0].tenants.logo_url || null;
  $('#company-title').textContent = state.tenantName;
  applyBrandLogo();
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
};

// دالة عامة لتبديل التبويب — يستدعيها السايدبار وشريط القوائم الكلاسيكي
function switchTab(tabName) {
  if (!TAB_TITLES[tabName] || !$('#tab-' + tabName)) return;
  $$('.nav-btn').forEach(x => x.classList.toggle('active', x.dataset.tab === tabName));
  $$('.tab').forEach(t => t.classList.add('hidden'));
  $('#tab-' + tabName).classList.remove('hidden');
  $('.sidebar').classList.remove('open');
  const wt = $('#window-title');
  if (wt) wt.textContent = TAB_TITLES[tabName];
  if (tabName === 'dashboard') refreshDashboard();
  if (tabName === 'reports') loadReports();
  if (tabName === 'settings') loadSettings();
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
}
window.switchTab = switchTab;

$$('.nav-btn').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
$('#btn-menu').onclick = () => $('.sidebar').classList.toggle('open');

// ─────────── ٥-أ) شريط القوائم الكلاسيكي (Win98/XP) ───────────
function closeAllMenus() {
  $$('#menubar .mb-item.open').forEach(m => m.classList.remove('open'));
}

// فتح/قفل القوائم المنسدلة
$$('#menubar .mb-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = btn.closest('.mb-item');
    const wasOpen = item.classList.contains('open');
    closeAllMenus();
    if (!wasOpen) item.classList.add('open');
  });
  // عند وجود قائمة مفتوحة، المرور على بند آخر ينقل الفتح إليه
  btn.addEventListener('mouseenter', () => {
    if ($('#menubar .mb-item.open') && !btn.closest('.mb-item').classList.contains('open')) {
      closeAllMenus();
      btn.closest('.mb-item').classList.add('open');
    }
  });
});
// الضغط خارج القوائم يقفلها، وEscape كذلك
document.addEventListener('click', (e) => { if (!e.target.closest('#menubar')) closeAllMenus(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllMenus(); });

// عناصر القوائم: تبويب أو إجراء
$$('#menubar .mb-leaf').forEach(leaf => {
  if (leaf.disabled) return; // البنود المعطلة «قريباً 🚧» لا تفعل شيئاً
  leaf.addEventListener('click', () => {
    closeAllMenus();
    if (leaf.dataset.tab) return switchTab(leaf.dataset.tab);
    if (leaf.dataset.action === 'logout') return $('#btn-logout').click();
    if (leaf.dataset.action === 'opening-entry') return openOpeningEntry();
    if (leaf.dataset.action === 'voucher-receipt') return openVoucher('receipt');
    if (leaf.dataset.action === 'voucher-payment') return openVoucher('payment');
    if (leaf.dataset.action === 'voucher-transfer') return openVoucher('transfer');
    if (leaf.dataset.action === 'purchase-invoice') return openPurchaseInvoice();
    if (leaf.dataset.action === 'purchase-return') return openPurchaseReturn();
    if (leaf.dataset.action === 'sales-return') return openSalesReturn();
    if (leaf.dataset.action === 'quote') return openQuote();
    if (leaf.dataset.action === 'warehouses') return openWarehouses('list');
    if (leaf.dataset.action === 'stock-transfer') return openWarehouses('transfer');
    if (leaf.dataset.action === 'stock-count') return openWarehouses('count');
    if (leaf.dataset.action === 'sysinfo') return openModal(`
      <h3>🖥️ معلومات النظام</h3>
      <div class="table-wrap"><table><tbody>
        <tr><td style="color:#94a3b8">النظام</td><td style="font-weight:700">H. ERP SYSTEM MANAGER</td></tr>
        <tr><td style="color:#94a3b8">الشركة</td><td>${esc(state.tenantName || '—')}</td></tr>
        <tr><td style="color:#94a3b8">المستخدم</td><td dir="ltr">${esc(state.user?.email || '—')}</td></tr>
        <tr><td style="color:#94a3b8">الإصدار</td><td>1.0.0</td></tr>
        <tr><td style="color:#94a3b8">التاريخ</td><td>${new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}</td></tr>
      </tbody></table></div>
      <div class="modal-actions"><button class="btn btn-gold" onclick="closeModal()">موافق</button></div>`);
    if (leaf.dataset.action === 'about') return openModal(`
      <h3 style="text-align:center">H. ERP SYSTEM MANAGER</h3>
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
      هذه المنطقة خاصة بمالك H. ERP SYSTEM MANAGER فقط — سجّل بياناتك للمتابعة</p>
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
    <div class="modal-actions">
      <button class="btn btn-gold" id="f-save">حفظ</button>
      <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
    </div>`);
  $('#f-save').onclick = async () => {
    const rec = { sku: $('#f-sku').value.trim(), name: $('#f-name').value.trim(),
      unit: $('#f-unit').value.trim(), sale_price: Number($('#f-price').value) || 0 };
    if (!rec.name) return toast('اسم الصنف مطلوب', false);
    let r;
    if (item) r = await sb.from('items').update(rec).eq('id', item.id);
    else r = await sb.from('items').insert({ ...rec, tenant_id: state.tenant });
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
      <td>${p.kind === 'customer' ? 'عميل' : 'مورد'}</td>
      <td>${fmt(balMap[p.id] || 0)}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="editParty('${p.id}')">تعديل</button>
        <button class="btn btn-danger" onclick="delParty('${p.id}')">حذف</button>
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
    if (!rec.name) return toast('الاسم مطلوب', false);
    let r;
    if (p) r = await sb.from('parties').update(rec).eq('id', p.id);
    else r = await sb.from('parties').insert({ ...rec, tenant_id: state.tenant });
    if (r.error) return toast('خطأ: ' + r.error.message, false);
    toast('تم الحفظ بنجاح'); closeModal(); loadParties();
  };
}

window.delParty = async (id) => {
  if (!confirm('حذف هذا الطرف؟')) return;
  const { error } = await sb.from('parties').delete().eq('id', id);
  if (error) return toast('لا يمكن الحذف: ' + error.message, false);
  toast('تم الحذف'); loadParties();
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
    <h3>فاتورة مبيعات جديدة</h3>
    <select id="inv-customer">
      ${state.parties.filter(p => p.kind === 'customer')
        .map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
    </select>
    <div id="inv-lines"></div>
    <button class="btn btn-ghost btn-sm" id="inv-add-line">+ إضافة سطر</button>
    <div class="inv-total">الإجمالي: <span id="inv-total">0</span></div>
    <div class="modal-actions">
      <button class="btn btn-gold" id="inv-save">حفظ وترحيل</button>
      <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
    </div>`);

  // سطر ديناميكي
  const addLine = () => {
    const d = document.createElement('div');
    d.className = 'inv-line';
    d.innerHTML = `
      <select class="ln-item">${itemOpts()}</select>
      <input class="ln-qty" type="number" min="0" step="any" value="1" placeholder="الكمية">
      <input class="ln-price" type="number" min="0" step="any" placeholder="السعر">
      <button class="del-line" title="حذف السطر">✕</button>`;
    const sel = d.querySelector('.ln-item');
    const priceIn = d.querySelector('.ln-price');
    // تعبئة السعر الافتراضي من سعر بيع الصنف
    const syncPrice = () => priceIn.value = sel.selectedOptions[0]?.dataset.price ?? 0;
    sel.onchange = () => { syncPrice(); calcTotal(); };
    syncPrice();
    d.querySelectorAll('input').forEach(i => i.oninput = calcTotal);
    d.querySelector('.del-line').onclick = () => { d.remove(); calcTotal(); };
    $('#inv-lines').appendChild(d);
    calcTotal();
  };

  // حساب الإجمالي لحظياً
  function calcTotal() {
    let t = 0;
    $$('#inv-lines .inv-line').forEach(l => {
      t += (Number(l.querySelector('.ln-qty').value) || 0) *
           (Number(l.querySelector('.ln-price').value) || 0);
    });
    $('#inv-total').textContent = fmt(t);
  }

  $('#inv-add-line').onclick = addLine;
  addLine();

  // الحفظ عبر RPC فقط (كتابة تشغيلية حساسة)
  $('#inv-save').onclick = async () => {
    const lines = $$('#inv-lines .inv-line').map(l => ({
      item_id: l.querySelector('.ln-item').value,
      qty: Number(l.querySelector('.ln-qty').value),
      price: Number(l.querySelector('.ln-price').value),
    }));
    if (!lines.length || lines.some(l => !l.qty || l.qty <= 0))
      return toast('تحقق من سطور الفاتورة (كمية > 0)', false);
    const { data, error } = await sb.rpc('post_sales_invoice', {
      p_customer: $('#inv-customer').value, p_lines: lines });
    if (error) return toast('فشل الترحيل: ' + error.message, false);
    closeModal();
    toast(`تم ترحيل فاتورة المبيعات رقم ${data} بنجاح`);
    loadInvoices();
  };
}

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
'   H. ERP SYSTEM MANAGER — ملف إعداد الاتصال بقاعدة البيانات\n' +
'   ضع مفاتيح مشروع Supabase الخاص بك في السطرين التاليين:\n' +
'   (Project Settings ← API ← Project URL و anon public key)\n' +
'   ═══════════════════════════════════════════════ */\n' +
'const HAZEM_SUPABASE_URL = "PUT_YOUR_URL";      // ← رابط المشروع، مثال: https://xxxx.supabase.co\n' +
'const HAZEM_SUPABASE_KEY = "PUT_YOUR_ANON_KEY"; // ← مفتاح anon public\n';

// صفحة Launcher «ابدأ-هنا.html» بنفس الهوية البصرية
function dlLauncherHtml(version, customer) {
  return '<!DOCTYPE html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="UTF-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'<title>H. ERP SYSTEM MANAGER — ابدأ هنا</title>\n<style>\n' +
'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#FFFFFF;color:#1C1712;font-family:Tahoma,Arial,sans-serif;direction:rtl;padding:20px;box-sizing:border-box}\n' +
'.card{max-width:560px;width:100%;background:#FAF6F1;border:1px solid #E7DDD1;border-top:5px solid #B42318;border-radius:18px;padding:36px;text-align:center;box-shadow:0 10px 30px rgba(28,23,18,.08)}\n' +
'img.logo{width:110px;height:110px;object-fit:contain;margin-bottom:14px}\n' +
'h1{margin:0 0 4px;color:#1C1712;font-size:26px}h1 span{color:#B42318}\n' +
'.sub{color:#7B4B26;margin:0 0 22px;font-size:14px}\n' +
'.btn{display:block;background:#B42318;color:#fff;text-decoration:none;font-weight:700;font-size:18px;padding:14px;border-radius:12px;margin-bottom:14px}\n' +
'.links a{color:#7B4B26;text-decoration:none;font-size:13px;margin:0 8px}\n' +
'.meta{color:#7A6A5C;font-size:12px;margin-top:18px;line-height:1.9}\n' +
'</style>\n</head>\n<body>\n<div class="card">\n' +
'<img class="logo" src="logo.png" alt="H. ERP" onerror="this.style.display=\'none\'">\n' +
'<h1>H. ERP <span>SYSTEM MANAGER</span></h1>\n' +
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
'   H. ERP SYSTEM MANAGER — دليل التثبيت خطوة بخطوة',
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
'بالتوفيق! — فريق H. ERP SYSTEM MANAGER',
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
      'H. ERP SYSTEM MANAGER\r\n' +
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

  const addLine = () => {
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
    const lines = $$('#je-lines .je-line').map(l => ({
      account_id: l.querySelector('.je-acc').value,
      party_id: l.querySelector('.je-party').value || null,
      debit: Number(l.querySelector('.je-debit').value) || 0,
      credit: Number(l.querySelector('.je-credit').value) || 0,
    }));
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
  $('#tbl-vouchers').innerHTML = (vouchers || []).map(v => `
    <tr>
      <td>${v.number}</td>
      <td>${new Date(v.created_at).toLocaleDateString('ar-EG')}</td>
      <td>${VOUCHER_TYPES[v.voucher_type] || esc(v.voucher_type)}</td>
      <td>${esc(v.parties?.name || '—')}</td>
      <td>${fmt(v.amount)}</td>
      <td>${esc(v.memo || '—')}</td>
    </tr>`).join('') || '<tr><td colspan="6" style="color:#7A6A5C">لا توجد سندات بعد</td></tr>';
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
    </tr>`).join('') || '<tr><td colspan="5" style="color:#7A6A5C">لا توجد فواتير شراء بعد</td></tr>';
  $('#tbl-purchase-returns').innerHTML = (rets || []).map(v => `
    <tr>
      <td>${v.number}</td>
      <td>${new Date(v.created_at).toLocaleDateString('ar-EG')}</td>
      <td>${esc(v.parties?.name)}</td>
      <td>${fmt(v.total)}</td>
    </tr>`).join('') || '<tr><td colspan="4" style="color:#7A6A5C">لا توجد مرتجعات مشتريات بعد</td></tr>';
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
    </tr>`).join('') || '<tr><td colspan="5" style="color:#7A6A5C">لا توجد مرتجعات مبيعات بعد</td></tr>';
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
      <td>${q.status === 'open' ? `
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
    <div id="doc-lines"></div>
    <button class="btn btn-ghost btn-sm" id="doc-add-line">+ إضافة سطر</button>
    <div class="inv-total">الإجمالي: <span id="doc-total">0</span></div>
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
      <input class="ln-price" type="number" min="0" step="any" placeholder="${K.priceLbl}">
      <span class="ln-sum" style="font-weight:700;color:#7B4B26">0</span>
      <button class="del-line" title="حذف السطر">✕</button>`;
    const sel = d.querySelector('.ln-item');
    const priceIn = d.querySelector('.ln-price');
    const syncPrice = () => { if (!priceIn.value) priceIn.value = sel.selectedOptions[0]?.dataset.price ?? 0; };
    sel.onchange = () => { priceIn.value = sel.selectedOptions[0]?.dataset.price ?? 0; calcTotal(); };
    syncPrice();
    d.querySelectorAll('input').forEach(i => i.oninput = calcTotal);
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
  }

  $('#doc-add-line').onclick = addLine;
  addLine();

  // الحفظ عبر RPC فقط (كتابة تشغيلية حساسة — القيد والمخزون داخل الدالة ذرياً)
  $('#doc-save').onclick = async () => {
    const lines = $$('#doc-lines .doc-line').map(l => ({
      item_id: l.querySelector('.ln-item').value,
      qty: Number(l.querySelector('.ln-qty').value),
      [K.priceField]: Number(l.querySelector('.ln-price').value),
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
  $('#purch-pane-pi').classList.toggle('hidden', sub !== 'pi');
  $('#purch-pane-pr').classList.toggle('hidden', sub !== 'pr');
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
  const items = state.items.filter(i => !q || i.name.includes(q) || (i.sku || '').includes(q));
  $('#pos-grid').innerHTML = items.map(i => `
    <button class="pos-item" data-id="${i.id}">
      <span class="pos-item-name">${esc(i.name)}</span>
      <span class="pos-item-price">${fmt(i.sale_price)}</span>
    </button>`).join('') || '<div style="color:var(--muted);padding:20px">لا توجد أصناف مطابقة</div>';
  $$('#pos-grid .pos-item').forEach(b => b.onclick = () => addToCart(b.dataset.id));
}
$('#pos-search').oninput = renderPosGrid;

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

// ─────────── ١٢) نقطة البداية ───────────
(async () => {
  if (HAZEM_SUPABASE_URL === 'PUT_YOUR_URL') {
    showScreen('auth-screen');
    return toast('عدّل config.js وضع رابط ومفتاح مشروع Supabase أولاً', false);
  }
  const { data: { session } } = await sb.auth.getSession();
  if (session) boot(); else showScreen('auth-screen');
})();
