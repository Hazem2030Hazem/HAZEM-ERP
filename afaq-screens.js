/* ═══════════════════════════════════════════════════════════════
   HAZEM.ERP — المرحلة 20 (v28): شاشات بنود القوائم المتبقية
   كل بند قائمة يفتح نافذة afaq كلاسيكية ببيانات حقيقية (صفر stubs).
   • CRUD عام على haz_lookups (دول/مدن/مناطق/جنسيات/مجموعات/كفلاء/
     وحدات/مستندات/عروض/سياسات...) مع بذور افتراضية.
   • أذون مخزون (استلام/صرف/إعدام/تحويل/تفكيك/تعبئة/مرتبط/استلام محولة)
     تكتب حركات فعلية في stock_movements + سجل haz_stock_vouchers،
     مع مسودات وشاشة «اعتماد وترحيل المخازن».
   • جرد (adjust_stock الموجود)، تعديل أسعار جماعي، نسخ احتياطي/استرجاع
     JSON، تتبع مستخدمين (haz_user_log)، رسائل جوال (إعدادات)، حجز
     كميات (haz_reservations)، تقارير (تكلفة/نقاط بيع/تسلسل/تنبيهات).
   يعمل عبر window.sb / state الموجودين — تدرّج آمن لو الجداول لم تُهجَّر.
   ═══════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const T = (k) => (typeof g.t === 'function' ? g.t(k) : k);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = () => (typeof state !== 'undefined' && state) ? state : {};
  const tid = () => st().tenant;
  const toastOk = (m) => g.toast && toast(m);
  const toastErr = (m) => g.toast && toast(m, false);
  const dbReady = () => (typeof sb !== 'undefined' && sb && tid());
  const fmtN = (n) => (Number(n || 0)).toLocaleString('en-US', { maximumFractionDigits: 2 });

  /* سجل تتبع المستخدمين */
  async function logAct(action, details) {
    try {
      if (!dbReady()) return;
      await sb.from('haz_user_log').insert({
        tenant_id: tid(), user_email: st().user?.email || '—', action, details: details || null });
    } catch (e) { /* ignore */ }
  }
  g.afaqLog = logAct;

  /* ───────── أدوات بناء النوافذ ───────── */
  function winShell(title, w, h) {
    const el = document.createElement('div');
    const win = g.afaqOpenWindow({ title, body: el, w: w || 900, h: h || 560 });
    return { el, win, q: (s) => el.querySelector(s), qa: (s) => Array.from(el.querySelectorAll(s)) };
  }
  const gridHtml = (heads, rowsHtml) =>
    `<table class="afx-grid"><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
     <tbody>${rowsHtml || `<tr><td colspan="${heads.length}" style="text-align:center;color:#777">${T('s20_no_data')}</td></tr>`}</tbody></table>`;

  async function dbSelect(table, cols, order) {
    if (!dbReady()) return { data: null, error: { message: 'offline' } };
    let qy = sb.from(table).select(cols || '*').eq('tenant_id', tid());
    if (order) qy = qy.order(order);
    return qy;
  }

  /* ═════════ 1) CRUD عام على haz_lookups ═════════ */
  const LOOKUP_COLS = [
    { key: 'code', lbl: 's20_code' }, { key: 'name', lbl: 's20_name' },
    { key: 'name_en', lbl: 's20_name_en' }, { key: 'extra', lbl: 's20_extra' },
  ];

  function lookupCrud(type, titleKey, opts = {}) {
    const { el, win, q } = winShell(T(titleKey), 820, 540);
    let rows = [];
    const cols = (opts.cols || LOOKUP_COLS).concat([{ key: 'active', lbl: 's20_active' }]);
    async function reload() {
      const { data, error } = await dbSelect('haz_lookups', '*', 'name');
      if (error) { q('.bd').innerHTML = `<div class="afx-stub">${T('s20_need_sql')}<br><small>hazem-stage20.sql</small></div>`; return; }
      rows = (data || []).filter(r => r.type === type);
      render();
    }
    function render() {
      q('.bd').innerHTML = gridHtml(cols.map(c => T(c.lbl)) .concat(['']),
        rows.map(r => `<tr>${cols.map(c =>
          `<td>${c.key === 'active' ? (r.active ? '✔' : '✖') : esc(r[c.key] ?? '')}</td>`).join('')}
          <td style="white-space:nowrap">
            <button class="afx-btn" data-e="${r.id}">${T('afx_btn_edit')}</button>
            <button class="afx-btn" data-d="${r.id}">${T('afx_btn_del')}</button>
          </td></tr>`).join(''));
      q('.bd').querySelectorAll('[data-e]').forEach(b => b.onclick = () => form(rows.find(r => r.id === b.dataset.e)));
      q('.bd').querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
        if (!confirm(T('s20_del_confirm'))) return;
        const { error } = await sb.from('haz_lookups').delete().eq('id', b.dataset.d);
        if (error) return toastErr(error.message);
        toastOk(T('s20_deleted')); reload();
      });
    }
    function form(r) {
      openModal(`<h3>${r ? T('afx_btn_edit') : T('btn_add')} — ${T(titleKey)}</h3>
        ${cols.filter(c => c.key !== 'active').map(c =>
          `<label class="lbl">${T(c.lbl)}</label><input id="lk-${c.key}" value="${esc(r?.[c.key])}">`).join('')}
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="lk-active" style="width:auto;margin:0" ${!r || r.active ? 'checked' : ''}> ${T('s20_active')}</label>
        <div class="modal-actions">
          <button class="btn btn-gold" id="lk-save">${T('btn_save') || 'حفظ'}</button>
          <button class="btn btn-ghost" onclick="closeModal()">${T('btn_cancel') || 'إلغاء'}</button>
        </div>`);
      q('#lk-name')?.focus();
      $('#lk-save').onclick = async () => {
        const rec = { tenant_id: tid(), type, active: $('#lk-active').checked };
        cols.filter(c => c.key !== 'active').forEach(c => rec[c.key] = $(`#lk-${c.key}`).value.trim());
        if (!rec.name) return toastErr(T('s20_name') + ' ✕');
        const rq = r
          ? await sb.from('haz_lookups').update(rec).eq('id', r.id)
          : await sb.from('haz_lookups').insert(rec);
        if (rq.error) return toastErr(rq.error.message);
        closeModal(); toastOk(T('s20_saved')); logAct('lookup_save', type + ': ' + rec.name); reload();
      };
    }
    el.innerHTML = `<div class="afx-sinv-toolbar">
        <button class="afx-btn afx-green" id="lk-add">${T('btn_add')}</button>
        ${opts.seeds ? `<button class="afx-btn" id="lk-seed">${T('s20_seed')}</button>` : ''}
      </div><div class="bd" style="max-height:420px;overflow:auto"></div>`;
    q('#lk-add').onclick = () => form(null);
    if (opts.seeds) q('#lk-seed').onclick = async () => {
      const list = opts.seeds.filter(s => !rows.some(r => r.name === s.name));
      if (!list.length) return toastOk(T('s20_seeded'));
      const { error } = await sb.from('haz_lookups')
        .insert(list.map(s => ({ tenant_id: tid(), type, active: true, ...s })));
      if (error) return toastErr(error.message);
      toastOk(T('s20_seeded')); reload();
    };
    reload();
    return win;
  }

  /* بذور البيانات الأساسية */
  const SEEDS = {
    country: [
      { code: 'SA', name: 'المملكة العربية السعودية', name_en: 'Saudi Arabia' },
      { code: 'AE', name: 'الإمارات العربية المتحدة', name_en: 'UAE' },
      { code: 'KW', name: 'الكويت', name_en: 'Kuwait' }, { code: 'BH', name: 'البحرين', name_en: 'Bahrain' },
      { code: 'QA', name: 'قطر', name_en: 'Qatar' }, { code: 'OM', name: 'عُمان', name_en: 'Oman' },
      { code: 'EG', name: 'مصر', name_en: 'Egypt' }, { code: 'JO', name: 'الأردن', name_en: 'Jordan' },
      { code: 'YE', name: 'اليمن', name_en: 'Yemen' },
    ],
    city: [
      { code: 'RUH', name: 'الرياض', name_en: 'Riyadh' }, { code: 'JED', name: 'جدة', name_en: 'Jeddah' },
      { code: 'MKK', name: 'مكة المكرمة', name_en: 'Makkah' }, { code: 'MDN', name: 'المدينة المنورة', name_en: 'Madinah' },
      { code: 'DMM', name: 'الدمام', name_en: 'Dammam' }, { code: 'KHB', name: 'الخبر', name_en: 'Khobar' },
      { code: 'TIF', name: 'الطائف', name_en: 'Taif' }, { code: 'ABH', name: 'أبها', name_en: 'Abha' },
      { code: 'TBJ', name: 'تبوك', name_en: 'Tabuk' }, { code: 'HOF', name: 'الهفوف', name_en: 'Hofuf' },
    ],
    region: [
      { code: 'R01', name: 'منطقة الرياض' }, { code: 'R02', name: 'منطقة مكة المكرمة' },
      { code: 'R03', name: 'منطقة المدينة المنورة' }, { code: 'R04', name: 'المنطقة الشرقية' },
      { code: 'R05', name: 'منطقة عسير' }, { code: 'R06', name: 'منطقة تبوك' },
    ],
    nationality: [
      { code: 'SA', name: 'سعودي', name_en: 'Saudi' }, { code: 'EG', name: 'مصري', name_en: 'Egyptian' },
      { code: 'YE', name: 'يمني', name_en: 'Yemeni' }, { code: 'PK', name: 'باكستاني', name_en: 'Pakistani' },
      { code: 'IN', name: 'هندي', name_en: 'Indian' }, { code: 'PH', name: 'فلبيني', name_en: 'Filipino' },
      { code: 'SY', name: 'سوري', name_en: 'Syrian' }, { code: 'JO', name: 'أردني', name_en: 'Jordanian' },
      { code: 'SD', name: 'سوداني', name_en: 'Sudanese' }, { code: 'BD', name: 'بنجلاديشي', name_en: 'Bangladeshi' },
    ],
  };

  /* شاشة موحدة بتبويبات: الدول/المدن/المناطق/الجنسيات */
  function geoScreen() {
    const { el, q, qa } = winShell(T('s20_geo_title'), 860, 560);
    const types = [
      ['country', 'afx_sys_countries'], ['city', 'afx_sys_cities'],
      ['region', 'afx_sys_regions'], ['nationality', 'afx_sys_nats'],
    ];
    el.innerHTML = `<div class="afx-sinv-toolbar" id="geo-tabs">${types.map(([ty, k], i) =>
      `<button class="afx-btn ${i === 0 ? 'afx-green' : ''}" data-ty="${ty}">${T(k)}</button>`).join('')}</div>
      <div id="geo-body"></div>`;
    function mount(ty, btn) {
      qa('#geo-tabs .afx-btn').forEach(b => b.classList.remove('afx-green'));
      btn.classList.add('afx-green');
      q('#geo-body').innerHTML = '';
      // نافذة CRUD داخلية — نعيد استخدام lookupCrud بحاوية بديلة
      const holder = document.createElement('div');
      q('#geo-body').appendChild(holder);
      const sub = lookupCrudInto(holder, ty, SEEDS[ty]);
    }
    qa('#geo-tabs .afx-btn').forEach(b => b.onclick = () => mount(b.dataset.ty, b));
    mount('country', q('#geo-tabs .afx-btn'));
  }

  /* نسخة CRUD تُركَّب داخل حاوية بدل نافذة (للتبويبات) */
  function lookupCrudInto(holder, type, seeds) {
    let rows = [];
    const heads = [T('s20_code'), T('s20_name'), T('s20_name_en'), ''];
    async function reload() {
      const { data, error } = await dbSelect('haz_lookups', '*', 'name');
      if (error) { holder.querySelector('.bd').innerHTML = `<div class="afx-stub">${T('s20_need_sql')}<br><small>hazem-stage20.sql</small></div>`; return; }
      rows = (data || []).filter(r => r.type === type);
      holder.querySelector('.bd').innerHTML = gridHtml(heads, rows.map(r =>
        `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td>${esc(r.name_en)}</td>
         <td><button class="afx-btn" data-e="${r.id}">${T('afx_btn_edit')}</button>
             <button class="afx-btn" data-d="${r.id}">${T('afx_btn_del')}</button></td></tr>`).join(''));
      holder.querySelectorAll('[data-e]').forEach(b => b.onclick = () => form(rows.find(r => r.id === b.dataset.e)));
      holder.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
        if (!confirm(T('s20_del_confirm'))) return;
        await sb.from('haz_lookups').delete().eq('id', b.dataset.d); reload();
      });
    }
    function form(r) {
      openModal(`<h3>${r ? T('afx_btn_edit') : T('btn_add')}</h3>
        <label class="lbl">${T('s20_code')}</label><input id="lk2-code" value="${esc(r?.code)}">
        <label class="lbl">${T('s20_name')}</label><input id="lk2-name" value="${esc(r?.name)}">
        <label class="lbl">${T('s20_name_en')}</label><input id="lk2-name_en" value="${esc(r?.name_en)}">
        <div class="modal-actions"><button class="btn btn-gold" id="lk2-save">${T('btn_save') || 'حفظ'}</button>
        <button class="btn btn-ghost" onclick="closeModal()">${T('btn_cancel') || 'إلغاء'}</button></div>`);
      $('#lk2-save').onclick = async () => {
        const rec = { tenant_id: tid(), type, code: $('#lk2-code').value.trim(),
          name: $('#lk2-name').value.trim(), name_en: $('#lk2-name_en').value.trim(), active: true };
        if (!rec.name) return toastErr(T('s20_name') + ' ✕');
        const rq = r ? await sb.from('haz_lookups').update(rec).eq('id', r.id)
                     : await sb.from('haz_lookups').insert(rec);
        if (rq.error) return toastErr(rq.error.message);
        closeModal(); reload();
      };
    }
    holder.innerHTML = `<div class="afx-sinv-toolbar">
      <button class="afx-btn afx-green" id="lk2-add">${T('btn_add')}</button>
      ${seeds ? `<button class="afx-btn" id="lk2-seed">${T('s20_seed')}</button>` : ''}
      </div><div class="bd" style="max-height:400px;overflow:auto"></div>`;
    holder.querySelector('#lk2-add').onclick = () => form(null);
    if (seeds) holder.querySelector('#lk2-seed').onclick = async () => {
      const list = seeds.filter(s => !rows.some(r => r.name === s.name));
      if (list.length) await sb.from('haz_lookups').insert(list.map(s => ({ tenant_id: tid(), type, active: true, ...s })));
      toastOk(T('s20_seeded')); reload();
    };
    reload();
  }

  /* ═════════ 2) الوحدات (مع الكسر العشري) + ربط نموذج الصنف ═════════ */
  function unitsScreen() {
    return lookupCrud('unit', 'afx_iv_units', {
      cols: [{ key: 'name', lbl: 's20_unit' }, { key: 'code', lbl: 's20_symbol' },
             { key: 'extra', lbl: 's20_decimals' }, { key: 'active', lbl: 's20_active' }],
      seeds: [
        { name: 'حبة', code: 'PCS', extra: '0' }, { name: 'كرتونة', code: 'BOX', extra: '0' },
        { name: 'كيلو', code: 'KG', extra: '3' }, { name: 'متر', code: 'M', extra: '2' },
        { name: 'لتر', code: 'L', extra: '2' }, { name: 'علبة', code: 'PKT', extra: '0' },
      ],
    });
  }
  // تغذية حقل الوحدة في نموذج الصنف من جدول الوحدات
  async function feedItemUnits() {
    try {
      if (!dbReady()) return;
      const { data } = await sb.from('haz_lookups').select('name,code')
        .eq('tenant_id', tid()).eq('type', 'unit').eq('active', true);
      let dl = document.getElementById('units-dl');
      if (!dl) { dl = document.createElement('datalist'); dl.id = 'units-dl'; document.body.appendChild(dl); }
      const list = (data && data.length ? data : [{ name: 'حبة' }, { name: 'PCS' }]);
      dl.innerHTML = list.map(u => `<option value="${esc(u.name)}">`).join('');
      const f = document.getElementById('f-unit');
      if (f) f.setAttribute('list', 'units-dl');
    } catch (e) { /* ignore */ }
  }
  g.afaqFeedItemUnits = feedItemUnits;

  /* ═════════ 3) أذون المخزون (استلام/صرف/إعدام/تحويل/تفكيك/تعبئة/مرتبط) ═════════ */
  const VOUCHER_TYPES20 = {
    receipt:            { title: 'afx_iv_rcv',       sign: +1, reason: 'goods_receipt' },
    issue:              { title: 'afx_iv_issue',     sign: -1, reason: 'goods_issue' },
    destroy:            { title: 'afx_iv_destroy',   sign: -1, reason: 'goods_destroy' },
    disassemble:        { title: 'afx_iv_disassemble', sign: -1, reason: 'disassemble' },
    pack:               { title: 'afx_iv_pack',      sign: +1, reason: 'packing' },
    transfer:           { title: 'afx_iv_transfer',  transfer: true },
    transfer_linked:    { title: 'afx_iv_transfer_rcv', transfer: true, transit: true },
  };

  function stockVoucherScreen(vtype) {
    const VT = VOUCHER_TYPES20[vtype];
    const { el, q, qa } = winShell(T(VT.title), 1000, 620);
    const S = st();
    const itemOpts = (S.items || []).map(i =>
      `<option value="${i.id}" data-price="${i.purchase_price ?? i.sale_price ?? 0}">${esc(i.name)}</option>`).join('');
    const whOpts = (S.warehouses || []).map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')
      || `<option value="">${T('afx_sinv_wh_main')}</option>`;

    el.innerHTML = `
      <div class="afx-sinv-form"><div class="cols" style="grid-template-columns:auto 1fr auto 1fr auto 1fr">
        <span class="afx-lbl">${T('afx_sinv_date')}</span><input type="date" id="sv-date" value="${new Date().toISOString().slice(0, 10)}" dir="ltr">
        <span class="afx-lbl">${T('afx_sinv_wh')}</span><select id="sv-wh">${whOpts}</select>
        ${VT.transfer ? `<span class="afx-lbl">${T('s20_wh_to')}</span><select id="sv-wh2">${whOpts}</select>` : ''}
        <span class="afx-lbl">${T('afx_sinv_desc')}</span><input id="sv-memo">
        <span class="afx-lbl">${T('s20_save_draft')}</span><input type="checkbox" id="sv-draft">
      </div></div>
      <table class="afx-grid" id="sv-grid"><thead><tr>
        <th>${T('afx_sinv_m')}</th><th>${T('afx_sinv_item')}</th><th>${T('afx_sinv_qty')}</th>
        ${VT.transfer ? '' : `<th>${T('afx_sinv_price')}</th>`}<th></th>
      </tr></thead><tbody></tbody></table>
      <button class="afx-btn" id="sv-addline" style="margin-top:4px">+ ${T('s20_add_line')}</button>
      <div class="afx-sinv-actions">
        <button class="afx-btn afx-green" id="sv-save">${T('s20_post')}</button>
        <button class="afx-btn" id="sv-exit">${T('afx_btn_exit')}</button>
      </div>
      <fieldset class="afx-sec"><legend>${T('s20_history')}</legend>
        <div id="sv-history" style="max-height:150px;overflow:auto"></div></fieldset>`;

    function addLine() {
      const tb = q('#sv-grid tbody');
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${tb.children.length + 1}</td>
        <td><select class="v-item">${itemOpts}</select></td>
        <td><input class="v-qty" type="number" min="0" step="any" value="1" dir="ltr"></td>
        ${VT.transfer ? '' : `<td><input class="v-price" type="number" min="0" step="any" dir="ltr"></td>`}
        <td><button class="afx-btn v-del">✕</button></td>`;
      tb.appendChild(tr);
      const sel = tr.querySelector('.v-item');
      const pr = tr.querySelector('.v-price');
      if (pr) { pr.value = sel.selectedOptions[0]?.dataset.price ?? 0;
        sel.onchange = () => pr.value = sel.selectedOptions[0]?.dataset.price ?? 0; }
      tr.querySelector('.v-del').onclick = () => tr.remove();
    }
    q('#sv-addline').onclick = addLine; addLine();
    q('#sv-exit').onclick = () => el.closest('.afx-win').close();

    async function history() {
      const box = q('#sv-history');
      if (!dbReady()) { box.innerHTML = '—'; return; }
      const { data } = await sb.from('haz_stock_vouchers').select('*')
        .eq('tenant_id', tid()).eq('vtype', vtype).order('created_at', { ascending: false }).limit(15);
      box.innerHTML = gridHtml([T('afx_sinv_number'), T('afx_sinv_date'), T('s20_status'), T('afx_sinv_desc')],
        (data || []).map(v => `<tr><td>${v.number}</td>
          <td dir="ltr">${new Date(v.created_at).toLocaleDateString('ar-EG')}</td>
          <td>${T('s20_st_' + v.status) || v.status}</td><td>${esc(v.memo)}</td></tr>`).join(''));
    }
    history();

    q('#sv-save').onclick = async () => {
      if (!dbReady()) return toastErr(T('s20_need_sql'));
      const rows = qa('#sv-grid tbody tr').map(tr => ({
        item_id: tr.querySelector('.v-item').value,
        qty: Number(tr.querySelector('.v-qty').value),
        unit_price: Number(tr.querySelector('.v-price')?.value || 0),
      })).filter(r => r.item_id && r.qty > 0);
      if (!rows.length) return toastErr(T('msg_check_lines'));
      const whId = q('#sv-wh').value || null, wh2Id = q('#sv-wh2')?.value || null;
      if (VT.transfer && whId && wh2Id && whId === wh2Id) return toastErr(T('s20_same_wh'));
      const draft = q('#sv-draft').checked;
      const status = draft ? 'draft' : (VT.transit ? 'in_transit' : 'posted');
      const { data: v, error } = await sb.from('haz_stock_vouchers').insert({
        tenant_id: tid(), vtype, wh_id: whId, wh2_id: wh2Id,
        memo: q('#sv-memo').value.trim(), status }).select().single();
      if (error) return toastErr(error.message);
      const { error: e2 } = await sb.from('haz_stock_voucher_lines')
        .insert(rows.map(r => ({ tenant_id: tid(), voucher_id: v.id, ...r })));
      if (e2) return toastErr(e2.message);
      if (!draft) {
        const fail = await postVoucherMovements({ ...v, status }, rows, VT);
        if (fail) return toastErr(fail);
      }
      toastOk(T('s20_posted') + (draft ? ' (' + T('s20_st_draft') + ')' : ''));
      logAct('stock_voucher', VT.title + ' #' + v.number);
      if (typeof loadItems === 'function') loadItems();
      history();
    };

    async function postVoucherMovements(v, rows, VT2) {
      if (VT2.transfer) {
        for (const r of rows) {
          if (VT2.transit) continue; // المرتبط بالاستلام: الحركة عند الاستلام فعلياً
          const { error } = await sb.rpc('transfer_stock', {
            p_tenant: tid(), p_item: r.item_id, p_from_wh: v.wh_id, p_to_wh: v.wh2_id, p_qty: r.qty });
          if (error) return error.message;
        }
        return null;
      }
      const whId = v.wh_id || (await mainWh());
      const { error } = await sb.from('stock_movements').insert(rows.map(r => ({
        tenant_id: tid(), item_id: r.item_id, warehouse_id: whId,
        qty: VT2.sign * r.qty, reason: VT2.reason,
      })));
      return error ? error.message : null;
    }
    async function mainWh() {
      const { data } = await sb.from('warehouses').select('id').eq('is_main', true).limit(1).maybeSingle();
      return data?.id || q('#sv-wh').value || null;
    }
    g.__postVoucherMovements = postVoucherMovements; // تستخدمه شاشة الاعتماد
  }

  /* ═════════ 4) اعتماد وترحيل المخازن (مسودات الأذون) ═════════ */
  function stockApprovalScreen() {
    const { el, q } = winShell(T('afx_iv_post'), 900, 560);
    async function reload() {
      if (!dbReady()) { q('.bd').innerHTML = T('s20_need_sql'); return; }
      const { data } = await sb.from('haz_stock_vouchers').select('*, haz_stock_voucher_lines(item_id, qty, unit_price)')
        .eq('tenant_id', tid()).eq('status', 'draft').order('created_at', { ascending: false });
      q('.bd').innerHTML = gridHtml(
        [T('afx_sinv_number'), T('s20_type'), T('afx_sinv_date'), T('s20_lines'), T('afx_sinv_desc'), ''],
        (data || []).map(v => `<tr><td>${v.number}</td><td>${T((VOUCHER_TYPES20[v.vtype] || {}).title) || v.vtype}</td>
          <td dir="ltr">${new Date(v.created_at).toLocaleDateString('ar-EG')}</td>
          <td>${(v.haz_stock_voucher_lines || []).length}</td><td>${esc(v.memo)}</td>
          <td><button class="afx-btn afx-green" data-p="${v.id}">${T('s20_post')}</button></td></tr>`).join(''));
      q('.bd').querySelectorAll('[data-p]').forEach(b => b.onclick = async () => {
        const v = (data || []).find(x => x.id === b.dataset.p);
        const VT = VOUCHER_TYPES20[v.vtype];
        const fail = await g.__postVoucherMovements(v, v.haz_stock_voucher_lines || [], VT);
        if (fail) return toastErr(fail);
        await sb.from('haz_stock_vouchers').update({ status: 'posted' }).eq('id', v.id);
        toastOk(T('s20_posted')); logAct('stock_approve', v.vtype + ' #' + v.number); reload();
      });
    }
    el.innerHTML = `<div class="bd" style="max-height:480px;overflow:auto"></div>`;
    reload();
  }

  /* ═════════ 5) استلام بضاعة محولة (تحويلات in_transit) ═════════ */
  function receiveTransferredScreen() {
    const { el, q } = winShell(T('afx_iv_receive'), 900, 560);
    async function reload() {
      if (!dbReady()) { q('.bd').innerHTML = T('s20_need_sql'); return; }
      const { data } = await sb.from('haz_stock_vouchers').select('*, haz_stock_voucher_lines(item_id, qty)')
        .eq('tenant_id', tid()).eq('status', 'in_transit').order('created_at', { ascending: false });
      q('.bd').innerHTML = gridHtml(
        [T('afx_sinv_number'), T('afx_sinv_date'), T('s20_lines'), T('afx_sinv_desc'), ''],
        (data || []).map(v => `<tr><td>${v.number}</td>
          <td dir="ltr">${new Date(v.created_at).toLocaleDateString('ar-EG')}</td>
          <td>${(v.haz_stock_voucher_lines || []).length}</td><td>${esc(v.memo)}</td>
          <td><button class="afx-btn afx-green" data-r="${v.id}">${T('s20_receive')}</button></td></tr>`).join(''));
      q('.bd').querySelectorAll('[data-r]').forEach(b => b.onclick = async () => {
        const v = (data || []).find(x => x.id === b.dataset.r);
        for (const r of (v.haz_stock_voucher_lines || [])) {
          const { error } = await sb.rpc('transfer_stock', {
            p_tenant: tid(), p_item: r.item_id, p_from_wh: v.wh_id, p_to_wh: v.wh2_id, p_qty: r.qty });
          if (error) return toastErr(error.message);
        }
        await sb.from('haz_stock_vouchers').update({ status: 'done' }).eq('id', v.id);
        toastOk(T('s20_received')); logAct('stock_receive', '#' + v.number); reload();
      });
    }
    el.innerHTML = `<div class="bd" style="max-height:480px;overflow:auto"></div>`;
    reload();
  }

  /* ═════════ 6) حجز / فك حجز كميات ═════════ */
  function reservationScreen(releaseMode) {
    const title = T(releaseMode ? 'afx_iv_unhold' : 'afx_iv_hold');
    const { el, q } = winShell(title, 900, 580);
    const S = st();
    const itemOpts = (S.items || []).map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join('');
    const whOpts = (S.warehouses || []).map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
    el.innerHTML = `
      ${!releaseMode ? `<div class="afx-sinv-form"><div class="cols">
        <span class="afx-lbl">${T('afx_sinv_item')}</span><select id="rs-item">${itemOpts}</select>
        <span class="afx-lbl">${T('afx_sinv_wh')}</span><select id="rs-wh"><option value="">—</option>${whOpts}</select>
        <span class="afx-lbl">${T('afx_sinv_qty')}</span><input id="rs-qty" type="number" min="0" step="any" dir="ltr" value="1">
        <span class="afx-lbl">${T('afx_sinv_desc')}</span><input id="rs-memo">
      </div></div>
      <button class="afx-btn afx-green" id="rs-add">${T('afx_iv_hold')}</button><hr>` : ''}
      <div class="bd" style="max-height:380px;overflow:auto"></div>`;
    async function reload() {
      if (!dbReady()) { q('.bd').innerHTML = T('s20_need_sql'); return; }
      const { data } = await sb.from('haz_reservations').select('*')
        .eq('tenant_id', tid()).eq('status', 'held').order('created_at', { ascending: false });
      q('.bd').innerHTML = gridHtml([T('afx_sinv_item'), T('afx_sinv_qty'), T('afx_sinv_date'), T('afx_sinv_desc'), ''],
        (data || []).map(r => {
          const it = (st().items || []).find(i => i.id === r.item_id);
          return `<tr><td>${esc(it?.name || r.item_id)}</td><td dir="ltr">${fmtN(r.qty)}</td>
            <td dir="ltr">${new Date(r.created_at).toLocaleDateString('ar-EG')}</td><td>${esc(r.memo)}</td>
            <td><button class="afx-btn" data-u="${r.id}">${T('afx_iv_unhold')}</button></td></tr>`;
        }).join(''));
      q('.bd').querySelectorAll('[data-u]').forEach(b => b.onclick = async () => {
        await sb.from('haz_reservations').update({ status: 'released' }).eq('id', b.dataset.u);
        toastOk(T('s20_released')); reload();
      });
    }
    if (!releaseMode) q('#rs-add').onclick = async () => {
      const rec = { tenant_id: tid(), item_id: q('#rs-item').value,
        wh_id: q('#rs-wh').value || null, qty: Number(q('#rs-qty').value),
        memo: q('#rs-memo').value.trim() };
      if (!rec.item_id || !(rec.qty > 0)) return toastErr(T('msg_check_lines'));
      const { error } = await sb.from('haz_reservations').insert(rec);
      if (error) return toastErr(error.message);
      toastOk(T('s20_saved')); logAct('reserve', rec.qty); reload();
    };
    reload();
  }

  /* ═════════ 7) تعديل أسعار الأصناف (جماعي) ═════════ */
  function priceUpdateScreen() {
    const { el, q } = winShell(T('afx_iv_prices'), 950, 600);
    const items = st().items || [];
    el.innerHTML = `
      <div class="afx-sinv-form"><div class="cols" style="grid-template-columns:auto 1fr auto 1fr auto 1fr">
        <span class="afx-lbl">${T('s20_scope')}</span>
        <select id="pu-scope"><option value="all">${T('s20_all_items')}</option><option value="pick">${T('s20_picked')}</option></select>
        <span class="afx-lbl">${T('s20_mode')}</span>
        <select id="pu-mode"><option value="pct">${T('s20_pct')}</option><option value="val">${T('s20_value')}</option></select>
        <span class="afx-lbl">${T('s20_amount')}</span><input id="pu-amt" type="number" step="any" dir="ltr" value="0">
      </div></div>
      <div style="max-height:330px;overflow:auto" class="bd"></div>
      <div class="afx-sinv-actions">
        <button class="afx-btn afx-green" id="pu-apply">${T('s20_apply')}</button>
        <button class="afx-btn" id="pu-exit">${T('afx_btn_exit')}</button>
      </div>`;
    function render() {
      const pick = q('#pu-scope').value === 'pick';
      q('.bd').innerHTML = gridHtml([pick ? T('afx_stmt_pick') : '—', T('afx_sinv_item'), T('s20_old_price'), T('s20_new_price')],
        items.map(i => {
          const nw = compute(i.sale_price || 0);
          return `<tr><td style="text-align:center">${pick ? `<input type="checkbox" class="pu-pick" data-id="${i.id}" checked>` : '✔'}</td>
            <td>${esc(i.name)}</td><td dir="ltr">${fmtN(i.sale_price)}</td>
            <td dir="ltr" class="${nw !== (i.sale_price || 0) ? 'afx-green' : ''}" style="font-weight:700">${fmtN(nw)}</td></tr>`;
        }).join(''));
    }
    function compute(p) {
      const a = Number(q('#pu-amt').value || 0);
      const nw = q('#pu-mode').value === 'pct' ? p * (1 + a / 100) : p + a;
      return Math.max(0, Math.round(nw * 10000) / 10000);
    }
    q('#pu-scope').onchange = render; q('#pu-mode').onchange = render; q('#pu-amt').oninput = render;
    q('#pu-exit').onclick = () => el.closest('.afx-win').close();
    q('#pu-apply').onclick = async () => {
      if (!dbReady()) return toastErr(T('s20_need_sql'));
      if (!confirm(T('s20_apply_confirm'))) return;
      const pick = q('#pu-scope').value === 'pick';
      const ids = pick ? Array.from(q('.bd').querySelectorAll('.pu-pick:checked')).map(c => c.dataset.id) : null;
      let done = 0, failed = 0;
      for (const i of items) {
        if (ids && !ids.includes(i.id)) continue;
        const nw = compute(i.sale_price || 0);
        if (nw === (i.sale_price || 0)) continue;
        const { error } = await sb.from('items').update({ sale_price: nw }).eq('id', i.id);
        error ? failed++ : done++;
      }
      toastOk(`${T('s20_updated')}: ${done}` + (failed ? ` — ✕${failed}` : ''));
      logAct('price_update', done + ' items');
      if (typeof loadItems === 'function') await loadItems();
      render();
    };
    render();
  }

  /* ═════════ 8) جرد المخزون / محضر الجرد (أرصدة + تسوية عبر adjust_stock) ═════════ */
  function stockCountScreen() {
    const { el, q } = winShell(T('afx_iv_count'), 950, 620);
    const whOpts = (st().warehouses || []).map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
    el.innerHTML = `
      <div class="afx-sinv-toolbar"><span class="afx-lbl">${T('afx_sinv_wh')}</span>
        <select id="ct-wh"><option value="">—</option>${whOpts}</select>
        <button class="afx-btn" id="ct-load">${T('s20_load')}</button></div>
      <div class="bd" style="max-height:400px;overflow:auto"></div>
      <div class="afx-sinv-actions"><button class="afx-btn afx-green" id="ct-settle">${T('s20_settle')}</button></div>`;
    let rows = [];
    q('#ct-load').onclick = async () => {
      if (!dbReady()) return toastErr(T('s20_need_sql'));
      const whId = q('#ct-wh').value;
      let qy = sb.from('v_item_balances').select('*').eq('tenant_id', tid());
      if (whId) qy = qy.eq('warehouse_id', whId);
      const { data, error } = await qy;
      if (error) return toastErr(error.message);
      rows = (data || []).map(r => ({ ...r, counted: r.balance }));
      q('.bd').innerHTML = gridHtml([T('afx_sinv_item'), T('s20_book'), T('s20_counted'), T('s20_diff')],
        rows.map((r, i) => {
          const it = (st().items || []).find(x => x.id === r.item_id);
          return `<tr><td>${esc(it?.name || r.item_id)}</td><td dir="ltr">${fmtN(r.balance)}</td>
            <td><input type="number" step="any" dir="ltr" class="ct-cnt" data-i="${i}" value="${r.counted}"></td>
            <td dir="ltr" class="ct-diff" data-i="${i}">0</td></tr>`;
        }).join(''));
      q('.bd').querySelectorAll('.ct-cnt').forEach(inp => inp.oninput = () => {
        const r = rows[Number(inp.dataset.i)];
        r.counted = Number(inp.value);
        inp.closest('tr').querySelector('.ct-diff').textContent = fmtN(r.counted - r.balance);
      });
    };
    q('#ct-settle').onclick = async () => {
      const whId = q('#ct-wh').value;
      if (!whId) return toastErr(T('afx_sinv_wh') + ' ✕');
      const changed = rows.filter(r => Number(r.counted) !== Number(r.balance));
      if (!changed.length) return toastOk(T('s20_no_diff'));
      let ok = 0, failed = 0;
      for (const r of changed) {
        const { error } = await sb.rpc('adjust_stock', {
          p_tenant: tid(), p_item: r.item_id, p_wh: whId,
          p_counted: Number(r.counted), p_memo: T('afx_iv_count') });
        error ? failed++ : ok++;
      }
      toastOk(`${T('s20_posted')}: ${ok}` + (failed ? ` — ✕${failed}` : ''));
      logAct('stock_count', ok + ' items');
      if (typeof loadItems === 'function') loadItems();
      q('#ct-load').click();
    };
  }

  /* ═════════ 9) تحديد السنة الفعالة ═════════ */
  function fiscalYearScreen() {
    const { el, q } = winShell(T('afx_sys_activeyear'), 460, 300);
    const yr = new Date().getFullYear();
    const active = localStorage.getItem('haz_active_fy') || String(yr);
    el.innerHTML = `<div style="padding:14px">
      <label class="lbl">${T('afx_sys_years')}</label>
      <select id="fy-sel" style="width:100%">${[yr - 1, yr, yr + 1].map(y =>
        `<option ${String(y) === active ? 'selected' : ''}>${y}</option>`).join('')}</select>
      <div style="margin-top:14px;text-align:center">
        <button class="afx-btn afx-green" id="fy-save">${T('btn_save') || 'حفظ'}</button></div></div>`;
    q('#fy-save').onclick = () => {
      localStorage.setItem('haz_active_fy', q('#fy-sel').value);
      const si = document.getElementById('afx-si-fy');
      if (si) si.textContent = q('#fy-sel').value;
      toastOk(T('s20_saved')); logAct('set_fy', q('#fy-sel').value);
      el.closest('.afx-win').close();
    };
  }

  /* ═════════ 10) تتبع المستخدمين ═════════ */
  function userTrackScreen() {
    const { el, q } = winShell(T('afx_rp_users'), 950, 600);
    el.innerHTML = `<div class="bd" style="max-height:520px;overflow:auto"></div>`;
    (async () => {
      if (!dbReady()) { q('.bd').innerHTML = T('s20_need_sql'); return; }
      const { data } = await sb.from('haz_user_log').select('*')
        .eq('tenant_id', tid()).order('created_at', { ascending: false }).limit(200);
      q('.bd').innerHTML = gridHtml([T('afx_user'), T('s20_action'), T('s20_details'), T('afx_sinv_date')],
        (data || []).map(r => `<tr><td>${esc(r.user_email)}</td><td>${esc(r.action)}</td>
          <td>${esc(r.details)}</td><td dir="ltr">${new Date(r.created_at).toLocaleString('ar-EG')}</td></tr>`).join(''));
    })();
  }

  /* ═════════ 11) رسائل الجوال (إعدادات بوابة SMS) ═════════ */
  function smsScreen() {
    const { el, q } = winShell(T('afx_sys_sms'), 560, 460);
    el.innerHTML = `<div style="padding:8px">
      <label class="lbl">${T('s20_provider')}</label><input id="sm-provider" style="width:100%">
      <label class="lbl">API URL</label><input id="sm-url" dir="ltr" style="width:100%;text-align:left">
      <label class="lbl">API Key</label><input id="sm-key" dir="ltr" style="width:100%;text-align:left">
      <label class="lbl">${T('s20_sender')}</label><input id="sm-sender" style="width:100%">
      <label style="display:flex;gap:8px;align-items:center;margin:8px 0">
        <input type="checkbox" id="sm-enabled" style="width:auto;margin:0"> ${T('s20_enabled')}</label>
      <div class="afx-sinv-actions">
        <button class="afx-btn afx-green" id="sm-save">${T('btn_save') || 'حفظ'}</button>
        <button class="afx-btn" id="sm-test">${T('s20_test')}</button>
      </div></div>`;
    (async () => {
      if (!dbReady()) return;
      const { data } = await sb.from('haz_sms_settings').select('*').eq('tenant_id', tid()).maybeSingle();
      if (data) {
        q('#sm-provider').value = data.provider || ''; q('#sm-url').value = data.api_url || '';
        q('#sm-key').value = data.api_key || ''; q('#sm-sender').value = data.sender || '';
        q('#sm-enabled').checked = !!data.enabled;
      }
    })();
    q('#sm-save').onclick = async () => {
      if (!dbReady()) return toastErr(T('s20_need_sql'));
      const rec = { tenant_id: tid(), provider: q('#sm-provider').value.trim(),
        api_url: q('#sm-url').value.trim(), api_key: q('#sm-key').value.trim(),
        sender: q('#sm-sender').value.trim(), enabled: q('#sm-enabled').checked };
      const { error } = await sb.from('haz_sms_settings').upsert(rec, { onConflict: 'tenant_id' });
      if (error) return toastErr(error.message);
      toastOk(T('s20_saved')); logAct('sms_settings');
    };
    q('#sm-test').onclick = () =>
      toastOk(T('s20_sms_test_note'));
  }

  /* ═════════ 12) النسخ الاحتياطي / الاسترجاع ═════════ */
  const BACKUP_TABLES = ['items', 'parties', 'accounts', 'invoices', 'invoice_lines',
    'purchase_invoices', 'vouchers', 'warehouses', 'haz_lookups', 'haz_reservations',
    'haz_stock_vouchers', 'haz_stock_voucher_lines'];
  function backupScreen() {
    const { el, q } = winShell(T('afx_sys_backup'), 560, 320);
    el.innerHTML = `<div style="padding:16px;text-align:center">
      <p>${T('s20_backup_note')}</p>
      <button class="afx-btn afx-green" id="bk-go">${T('afx_sys_backup')}</button>
      <div id="bk-res" style="margin-top:12px;font-size:12px;color:#555"></div></div>`;
    q('#bk-go').onclick = async () => {
      if (!dbReady()) return toastErr(T('s20_need_sql'));
      const dump = { app: 'HAZEM.ERP', version: 28, tenant: tid(), at: new Date().toISOString(), tables: {} };
      for (const tb of BACKUP_TABLES) {
        try {
          const { data } = await sb.from(tb).select('*').eq('tenant_id', tid());
          dump.tables[tb] = data || [];
        } catch (e) { dump.tables[tb] = []; }
      }
      const blob = new Blob([JSON.stringify(dump, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `hazem-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(a.href);
      q('#bk-res').textContent = Object.entries(dump.tables).map(([k, v]) => `${k}: ${v.length}`).join(' — ');
      logAct('backup', Object.keys(dump.tables).length + ' tables');
    };
  }
  function restoreScreen() {
    const { el, q } = winShell(T('afx_sys_restore'), 620, 420);
    el.innerHTML = `<div style="padding:16px">
      <p>${T('s20_restore_note')}</p>
      <input type="file" id="rs-file" accept=".json" style="width:100%">
      <div id="rs-sum" style="margin:10px 0;font-size:12.5px"></div>
      <button class="afx-btn afx-green hidden" id="rs-go">${T('s20_restore_go')}</button></div>`;
    let dump = null;
    q('#rs-file').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { dump = JSON.parse(await f.text()); } catch { return toastErr(T('s20_bad_file')); }
      if (!dump.tables) return toastErr(T('s20_bad_file'));
      q('#rs-sum').innerHTML = gridHtml([T('s20_table'), T('s20_rows')],
        Object.entries(dump.tables).map(([k, v]) => `<tr><td dir="ltr">${esc(k)}</td><td dir="ltr">${v.length}</td></tr>`).join(''));
      q('#rs-go').classList.remove('hidden');
    };
    q('#rs-go').onclick = async () => {
      if (!dump || !dbReady()) return toastErr(T('s20_need_sql'));
      if (!confirm(T('s20_restore_confirm'))) return;
      let ok = 0, fail = 0;
      for (const [tb, rows] of Object.entries(dump.tables)) {
        if (!BACKUP_TABLES.includes(tb) || !rows.length) continue;
        const { error } = await sb.from(tb).upsert(rows.map(r => ({ ...r, tenant_id: tid() })));
        error ? fail++ : ok++;
      }
      toastOk(`${T('s20_done')}: ${ok}` + (fail ? ` — ✕${fail}` : ''));
      logAct('restore', ok + ' tables');
      if (typeof loadItems === 'function') loadItems();
    };
  }

  /* ═════════ 13) تقارير: تتبع نقاط البيع / تتبع التكلفة / استعلام التسلسل / تنبيهات اليوم ═════════ */
  function posTrackScreen() {
    const { el, q } = winShell(T('afx_pos_rtrack'), 950, 600);
    el.innerHTML = `<div class="bd" style="max-height:520px;overflow:auto"></div>`;
    (async () => {
      if (!dbReady()) { q('.bd').innerHTML = T('s20_need_sql'); return; }
      const { data } = await sb.from('pos_shifts').select('*')
        .eq('tenant_id', tid()).order('opened_at', { ascending: false }).limit(100);
      q('.bd').innerHTML = gridHtml([T('s20_shift'), T('afx_user'), T('s20_opened'), T('s20_closed'),
          T('s20_status'), T('afx_sinv_total')],
        (data || []).map(s => `<tr><td>${s.number ?? s.id}</td><td>${esc(s.cashier || s.user_email || '—')}</td>
          <td dir="ltr">${s.opened_at ? new Date(s.opened_at).toLocaleString('ar-EG') : '—'}</td>
          <td dir="ltr">${s.closed_at ? new Date(s.closed_at).toLocaleString('ar-EG') : '—'}</td>
          <td>${esc(s.status || '—')}</td><td dir="ltr">${fmtN(s.total_sales ?? s.expected_cash)}</td></tr>`).join(''));
    })();
  }

  function costTrackScreen() {
    const { el, q } = winShell(T('afx_iv_cost'), 950, 600);
    el.innerHTML = `<div class="bd" style="max-height:520px;overflow:auto"></div>`;
    (async () => {
      if (!dbReady()) { q('.bd').innerHTML = T('s20_need_sql'); return; }
      const { data: bals } = await sb.from('v_item_balances').select('item_id, balance').eq('tenant_id', tid());
      const items = st().items || [];
      const rows = (bals || []).map(b => {
        const it = items.find(i => i.id === b.item_id) || {};
        const cost = Number(it.purchase_price ?? it.cost_price ?? it.sale_price ?? 0);
        return { name: it.name || b.item_id, bal: b.balance, cost, val: b.balance * cost };
      });
      const tot = rows.reduce((a, r) => a + r.val, 0);
      q('.bd').innerHTML = gridHtml([T('afx_sinv_item'), T('s20_book'), T('s20_unit_cost'), T('s20_total_cost')],
        rows.map(r => `<tr><td>${esc(r.name)}</td><td dir="ltr">${fmtN(r.bal)}</td>
          <td dir="ltr">${fmtN(r.cost)}</td><td dir="ltr">${fmtN(r.val)}</td></tr>`).join('')) +
        `<div style="text-align:left;font-weight:800;margin-top:6px">${T('afx_sinv_gtotal')}: ${fmtN(tot)}</div>`;
    })();
  }

  function serialScreen() {
    const { el, q } = winShell(T('afx_iv_serial') + ' (Ctrl+F7)', 850, 560);
    el.innerHTML = `
      <div class="afx-sinv-toolbar"><span class="afx-lbl">${T('afx_stmt_search')}</span>
        <input id="sr-q" dir="ltr" style="flex:1">
        <button class="afx-btn afx-green" id="sr-go">${T('s20_search')}</button></div>
      <div class="bd" style="max-height:420px;overflow:auto"></div>`;
    const run = async () => {
      const txt = q('#sr-q').value.trim(); if (!txt || !dbReady()) return;
      const like = `%${txt}%`;
      const { data: mvs } = await sb.from('stock_movements').select('*')
        .eq('tenant_id', tid()).or(`reason.ilike.${like},memo.ilike.${like}`).limit(50);
      const its = (st().items || []).filter(i => (i.barcode || '').includes(txt) || (i.sku || '').includes(txt));
      q('.bd').innerHTML =
        `<h4 style="margin:4px 0">${T('afx_iv_items')}</h4>` +
        gridHtml([T('afx_sinv_code'), T('afx_sinv_item')],
          its.map(i => `<tr><td dir="ltr">${esc(i.sku || i.barcode)}</td><td>${esc(i.name)}</td></tr>`).join('')) +
        `<h4 style="margin:8px 0 4px">${T('s20_movements')}</h4>` +
        gridHtml([T('afx_sinv_date'), T('afx_sinv_item'), T('afx_sinv_qty'), T('s20_reason')],
          (mvs || []).map(m => {
            const it = (st().items || []).find(i => i.id === m.item_id);
            return `<tr><td dir="ltr">${new Date(m.created_at).toLocaleDateString('ar-EG')}</td>
              <td>${esc(it?.name || m.item_id)}</td><td dir="ltr">${fmtN(m.qty)}</td><td>${esc(m.reason)}</td></tr>`;
          }).join(''));
    };
    q('#sr-go').onclick = run;
    q('#sr-q').onkeydown = (e) => { if (e.key === 'Enter') run(); };
    q('#sr-q').focus();
  }

  function alertsTodayScreen() {
    const { el, q } = winShell(T('afx_sys_alerts'), 850, 560);
    el.innerHTML = `<div class="bd" style="max-height:480px;overflow:auto"></div>`;
    (async () => {
      if (!dbReady()) { q('.bd').innerHTML = T('s20_need_sql'); return; }
      const d0 = new Date(); d0.setHours(0, 0, 0, 0);
      const { data: invs } = await sb.from('invoices').select('id, number, total, created_at')
        .eq('tenant_id', tid()).gte('created_at', d0.toISOString());
      const { data: vs } = await sb.from('vouchers').select('id, number, total, created_at, voucher_type')
        .eq('tenant_id', tid()).gte('created_at', d0.toISOString());
      const tot = (invs || []).reduce((a, x) => a + Number(x.total || 0), 0);
      q('.bd').innerHTML =
        `<h4>${T('s20_today_sales')}: ${(invs || []).length} — ${fmtN(tot)}</h4>` +
        gridHtml([T('afx_sinv_number'), T('afx_sinv_total'), T('afx_sinv_date')],
          (invs || []).map(x => `<tr><td>${x.number ?? x.id}</td><td dir="ltr">${fmtN(x.total)}</td>
            <td dir="ltr">${new Date(x.created_at).toLocaleTimeString('ar-EG')}</td></tr>`).join('')) +
        `<h4>${T('s20_today_vouchers')}: ${(vs || []).length}</h4>` +
        gridHtml([T('afx_sinv_number'), T('s20_type'), T('afx_sinv_total')],
          (vs || []).map(x => `<tr><td>${x.number ?? x.id}</td><td>${esc(x.voucher_type)}</td>
            <td dir="ltr">${fmtN(x.total)}</td></tr>`).join(''));
    })();
  }

  function alertCfgScreen() {
    const { el, q } = winShell(T('afx_sys_alertcfg'), 460, 260);
    const cfg = JSON.parse(localStorage.getItem('haz_alert_cfg') || '{}');
    el.innerHTML = `<div style="padding:14px">
      <label style="display:flex;gap:8px;align-items:center;margin:6px 0">
        <input type="checkbox" id="ac-daily" style="width:auto;margin:0" ${cfg.daily ? 'checked' : ''}> ${T('s20_alert_daily')}</label>
      <label style="display:flex;gap:8px;align-items:center;margin:6px 0">
        <input type="checkbox" id="ac-low" style="width:auto;margin:0" ${cfg.low ? 'checked' : ''}> ${T('s20_alert_low')}</label>
      <div style="text-align:center;margin-top:12px">
        <button class="afx-btn afx-green" id="ac-save">${T('btn_save') || 'حفظ'}</button></div></div>`;
    q('#ac-save').onclick = () => {
      localStorage.setItem('haz_alert_cfg', JSON.stringify({ daily: q('#ac-daily').checked, low: q('#ac-low').checked }));
      toastOk(T('s20_saved')); el.closest('.afx-win').close();
    };
  }

  /* ═════════ 14) تغيير فرع الموظف / إعدادات قاعدة البيانات / دليل الاستخدام / مراكز التكلفة ═════════ */
  function empBranchScreen() {
    const { el, q } = winShell(T('afx_sys_empbranch'), 560, 300);
    el.innerHTML = `<div style="padding:12px">
      <label class="lbl">${T('afx_sys_emps')}</label><select id="eb-emp" style="width:100%"></select>
      <label class="lbl">${T('afx_sys_branches')}</label><select id="eb-br" style="width:100%"></select>
      <div style="text-align:center;margin-top:12px">
        <button class="afx-btn afx-green" id="eb-save">${T('btn_save') || 'حفظ'}</button></div></div>`;
    (async () => {
      if (!dbReady()) return;
      const [{ data: emps }, { data: brs }] = await Promise.all([
        sb.from('employees').select('id, name, branch_id').eq('tenant_id', tid()),
        sb.from('branches').select('id, name').eq('tenant_id', tid())]);
      q('#eb-emp').innerHTML = (emps || []).map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
      q('#eb-br').innerHTML = (brs || []).map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    })();
    q('#eb-save').onclick = async () => {
      const { error } = await sb.from('employees')
        .update({ branch_id: q('#eb-br').value || null }).eq('id', q('#eb-emp').value);
      if (error) return toastErr(error.message);
      toastOk(T('s20_saved')); logAct('emp_branch');
      el.closest('.afx-win').close();
    };
  }

  function dbCfgScreen() {
    const { el, q } = winShell(T('afx_sys_dbcfg'), 560, 300);
    const url = (typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : '';
    el.innerHTML = `<div style="padding:14px;line-height:2.2">
      <div><b>${T('afx_server')}:</b> <span dir="ltr">${esc(url ? new URL(url).hostname : location.hostname)}</span></div>
      <div><b>${T('afx_db')}:</b> <span dir="ltr">${esc(url ? new URL(url).pathname.replace('/', '') : 'HAZEM.ERP')}</span></div>
      <div><b>${T('afx_version')}:</b> V28.0 — ${T('afx_copy_one')}</div>
      <div style="color:#777;font-size:12px">${T('s20_dbcfg_note')}</div></div>`;
  }

  function guideScreen() {
    const { el } = winShell(T('afx_hlp_guide'), 700, 540);
    const sections = [
      ['afx_m_system', 'الشركات والفروع والسنوات والمستخدمين وبيانات الأساس (دول/مدن/جنسيات...) — كلها من قائمة النظام.'],
      ['afx_m_inv', 'تعريف الأصناف والمخازن والوحدات، أذون الاستلام والصرف والتحويل والإعدام، الجرد، الباركود، الأسعار، الحجز.'],
      ['afx_m_sales', 'عروض الأسعار وفواتير المبيعات والمرتجعات — نافذة فاتورة المبيعات بنمط آفاق مع الدفعات والضريبة.'],
      ['afx_m_glrep', 'كشف الحساب وميزان المراجعة وقائمة الدخل والمركز المالي — تُفتح في نوافذ مستقلة قابلة للطباعة.'],
      ['afx_m_integrated', 'الفوترة الإلكترونية (زاتكا) والكيانات/الشركات الشقيقة وإشعارات مدين/دائن.'],
    ];
    el.innerHTML = `<div style="padding:12px;line-height:2">
      <h3 style="margin-top:0">HAZEM.ERP — ${T('afx_hlp_guide')}</h3>
      ${sections.map(([k, d]) => `<div style="margin-bottom:8px"><b>◈ ${T(k)}:</b> ${d}</div>`).join('')}
      <hr><div style="color:#555;font-size:12px">V28.0 — ${T('afx_copy_one')}</div></div>`;
  }

  function ccReportScreen(mode) {
    const titles = { levels: 'afx_gr_cc_levels', acc: 'afx_gr_cc_acc', acccc: 'afx_gr_acc_cc' };
    const { el, q } = winShell(T(titles[mode]), 850, 560);
    el.innerHTML = `<div class="bd" style="max-height:480px;overflow:auto"></div>`;
    (async () => {
      if (!dbReady()) { q('.bd').innerHTML = T('s20_need_sql'); return; }
      const { data: ccs } = await sb.from('cost_centers').select('*').eq('tenant_id', tid()).order('code');
      const rows = ccs || [];
      if (mode === 'levels') {
        const byParent = (p) => rows.filter(r => (r.parent_id || null) === p);
        const walk = (p, d) => byParent(p).map(r =>
          `<tr><td>${'— '.repeat(d)}${esc(r.code || '')} ${esc(r.name)}</td></tr>` + walk(r.id, d + 1)).join('');
        q('.bd').innerHTML = gridHtml([T('afx_set_cost')], walk(null, 0));
      } else {
        q('.bd').innerHTML = gridHtml([T('s20_code'), T('s20_name'), T('afx_stmt_parent')],
          rows.map(r => {
            const p = rows.find(x => x.id === r.parent_id);
            return `<tr><td dir="ltr">${esc(r.code)}</td><td>${esc(r.name)}</td><td>${esc(p?.name || '—')}</td></tr>`;
          }).join(''));
      }
    })();
  }

  /* ═════════ 15) عمولات المناديب (تقرير مبيعات يومية — أقل منطق صادق) ═════════ */
  function commRepsScreen() {
    const { el, q } = winShell(T('afx_sa_comm'), 900, 560);
    el.innerHTML = `<div class="bd" style="max-height:480px;overflow:auto"></div>`;
    (async () => {
      if (!dbReady()) { q('.bd').innerHTML = T('s20_need_sql'); return; }
      const d0 = new Date(Date.now() - 30 * 864e5);
      const { data } = await sb.from('invoices').select('total, created_at')
        .eq('tenant_id', tid()).gte('created_at', d0.toISOString()).order('created_at', { ascending: false });
      const byDay = {};
      (data || []).forEach(x => {
        const d = x.created_at.slice(0, 10);
        byDay[d] = byDay[d] || { n: 0, tot: 0 };
        byDay[d].n++; byDay[d].tot += Number(x.total || 0);
      });
      q('.bd').innerHTML = gridHtml([T('afx_sinv_date'), T('s20_inv_count'), T('afx_sinv_total')],
        Object.entries(byDay).map(([d, v]) =>
          `<tr><td dir="ltr">${d}</td><td dir="ltr">${v.n}</td><td dir="ltr">${fmtN(v.tot)}</td></tr>`).join(''));
    })();
  }

  /* ═════════ 16) «المزيد» — نظرة على كل أنواع البيانات ═════════ */
  function moreDataScreen() {
    const { el, q } = winShell(T('afx_iv_more2'), 850, 560);
    el.innerHTML = `<div class="bd" style="max-height:480px;overflow:auto"></div>`;
    (async () => {
      if (!dbReady()) { q('.bd').innerHTML = T('s20_need_sql'); return; }
      const { data } = await sb.from('haz_lookups').select('type').eq('tenant_id', tid());
      const cnt = {};
      (data || []).forEach(r => cnt[r.type] = (cnt[r.type] || 0) + 1);
      q('.bd').innerHTML = gridHtml([T('s20_type'), T('s20_rows')],
        Object.entries(cnt).map(([ty, n]) => `<tr><td dir="ltr">${esc(ty)}</td><td dir="ltr">${n}</td></tr>`).join(''));
    })();
  }

  /* ═════════ السجل + نقطة الدخول ═════════ */
  const SCREENS = {
    geo: geoScreen, countries: geoScreen, cities: geoScreen, regions: geoScreen, nationalities: geoScreen,
    supgrps: () => lookupCrud('supgrp', 'afx_sys_supgrps'),
    custgrps: () => lookupCrud('custgrp', 'afx_sys_custgrps'),
    sponsors: () => lookupCrud('sponsor', 'afx_sys_sponsors'),
    doctypes: () => lookupCrud('doctype', 'afx_sys_doctypes'),
    docclass: () => lookupCrud('docclass', 'afx_sys_docclass'),
    units: unitsScreen,
    item_groups: () => lookupCrud('item_group', 'afx_iv_groups'),
    item_companies: () => lookupCrud('item_company', 'afx_iv_itemcos'),
    item_specs: () => lookupCrud('item_spec', 'afx_iv_specs'),
    group_levels: () => lookupCrud('group_level', 'afx_iv_levels'),
    item_max: () => lookupCrud('item_max', 'afx_iv_max'),
    more_data: moreDataScreen,
    offers: () => lookupCrud('offer', 'afx_sa_offers'),
    comm_policy: () => lookupCrud('comm_policy', 'afx_sa_compol'),
    comm_reps: commRepsScreen,
    fy: fiscalYearScreen,
    usertrack: userTrackScreen,
    sms: smsScreen,
    backup: backupScreen, restore: restoreScreen, dbcfg: dbCfgScreen,
    postrack: posTrackScreen, costtrack: costTrackScreen, serial: serialScreen,
    priceupdate: priceUpdateScreen,
    hold: () => reservationScreen(false), unhold: () => reservationScreen(true),
    receipt: () => stockVoucherScreen('receipt'), issue: () => stockVoucherScreen('issue'),
    destroy: () => stockVoucherScreen('destroy'), transfer: () => stockVoucherScreen('transfer'),
    transfer_linked: () => stockVoucherScreen('transfer_linked'),
    disassemble: () => stockVoucherScreen('disassemble'), pack: () => stockVoucherScreen('pack'),
    receive_transferred: receiveTransferredScreen,
    stock_approve: stockApprovalScreen,
    stockcount: stockCountScreen,
    alerts_today: alertsTodayScreen, alert_cfg: alertCfgScreen,
    emp_branch: empBranchScreen, guide: guideScreen,
    cc_levels: () => ccReportScreen('levels'), cc_acc: () => ccReportScreen('acc'),
    acc_cc: () => ccReportScreen('acccc'),
  };
  g.openAfaqScreen = (id) => {
    if (SCREENS[id]) { logAct('open_screen', id); return SCREENS[id](); }
    if (g.afaqStub) g.afaqStub(id);
  };

  // تسجيل الدخول في سجل تتبع المستخدمين (مرة واحدة لكل جلسة)
  let loggedIn = false;
  const loginTimer = setInterval(() => {
    if (loggedIn || !dbReady() || !st().user) return;
    loggedIn = true; clearInterval(loginTimer);
    logAct('login', location.hostname);
  }, 3000);
})(typeof window !== 'undefined' ? window : globalThis);
