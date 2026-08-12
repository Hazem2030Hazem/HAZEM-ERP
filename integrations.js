/* ═══════════════════════════════════════════════════════════════
   HAZEM.ERP — المرحلة 18: تكاملات المتاجر (سلة/زد) + API مفتوح
   ─────────────────────────────────────────────────────────────
   قرارات التنفيذ الموثقة:
   • إطار تكاملات موحّد: كل مزوّد (سلة/زد) له بطاقة إعدادات + اختبار اتصال
     + مزامنة يدوية + سجل عمليات (sync_logs). الإعدادات في جدول
     integrations_settings (tenant_id + RLS is_member) عبر hazem-integrations.sql.
   • تحويل الطلبات: دوال نقية (sallaOrderToInvoice / zidOrderToInvoice)
     تحوّل طلب المتجر إلى بنية فاتورة داخلية {externalId, customerName, lines}.
     البنود تُطابَق مع الأصناف بالـ SKU ثم الباركود، وإلا تُستخدم صنفاً
     خدمياً عاماً «مبيعات متجر» (يُنشأ تلقائياً). أسعار المتاجر شاملة
     الضريبة — متوافقة مع قرار النظام (vat.js).
   • منع التكرار: كل فاتورة مستوردة تُختم بـ (source, external_order_id)
     على sales_invoices، وتُتخطَّى الطلبات المستوردة سابقاً.
   • الترحيل عبر RPC post_sales_invoice القائم (لا مسار موازٍ) + الحقول
     الضريبية عبر applyInvoiceTaxMeta بتدرّج آمن — القيود تبقى immutable.
   • CORS: الجلب المباشر من المتصفح غالباً مرفوض؛ عند الفشل رسالة إرشادية
     + Edge Function جاهزة (edge-function-salla-sync.ts / edge-function-zid-sync.ts).
   • API مفتوح: مفاتيح haz_live_... تُخزَّن كـ SHA-256 hex فقط في api_keys
     (لا نص صريح أبداً)، والاستخدام عبر RPC api_request (security definer،
     قراءة فقط، قائمة بيضاء من الإجراءات — لا SQL خام).
   يعمل في المتصفح و Node (الدوال النقية للاختبارات) بلا build step.
   ═══════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';

  // ─── SHA-256 hex (من zatca2.js عند توفره — نفس التنفيذ) ───
  const _sha256Hex = g.sha256Hex || require('./zatca2.js').sha256Hex;
  const _r2 = (g.r2) || require('./vat.js').r2;

  // ═══ ١) تحويل طلبات المتاجر إلى بنية فاتورة داخلية ═══
  // الناتج: { externalId, customerName, customerPhone, reference, lines:[{sku,name,qty,price}], total }
  // price = سعر الوحدة الشامل الضريبة. الدوال متسامحة مع اختلافات الحقول الفرعية.

  // سلة: GET {store}/admin/v2/orders — العناصر في data[] لكل طلب:
  //   id, reference_id, customer{first_name,last_name,mobile}, currency,
  //   items[{name, sku, quantity, amounts{total{amount}}}], amounts{total{amount}}
  function sallaOrderToInvoice(o) {
    o = o || {};
    const cust = o.customer || {};
    const name = [cust.first_name, cust.last_name].filter(Boolean).join(' ').trim()
      || cust.name || 'عميل متجر سلة';
    const lines = (o.items || []).map(it => {
      const qty = Number(it.quantity) || 1;
      let price = Number(it.amounts && it.amounts.total && it.amounts.total.amount) / qty;
      if (!(price > 0)) price = Number(it.price) || Number(it.amounts && it.amounts.price_with_tax && it.amounts.price_with_tax.amount) || 0;
      return { sku: it.sku || (it.product && it.product.sku) || '',
               name: it.name || 'صنف متجر', qty, price: _r2(price) };
    });
    const total = Number(o.amounts && o.amounts.total && o.amounts.total.amount)
      || _r2(lines.reduce((a, l) => a + l.qty * l.price, 0));
    return { externalId: String(o.id), customerName: name,
             customerPhone: cust.mobile || cust.mobile_code && (String(cust.mobile_code) + String(cust.mobile)) || '',
             reference: String(o.reference_id || o.id), lines, total: _r2(total) };
  }

  // زد: GET https://api.zid.sa/v1/managers/store/orders — العناصر في orders[]:
  //   id, customer{name, mobile}, products[{name, sku, quantity, price}], order_total
  function zidOrderToInvoice(o) {
    o = o || {};
    const cust = o.customer || {};
    const lines = (o.products || o.items || []).map(p => {
      const qty = Number(p.quantity) || 1;
      const price = Number(p.price) || 0;
      return { sku: p.sku || '', name: p.name || 'صنف متجر', qty, price: _r2(price) };
    });
    const total = Number(o.order_total) || _r2(lines.reduce((a, l) => a + l.qty * l.price, 0));
    return { externalId: String(o.id), customerName: cust.name || 'عميل متجر زد',
             customerPhone: cust.mobile || '', reference: String(o.id), lines, total: _r2(total) };
  }

  // ═══ ٢) مطابقة بنود الطلب مع أصناف النظام ═══
  // المطابقة: sku → items.sku ثم items.barcode (بترميم النصوص)، وإلا الصنف الاحتياطي.
  // الناتج: [{item_id, qty, price, tax_category:'standard', name, sku, matched}]
  function resolveOrderLines(lines, items, fallbackItemId) {
    const bySku = {}, byBarcode = {};
    (items || []).forEach(it => {
      if (it.sku) bySku[String(it.sku).trim().toLowerCase()] = it;
      if (it.barcode) byBarcode[String(it.barcode).trim().toLowerCase()] = it;
    });
    return (lines || []).map(l => {
      const key = String(l.sku || '').trim().toLowerCase();
      const hit = key ? (bySku[key] || byBarcode[key]) : null;
      return { item_id: hit ? hit.id : fallbackItemId,
               qty: Number(l.qty) || 1, price: _r2(l.price),
               tax_category: 'standard',
               name: l.name, sku: l.sku || '', matched: !!hit };
    });
  }

  // ═══ ٣) منع التكرار ═══
  // importedIds: مصفوفة/Set من external_order_id المستوردة سابقاً (نصوص).
  function filterNewOrders(invoices, importedIds) {
    const seen = importedIds instanceof Set ? importedIds : new Set((importedIds || []).map(String));
    const newOnes = [], skipped = [];
    (invoices || []).forEach(inv => {
      if (seen.has(String(inv.externalId))) skipped.push(inv);
      else newOnes.push(inv);
    });
    return { newOrders: newOnes, skipped };
  }

  // ═══ ٤) مفاتيح API ═══
  // توليد مفتاح: haz_live_ + 32 محرف hex عشوائي (128 بت)
  function generateApiKey(randBytes) {
    let bytes;
    if (randBytes) bytes = randBytes(16);
    else if (g.crypto && g.crypto.getRandomValues) { bytes = new Uint8Array(16); g.crypto.getRandomValues(bytes); }
    else bytes = Uint8Array.from(require('crypto').randomBytes(16));
    return 'haz_live_' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const apiKeyPrefix = (key) => String(key || '').slice(0, 12); // للعرض فقط
  const apiKeyHash = (key) => _sha256Hex(String(key || ''));
  // التحقق: هاش المفتاح المُدخل == الهاش المخزن (لا يُخزَّن النص الصريح أبداً)
  async function verifyApiKey(key, storedHash) {
    return (await apiKeyHash(key)) === String(storedHash || '').toLowerCase();
  }

  // ═══ ٥) تنسيق سجل المزامنة ═══
  // بنية موحدة تُدرج في sync_logs وتُعرض في الواجهة
  function formatSyncLog({ provider, action, fetched, imported, skipped, status, errors }) {
    return { provider: provider || '', action: action || 'orders_sync',
             fetched: fetched | 0, imported: imported | 0, skipped: skipped | 0,
             status: status || 'success', // success | partial | failed
             errors: errors || [], at: new Date().toISOString() };
  }
  // حالة المزامنة من الأعداد: فشل كامل (لا مستورد + أخطاء) / جزئي / نجاح
  function syncStatus(fetched, imported, errorCount) {
    if (errorCount > 0 && imported === 0) return 'failed';
    if (errorCount > 0) return 'partial';
    return 'success';
  }

  // ═══ ٦) تعريف المزوّدين (endpoints + توثيق + تحليل الاستجابة) ═══
  const PROVIDERS = {
    salla: {
      key: 'salla', labelAr: 'سلة', labelEn: 'Salla',
      ordersUrl: (cfg) => String(cfg.store_url || '').replace(/\/+$/, '') + '/admin/v2/orders',
      testUrl: (cfg) => String(cfg.store_url || '').replace(/\/+$/, '') + '/admin/v2/products?page=1&per_page=1',
      headers: (cfg) => ({ 'Authorization': 'Bearer ' + cfg.access_token, 'Accept': 'application/json' }),
      parseOrders: (json) => (json && json.data) || [],
      toInvoice: sallaOrderToInvoice,
      required: ['store_url', 'access_token'],
    },
    zid: {
      key: 'zid', labelAr: 'زد', labelEn: 'Zid',
      ordersUrl: () => 'https://api.zid.sa/v1/managers/store/orders',
      testUrl: () => 'https://api.zid.sa/v1/managers/store/profile',
      headers: (cfg) => ({ 'Authorization': 'Bearer ' + cfg.access_token,
                           'X-Manager-Token': cfg.manager_token || '', 'Accept': 'application/json' }),
      parseOrders: (json) => (json && (json.orders || (json.results && json.results.orders))) || [],
      toInvoice: zidOrderToInvoice,
      required: ['access_token', 'manager_token'],
    },
  };

  const api = { sallaOrderToInvoice, zidOrderToInvoice, resolveOrderLines,
    filterNewOrders, generateApiKey, apiKeyPrefix, apiKeyHash, verifyApiKey,
    formatSyncLog, syncStatus, PROVIDERS };
  Object.keys(api).forEach(k => { g[k] = api[k]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);


/* ═══════════════════════════════════════════════════════════════
   الجزء الثاني — ربط قاعدة البيانات والواجهة (متصفح فقط)
   تبويب «التكاملات»: بطاقات المتاجر + سجل المزامنة + مفاتيح API.
   الجداول تُنشأ عبر hazem-integrations.sql — تدرّج آمن: لو لم يُنفَّذ
   الـ SQL تظهر رسالة إرشادية بدل كسر التطبيق.
   ═══════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';
  if (typeof document === 'undefined') return; // Node: الدوال النقية فقط

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  state.integrations = state.integrations || {};

  // ─── تحميل إعدادات التكاملات (تدرّج آمن) ───
  async function loadIntegrationSettings() {
    const { data, error } = await sb.from('integrations_settings')
      .select('provider, settings, connected_at').eq('tenant_id', state.tenant);
    if (error) return false; // الجدول غير موجود بعد
    (data || []).forEach(r => { state.integrations[r.provider] = r; });
    return true;
  }

  function _cfg(p) {
    const row = state.integrations[p];
    return (row && row.settings) || {};
  }
  function _readCardInputs(p) {
    const cfg = {};
    if ($('#ig-' + p + '-url')) cfg.store_url = $('#ig-' + p + '-url').value.trim();
    cfg.access_token = $('#ig-' + p + '-token').value.trim();
    if ($('#ig-' + p + '-mtoken')) cfg.manager_token = $('#ig-' + p + '-mtoken').value.trim();
    return cfg;
  }
  function _fillCard(p) {
    const cfg = _cfg(p);
    if ($('#ig-' + p + '-url')) $('#ig-' + p + '-url').value = cfg.store_url || '';
    if ($('#ig-' + p + '-token')) $('#ig-' + p + '-token').value = cfg.access_token || '';
    if ($('#ig-' + p + '-mtoken')) $('#ig-' + p + '-mtoken').value = cfg.manager_token || '';
    _badge(p);
  }
  function _badge(p) {
    const el = $('#ig-' + p + '-status'); if (!el) return;
    const row = state.integrations[p];
    const cfg = _cfg(p);
    const hasCreds = PROVIDERS[p].required.every(k => cfg[k]);
    if (row && row.connected_at)
      el.innerHTML = '<b style="color:#166534">● ' + t('ig_connected') + '</b>';
    else if (hasCreds)
      el.innerHTML = '<b style="color:#b45309">● ' + t('ig_configured') + '</b>';
    else
      el.innerHTML = '<b style="color:#7A6A5C">● ' + t('ig_disconnected') + '</b>';
  }

  // ─── حفظ الإعدادات (upsert) ───
  async function igSave(p) {
    const cfg = _readCardInputs(p);
    const rec = { tenant_id: state.tenant, provider: p, settings: cfg, updated_at: new Date().toISOString() };
    const { error } = await sb.from('integrations_settings')
      .upsert(rec, { onConflict: 'tenant_id,provider' });
    if (error) return toast(t('ig_save_fail') + ': ' + error.message + ' — ' + t('ig_need_sql'), false);
    state.integrations[p] = { ...(state.integrations[p] || {}), ...rec };
    _badge(p);
    toast(t('ig_saved'));
  }
  g.igSave = igSave;

  // رسالة CORS الإرشادية الموحدة (مع ذكر الـ Edge Function الجاهزة)
  function corsModal(p) {
    openModal(`<h3>⚠️ ${t('ig_cors_title')}</h3>
      <p style="line-height:2">${t('ig_cors_msg')}</p>
      <p dir="ltr" style="text-align:left;font-family:monospace;font-size:12px;background:#FAF6F1;padding:8px;border-radius:8px">edge-function-${p}-sync.ts</p>
      <p style="line-height:2;color:#7A6A5C;font-size:13px">${t('ig_cors_fix')}</p>
      <div class="modal-actions"><button class="btn btn-gold" onclick="closeModal()">${t('btn_ok')}</button></div>`);
  }

  // ─── اختبار الاتصال ───
  async function igTest(p) {
    const cfg = _readCardInputs(p);
    const missing = PROVIDERS[p].required.filter(k => !cfg[k]);
    if (missing.length) return toast(t('ig_missing_creds'), false);
    const btn = $('#ig-' + p + '-test'); if (btn) btn.disabled = true;
    try {
      const res = await fetch(PROVIDERS[p].testUrl(cfg), { headers: PROVIDERS[p].headers(cfg) });
      if (res.ok) {
        const { error } = await sb.from('integrations_settings').upsert({
          tenant_id: state.tenant, provider: p, settings: cfg,
          connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id,provider' });
        if (!error) state.integrations[p] = { provider: p, settings: cfg, connected_at: new Date().toISOString() };
        _badge(p);
        toast(t('ig_test_ok'));
      } else {
        toast(t('ig_test_fail') + ' (HTTP ' + res.status + ')', false);
      }
    } catch (e) { corsModal(p); }
    if (btn) btn.disabled = false;
  }
  g.igTest = igTest;

  // ─── العميل: إيجاد بالاسم أو إنشاء تلقائي ───
  async function ensureCustomer(name, phone) {
    name = (name || '').trim() || 'عميل متجر';
    let hit = (state.parties || []).find(x => x.kind === 'customer' && x.name === name);
    if (hit) return hit.id;
    const { data, error } = await sb.from('parties')
      .insert({ tenant_id: state.tenant, name, phone: phone || '', kind: 'customer' })
      .select('id').single();
    if (error) throw new Error(error.message);
    if (typeof loadParties === 'function') loadParties(); // تحديث الكاش بلا انتظار
    return data.id;
  }

  // ─── الصنف الخدمي العام «مبيعات متجر» (fallback) ───
  async function ensureStoreItem() {
    let it = (state.items || []).find(i => i.sku === 'STORE-SALE' || i.name === 'مبيعات متجر');
    if (it) return it.id;
    const { data, error } = await sb.from('items')
      .insert({ tenant_id: state.tenant, sku: 'STORE-SALE', name: 'مبيعات متجر',
                unit: 'خدمة', sale_price: 0 })
      .select('id').single();
    if (error) throw new Error(error.message);
    if (typeof loadItems === 'function') loadItems();
    return data.id;
  }

  // ─── تسجيل عملية مزامنة (تدرّج آمن) ───
  async function logSync(entry) {
    try {
      await sb.from('sync_logs').insert({
        tenant_id: state.tenant, provider: entry.provider, action: entry.action,
        fetched: entry.fetched, imported: entry.imported, skipped: entry.skipped,
        status: entry.status, errors: entry.errors });
    } catch (e) { /* الجدول غير موجود بعد */ }
  }

  // ─── المزامنة اليدوية «مزامنة الآن» ───
  async function igSync(p) {
    const cfg = _readCardInputs(p);
    const missing = PROVIDERS[p].required.filter(k => !cfg[k]);
    if (missing.length) return toast(t('ig_missing_creds'), false);
    const btn = $('#ig-' + p + '-sync'); if (btn) btn.disabled = true;
    const res = $('#ig-' + p + '-result');
    const errors = [];
    let fetched = 0, imported = 0, skipped = 0;
    try {
      // ١) جلب الطلبات من المتجر
      const r = await fetch(PROVIDERS[p].ordersUrl(cfg), { headers: PROVIDERS[p].headers(cfg) });
      if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { http: true });
      const json = await r.json();
      const rawOrders = PROVIDERS[p].parseOrders(json);
      fetched = rawOrders.length;
      const invoices = rawOrders.map(PROVIDERS[p].toInvoice).filter(v => v.lines.length);

      // ٢) منع التكرار: ما استُورد سابقاً يُتخطَّى
      const ids = invoices.map(v => v.externalId);
      const { data: existing, error: exErr } = await sb.from('sales_invoices')
        .select('external_order_id').eq('source', p).in('external_order_id', ids.length ? ids : ['—']);
      if (exErr && /external_order_id|source/.test(exErr.message)) {
        toast(t('ig_need_cols'), false);
        if (btn) btn.disabled = false;
        return;
      }
      const { newOrders, skipped: sk } = filterNewOrders(invoices, (existing || []).map(x => x.external_order_id));
      skipped = sk.length;

      // ٣) تحويل وترحيل كل طلب جديد عبر post_sales_invoice
      const fallbackItemId = newOrders.length ? await ensureStoreItem() : null;
      for (const inv of newOrders) {
        try {
          const customerId = await ensureCustomer(inv.customerName, inv.customerPhone);
          const lines = resolveOrderLines(inv.lines, state.items, fallbackItemId);
          const sum = summarizeLines(lines);
          const { data: number, error: postErr } = await sb.rpc('post_sales_invoice', {
            p_customer: customerId,
            p_lines: lines.map(({ item_id, qty, price }) => ({ item_id, qty, price })) });
          if (postErr) throw new Error(postErr.message);
          // ختم الفاتورة بالمصدر + الرقم الخارجي + الحقول الضريبية (تدرّج آمن)
          const { data: invRow } = await sb.from('sales_invoices').select('id')
            .eq('number', number).order('created_at', { ascending: false }).limit(1).single();
          if (invRow) {
            await sb.from('sales_invoices').update({ source: p, external_order_id: inv.externalId })
              .eq('id', invRow.id);
            if (typeof applyInvoiceTaxMeta === 'function')
              await applyInvoiceTaxMeta('sales', number, {
                invoice_type: 'simplified', buyer_vat_number: null, sum, lines });
          }
          imported++;
        } catch (e) {
          errors.push({ order: inv.externalId, error: e.message });
        }
      }
      const status = syncStatus(fetched - skipped, imported, errors.length);
      await logSync(formatSyncLog({ provider: p, fetched, imported, skipped, status, errors }));
      if (res) res.innerHTML =
        `<div class="logo-note">✅ ${t('ig_sync_result').replace('{x}', imported).replace('{y}', skipped)}` +
        (errors.length ? `<br><span style="color:#B42318">⚠️ ${errors.length} ${t('ig_sync_errors')}</span>` : '') + '</div>';
      toast(t('ig_sync_result').replace('{x}', imported).replace('{y}', skipped), !errors.length);
      if (typeof loadInvoices === 'function') loadInvoices();
      loadSyncLog();
    } catch (e) {
      if (e.http) {
        // رفض صريح من خادم المتجر (401/403/5xx)
        toast(t('ig_sync_fail') + ': ' + e.message, false);
        await logSync(formatSyncLog({ provider: p, fetched, imported, skipped, status: 'failed',
          errors: [{ error: e.message }] }));
        loadSyncLog();
      } else if (e instanceof TypeError) {
        // فشل الشبكة/CORS من fetch — إرشاد لنشر الـ Edge Function
        await logSync(formatSyncLog({ provider: p, fetched, imported, skipped, status: 'failed',
          errors: [{ error: 'network/CORS: ' + e.message }] }));
        loadSyncLog();
        corsModal(p);
      } else {
        // خطأ داخلي (قاعدة البيانات/الترحيل) — ليس CORS
        toast(t('ig_sync_fail') + ': ' + e.message, false);
        await logSync(formatSyncLog({ provider: p, fetched, imported, skipped, status: 'failed',
          errors: [{ error: e.message }] }));
        loadSyncLog();
      }
    }
    if (btn) btn.disabled = false;
  }
  g.igSync = igSync;

  // ─── سجل المزامنة ───
  const __syncErrs = []; // كاش أخطاء آخر سجل معروض (تفادي حقن علامات الاقتباس في onclick)
  async function loadSyncLog() {
    const tb = $('#tbl-synclog'); if (!tb) return;
    const { data, error } = await sb.from('sync_logs')
      .select('*').eq('tenant_id', state.tenant)
      .order('created_at', { ascending: false }).limit(50);
    if (error) {
      tb.innerHTML = '<tr><td colspan="7" style="color:#B42318">' + t('ig_need_sql_msg') + '</td></tr>';
      return;
    }
    const stLbl = (s) => ({ success: t('ig_st_success'), partial: t('ig_st_partial'),
                            failed: t('ig_st_failed') }[s] || s);
    const stColor = { success: '#166534', partial: '#b45309', failed: '#B42318' };
    const provLbl = (p) => (PROVIDERS[p] ? (currentLang() === 'ar' ? PROVIDERS[p].labelAr : PROVIDERS[p].labelEn) : p);
    __syncErrs.length = 0;
    tb.innerHTML = (data || []).map(r => {
      const errs = Array.isArray(r.errors) ? r.errors : [];
      const ei = errs.length ? __syncErrs.push(errs) - 1 : -1;
      return `<tr>
      <td>${new Date(r.created_at).toLocaleString(currentLang() === 'ar' ? 'ar-EG' : 'en-GB')}</td>
      <td>${esc(provLbl(r.provider))}</td>
      <td>${esc(r.action)}</td>
      <td>${r.fetched | 0}</td>
      <td style="color:#166534">${r.imported | 0}</td>
      <td>${r.skipped | 0}</td>
      <td><b style="color:${stColor[r.status] || '#7A6A5C'}">${stLbl(r.status)}</b>
        ${ei >= 0 ? `<button class="btn btn-ghost btn-sm" onclick="igShowErrors(${ei})">⚠️</button>` : ''}</td>
    </tr>`;
    }).join('') || '<tr><td colspan="7" style="color:#7A6A5C">' + t('ig_log_empty') + '</td></tr>';
  }
  g.igShowErrors = (idx) => {
    const errs = __syncErrs[idx] || [];
    openModal(`<h3>⚠️ ${t('ig_sync_errors')}</h3>
      <pre dir="ltr" style="text-align:left;max-height:220px;overflow:auto;background:#FAF6F1;padding:10px;border-radius:8px;font-size:12px">${esc(JSON.stringify(errs, null, 2))}</pre>
      <div class="modal-actions"><button class="btn btn-gold" onclick="closeModal()">${t('btn_close')}</button></div>`);
  };

  // ═══ مفاتيح API ═══
  async function loadApiKeys() {
    const tb = $('#tbl-apikeys'); if (!tb) return;
    const { data, error } = await sb.from('api_keys')
      .select('id, name, prefix, scope, created_at, last_used_at, revoked_at')
      .eq('tenant_id', state.tenant).order('created_at', { ascending: false });
    if (error) {
      tb.innerHTML = '<tr><td colspan="7" style="color:#B42318">' + t('ig_need_sql_msg') + '</td></tr>';
      return;
    }
    const dtf = (d) => d ? new Date(d).toLocaleDateString(currentLang() === 'ar' ? 'ar-EG' : 'en-GB') : '—';
    tb.innerHTML = (data || []).map(k => `<tr>
      <td>${esc(k.name)}</td>
      <td dir="ltr" style="font-family:monospace;font-size:12px">${esc(k.prefix)}…</td>
      <td>${k.scope === 'full' ? t('ak_scope_full') : t('ak_scope_read')}</td>
      <td>${dtf(k.created_at)}</td>
      <td>${dtf(k.last_used_at)}</td>
      <td>${k.revoked_at ? '<b style="color:#B42318">' + t('ak_revoked') + '</b>'
                         : '<b style="color:#166534">' + t('ak_active') + '</b>'}</td>
      <td>${k.revoked_at ? '' : `<button class="btn btn-danger" onclick="akRevoke('${k.id}')">${t('ak_revoke')}</button>`}</td>
    </tr>`).join('') || '<tr><td colspan="7" style="color:#7A6A5C">' + t('ak_empty') + '</td></tr>';
  }

  // توليد مفتاح جديد — يُعرض النص الصريح مرة واحدة فقط ثم يُخزَّن الهاش
  function akForm() {
    openModal(`<h3>🔑 ${t('ak_new')}</h3>
      <input id="f-akname" placeholder="${t('ak_name_ph')}">
      <select id="f-akscope">
        <option value="read">${t('ak_scope_read')}</option>
        <option value="full">${t('ak_scope_full')}</option>
      </select>
      <div class="modal-actions">
        <button class="btn btn-gold" id="f-akgen">${t('ak_generate')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);
    $('#f-akgen').onclick = async () => {
      const name = $('#f-akname').value.trim();
      if (!name) return toast(t('ak_name_req'), false);
      const scope = $('#f-akscope').value === 'full' ? 'full' : 'read';
      const key = generateApiKey();
      const hash = await apiKeyHash(key);
      const { error } = await sb.from('api_keys').insert({
        tenant_id: state.tenant, name, prefix: apiKeyPrefix(key), key_hash: hash,
        scope, created_by: state.user && state.user.id });
      if (error) return toast(t('ak_gen_fail') + ': ' + error.message + ' — ' + t('ig_need_sql'), false);
      openModal(`<h3>✅ ${t('ak_created')}</h3>
        <p style="line-height:2;color:#B42318;font-weight:bold">${t('ak_copy_warn')}</p>
        <pre dir="ltr" style="text-align:left;word-break:break-all;background:#FAF6F1;padding:12px;border-radius:8px;font-family:monospace;font-size:14px;user-select:all">${key}</pre>
        <div class="modal-actions"><button class="btn btn-gold" onclick="closeModal()">${t('btn_ok')}</button></div>`);
      loadApiKeys();
    };
  }
  g.akForm = akForm;

  g.akRevoke = async (id) => {
    if (!confirm(t('ak_revoke_confirm'))) return;
    const { error } = await sb.from('api_keys')
      .update({ revoked_at: new Date().toISOString() }).eq('id', id);
    if (error) return toast(error.message, false);
    toast(t('ak_revoked'));
    loadApiKeys();
  };

  // ─── تبديل التابات الفرعية ───
  g.switchIgSub = (sub) => {
    $$('#tab-integrations .sub-tab').forEach(b => b.classList.toggle('active', b.dataset.sub === sub));
    $$('#tab-integrations [id^="ig-pane-"]').forEach(p => p.classList.add('hidden'));
    $('#ig-pane-' + sub)?.classList.remove('hidden');
    if (sub === 'log') loadSyncLog();
    if (sub === 'apikeys') loadApiKeys();
  };

  // نقطة الدخول من switchTab في app.js (حارس التعريف هناك)
  g.loadIntegrationsTab = async () => {
    switchIgSub('stores');
    const okSql = await loadIntegrationSettings();
    if (!okSql) {
      const tb = $('#tbl-synclog');
      if (tb) tb.innerHTML = '<tr><td colspan="7" style="color:#B42318">' + t('ig_need_sql_msg') + '</td></tr>';
    }
    _fillCard('salla');
    _fillCard('zid');
    loadSyncLog();
    loadApiKeys();
  };
})(typeof window !== 'undefined' ? window : globalThis);
