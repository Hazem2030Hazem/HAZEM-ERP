/* ═══════════════════════════════════════════════════════════════
   HAZEM.ERP — المرحلة 13: الأصول الثابتة والإهلاك
   جزآن في ملف واحد (بلا build step):
   • منطق نقي قابل للاختبار في Node: جداول الإهلاك (قسط ثابت /
     قسط متناقص / وحدات إنتاج)، احتساب الاستبعاد، بناء سطور القيود.
   • واجهات المتصفح (بعد app.js): سجل الأصول، الفئات، ترحيل
     الإهلاك الشهري، جدول إهلاك الأصل، الاستبعاد/البيع، التقارير.
   قرارات موثقة:
   • بداية الإهلاك: من الشهر التالي لتاريخ الشراء افتراضياً
     (قابل للإعداد لكل أصل dep_start_next_month).
   • القسط الثابت: (التكلفة − الخردة)/العمر شهرياً، القسط الأخير
     يمتص فروقات التقريب. المتناقص: معدل = 2× معدل القسط الثابت
     افتراضياً (قابل للتعديل لكل أصل db_rate) على القيمة الدفترية
     شهرياً، بلا تجاوز قيمة الخردة.
   • وحدات الإنتاج: معدل الوحدة = (التكلفة − الخردة)/إجمالي الوحدات؛
     تُدخل الوحدات المستهلكة الفعلية عند الترحيل (لا جدول مسبق).
   • قيد الإهلاك الشهري: قيد واحد عبر post_manual_entry (مدين مصروف
     إهلاك / دائن مجمع إهلاك) + حركة asset_depreciation_entries لكل
     أصل — قيد فريد (tenant, asset, period) يمنع التكرار على مستوى DB.
   • كل القيود immutable عبر post_manual_entry القائمة.
   ═══════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';

  // r2 متاح من vat.js؛ نعيد تعريفه محلياً لو رُكّب assets.js وحده في Node
  const r2 = (typeof g.r2 === 'function') ? g.r2
    : (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const _num = (v) => Number(v) || 0;

  // ─────────── أدوات فترات 'YYYY-MM' ───────────
  // إزاحة فترة بعدد أشهر (موجب/سالب)
  function monthShift(period, n) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
    if (!m) return null;
    let y = +m[1], mo = +m[2] + (n || 0);
    y += Math.floor((mo - 1) / 12);
    mo = ((mo - 1) % 12 + 12) % 12 + 1;
    return y + '-' + String(mo).padStart(2, '0');
  }
  // فترة بداية الإهلاك: الشهر التالي للشراء افتراضياً (أو شهر الشراء نفسه)
  function depStartPeriod(purchaseDate, startNextMonth) {
    const d = new Date(purchaseDate);
    if (isNaN(d)) return null;
    const p = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    return startNextMonth === false ? p : monthShift(p, 1);
  }

  // ─────────── ١) القسط الثابت (straight-line) ───────────
  // in: { cost, salvage, lifeYears, startPeriod } → [{period, amount}] شهرياً
  // القسط الأخير يمتص فروقات التقريب بحيث يصل الإجمالي تماماً إلى (التكلفة − الخردة)
  function slSchedule(o) {
    const base = r2(_num(o.cost) - _num(o.salvage));
    const months = Math.max(1, Math.round(_num(o.lifeYears) * 12));
    if (base <= 0 || !o.startPeriod) return [];
    const each = r2(base / months);
    const out = [];
    for (let i = 0; i < months - 1; i++) {
      out.push({ period: monthShift(o.startPeriod, i), amount: each });
    }
    out.push({ period: monthShift(o.startPeriod, months - 1), amount: r2(base - each * (months - 1)) });
    return out;
  }

  // ─────────── ٢) القسط المتناقص (declining balance) ───────────
  // in: { cost, salvage, lifeYears, rate (سنوي — الافتراضي 2/العمر), startPeriod }
  // قسط شهري = القيمة الدفترية × المعدل/12، بلا تجاوز الخردة.
  // القسط الأخير يغلق الفرق حتى الخردة تماماً.
  function dbSchedule(o) {
    const salvage = _num(o.salvage);
    const rate = _num(o.rate) > 0 ? _num(o.rate) : (_num(o.lifeYears) > 0 ? 2 / _num(o.lifeYears) : 0);
    if (_num(o.cost) <= salvage || rate <= 0 || !o.startPeriod) return [];
    const mRate = rate / 12;
    const out = [];
    let bv = r2(o.cost);
    for (let i = 0; i < 1200; i++) { // حد أمان: 100 سنة
      if (bv <= salvage) break;
      const remaining = r2(bv - salvage);
      let amt = r2(bv * mRate);
      if (amt <= 0 || amt >= remaining) amt = remaining; // إغلاق حتى الخردة
      out.push({ period: monthShift(o.startPeriod, i), amount: amt });
      bv = r2(bv - amt);
      if (amt === remaining) break;
    }
    return out;
  }

  // ─────────── ٣) وحدات الإنتاج (units of production) ───────────
  // معدل الوحدة = (التكلفة − الخردة)/إجمالي الوحدات المقدرة
  function uopRate(cost, salvage, totalUnits) {
    const units = _num(totalUnits);
    if (units <= 0) return 0;
    return r2((_num(cost) - _num(salvage)) / units * 10000) / 10000; // ٤ خانات للدقة
  }
  function uopAmount(cost, salvage, totalUnits, unitsUsed) {
    return r2(uopRate(cost, salvage, totalUnits) * _num(unitsUsed));
  }

  // جدول موحّد حسب الطريقة (وحدات الإنتاج بلا جدول — تعتمد على الاستهلاك الفعلي)
  function buildSchedule(asset) {
    const start = depStartPeriod(asset.purchase_date, asset.dep_start_next_month !== false);
    const base = {
      cost: asset.cost, salvage: asset.salvage,
      lifeYears: asset.life_years, startPeriod: start,
    };
    if (asset.dep_method === 'db') return dbSchedule({ ...base, rate: asset.db_rate });
    if (asset.dep_method === 'uop') return [];
    return slSchedule(base);
  }

  // إهلاك فترة معيّنة لأصل: من الجدول (sl/db) أو بالوحدات (uop)
  // مُقيَّد بالمتبقي حتى الخردة (accumulated = إجمالي الإهلاك المرحّل سابقاً)
  function periodDepreciation(asset, period, accumulated, unitsUsed) {
    // لا إهلاك قبل فترة البداية (الشهر التالي للشراء افتراضياً)
    const start = depStartPeriod(asset.purchase_date, asset.dep_start_next_month !== false);
    if (!start || !period || period < start) return 0;
    const cap = r2(_num(asset.cost) - _num(asset.salvage) - _num(accumulated));
    if (cap <= 0) return 0;
    let amt = 0;
    if (asset.dep_method === 'uop') {
      amt = uopAmount(asset.cost, asset.salvage, asset.total_units, unitsUsed);
    } else {
      const row = buildSchedule(asset).find(s => s.period === period);
      amt = row ? row.amount : 0;
    }
    return Math.min(amt, cap);
  }

  // ─────────── ٤) الاستبعاد/البيع ───────────
  // القيمة الدفترية عند الاستبعاد + الربح/الخسارة (موجب = ربح)
  function disposalCalc(cost, accumulated, salePrice) {
    const bookValue = r2(_num(cost) - _num(accumulated));
    return { bookValue, gainLoss: r2(_num(salePrice) - bookValue) };
  }

  // سطور قيد الاستبعاد (متوازنة دائماً):
  //   مدين: نقدية/بنك (سعر البيع) + مجمع الإهلاك (المرحّل) [+ خسارة استبعاد]
  //   دائن: حساب الأصل (التكلفة) [+ ربح استبعاد]
  function buildDisposalLines(o) {
    const d = disposalCalc(o.cost, o.accumulated, o.salePrice);
    const lines = [];
    const L = (acc, dr, cr) => ({ account_id: acc, party_id: null, debit: r2(dr), credit: r2(cr) });
    if (_num(o.salePrice) > 0) lines.push(L(o.cashAccId, o.salePrice, 0));
    if (_num(o.accumulated) > 0) lines.push(L(o.accDepAccId, o.accumulated, 0));
    lines.push(L(o.assetAccId, 0, o.cost));
    if (d.gainLoss > 0) lines.push(L(o.gainAccId, 0, d.gainLoss));
    else if (d.gainLoss < 0) lines.push(L(o.lossAccId, -d.gainLoss, 0));
    return { ...d, lines };
  }

  // سطور قيد إهلاك فترة (مدين مصروف / دائن مجمع) — تجميع حسب الحسابات
  // pairs: [{expAccId, accDepAccId, amount}] → سطور مدمجة
  function buildDepLines(pairs) {
    const agg = new Map();
    const add = (acc, dr, cr) => {
      const cur = agg.get(acc) || { dr: 0, cr: 0 };
      cur.dr = r2(cur.dr + dr); cur.cr = r2(cur.cr + cr);
      agg.set(acc, cur);
    };
    pairs.forEach(p => {
      if (!(p.amount > 0)) return;
      add(p.expAccId, p.amount, 0);
      add(p.accDepAccId, 0, p.amount);
    });
    return [...agg.entries()].map(([account_id, v]) =>
      ({ account_id, party_id: null, debit: v.dr, credit: v.cr }));
  }

  // منع تكرار ترحيل فترة: هل رُحّلت لهذا الأصل؟
  function periodPosted(entries, assetId, period) {
    return (entries || []).some(e => e.asset_id === assetId && e.period === period);
  }

  // توازن قيد: مدين = دائن
  function linesBalanced(lines) {
    const dr = r2((lines || []).reduce((s, l) => s + _num(l.debit), 0));
    const cr = r2((lines || []).reduce((s, l) => s + _num(l.credit), 0));
    return { balanced: dr === cr && dr > 0, debit: dr, credit: cr };
  }

  const pureExports = {
    monthShift, depStartPeriod, slSchedule, dbSchedule, uopRate, uopAmount,
    buildSchedule, periodDepreciation, disposalCalc, buildDisposalLines,
    buildDepLines, periodPosted, linesBalanced,
  };
  Object.assign(g, pureExports);
  if (typeof module !== 'undefined' && module.exports) module.exports = pureExports;
  if (typeof document === 'undefined') return; // Node: منطق نقي فقط

  /* ═══════════════════════ واجهات المتصفح ═══════════════════════ */

  // حسابات الأصول المزروعة (hazem-assets.sql → seed_asset_accounts)
  const ASSET_ACCOUNTS = [
    { code: '1500', key: 'asset' }, { code: '1590', key: 'accdep' },
    { code: '5300', key: 'exp' }, { code: '4900', key: 'gain' }, { code: '5400', key: 'loss' },
  ];
  const METHODS = { sl: 'as_m_sl', db: 'as_m_db', uop: 'as_m_uop' };
  const A_STATUS = { active: 'as_st_active', sold: 'as_st_sold', disposed: 'as_st_disposed' };

  const _accByCode = (code) => (state.accounts || []).find(a => String(a.code) === code);

  // ضمان حسابات الأصول (زرع idempotent عبر RPC) + خريطة الأكواد
  async function ensureAssetAccounts() {
    if (!state.accounts || !state.accounts.length) await loadAccounts();
    await sb.rpc('seed_asset_accounts', { p_tenant: state.tenant }).then(r => {
      if (r.error) toast(t('as_seed_failed') + ': ' + r.error.message, false);
    });
    await loadAccounts();
    const map = {};
    ASSET_ACCOUNTS.forEach(x => { map[x.key] = _accByCode(x.code); });
    return map;
  }

  // مجمع إهلاك كل أصل (من حركات الإهلاك المرحّلة)
  function accumulatedOf(assetId) {
    return r2((state.assetDepEntries || [])
      .filter(e => e.asset_id === assetId)
      .reduce((s, e) => s + _num(e.amount), 0));
  }
  const _catName = (id) => ((state.assetCategories || []).find(c => c.id === id) || {}).name_ar || '—';
  const _branchName = (id) => ((state.branches || []).find(b => b.id === id) || {}).name || '—';

  // ─────────── التبويبات الفرعية ───────────
  function switchAsSub(sub) {
    $$('#tab-assets .sub-tab').forEach(b => b.classList.toggle('active', b.dataset.sub === sub));
    ['register', 'cats', 'dep', 'reports'].forEach(s =>
      $('#as-pane-' + s).classList.toggle('hidden', s !== sub));
    if (sub === 'cats') renderCats();
  }
  window.switchAsSub = switchAsSub;

  async function loadAssets() {
    const [{ data: assets }, { data: cats }, { data: brs }, { data: entries }] = await Promise.all([
      sb.from('fixed_assets').select('*').order('code'),
      sb.from('asset_categories').select('*').order('name_ar'),
      sb.from('branches').select('id, name'),
      sb.from('asset_depreciation_entries').select('*'),
    ]);
    state.fixedAssets = assets || [];
    state.assetCategories = cats || [];
    state.branches = brs || [];
    state.assetDepEntries = entries || [];
    if (!state.accounts || !state.accounts.length) await loadAccounts().catch(() => {});
    renderAssets($('#as-search') ? $('#as-search').value.trim() : '');
    const active = $$('#tab-assets .sub-tab').find(b => b.classList.contains('active'));
    switchAsSub(active ? active.dataset.sub : 'register');
  }

  // ─────────── ١) سجل الأصول: قائمة + بحث ───────────
  function renderAssets(q) {
    const list = (state.fixedAssets || []).filter(a => !q ||
      (a.name_ar || '').includes(q) || (a.name_en || '').toLowerCase().includes(q.toLowerCase()) ||
      (a.code || '').includes(q));
    $('#tbl-assets').innerHTML = list.map(a => {
      const acc = accumulatedOf(a.id);
      return `<tr>
        <td dir="ltr">${esc(a.code)}</td>
        <td>${esc(a.name_ar)}${a.name_en ? ' <span style="color:#66707E">(' + esc(a.name_en) + ')</span>' : ''}</td>
        <td>${esc(_catName(a.category_id))}</td>
        <td>${esc(_branchName(a.branch_id))}</td>
        <td dir="ltr">${esc(a.purchase_date || '—')}</td>
        <td>${fmt(a.cost)}</td>
        <td>${fmt(acc)}</td>
        <td><b>${fmt(r2(_num(a.cost) - acc))}</b></td>
        <td>${t(METHODS[a.dep_method] || a.dep_method)}</td>
        <td>${t(A_STATUS[a.status] || a.status)}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="openAssetForm('${a.id}')">✏️ ${t('btn_edit')}</button>
          <button class="btn btn-ghost btn-sm" onclick="openAssetSchedule('${a.id}')">📅 ${t('as_schedule')}</button>
          ${a.status === 'active' ? `<button class="btn btn-gold btn-sm" onclick="openDisposalForm('${a.id}')">💰 ${t('as_dispose')}</button>` : ''}
        </td>
      </tr>`;
    }).join('') || `<tr><td colspan="11" style="color:#66707E">${t('as_no_assets')}</td></tr>`;
  }

  // كود تلقائي: AST-0001 تصاعدياً (من الأكواد الموجودة)
  function nextAssetCode() {
    let max = 0;
    (state.fixedAssets || []).forEach(a => {
      const m = /(\d+)\s*$/.exec(String(a.code || ''));
      if (m) max = Math.max(max, +m[1]);
    });
    return 'AST-' + String(max + 1).padStart(4, '0');
  }

  // نموذج إضافة/تعديل أصل
  window.openAssetForm = async function (id) {
    const accMap = await ensureAssetAccounts();
    const a = id ? (state.fixedAssets || []).find(x => x.id === id) : null;
    const catOpts = (state.assetCategories || []).map(c =>
      `<option value="${c.id}" ${a && a.category_id === c.id ? 'selected' : ''}>${esc(c.name_ar)}</option>`).join('');
    const brOpts = (state.branches || []).map(b =>
      `<option value="${b.id}" ${a && a.branch_id === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
    const accOpts = (sel) => (state.accounts || []).map(ac =>
      `<option value="${ac.id}" ${sel && ac.id === sel ? 'selected' : ''}>${esc(ac.code)} — ${esc(ac.name)}</option>`).join('');
    $('#modal-body').classList.add('modal-lg');
    openModal(`
      <h3>${a ? '✏️ ' + t('as_edit_asset') : '➕ ' + t('as_add_asset')}</h3>
      <div class="form-grid">
        <div><label class="lbl">${t('as_code')}</label><input id="af-code" dir="ltr" value="${esc(a ? a.code : nextAssetCode())}"></div>
        <div><label class="lbl">${t('as_name_ar')} *</label><input id="af-name-ar" value="${esc(a?.name_ar || '')}"></div>
        <div><label class="lbl">${t('as_name_en')}</label><input id="af-name-en" dir="ltr" value="${esc(a?.name_en || '')}"></div>
        <div><label class="lbl">${t('as_category')}</label><select id="af-cat"><option value="">—</option>${catOpts}</select></div>
        <div><label class="lbl">${t('as_purchase_date')} *</label><input type="date" id="af-pdate" value="${esc(a?.purchase_date || '')}"></div>
        <div><label class="lbl">${t('as_cost')} *</label><input type="number" step="0.01" id="af-cost" value="${a ? a.cost : ''}"></div>
        <div><label class="lbl">${t('as_salvage')}</label><input type="number" step="0.01" id="af-salvage" value="${a ? a.salvage : 0}"></div>
        <div><label class="lbl">${t('as_life')} *</label><input type="number" step="0.5" min="0.5" id="af-life" value="${a ? a.life_years : 5}"></div>
        <div><label class="lbl">${t('as_method')}</label><select id="af-method">
          ${Object.keys(METHODS).map(m => `<option value="${m}" ${a && a.dep_method === m ? 'selected' : ''}>${t(METHODS[m])}</option>`).join('')}
        </select></div>
        <div id="af-rate-box"><label class="lbl">${t('as_db_rate')}</label><input type="number" step="0.01" id="af-rate" dir="ltr" placeholder="${t('as_db_rate_ph')}" value="${a && a.db_rate ? a.db_rate : ''}"></div>
        <div id="af-units-box"><label class="lbl">${t('as_total_units')}</label><input type="number" step="1" id="af-units" value="${a && a.total_units ? a.total_units : ''}"></div>
        <div><label class="lbl">${t('hr_branch')}</label><select id="af-branch"><option value="">—</option>${brOpts}</select></div>
        <div><label class="lbl">${t('as_location')}</label><input id="af-loc" value="${esc(a?.location || '')}"></div>
        <div><label class="lbl">${t('as_pinv_no')}</label><input id="af-pinv" dir="ltr" value="${esc(a?.purchase_invoice_no || '')}"></div>
        <div><label class="lbl">${t('as_dep_start')}</label><select id="af-start-next">
          <option value="true" ${!a || a.dep_start_next_month !== false ? 'selected' : ''}>${t('as_start_next')}</option>
          <option value="false" ${a && a.dep_start_next_month === false ? 'selected' : ''}>${t('as_start_same')}</option>
        </select></div>
        <div><label class="lbl">${t('as_acc_asset')}</label><select id="af-acc-asset">${accOpts(a ? a.asset_account_id : accMap.asset && accMap.asset.id)}</select></div>
        <div><label class="lbl">${t('as_acc_accdep')}</label><select id="af-acc-accdep">${accOpts(a ? a.acc_dep_account_id : accMap.accdep && accMap.accdep.id)}</select></div>
        <div><label class="lbl">${t('as_acc_exp')}</label><select id="af-acc-exp">${accOpts(a ? a.dep_exp_account_id : accMap.exp && accMap.exp.id)}</select></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-gold" id="af-save">${t('btn_save')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);
    const syncMethod = () => {
      const m = $('#af-method').value;
      $('#af-rate-box').style.display = m === 'db' ? '' : 'none';
      $('#af-units-box').style.display = m === 'uop' ? '' : 'none';
    };
    $('#af-method').onchange = syncMethod; syncMethod();
    $('#af-save').onclick = async () => {
      const name = $('#af-name-ar').value.trim();
      if (!name) return toast(t('as_name_required'), false);
      const cost = _num($('#af-cost').value);
      const life = _num($('#af-life').value);
      const pdate = $('#af-pdate').value;
      if (cost <= 0 || !pdate) return toast(t('as_invalid_asset'), false);
      if (life <= 0) return toast(t('as_invalid_life'), false);
      const method = $('#af-method').value;
      if (method === 'uop' && _num($('#af-units').value) <= 0)
        return toast(t('as_invalid_units'), false);
      if (_num($('#af-salvage').value) >= cost) return toast(t('as_salvage_high'), false);
      const rec = {
        code: $('#af-code').value.trim() || nextAssetCode(),
        name_ar: name,
        name_en: $('#af-name-en').value.trim() || null,
        category_id: $('#af-cat').value || null,
        purchase_date: pdate,
        cost,
        salvage: _num($('#af-salvage').value),
        life_years: life,
        dep_method: method,
        db_rate: method === 'db' && _num($('#af-rate').value) > 0 ? _num($('#af-rate').value) : null,
        total_units: method === 'uop' ? _num($('#af-units').value) : null,
        branch_id: $('#af-branch').value || null,
        location: $('#af-loc').value.trim() || null,
        purchase_invoice_no: $('#af-pinv').value.trim() || null,
        dep_start_next_month: $('#af-start-next').value === 'true',
        asset_account_id: $('#af-acc-asset').value || null,
        acc_dep_account_id: $('#af-acc-accdep').value || null,
        dep_exp_account_id: $('#af-acc-exp').value || null,
      };
      let err;
      if (a) ({ error: err } = await sb.from('fixed_assets').update(rec).eq('id', a.id));
      else ({ error: err } = await sb.from('fixed_assets').insert({ tenant_id: state.tenant, status: 'active', ...rec }));
      if (err) return toast(t('msg_error') + ': ' + err.message, false);
      closeModal(); toast(t('msg_saved')); loadAssets();
    };
  };

  // ─────────── جدول إهلاك أصل (مستقبلي كامل حتى نهاية العمر) ───────────
  window.openAssetSchedule = function (id) {
    const a = (state.fixedAssets || []).find(x => x.id === id);
    if (!a) return;
    const sched = buildSchedule(a);
    const startP = depStartPeriod(a.purchase_date, a.dep_start_next_month !== false);
    $('#modal-body').classList.add('modal-lg');
    if (a.dep_method === 'uop') {
      openModal(`
        <h3>📅 ${t('as_schedule')} — ${esc(a.name_ar)}</h3>
        <div class="table-wrap"><table><tbody>
          <tr><td>${t('as_method')}</td><td>${t(METHODS.uop)}</td></tr>
          <tr><td>${t('as_uop_rate')}</td><td><b>${fmt(uopRate(a.cost, a.salvage, a.total_units))}</b></td></tr>
          <tr><td>${t('as_total_units')}</td><td>${fmt(a.total_units)}</td></tr>
          <tr><td>${t('as_dep_start')}</td><td dir="ltr">${esc(startP || '—')}</td></tr>
        </tbody></table></div>
        <p style="color:#66707E;font-size:13px">${t('as_uop_note')}</p>
        <div class="modal-actions"><button class="btn btn-gold" onclick="closeModal()">${t('btn_close')}</button></div>`);
      return;
    }
    let bv = _num(a.cost);
    const rows = sched.map((s, i) => {
      const open = bv;
      bv = r2(bv - s.amount);
      return `<tr><td>${i + 1}</td><td dir="ltr">${esc(s.period)}</td>
        <td>${fmt(open)}</td><td>${fmt(s.amount)}</td><td><b>${fmt(bv)}</b></td></tr>`;
    }).join('');
    openModal(`
      <h3>📅 ${t('as_schedule')} — ${esc(a.name_ar)}</h3>
      <p style="color:#66707E;font-size:13px;margin:0 0 10px">
        ${t(METHODS[a.dep_method] || a.dep_method)} — ${t('as_dep_start')}: <b dir="ltr">${esc(startP || '—')}</b></p>
      <div class="table-wrap" style="max-height:60vh;overflow:auto"><table>
        <thead><tr><th>#</th><th>${t('as_period')}</th><th>${t('as_bv_open')}</th>
          <th>${t('as_dep_amt')}</th><th>${t('as_bv_close')}</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5">${t('as_no_schedule')}</td></tr>`}</tbody>
      </table></div>
      <div class="modal-actions"><button class="btn btn-gold" onclick="closeModal()">${t('btn_close')}</button></div>`);
  };

  // ─────────── ٢) فئات الأصول (قابلة للإدارة) ───────────
  function renderCats() {
    $('#tbl-asset-cats').innerHTML = (state.assetCategories || []).map(c => {
      const count = (state.fixedAssets || []).filter(a => a.category_id === c.id).length;
      return `<tr>
        <td>${esc(c.name_ar)}</td><td dir="ltr">${esc(c.name_en || '—')}</td>
        <td>${count}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="openCatForm('${c.id}')">✏️ ${t('btn_edit')}</button>
          ${count === 0 ? `<button class="btn btn-ghost btn-sm" onclick="deleteCat('${c.id}')">🗑️ ${t('btn_delete')}</button>` : ''}
        </td>
      </tr>`;
    }).join('') || `<tr><td colspan="4" style="color:#66707E">${t('as_no_cats')}</td></tr>`;
  }

  window.openCatForm = function (id) {
    const c = id ? (state.assetCategories || []).find(x => x.id === id) : null;
    openModal(`
      <h3>${c ? '✏️ ' + t('as_edit_cat') : '➕ ' + t('as_add_cat')}</h3>
      <label class="lbl">${t('as_name_ar')} *</label><input id="cf-name-ar" value="${esc(c?.name_ar || '')}">
      <label class="lbl">${t('as_name_en')}</label><input id="cf-name-en" dir="ltr" value="${esc(c?.name_en || '')}">
      <div class="modal-actions">
        <button class="btn btn-gold" id="cf-save">${t('btn_save')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);
    $('#cf-save').onclick = async () => {
      const name = $('#cf-name-ar').value.trim();
      if (!name) return toast(t('as_name_required'), false);
      const rec = { name_ar: name, name_en: $('#cf-name-en').value.trim() || null };
      let err;
      if (c) ({ error: err } = await sb.from('asset_categories').update(rec).eq('id', c.id));
      else ({ error: err } = await sb.from('asset_categories').insert({ tenant_id: state.tenant, ...rec }));
      if (err) return toast(t('msg_error') + ': ' + err.message, false);
      closeModal(); toast(t('msg_saved')); loadAssets();
    };
  };

  window.deleteCat = async function (id) {
    const { error } = await sb.from('asset_categories').delete().eq('id', id);
    if (error) return toast(t('msg_error') + ': ' + error.message, false);
    toast(t('msg_deleted')); loadAssets();
  };

  // ─────────── ٣) ترحيل إهلاك فترة ───────────
  // عرض الأصول المستحقة لفترة (sl/db من الجدول، uop بإدخال وحدات)
  let _dueRows = [];
  window.asShowDue = function () {
    const period = $('#as-dep-month').value;
    if (!period) return toast(t('hr_pick_month'), false);
    const actives = (state.fixedAssets || []).filter(a => a.status === 'active');
    _dueRows = actives.map(a => {
      const acc = accumulatedOf(a.id);
      const posted = periodPosted(state.assetDepEntries, a.id, period);
      const amt = posted ? 0
        : (a.dep_method === 'uop' ? 0 : periodDepreciation(a, period, acc));
      return { a, acc, posted, amt };
    }).filter(r => r.posted || r.amt > 0 || r.a.dep_method === 'uop');
    $('#tbl-dep-due').innerHTML = _dueRows.map((r, i) => {
      const remaining = r2(_num(r.a.cost) - _num(r.a.salvage) - r.acc);
      return `<tr>
        <td dir="ltr">${esc(r.a.code)}</td>
        <td>${esc(r.a.name_ar)}</td>
        <td>${t(METHODS[r.a.dep_method] || r.a.dep_method)}</td>
        <td>${fmt(r.acc)}</td><td>${fmt(remaining)}</td>
        ${r.a.dep_method === 'uop' && !r.posted
          ? `<td><input type="number" step="1" min="0" id="as-units-${i}" style="width:100px"></td>
             <td id="as-due-${i}">—</td>`
          : `<td>—</td><td id="as-due-${i}">${fmt(r.amt)}</td>`}
        <td>${r.posted ? '✅ ' + t('as_posted_already') : '⏳'}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="8" style="color:#66707E">${t('as_no_due')}</td></tr>`;
    // تحديث مبلغ uop لحظياً مع إدخال الوحدات
    _dueRows.forEach((r, i) => {
      if (r.a.dep_method !== 'uop' || r.posted) return;
      const inp = $('#as-units-' + i);
      if (inp) inp.oninput = () => {
        const amt = periodDepreciation(r.a, period, r.acc, _num(inp.value));
        r.amt = amt;
        $('#as-due-' + i).textContent = fmt(amt);
        _asUpdateDepTotal();
      };
    });
    _asUpdateDepTotal();
  };
  function _asUpdateDepTotal() {
    const tot = r2(_dueRows.filter(r => !r.posted).reduce((s, r) => s + r.amt, 0));
    $('#as-dep-total').textContent = fmt(tot);
    $('#btn-as-post-dep').disabled = !(tot > 0);
  }

  // الترحيل: قيد واحد (مدين مصروف / دائن مجمع) + حركة لكل أصل
  window.asPostDep = async function () {
    const period = $('#as-dep-month').value;
    const rows = _dueRows.filter(r => !r.posted && r.amt > 0);
    if (!period || !rows.length) return;
    // المرحلة 16: رفض ترحيل إهلاك فترة مقفلة
    if (typeof window.checkPeriodLock === 'function' && window.checkPeriodLock(period + '-28')) return;
    const accMap = await ensureAssetAccounts();
    // لا تكرار لنفس الفترة — تحقق من الخادم أيضاً (القيد الفريد في DB خط الدفاع الأخير)
    const { data: existing } = await sb.from('asset_depreciation_entries')
      .select('asset_id').eq('period', period);
    const doneSet = new Set((existing || []).map(e => e.asset_id));
    const fresh = rows.filter(r => !doneSet.has(r.a.id));
    if (!fresh.length) return toast(t('as_period_dup'), false);
    const pairs = fresh.map(r => ({
      expAccId: r.a.dep_exp_account_id || (accMap.exp && accMap.exp.id),
      accDepAccId: r.a.acc_dep_account_id || (accMap.accdep && accMap.accdep.id),
      amount: r.amt,
    })).filter(p => p.expAccId && p.accDepAccId);
    const lines = buildDepLines(pairs);
    const bal = linesBalanced(lines);
    if (!bal.balanced) return toast(t('as_unbalanced'), false);
    const { data, error } = await sb.rpc('post_manual_entry', {
      p_tenant: state.tenant, p_memo: t('as_dep_memo') + ' ' + period, p_lines: lines });
    if (error) return toast(t('hr_post_failed') + ': ' + error.message, false);
    const ins = fresh.map(r => ({
      tenant_id: state.tenant, asset_id: r.a.id, period, amount: r.amt,
      units: r.a.dep_method === 'uop' ? _num($('#as-units-' + _dueRows.indexOf(r))?.value) || null : null,
      entry_number: data?.number ?? null,
    }));
    const { error: e2 } = await sb.from('asset_depreciation_entries').insert(ins);
    if (e2) return toast(t('msg_error') + ': ' + e2.message, false);
    toast(t('hr_posted') + ' ' + (data?.number ?? ''));
    await loadAssets();
    switchAsSub('dep'); asShowDue();
  };

  // ─────────── ٤) استبعاد/بيع أصل ───────────
  window.openDisposalForm = async function (id) {
    const a = (state.fixedAssets || []).find(x => x.id === id);
    if (!a || a.status !== 'active') return;
    const accMap = await ensureAssetAccounts();
    const acc = accumulatedOf(a.id);
    const treas = (state.accounts || []).filter(x => x.kind === 'asset' && String(x.code).startsWith('11'));
    openModal(`
      <h3>💰 ${t('as_dispose')} — ${esc(a.name_ar)} (${esc(a.code)})</h3>
      <div class="table-wrap" style="margin-bottom:10px"><table><tbody>
        <tr><td>${t('as_cost')}</td><td>${fmt(a.cost)}</td></tr>
        <tr><td>${t('as_accum')}</td><td>${fmt(acc)}</td></tr>
        <tr><td>${t('as_book_value')}</td><td><b>${fmt(r2(_num(a.cost) - acc))}</b></td></tr>
      </tbody></table></div>
      <div class="form-grid">
        <div><label class="lbl">${t('as_disp_type')}</label><select id="df-type">
          <option value="sale">${t('as_disp_sale')}</option>
          <option value="writeoff">${t('as_disp_writeoff')}</option>
        </select></div>
        <div><label class="lbl">${t('as_disp_date')}</label><input type="date" id="df-date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div id="df-price-box"><label class="lbl">${t('as_sale_price')}</label><input type="number" step="0.01" id="df-price" value="0"></div>
        <div id="df-cash-box"><label class="lbl">${t('as_cash_acc')}</label><select id="df-cash">
          ${treas.map(x => `<option value="${x.id}">${esc(x.code)} — ${esc(x.name)}</option>`).join('')}
        </select></div>
      </div>
      <div id="df-preview" style="margin-top:8px;font-weight:700"></div>
      <div class="modal-actions">
        <button class="btn btn-gold" id="df-save">${t('btn_save_post')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);
    const syncDisp = () => {
      const isSale = $('#df-type').value === 'sale';
      $('#df-price-box').style.display = isSale ? '' : 'none';
      $('#df-cash-box').style.display = isSale ? '' : 'none';
      const price = isSale ? _num($('#df-price').value) : 0;
      const d = disposalCalc(a.cost, acc, price);
      $('#df-preview').innerHTML = d.gainLoss > 0
        ? `<span style="color:#15803d">${t('as_gain')}: ${fmt(d.gainLoss)}</span>`
        : d.gainLoss < 0
          ? `<span style="color:#B42318">${t('as_loss')}: ${fmt(-d.gainLoss)}</span>`
          : `<span style="color:#66707E">${t('as_no_gainloss')}</span>`;
    };
    $('#df-type').onchange = syncDisp;
    $('#df-price').oninput = syncDisp;
    syncDisp();
    $('#df-save').onclick = async () => {
      const isSale = $('#df-type').value === 'sale';
      const price = isSale ? _num($('#df-price').value) : 0;
      const date = $('#df-date').value || new Date().toISOString().slice(0, 10);
      // المرحلة 16: رفض استبعاد/بيع بتاريخ فترة مقفلة
      if (typeof window.checkPeriodLock === 'function' && window.checkPeriodLock(date)) return;
      const res = buildDisposalLines({
        cost: a.cost, accumulated: acc, salePrice: price,
        cashAccId: $('#df-cash').value,
        assetAccId: a.asset_account_id || (accMap.asset && accMap.asset.id),
        accDepAccId: a.acc_dep_account_id || (accMap.accdep && accMap.accdep.id),
        gainAccId: accMap.gain && accMap.gain.id,
        lossAccId: accMap.loss && accMap.loss.id,
      });
      const bal = linesBalanced(res.lines);
      if (!bal.balanced) return toast(t('as_unbalanced'), false);
      const { data, error } = await sb.rpc('post_manual_entry', {
        p_tenant: state.tenant,
        p_memo: (isSale ? t('as_sale_memo') : t('as_writeoff_memo')) + ' ' + a.code + ' — ' + a.name_ar,
        p_lines: res.lines });
      if (error) return toast(t('hr_post_failed') + ': ' + error.message, false);
      const { error: e2 } = await sb.from('asset_disposals').insert({
        tenant_id: state.tenant, asset_id: a.id, disposal_date: date,
        type: isSale ? 'sale' : 'writeoff', sale_price: price,
        accumulated: acc, book_value: res.bookValue, gain_loss: res.gainLoss,
        entry_number: data?.number ?? null,
      });
      if (e2) return toast(t('msg_error') + ': ' + e2.message, false);
      await sb.from('fixed_assets').update({ status: isSale ? 'sold' : 'disposed' }).eq('id', a.id);
      closeModal(); toast(t('hr_posted') + ' ' + (data?.number ?? ''));
      loadAssets();
    };
  };

  // ─────────── ٥) تقارير الأصول (طباعة + Excel عبر محرك دفعة B) ───────────
  const _money = (n) => ({ txt: fmt(n), num: _num(n) });

  window.asReport = async function (kind) {
    state._asDoc = null;
    let doc = null;
    const assets = state.fixedAssets || [];
    if (kind === 'register') {
      // سجل الأصول: تكلفة/مجمع/صافي دفتري لكل أصل، مجمّعاً بالفئة + إجمالي عام
      const byCat = {};
      assets.forEach(a => {
        const k = a.category_id || '';
        (byCat[k] = byCat[k] || []).push(a);
      });
      const rows = [];
      let gCost = 0, gAcc = 0, gNet = 0;
      Object.keys(byCat).forEach(k => {
        const list = byCat[k];
        let cCost = 0, cAcc = 0;
        list.forEach(a => {
          const acc = accumulatedOf(a.id);
          const net = r2(_num(a.cost) - acc);
          cCost = r2(cCost + _num(a.cost)); cAcc = r2(cAcc + acc);
          rows.push([esc(a.code), esc(a.name_ar), esc(_catName(a.category_id)),
            esc(_branchName(a.branch_id)), t(A_STATUS[a.status] || a.status),
            _money(a.cost), _money(acc), _money(net)]);
        });
        gCost = r2(gCost + cCost); gAcc = r2(gAcc + cAcc);
        rows.push([{ txt: '', num: null }, { txt: '— ' + t('as_cat_total') + ' ' + esc(_catName(k)) + ' —', num: null },
          '', '', '', _money(cCost), _money(cAcc), _money(r2(cCost - cAcc))]);
      });
      gNet = r2(gCost - gAcc);
      doc = {
        title: t('as_rep_register'),
        meta: [[t('hr_date'), new Date().toLocaleDateString('ar-EG')]],
        tables: [{
          head: [t('as_code'), t('as_asset'), t('as_category'), t('hr_branch'),
                 t('hr_status'), t('as_cost'), t('as_accum'), t('as_net_book')],
          rows,
        }],
        totals: [t('as_cost') + ': ' + fmt(gCost), t('as_accum') + ': ' + fmt(gAcc),
                 t('as_net_book') + ': ' + fmt(gNet)],
        fileName: 'assets-register',
      };
      if (!assets.length) return toast(t('as_no_assets'), false);
    } else if (kind === 'depmov') {
      // حركات الإهلاك لفترة
      const from = $('#as-rep-from').value, to = $('#as-rep-to').value;
      if (!from || !to) return toast(t('as_pick_period'), false);
      const nameOf = (id) => ((assets.find(a => a.id === id) || {}).name_ar) || '—';
      const list = (state.assetDepEntries || [])
        .filter(e => e.period >= from.slice(0, 7) && e.period <= to.slice(0, 7))
        .sort((x, y) => x.period < y.period ? -1 : 1);
      if (!list.length) return toast(t('as_no_dep_mov'), false);
      const tot = r2(list.reduce((s, e) => s + _num(e.amount), 0));
      doc = {
        title: t('as_rep_dep') + ' — ' + from.slice(0, 7) + ' → ' + to.slice(0, 7),
        meta: [[t('vat_period_from'), from], [t('vat_period_to'), to]],
        tables: [{
          head: [t('as_period'), t('as_code'), t('as_asset'), t('as_units'), t('as_dep_amt'), t('as_entry_no')],
          rows: list.map(e => [{ txt: e.period, num: null },
            esc((assets.find(a => a.id === e.asset_id) || {}).code || '—'),
            esc(nameOf(e.asset_id)),
            e.units != null ? fmt(e.units) : '—',
            _money(e.amount), e.entry_number != null ? String(e.entry_number) : '—']),
        }],
        totals: [t('as_dep_amt') + ': ' + fmt(tot)],
        fileName: 'dep-movements',
      };
    } else if (kind === 'bycat' || kind === 'bybranch') {
      // أصول حسب الفئة / الفرع
      const isCat = kind === 'bycat';
      const groups = {};
      assets.forEach(a => {
        const k = isCat ? _catName(a.category_id) : _branchName(a.branch_id);
        (groups[k] = groups[k] || []).push(a);
      });
      const rows = Object.keys(groups).sort().map(k => {
        const list = groups[k];
        const cost = r2(list.reduce((s, a) => s + _num(a.cost), 0));
        const acc = r2(list.reduce((s, a) => s + accumulatedOf(a.id), 0));
        return [esc(k), String(list.length), _money(cost), _money(acc), _money(r2(cost - acc))];
      });
      if (!rows.length) return toast(t('as_no_assets'), false);
      doc = {
        title: isCat ? t('as_rep_bycat') : t('as_rep_bybranch'),
        meta: [[t('hr_date'), new Date().toLocaleDateString('ar-EG')]],
        tables: [{
          head: [isCat ? t('as_category') : t('hr_branch'), t('as_count'),
                 t('as_cost'), t('as_accum'), t('as_net_book')],
          rows,
        }],
        totals: [t('as_count') + ': ' + assets.length],
        fileName: isCat ? 'assets-by-category' : 'assets-by-branch',
      };
    }
    state._asDoc = doc;
    openPrintPreview(doc);
  };
  window.asReportExcel = function () { if (state._asDoc) exportDocExcel(state._asDoc); };

  // ─────────── ربط الأحداث ───────────
  window.loadAssets = loadAssets;
  const _initAssets = () => {
    const b1 = $('#btn-add-asset'); if (b1) b1.onclick = () => openAssetForm(null);
    const srch = $('#as-search'); if (srch) srch.oninput = () => renderAssets(srch.value.trim());
    const bCat = $('#btn-add-cat'); if (bCat) bCat.onclick = () => openCatForm(null);
    $$('#tab-assets .sub-tab').forEach(b => b.onclick = () => switchAsSub(b.dataset.sub));
    const bDue = $('#btn-as-due'); if (bDue) bDue.onclick = asShowDue;
    const bPost = $('#btn-as-post-dep'); if (bPost) bPost.onclick = asPostDep;
  };
  // السكربتات في نهاية body (DOM جاهز)، لكن نحتمي لأي ترتيب تحميل مستقبلي
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initAssets);
  else _initAssets();

})(typeof window !== 'undefined' ? window : globalThis);
