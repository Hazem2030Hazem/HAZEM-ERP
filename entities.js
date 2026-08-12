/* ═══════════════════════════════════════════════════════════════
   HAZEM.ERP — دفعة v27: زاتكا متعدد الكيانات (الكيانات/الشركات الشقيقة)
   • منتقي كيان أعلى صندوق الإعدادات الضريبية: اختيار كيان يملأ النموذج،
     والحفظ يكتب على الكيان المختار (مع حفظ tenants للكيان الافتراضي كما كان).
   • زر «➕ إضافة كيان جديد» يفتح نموذجاً موسعاً (اسم/ضريبي/سجل/عنوان/مدينة/
     حي/رمز بريدي/لوجو/CSID) مع تحقق ^3\d{13}3$.
   • أول مرة: يُزرع كيان افتراضي من بيانات tenants الحالية (تدرّج آمن —
     أي فشل SQL/تهجير لا يكسر شيئاً).
   • window.__zentity() → الكيان الحالي (يستخدمه قالب طباعة «نموذج آفاق A4»).
   ═══════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const T = (k) => (typeof g.t === 'function' ? g.t(k) : k);

  let entities = [];
  let current = null; // الكيان المختار حالياً
  g.__zentity = () => current;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const validVat = (v) => !v || /^3\d{13}3$/.test(v);

  /* ── حقن واجهة المنتقي أعلى صندوق الإعدادات الضريبية ── */
  function injectPicker() {
    const box = $('#tax-settings-box');
    if (!box || $('#zentity-box')) return;
    const div = document.createElement('div');
    div.id = 'zentity-box';
    div.innerHTML = `
      <label class="lbl" data-i18n="ent_pick_lbl">${T('ent_pick_lbl')}</label>
      <div style="display:flex;gap:6px;margin-bottom:10px">
        <select id="zentity-picker" style="flex:1;margin-bottom:0"></select>
        <button type="button" class="btn btn-ghost btn-sm" id="zentity-add" data-i18n="ent_add">${T('ent_add')}</button>
        <button type="button" class="btn btn-ghost btn-sm hidden" id="zentity-edit" data-i18n="ent_edit">${T('ent_edit')}</button>
      </div>`;
    box.insertBefore(div, box.children[2] || null); // بعد العنوان والملاحظة
    $('#zentity-picker').onchange = () => selectEntity($('#zentity-picker').value);
    $('#zentity-add').onclick = () => entityForm(null);
    $('#zentity-edit').onclick = () => entityForm(current);
  }

  function fillPicker() {
    const sel = $('#zentity-picker');
    if (!sel) return;
    sel.innerHTML = entities.map(e =>
      `<option value="${e.id}">${esc(e.name)}${e.is_default ? ' ⭐' : ''}</option>`).join('');
    $('#zentity-edit')?.classList.toggle('hidden', !entities.length);
  }

  function fillForm(e) {
    if (!e) return;
    if ($('#tax-name')) {
      $('#tax-name').value = e.name || '';
      $('#tax-vat-number').value = e.vat_number || '';
      $('#tax-cr-number').value = e.cr_number || '';
      $('#tax-national-address').value = e.address ||
        [e.city, e.district, e.postal_code].filter(Boolean).join(' — ');
    }
  }

  async function selectEntity(id) {
    current = entities.find(e => String(e.id) === String(id)) || null;
    fillForm(current);
  }

  /* ── تحميل الكيانات + زرع الافتراضي أول مرة ── */
  async function loadEntities() {
    if (typeof sb === 'undefined' || !sb || !state.tenant) return;
    const { data, error } = await sb.from('haz_zatca_entities')
      .select('*').eq('tenant_id', state.tenant).order('created_at');
    if (error) return; // التهجير لم تُنفَّذ بعد — تدرّج آمن
    entities = data || [];
    if (!entities.length) {
      // زرع الكيان الافتراضي من بيانات tenants الحالية
      const t0 = state.tax || {};
      const seed = {
        tenant_id: state.tenant, is_default: true,
        name: t0.tax_name || state.tenantName || '',
        vat_number: t0.vat_number || '', cr_number: t0.cr_number || '',
        address: t0.national_address || '',
      };
      const ins = await sb.from('haz_zatca_entities').insert(seed).select().single();
      if (!ins.error && ins.data) entities = [ins.data];
    }
    fillPicker();
    if (entities.length) {
      const def = entities.find(e => e.is_default) || entities[0];
      $('#zentity-picker').value = def.id;
      selectEntity(def.id);
    }
  }
  g.loadZatcaEntities = loadEntities;

  /* ── نموذج إضافة/تعديل كيان ── */
  function entityForm(e) {
    openModal(`
      <h3>${e ? T('ent_edit') : T('ent_add_title')}</h3>
      <label class="lbl">${T('ent_name')}</label><input id="ze-name" value="${esc(e?.name)}">
      <label class="lbl">${T('ent_vat')}</label>
      <input id="ze-vat" dir="ltr" style="text-align:left" maxlength="15" value="${esc(e?.vat_number)}" placeholder="3xxxxxxxxxxxx3">
      <label class="lbl">${T('ent_cr')}</label>
      <input id="ze-cr" dir="ltr" style="text-align:left" value="${esc(e?.cr_number)}">
      <label class="lbl">${T('ent_addr')}</label><input id="ze-addr" value="${esc(e?.address)}">
      <div style="display:flex;gap:6px">
        <input id="ze-city" placeholder="${T('ent_city')}" value="${esc(e?.city)}" style="flex:1">
        <input id="ze-district" placeholder="${T('ent_district')}" value="${esc(e?.district)}" style="flex:1">
        <input id="ze-postal" placeholder="${T('ent_postal')}" dir="ltr" value="${esc(e?.postal_code)}" style="flex:1">
      </div>
      <label class="lbl">${T('ent_logo')}</label>
      <input id="ze-logo" dir="ltr" style="text-align:left" value="${esc(e?.logo_url)}" placeholder="https://…">
      <label style="display:flex;gap:8px;align-items:center;margin:6px 0">
        <input type="checkbox" id="ze-default" ${e?.is_default ? 'checked' : ''} style="width:auto;margin:0"> ${T('ent_is_default')}</label>
      <div class="modal-actions">
        <button class="btn btn-gold" id="ze-save">${T('btn_save') || 'حفظ'}</button>
        <button class="btn btn-ghost" onclick="closeModal()">${T('btn_cancel') || 'إلغاء'}</button>
      </div>`);
    $('#ze-save').onclick = async () => {
      const rec = {
        tenant_id: state.tenant,
        name: $('#ze-name').value.trim(),
        vat_number: $('#ze-vat').value.trim(),
        cr_number: $('#ze-cr').value.trim(),
        address: $('#ze-addr').value.trim(),
        city: $('#ze-city').value.trim(),
        district: $('#ze-district').value.trim(),
        postal_code: $('#ze-postal').value.trim(),
        logo_url: $('#ze-logo').value.trim() || null,
        is_default: $('#ze-default').checked,
      };
      if (!rec.name) return toast(T('ent_name') + ' — ✕', false);
      if (!validVat(rec.vat_number)) return toast(T('tax_invalid_vat'), false);
      if (rec.is_default) // افتراضي واحد: نزيل العلم عن الباقي
        await sb.from('haz_zatca_entities').update({ is_default: false })
          .eq('tenant_id', state.tenant).eq('is_default', true);
      const r = e
        ? await sb.from('haz_zatca_entities').update(rec).eq('id', e.id)
        : await sb.from('haz_zatca_entities').insert(rec);
      if (r.error) return toast(T('ent_save_failed') + ': ' + r.error.message, false);
      closeModal(); toast(T('ent_saved'));
      await loadEntities();
      if (!e && entities.length) { $('#zentity-picker').value = entities[entities.length - 1].id; selectEntity(entities[entities.length - 1].id); }
    };
  }

  /* ── الحفظ من زر الإعدادات الضريبية: يكتب على الكيان المختار أيضاً ── */
  function hookSave() {
    const btn = $('#btn-save-tax');
    if (!btn || btn.__zeHooked) return;
    btn.__zeHooked = true;
    btn.addEventListener('click', async () => {
      // يعمل بعد معالج app.js (يحفظ tenants) — نحدّث الكيان المختار بنفس القيم
      setTimeout(async () => {
        if (!current || typeof sb === 'undefined' || !sb) return;
        const vat = $('#tax-vat-number').value.trim();
        if (!validVat(vat)) return;
        const rec = {
          name: $('#tax-name').value.trim(), vat_number: vat,
          cr_number: $('#tax-cr-number').value.trim(),
          address: $('#tax-national-address').value.trim(),
        };
        const r = await sb.from('haz_zatca_entities').update(rec).eq('id', current.id);
        if (!r.error) { Object.assign(current, rec); fillPicker(); }
      }, 400);
    });
  }

  /* ── تغليف تحميل الإعدادات الضريبية ليشمل الكيانات ── */
  function boot() {
    injectPicker(); hookSave();
    if (typeof g.loadTaxSettings === 'function' && !g.loadTaxSettings.__zeWrapped) {
      const orig = g.loadTaxSettings;
      const wrapped = async () => { await orig(); await loadEntities(); };
      wrapped.__zeWrapped = true;
      // loadTaxSettings معرّفة كدالة عامة في app.js — نستبدل خاصية window
      g.loadTaxSettings = wrapped;
    }
    loadEntities();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
