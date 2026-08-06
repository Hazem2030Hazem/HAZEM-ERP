/* ═══════════════════════════════════════════════════════════════
   HAZEM ERP — منطق التطبيق كاملاً (SPA خالص بدون build step)
   ═══════════════════════════════════════════════════════════════ */

// ─────────── ١) تهيئة Supabase ───────────
// حارس الإعداد: لو المفاتيح لسه ماتحطتش نظهر شاشة تعليمات بدل صفحة بيضاء
const _cfgOk = /^https:\/\/.+\.supabase\.co\/?$/.test(HAZEM_SUPABASE_URL || '') && (HAZEM_SUPABASE_KEY || '').length > 50;
const sb = _cfgOk ? window.supabase.createClient(HAZEM_SUPABASE_URL, HAZEM_SUPABASE_KEY) : null;
if (!_cfgOk) {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:#0B0D1A;color:#fff;font-family:inherit;direction:rtl">' +
      '<div style="max-width:560px;background:#141830;border:1px solid #D4AF37;border-radius:16px;padding:32px;line-height:2">' +
      '<h1 style="color:#D4AF37;margin:0 0 12px">⚙️ خطوة واحدة باقية — إعداد الاتصال</h1>' +
      '<p>تطبيق <b>HAZEM ERP</b> شغال، بس محتاج مفاتيح مشروع Supabase الجديد:</p>' +
      '<ol style="margin:0;padding-right:20px">' +
      '<li>افتح مشروعك في Supabase ← <b>Project Settings ← API</b></li>' +
      '<li>انسخ <b>Project URL</b> و <b>anon public key</b></li>' +
      '<li>افتح ملف <code style="color:#D4AF37">config.js</code> والصقهما مكان الكلمتين المؤقتتين</li>' +
      '<li>ارفع الملف على GitHub وحدّث الصفحة</li>' +
      '</ol><p style="color:#9aa5b9;font-size:13px;margin-bottom:0">ولا تنسى تشغيل ملف schema.sql في SQL Editor مرة واحدة قبل أول استخدام.</p>' +
      '</div></div>';
  });
  throw new Error('HAZEM ERP: config.js غير مُعدّ بعد');
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

  const { data: ms } = await sb.from('memberships').select('tenant_id, tenants(name)').limit(1);
  if (!ms || ms.length === 0) return showScreen('onboarding-screen');

  state.tenant = ms[0].tenant_id;
  $('#company-title').textContent = ms[0].tenants.name;
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
$$('.nav-btn').forEach(b => b.onclick = () => {
  $$('.nav-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $$('.tab').forEach(t => t.classList.add('hidden'));
  $('#tab-' + b.dataset.tab).classList.remove('hidden');
  $('.sidebar').classList.remove('open');
  if (b.dataset.tab === 'dashboard') refreshDashboard();
  if (b.dataset.tab === 'reports') loadReports();
});
$('#btn-menu').onclick = () => $('.sidebar').classList.toggle('open');

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

// ─────────── ١٢) نقطة البداية ───────────
(async () => {
  if (HAZEM_SUPABASE_URL === 'PUT_YOUR_URL') {
    showScreen('auth-screen');
    return toast('عدّل config.js وضع رابط ومفتاح مشروع Supabase أولاً', false);
  }
  const { data: { session } } = await sb.auth.getSession();
  if (session) boot(); else showScreen('auth-screen');
})();
