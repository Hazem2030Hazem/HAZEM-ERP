/* ═══════════════════════════════════════════════════════════════
   H. ERP — المرحلة 12: الموارد البشرية والرواتب (السعودية)
   جزآن في ملف واحد (بلا build step):
   • منطق نقي قابل للاختبار في Node: GOSI / نهاية الخدمة / أقساط السلف / صافي القسيمة.
   • واجهات HR (تعمل في المتصفح فقط، بعد app.js): الموظفون، مسيرات الرواتب،
     السلف، الخصومات، حاسبة EOS، تقارير HR، إعدادات GOSI.
   قرارات موثقة:
   • أجر احتساب GOSI = الأساسي + بدل السكن، بحد أقصى (افتراضي 45,000).
     سعودي: موظف 10% (9% معاشات + 1% ساند) / صاحب عمل 12% (9% معاشات
     + 2% أخطار + 1% ساند). غير سعودي: 2% أخطار مهنية على صاحب العمل فقط.
     كل النسب قابلة للتعديل من إعدادات HR (tenants.hr_settings).
   • EOS: نصف شهر عن كل سنة من أول 5 + شهر كامل عمّا بعدها (أجر شامل شهري)،
     سنوات الخدمة كسرية (أيام/365). الاستقالة: <2 لا شيء، 2-5 ثلث،
     5-10 ثلثان، 10+ كاملة. إنهاء صاحب العمل = كاملة.
   • كل قيد يُرحَّل عبر post_manual_entry القائمة (immutable).
   ═══════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';

  // r2 متاح من vat.js؛ نعيد تعريفه محلياً لو رُكّب hr.js وحده في Node
  const r2 = (typeof g.r2 === 'function') ? g.r2
    : (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  // ─── نسب GOSI الافتراضية (قابلة للتعديل من الإعدادات) ───
  const HR_DEFAULT_GOSI = { sa_emp: 0.10, sa_er: 0.12, expat_er: 0.02, cap: 45000 };

  // حساب GOSI لموظف: (الأساسي + السكن) بحد أقصى cap
  function gosiCalc(basic, housing, isSaudi, cfg) {
    cfg = Object.assign({}, HR_DEFAULT_GOSI, cfg || {});
    const base = Math.min((Number(basic) || 0) + (Number(housing) || 0), Number(cfg.cap) || 0);
    if (isSaudi) {
      return { base: r2(base), employee: r2(base * cfg.sa_emp), employer: r2(base * cfg.sa_er) };
    }
    return { base: r2(base), employee: 0, employer: r2(base * cfg.expat_er) };
  }

  // مكافأة نهاية الخدمة السعودية
  // in: { hireDate, endDate (Date|string), wage (أجر شامل شهري), reason: 'termination'|'resignation' }
  function computeEOS(o) {
    const hire = new Date(o.hireDate), end = new Date(o.endDate);
    const wage = Number(o.wage) || 0;
    if (isNaN(hire) || isNaN(end) || end <= hire || wage <= 0) {
      return { years: 0, months: 0, gross: 0, factor: 0, award: 0 };
    }
    const years = (end - hire) / 86400000 / 365;
    const months = 0.5 * Math.min(years, 5) + Math.max(years - 5, 0);
    const gross = wage * months;
    let factor = 1;
    if (o.reason === 'resignation') {
      if (years < 2) factor = 0;
      else if (years < 5) factor = 1 / 3;
      else if (years < 10) factor = 2 / 3;
      else factor = 1;
    }
    return { years: r2(years * 100) / 100, months: r2(months * 1000) / 1000,
             gross: r2(gross), factor, award: r2(gross * factor) };
  }

  // جدول أقساط سلفة: أقساط متساوية والقسط الأخير يمتص فروقات التقريب
  function advanceSchedule(amount, count) {
    amount = r2(amount); count = Math.max(1, Math.floor(count) || 1);
    const each = r2(amount / count);
    const out = [];
    for (let i = 0; i < count - 1; i++) out.push(each);
    out.push(r2(amount - each * (count - 1)));
    return out;
  }

  // قسيمة راتب موظف: مدخلات خام → كل المجاميع والصافي
  // in: { basic, housing, transport, other:[{label,amount}], deductions, advance, isSaudi, cfg }
  function slipCalc(o, cfg) {
    const other = (o.other || []).map(x => ({ label: x.label, amount: r2(x.amount) }));
    const basic = r2(o.basic), housing = r2(o.housing), transport = r2(o.transport);
    const otherTotal = r2(other.reduce((s, x) => s + x.amount, 0));
    const allowances = r2(housing + transport + otherTotal);
    const gross = r2(basic + allowances);
    const gosi = gosiCalc(basic, housing, !!o.isSaudi, cfg);
    const ded = r2(o.deductions), adv = r2(o.advance);
    const net = r2(gross - ded - adv - gosi.employee);
    return { basic, housing, transport, other, otherTotal, allowances, gross,
             deductions: ded, advance: adv,
             gosi_base: gosi.base, gosi_employee: gosi.employee, gosi_employer: gosi.employer, net };
  }

  const pureExports = { HR_DEFAULT_GOSI, gosiCalc, computeEOS, advanceSchedule, slipCalc };
  Object.assign(g, pureExports);
  if (typeof module !== 'undefined' && module.exports) module.exports = pureExports;
  if (typeof document === 'undefined') return; // Node: منطق نقي فقط

  /* ═══════════════════════ واجهات المتصفح ═══════════════════════ */

  const HR_ACCOUNTS = [
    { code: '1150', key: 'adv' }, { code: '2300', key: 'payable' },
    { code: '2310', key: 'gosi' }, { code: '2320', key: 'ded' },
    { code: '5200', key: 'exp' }, { code: '5210', key: 'gosiExp' }, { code: '5220', key: 'eosExp' },
  ];
  const EMP_STATUS = { active: 'hr_status_active', suspended: 'hr_status_suspended', terminated: 'hr_status_terminated' };
  const CONTRACT = { fulltime: 'hr_contract_full', parttime: 'hr_contract_part', temporary: 'hr_contract_temp' };

  const _num = (v) => Number(v) || 0;
  const _accByCode = (code) => (state.accounts || []).find(a => String(a.code) === code);

  // ضمان حسابات الرواتب (زرع idempotent عبر RPC) + إرجاع خريطة الأكواد → الحساب
  async function ensureHrAccounts() {
    if (!state.accounts || !state.accounts.length) await loadAccounts();
    await sb.rpc('seed_hr_accounts', { p_tenant: state.tenant }).then(r => {
      if (r.error) toast(t('hr_seed_failed') + ': ' + r.error.message, false);
    });
    await loadAccounts(); // إعادة تحميل لتشمل الحسابات المزروعة
    const map = {};
    HR_ACCOUNTS.forEach(x => { map[x.key] = _accByCode(x.code); });
    return map;
  }

  // إعدادات GOSI للشركة (مع رجوع آمن للافتراضيات)
  async function getGosiCfg() {
    if (state.hrGosi) return state.hrGosi;
    let cfg = Object.assign({}, HR_DEFAULT_GOSI);
    try {
      const { data, error } = await sb.from('tenants').select('hr_settings').eq('id', state.tenant).single();
      if (!error && data && data.hr_settings) cfg = Object.assign(cfg, data.hr_settings);
    } catch (e) { /* العمود غير موجود بعد — الافتراضيات */ }
    state.hrGosi = cfg;
    return cfg;
  }

  const isSaudiEmp = (e) => /^(saudi|سعودي)/i.test(String(e.nationality || '').trim());

  // ─────────── الموظفون: قائمة + بحث + نموذج ───────────
  async function loadEmployees() {
    const [{ data: emps }, { data: brs }] = await Promise.all([
      sb.from('employees').select('*').order('created_at', { ascending: false }),
      sb.from('branches').select('id, name'),
    ]);
    state.employees = emps || [];
    state.branches = brs || [];
    renderEmployees($('#emp-search') ? $('#emp-search').value.trim() : '');
  }

  function renderEmployees(q) {
    const list = (state.employees || []).filter(e => !q ||
      (e.name_ar || '').includes(q) || (e.name_en || '').toLowerCase().includes(q.toLowerCase()) ||
      (e.id_number || '').includes(q));
    $('#tbl-employees').innerHTML = list.map(e => `
      <tr>
        <td>${esc(e.name_ar)}${e.name_en ? ' <span style="color:#7A6A5C">(' + esc(e.name_en) + ')</span>' : ''}</td>
        <td dir="ltr">${esc(e.id_number || '—')}</td>
        <td>${esc(e.nationality || '—')}</td>
        <td>${esc(e.job_title || '—')}</td>
        <td>${esc((state.branches.find(b => b.id === e.branch_id) || {}).name || '—')}</td>
        <td>${fmt(e.basic_salary)}</td>
        <td>${t(EMP_STATUS[e.status] || 'hr_status_active')}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="openEmployeeForm('${e.id}')">✏️ ${t('btn_edit')}</button>
          <button class="btn btn-ghost btn-sm" onclick="hrToggleEmpStatus('${e.id}')">
            ${e.status === 'active' ? '⏸️ ' + t('hr_suspend') : '▶️ ' + t('hr_activate')}</button>
        </td>
      </tr>`).join('') ||
      `<tr><td colspan="8" style="color:#7A6A5C">${t('hr_no_emps')}</td></tr>`;
  }

  // نموذج إضافة/تعديل موظف — بدلات أخرى مرنة (بنود label+amount)
  window.openEmployeeForm = function (id) {
    const e = id ? (state.employees || []).find(x => x.id === id) : null;
    const brOpts = (state.branches || []).map(b =>
      `<option value="${b.id}" ${e && e.branch_id === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
    const otherRows = (e && Array.isArray(e.other_allowances) ? e.other_allowances : [])
      .map(a => _otherRow(a.label, a.amount)).join('');
    $('#modal-body').classList.add('modal-lg');
    openModal(`
      <h3>${e ? '✏️ ' + t('hr_edit_emp') : '➕ ' + t('hr_add_emp')}</h3>
      <div class="form-grid">
        <div><label class="lbl">${t('hr_name_ar')} *</label><input id="em-name-ar" value="${esc(e?.name_ar || '')}"></div>
        <div><label class="lbl">${t('hr_name_en')}</label><input id="em-name-en" dir="ltr" value="${esc(e?.name_en || '')}"></div>
        <div><label class="lbl">${t('hr_id_number')}</label><input id="em-idnum" dir="ltr" value="${esc(e?.id_number || '')}"></div>
        <div><label class="lbl">${t('hr_nationality')}</label><input id="em-nat" value="${esc(e?.nationality || '')}"></div>
        <div><label class="lbl">${t('hr_job')}</label><input id="em-job" value="${esc(e?.job_title || '')}"></div>
        <div><label class="lbl">${t('hr_dept')}</label><input id="em-dept" value="${esc(e?.department || '')}"></div>
        <div><label class="lbl">${t('hr_branch')}</label><select id="em-branch"><option value="">—</option>${brOpts}</select></div>
        <div><label class="lbl">${t('hr_hire_date')}</label><input type="date" id="em-hire" value="${esc(e?.hire_date || '')}"></div>
        <div><label class="lbl">${t('hr_contract')}</label><select id="em-contract">
          ${Object.keys(CONTRACT).map(c => `<option value="${c}" ${e && e.contract_type === c ? 'selected' : ''}>${t(CONTRACT[c])}</option>`).join('')}
        </select></div>
        <div><label class="lbl">${t('hr_status')}</label><select id="em-status">
          ${Object.keys(EMP_STATUS).map(s => `<option value="${s}" ${e && e.status === s ? 'selected' : ''}>${t(EMP_STATUS[s])}</option>`).join('')}
        </select></div>
        <div><label class="lbl">${t('hr_basic')} *</label><input type="number" step="0.01" id="em-basic" value="${e ? e.basic_salary : ''}"></div>
        <div><label class="lbl">${t('hr_housing')}</label><input type="number" step="0.01" id="em-housing" value="${e ? e.housing_allowance : ''}"></div>
        <div><label class="lbl">${t('hr_transport')}</label><input type="number" step="0.01" id="em-transport" value="${e ? e.transport_allowance : ''}"></div>
        <div><label class="lbl">IBAN</label><input id="em-iban" dir="ltr" value="${esc(e?.iban || '')}"></div>
        <div><label class="lbl">${t('hr_bank')}</label><input id="em-bank" value="${esc(e?.bank_name || '')}"></div>
        <div><label class="lbl">${t('hr_mobile')}</label><input id="em-mobile" dir="ltr" value="${esc(e?.mobile || '')}"></div>
      </div>
      <label class="lbl" style="margin-top:10px">${t('hr_other_allowances')}</label>
      <div id="em-other">${otherRows}</div>
      <button class="btn btn-ghost btn-sm" id="em-add-other">${t('hr_add_allowance')}</button>
      <div class="modal-actions">
        <button class="btn btn-gold" id="em-save">${t('btn_save')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);
    $('#em-add-other').onclick = () => $('#em-other').insertAdjacentHTML('beforeend', _otherRow('', ''));
    $('#em-save').onclick = async () => {
      const name = $('#em-name-ar').value.trim();
      if (!name) return toast(t('hr_name_required'), false);
      const basic = _num($('#em-basic').value);
      if (basic <= 0) return toast(t('hr_basic_required'), false);
      const rec = {
        name_ar: name,
        name_en: $('#em-name-en').value.trim() || null,
        id_number: $('#em-idnum').value.trim() || null,
        nationality: $('#em-nat').value.trim() || null,
        job_title: $('#em-job').value.trim() || null,
        department: $('#em-dept').value.trim() || null,
        branch_id: $('#em-branch').value || null,
        hire_date: $('#em-hire').value || null,
        contract_type: $('#em-contract').value,
        status: $('#em-status').value,
        basic_salary: basic,
        housing_allowance: _num($('#em-housing').value),
        transport_allowance: _num($('#em-transport').value),
        other_allowances: $$('#em-other .em-other-row').map(rw => ({
          label: rw.querySelector('.em-other-label').value.trim(),
          amount: _num(rw.querySelector('.em-other-amt').value),
        })).filter(x => x.label && x.amount > 0),
        iban: $('#em-iban').value.trim() || null,
        bank_name: $('#em-bank').value.trim() || null,
        mobile: $('#em-mobile').value.trim() || null,
      };
      let err;
      if (e) ({ error: err } = await sb.from('employees').update(rec).eq('id', e.id));
      else ({ error: err } = await sb.from('employees').insert({ tenant_id: state.tenant, ...rec }));
      if (err) return toast(t('msg_error') + ': ' + err.message, false);
      closeModal(); toast(t('msg_saved')); loadEmployees();
    };
  };

  function _otherRow(label, amount) {
    return `<div class="em-other-row" style="display:flex;gap:8px;margin-bottom:6px">
      <input class="em-other-label" placeholder="${t('hr_allowance_label')}" value="${esc(label || '')}" style="flex:2">
      <input class="em-other-amt" type="number" step="0.01" placeholder="${t('hr_amount')}" value="${amount || ''}" style="flex:1">
      <button class="btn btn-ghost btn-sm em-other-del">✕</button></div>`;
  }
  // تفويض حذف بند بدل (الصفوف تُضاف ديناميكياً)
  document.addEventListener('click', (ev) => {
    if (ev.target.classList && ev.target.classList.contains('em-other-del'))
      ev.target.closest('.em-other-row').remove();
  });

  window.hrToggleEmpStatus = async function (id) {
    const e = (state.employees || []).find(x => x.id === id);
    if (!e) return;
    const next = e.status === 'active' ? 'suspended' : 'active';
    const { error } = await sb.from('employees').update({ status: next }).eq('id', id);
    if (error) return toast(t('msg_error') + ': ' + error.message, false);
    toast(t('msg_saved')); loadEmployees();
  };


  // ─────────── مسيرات الرواتب ───────────
  const RUN_STATUS = { draft: 'hr_run_draft', posted: 'hr_run_posted', paid: 'hr_run_paid' };

  function switchHrSub(sub) {
    $$('#tab-hr .sub-tab').forEach(b => b.classList.toggle('active', b.dataset.sub === sub));
    ['runs', 'advances', 'deductions', 'eos', 'reports', 'settings'].forEach(s =>
      $('#hr-pane-' + s).classList.toggle('hidden', s !== sub));
    if (sub === 'runs') loadPayrollRuns();
    if (sub === 'advances') loadAdvances();
    if (sub === 'deductions') loadDeductions();
    if (sub === 'eos') initEosPane();
    if (sub === 'settings') loadHrSettingsForm();
  }
  window.switchHrSub = switchHrSub;

  async function loadHr() {
    if (!state.employees) await loadEmployees().catch(() => {});
    await getGosiCfg();
    const active = $$('#tab-hr .sub-tab').find(b => b.classList.contains('active'));
    switchHrSub(active ? active.dataset.sub : 'runs');
  }

  async function loadPayrollRuns() {
    const { data: runs } = await sb.from('payroll_runs').select('*')
      .order('month', { ascending: false }).limit(60);
    state.payrollRuns = runs || [];
    $('#tbl-payroll-runs').innerHTML = state.payrollRuns.map(r => `
      <tr>
        <td dir="ltr">${esc(r.month)}</td>
        <td>${r.employees_count}</td>
        <td>${fmt(r.total_gross)}</td>
        <td>${fmt(r.total_net)}</td>
        <td>${t(RUN_STATUS[r.status] || r.status)}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="viewPayrollRun('${r.id}')">👁️ ${t('btn_show')}</button>
          ${r.status === 'draft' ? `<button class="btn btn-gold btn-sm" onclick="postPayrollEntry('${r.id}')">📒 ${t('hr_post_entry')}</button>
            <button class="btn btn-ghost btn-sm" onclick="deletePayrollRun('${r.id}')">🗑️ ${t('btn_delete')}</button>` : ''}
          ${r.status === 'posted' ? `<button class="btn btn-gold btn-sm" onclick="payPayrollRun('${r.id}')">💵 ${t('hr_pay_run')}</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="exportWps('${r.id}')">📄 WPS</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="6" style="color:#7A6A5C">${t('hr_no_runs')}</td></tr>`;
    $('#hr-slips-box').classList.add('hidden');
  }

  // توليد مسيّر شهر: قسيمة لكل موظف نشط (أساسي+بدلات−خصومات−سلف−GOSI)
  window.generatePayrollRun = async function () {
    const month = $('#hr-run-month').value; // 'YYYY-MM'
    if (!month) return toast(t('hr_pick_month'), false);
    if ((state.payrollRuns || []).some(r => r.month === month))
      return toast(t('hr_run_exists'), false);
    const emps = (state.employees || []).filter(e => e.status === 'active');
    if (!emps.length) return toast(t('hr_no_active_emps'), false);
    const cfg = await getGosiCfg();

    const [{ data: deds }, { data: insts }] = await Promise.all([
      sb.from('hr_deductions').select('*').eq('month', month),
      sb.from('advance_installments').select('*, employee_advances(employee_id, status)')
        .eq('status', 'pending').order('seq'),
    ]);
    const dedByEmp = {};
    (deds || []).forEach(d => { (dedByEmp[d.employee_id] = dedByEmp[d.employee_id] || []).push(d); });
    // أقدم قسط pending لكل موظف (سلفة مفتوحة) — قسط واحد شهرياً
    const instByEmp = {};
    (insts || []).forEach(i => {
      const empId = i.employee_advances && i.employee_advances.employee_id;
      if (!empId || i.employee_advances.status !== 'open') return;
      if (!instByEmp[empId]) instByEmp[empId] = i;
    });

    const slips = emps.map(e => {
      const dl = dedByEmp[e.id] || [];
      const inst = instByEmp[e.id];
      const s = slipCalc({
        basic: e.basic_salary, housing: e.housing_allowance, transport: e.transport_allowance,
        other: e.other_allowances || [], isSaudi: isSaudiEmp(e),
        deductions: dl.reduce((x, d) => x + _num(d.amount), 0),
        advance: inst ? _num(inst.amount) : 0,
      }, cfg);
      return { emp: e, s, dedList: dl, inst };
    });

    const tot = (k) => r2(slips.reduce((x, p) => x + p.s[k], 0));
    const { data: run, error } = await sb.from('payroll_runs').insert({
      tenant_id: state.tenant, month, status: 'draft', employees_count: slips.length,
      total_gross: tot('gross'), total_deductions: tot('deductions'),
      total_advances: tot('advance'), total_gosi_employee: tot('gosi_employee'),
      total_gosi_employer: tot('gosi_employer'), total_net: tot('net'),
    }).select().single();
    if (error) return toast(t('msg_error') + ': ' + error.message, false);

    for (const p of slips) {
      const { data: slip, error: e2 } = await sb.from('payroll_slips').insert({
        tenant_id: state.tenant, run_id: run.id, employee_id: p.emp.id,
        basic: p.s.basic, housing: p.s.housing, transport: p.s.transport,
        other_allowances: p.s.other, allowances_total: p.s.allowances, gross: p.s.gross,
        deductions_total: p.s.deductions, advance_deduction: p.s.advance,
        gosi_base: p.s.gosi_base, gosi_employee: p.s.gosi_employee,
        gosi_employer: p.s.gosi_employer, net: p.s.net,
        details: { deductions: p.dedList.map(d => ({ reason: d.reason, amount: d.amount })),
                   advance_id: p.inst ? p.inst.advance_id : null,
                   installment_seq: p.inst ? p.inst.seq : null },
      }).select().single();
      if (e2) { toast(t('msg_error') + ': ' + e2.message, false); continue; }
      if (p.inst) {
        await sb.from('advance_installments')
          .update({ status: 'paid', slip_id: slip.id, paid_at: new Date().toISOString() })
          .eq('id', p.inst.id);
        // إغلاق السلفة لو لم يبقَ أقساط
        const { data: rest } = await sb.from('advance_installments')
          .select('id').eq('advance_id', p.inst.advance_id).eq('status', 'pending').limit(1);
        if (!rest || !rest.length)
          await sb.from('employee_advances').update({ status: 'closed' }).eq('id', p.inst.advance_id);
      }
    }
    toast(t('hr_run_created'));
    loadPayrollRuns();
  };

  // عرض قسائم مسيّر
  window.viewPayrollRun = async function (runId) {
    const run = (state.payrollRuns || []).find(r => r.id === runId);
    const { data: slips } = await sb.from('payroll_slips')
      .select('*, employees(name_ar, name_en, id_number, iban, bank_name, job_title)')
      .eq('run_id', runId).order('created_at');
    state.currentSlips = slips || [];
    state.currentRun = run;
    $('#hr-slips-title').textContent = t('hr_slips_of') + ' ' + (run ? run.month : '');
    $('#tbl-payroll-slips').innerHTML = state.currentSlips.map(s => `
      <tr>
        <td>${esc(s.employees?.name_ar || '—')}</td>
        <td>${fmt(s.basic)}</td><td>${fmt(s.allowances_total)}</td>
        <td>${fmt(s.deductions_total)}</td><td>${fmt(s.advance_deduction)}</td>
        <td>${fmt(s.gosi_employee)}</td><td><b>${fmt(s.net)}</b></td>
        <td><button class="btn btn-ghost btn-sm" onclick="printPayslip('${s.id}')">🖨️ ${t('hr_payslip')}</button></td>
      </tr>`).join('') || `<tr><td colspan="8">${t('hr_no_slips')}</td></tr>`;
    $('#hr-slips-box').classList.remove('hidden');
    $('#hr-slips-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ترحيل قيد المسيّر (قيد واحد immutable):
  //   مدين 5200 مصروف رواتب (الإجمالي) + 5210 مصروف GOSI (حصة صاحب العمل)
  //   دائن 2300 رواتب مستحقة (الصافي) + 2310 GOSI مستحقة (الحصتان)
  //        + 1150 سلف موظفين (الأقساط) + 2320 خصومات مستحقة (الجزاءات)
  window.postPayrollEntry = async function (runId) {
    const run = (state.payrollRuns || []).find(r => r.id === runId);
    if (!run || run.status !== 'draft') return;
    // المرحلة 16: رفض ترحيل مسيّر شهر مقفل (نفحص نهاية الشهر)
    if (typeof window.checkPeriodLock === 'function' &&
        window.checkPeriodLock(run.month ? run.month + '-28' : null)) return;
    const acc = await ensureHrAccounts();
    const L = (a, d, c) => ({ account_id: a.id, party_id: null, debit: r2(d), credit: r2(c) });
    const lines = [L(acc.exp, run.total_gross, 0)];
    if (run.total_gosi_employer > 0) lines.push(L(acc.gosiExp, run.total_gosi_employer, 0));
    lines.push(L(acc.payable, 0, run.total_net));
    const gosiTot = r2(run.total_gosi_employee + run.total_gosi_employer);
    if (gosiTot > 0) lines.push(L(acc.gosi, 0, gosiTot));
    if (run.total_advances > 0) lines.push(L(acc.adv, 0, run.total_advances));
    if (run.total_deductions > 0) lines.push(L(acc.ded, 0, run.total_deductions));
    const { data, error } = await sb.rpc('post_manual_entry', {
      p_tenant: state.tenant, p_memo: t('hr_entry_memo') + ' ' + run.month, p_lines: lines });
    if (error) return toast(t('hr_post_failed') + ': ' + error.message, false);
    await sb.from('payroll_runs').update({ status: 'posted', posted_entry_number: data?.number ?? null }).eq('id', runId);
    toast(t('hr_posted') + ' ' + (data?.number ?? ''));
    loadPayrollRuns();
  };

  // صرف المسيّر: مدين 2300 رواتب مستحقة / دائن الخزينة أو البنك المختار
  window.payPayrollRun = async function (runId) {
    const run = (state.payrollRuns || []).find(r => r.id === runId);
    if (!run || run.status !== 'posted') return;
    await ensureHrAccounts();
    const treas = (state.accounts || []).filter(a => a.kind === 'asset' && String(a.code).startsWith('11'));
    if (!treas.length) return toast(t('hr_no_treasury'), false);
    openModal(`
      <h3>💵 ${t('hr_pay_run')} — ${esc(run.month)}</h3>
      <p>${t('hr_pay_amount')}: <b>${fmt(run.total_net)}</b></p>
      <label class="lbl">${t('hr_pay_from')}</label>
      <select id="pay-acc">${treas.map(a => `<option value="${a.id}">${esc(a.code)} — ${esc(a.name)}</option>`).join('')}</select>
      <div class="modal-actions">
        <button class="btn btn-gold" id="pay-ok">${t('btn_save_post')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);
    $('#pay-ok').onclick = async () => {
      // المرحلة 16: رفض الصرف في فترة مقفلة
      if (typeof window.checkPeriodLock === 'function' &&
          window.checkPeriodLock(new Date().toISOString().slice(0, 10))) return;
      const acc = _accByCode('2300');
      const lines = [
        { account_id: acc.id, party_id: null, debit: run.total_net, credit: 0 },
        { account_id: $('#pay-acc').value, party_id: null, debit: 0, credit: run.total_net },
      ];
      const { data, error } = await sb.rpc('post_manual_entry', {
        p_tenant: state.tenant, p_memo: t('hr_pay_memo') + ' ' + run.month, p_lines: lines });
      if (error) return toast(t('hr_post_failed') + ': ' + error.message, false);
      await sb.from('payroll_runs').update({ status: 'paid', paid_entry_number: data?.number ?? null }).eq('id', runId);
      closeModal(); toast(t('hr_paid')); loadPayrollRuns();
    };
  };

  // حذف مسيّر مسودة: إرجاع أقساطه إلى pending ثم الحذف (القسائم cascade)
  window.deletePayrollRun = async function (runId) {
    const run = (state.payrollRuns || []).find(r => r.id === runId);
    if (!run || run.status !== 'draft') return;
    if (!confirm(t('hr_confirm_del_run'))) return;
    const { data: slips } = await sb.from('payroll_slips').select('id').eq('run_id', runId);
    const ids = (slips || []).map(s => s.id);
    if (ids.length) {
      await sb.from('advance_installments')
        .update({ status: 'pending', slip_id: null, paid_at: null }).in('slip_id', ids);
    }
    const { error } = await sb.from('payroll_runs').delete().eq('id', runId);
    if (error) return toast(t('msg_error') + ': ' + error.message, false);
    toast(t('msg_deleted')); loadPayrollRuns();
  };

  // قسيمة راتب قابلة للطباعة (محرك المعاينة القائم)
  window.printPayslip = function (slipId) {
    const s = (state.currentSlips || []).find(x => x.id === slipId);
    if (!s) return;
    const e = s.employees || {};
    const rows = [
      [t('hr_basic'), { txt: fmt(s.basic), num: _num(s.basic) }],
      [t('hr_housing'), { txt: fmt(s.housing), num: _num(s.housing) }],
      [t('hr_transport'), { txt: fmt(s.transport), num: _num(s.transport) }],
    ];
    (s.other_allowances || []).forEach(a =>
      rows.push([esc(a.label), { txt: fmt(a.amount), num: _num(a.amount) }]));
    const dedRows = [
      [t('hr_deductions'), { txt: fmt(s.deductions_total), num: _num(s.deductions_total) }],
      [t('hr_advance_ded'), { txt: fmt(s.advance_deduction), num: _num(s.advance_deduction) }],
      [t('hr_gosi_emp'), { txt: fmt(s.gosi_employee), num: _num(s.gosi_employee) }],
    ];
    openPrintPreview({
      title: t('hr_payslip_title') + ' — ' + (state.currentRun ? state.currentRun.month : ''),
      meta: [
        [t('hr_employee'), e.name_ar || '—'],
        [t('hr_id_number'), e.id_number || '—'],
        [t('hr_job'), e.job_title || '—'],
        ['IBAN', e.iban || '—'],
      ],
      tables: [
        { caption: t('hr_earnings'), head: [t('hr_item'), t('hr_amount')], rows },
        { caption: t('hr_deductions_sec'), head: [t('hr_item'), t('hr_amount')], rows: dedRows },
      ],
      totals: [t('hr_gross') + ': ' + fmt(s.gross), t('hr_net') + ': ' + fmt(s.net)],
      fileName: 'payslip-' + (state.currentRun ? state.currentRun.month : '') + '-' + (e.name_ar || ''),
    });
  };

  // تصدير ملف حماية الأجور WPS (CSV بالبنية السعودية المبسطة):
  // سجل منشأة (HDR) + سجل لكل موظف (EMP)
  window.exportWps = async function (runId) {
    const run = (state.payrollRuns || []).find(r => r.id === runId);
    if (!run) return;
    let slips = state.currentSlips;
    if (!state.currentRun || state.currentRun.id !== runId) {
      const { data } = await sb.from('payroll_slips')
        .select('*, employees(name_ar, name_en, id_number, iban, bank_name)').eq('run_id', runId);
      slips = data || [];
    }
    const estNo = (state.tax && (state.tax.cr_number || state.tax.vat_number)) || state.tenant;
    const lines = [];
    // HDR: نوع السجل، رقم المنشأة، الشهر، عدد الموظفين، إجمالي الصافي
    lines.push(['HDR', estNo, run.month, slips.length, r2(run.total_net).toFixed(2)].join(','));
    slips.forEach(s => {
      const e = s.employees || {};
      lines.push(['EMP',
        e.id_number || '', e.name_ar || '', (e.iban || '').replace(/\s/g, ''),
        e.bank_name || '', _num(s.basic).toFixed(2), _num(s.allowances_total).toFixed(2),
        r2(_num(s.deductions_total) + _num(s.advance_deduction) + _num(s.gosi_employee)).toFixed(2),
        _num(s.net).toFixed(2)].join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'WPS-' + run.month + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast(t('hr_wps_exported'));
  };

  // ─────────── السلف والخصومات ───────────
  async function loadAdvances() {
    const [{ data: advs }, { data: insts }] = await Promise.all([
      sb.from('employee_advances').select('*, employees(name_ar)').order('created_at', { ascending: false }),
      sb.from('advance_installments').select('*'),
    ]);
    state.advances = advs || [];
    const instByAdv = {};
    (insts || []).forEach(i => { (instByAdv[i.advance_id] = instByAdv[i.advance_id] || []).push(i); });
    $('#tbl-advances').innerHTML = state.advances.map(a => {
      const list = (instByAdv[a.id] || []).sort((x, y) => x.seq - y.seq);
      const paid = list.filter(i => i.status === 'paid');
      const paidAmt = r2(paid.reduce((s, i) => s + _num(i.amount), 0));
      return `<tr>
        <td>${esc(a.employees?.name_ar || '—')}</td>
        <td>${fmt(a.amount)}</td>
        <td>${esc(a.advance_date || '—')}</td>
        <td>${paid.length}/${a.installments_count}</td>
        <td>${fmt(r2(_num(a.amount) - paidAmt))}</td>
        <td>${a.status === 'open' ? t('hr_adv_open') : t('hr_adv_closed')}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="viewAdvance('${a.id}')">📋 ${t('hr_schedule')}</button></td>
      </tr>`;
    }).join('') || `<tr><td colspan="7" style="color:#7A6A5C">${t('hr_no_advances')}</td></tr>`;
  }

  window.openAdvanceForm = function () {
    const opts = (state.employees || []).filter(e => e.status !== 'terminated')
      .map(e => `<option value="${e.id}">${esc(e.name_ar)}</option>`).join('');
    openModal(`
      <h3>💸 ${t('hr_add_advance')}</h3>
      <label class="lbl">${t('hr_employee')}</label><select id="adv-emp">${opts}</select>
      <label class="lbl">${t('hr_amount')}</label><input type="number" step="0.01" id="adv-amount">
      <label class="lbl">${t('hr_date')}</label><input type="date" id="adv-date" value="${new Date().toISOString().slice(0, 10)}">
      <label class="lbl">${t('hr_inst_count')}</label><input type="number" min="1" step="1" id="adv-count" value="1">
      <label class="lbl">${t('hr_memo')}</label><input id="adv-memo">
      <div class="modal-actions">
        <button class="btn btn-gold" id="adv-save">${t('btn_save')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);
    $('#adv-save').onclick = async () => {
      const amount = _num($('#adv-amount').value);
      const count = Math.floor(_num($('#adv-count').value));
      if (amount <= 0 || count < 1) return toast(t('hr_invalid_advance'), false);
      const { data: adv, error } = await sb.from('employee_advances').insert({
        tenant_id: state.tenant, employee_id: $('#adv-emp').value, amount,
        advance_date: $('#adv-date').value, installments_count: count,
        memo: $('#adv-memo').value.trim() || null,
      }).select().single();
      if (error) return toast(t('msg_error') + ': ' + error.message, false);
      const sched = advanceSchedule(amount, count);
      const { error: e2 } = await sb.from('advance_installments').insert(
        sched.map((amt, i) => ({ tenant_id: state.tenant, advance_id: adv.id, seq: i + 1, amount: amt })));
      if (e2) return toast(t('msg_error') + ': ' + e2.message, false);
      closeModal(); toast(t('msg_saved')); loadAdvances();
    };
  };

  window.viewAdvance = async function (advId) {
    const a = (state.advances || []).find(x => x.id === advId);
    const { data: insts } = await sb.from('advance_installments').select('*')
      .eq('advance_id', advId).order('seq');
    openModal(`
      <h3>📋 ${t('hr_schedule')} — ${esc(a?.employees?.name_ar || '')}</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>${t('hr_amount')}</th><th>${t('hr_status')}</th></tr></thead>
        <tbody>${(insts || []).map(i => `<tr><td>${i.seq}</td><td>${fmt(i.amount)}</td>
          <td>${i.status === 'paid' ? '✅ ' + t('hr_paid_inst') : '⏳ ' + t('hr_pending_inst')}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="modal-actions"><button class="btn btn-gold" onclick="closeModal()">${t('btn_close')}</button></div>`);
  };

  async function loadDeductions() {
    const month = $('#hr-ded-month') ? $('#hr-ded-month').value : '';
    let q = sb.from('hr_deductions').select('*, employees(name_ar)').order('created_at', { ascending: false });
    if (month) q = q.eq('month', month);
    const { data } = await q.limit(200);
    $('#tbl-deductions').innerHTML = (data || []).map(d => `
      <tr>
        <td dir="ltr">${esc(d.month)}</td><td>${esc(d.employees?.name_ar || '—')}</td>
        <td>${fmt(d.amount)}</td><td>${esc(d.reason || '—')}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="deleteDeduction('${d.id}')">🗑️</button></td>
      </tr>`).join('') || `<tr><td colspan="5" style="color:#7A6A5C">${t('hr_no_deductions')}</td></tr>`;
  }

  window.openDeductionForm = function () {
    const opts = (state.employees || []).filter(e => e.status === 'active')
      .map(e => `<option value="${e.id}">${esc(e.name_ar)}</option>`).join('');
    openModal(`
      <h3>➖ ${t('hr_add_deduction')}</h3>
      <label class="lbl">${t('hr_employee')}</label><select id="ded-emp">${opts}</select>
      <label class="lbl">${t('hr_month')}</label><input type="month" id="ded-month">
      <label class="lbl">${t('hr_amount')}</label><input type="number" step="0.01" id="ded-amount">
      <label class="lbl">${t('hr_reason')}</label><input id="ded-reason">
      <div class="modal-actions">
        <button class="btn btn-gold" id="ded-save">${t('btn_save')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);
    $('#ded-save').onclick = async () => {
      const amount = _num($('#ded-amount').value);
      const month = $('#ded-month').value;
      if (amount <= 0 || !month) return toast(t('hr_invalid_deduction'), false);
      const { error } = await sb.from('hr_deductions').insert({
        tenant_id: state.tenant, employee_id: $('#ded-emp').value, month, amount,
        reason: $('#ded-reason').value.trim() || null });
      if (error) return toast(t('msg_error') + ': ' + error.message, false);
      closeModal(); toast(t('msg_saved'));
      if ($('#hr-ded-month')) $('#hr-ded-month').value = month;
      loadDeductions();
    };
  };

  window.deleteDeduction = async function (id) {
    const { error } = await sb.from('hr_deductions').delete().eq('id', id);
    if (error) return toast(t('msg_error') + ': ' + error.message, false);
    toast(t('msg_deleted')); loadDeductions();
  };

  // ─────────── حاسبة نهاية الخدمة ───────────
  let _eosResult = null;
  function initEosPane() {
    const sel = $('#eos-emp');
    if (sel && !sel.options.length) {
      sel.innerHTML = '<option value="">—</option>' + (state.employees || [])
        .map(e => `<option value="${e.id}">${esc(e.name_ar)}</option>`).join('');
    }
  }
  window.eosFillFromEmp = function () {
    const e = (state.employees || []).find(x => x.id === $('#eos-emp').value);
    if (!e) return;
    $('#eos-hire').value = e.hire_date || '';
    $('#eos-wage').value = r2(_num(e.basic_salary) + _num(e.housing_allowance) +
      _num(e.transport_allowance) + (e.other_allowances || []).reduce((s, a) => s + _num(a.amount), 0));
  };
  window.calcEos = function () {
    const res = computeEOS({
      hireDate: $('#eos-hire').value, endDate: $('#eos-end').value,
      wage: _num($('#eos-wage').value), reason: $('#eos-reason').value,
    });
    _eosResult = res;
    $('#eos-result').innerHTML = `
      <div class="table-wrap"><table><tbody>
        <tr><td>${t('hr_eos_years')}</td><td><b>${fmt(res.years)}</b></td></tr>
        <tr><td>${t('hr_eos_gross')}</td><td>${fmt(res.gross)}</td></tr>
        <tr><td>${t('hr_eos_factor')}</td><td>${res.factor === 0 ? '0' : res.factor === 1 ? t('hr_eos_full') :
          (res.factor === 1 / 3 ? t('hr_eos_third') : t('hr_eos_twothirds'))}</td></tr>
        <tr><td style="font-weight:700">${t('hr_eos_award')}</td>
            <td style="font-weight:700;color:#B42318">${fmt(res.award)}</td></tr>
      </tbody></table></div>`;
    $('#eos-post').disabled = !(res.award > 0);
  };
  // ترحيل المكافأة كقيد: مدين 5220 مصروف نهاية خدمة / دائن 2300 رواتب مستحقة
  window.postEosEntry = async function () {
    if (!_eosResult || !(_eosResult.award > 0)) return;
    // المرحلة 16: رفض ترحيل المكافأة في فترة مقفلة (القيد يُحفظ بتاريخ اليوم)
    if (typeof window.checkPeriodLock === 'function' &&
        window.checkPeriodLock(new Date().toISOString().slice(0, 10))) return;
    const acc = await ensureHrAccounts();
    const empName = $('#eos-emp').selectedOptions[0] && $('#eos-emp').value
      ? $('#eos-emp').selectedOptions[0].textContent : '';
    const lines = [
      { account_id: acc.eosExp.id, party_id: null, debit: _eosResult.award, credit: 0 },
      { account_id: acc.payable.id, party_id: null, debit: 0, credit: _eosResult.award },
    ];
    const { data, error } = await sb.rpc('post_manual_entry', {
      p_tenant: state.tenant,
      p_memo: t('hr_eos_memo') + (empName ? ' — ' + empName : ''), p_lines: lines });
    if (error) return toast(t('hr_post_failed') + ': ' + error.message, false);
    toast(t('hr_posted') + ' ' + (data?.number ?? ''));
  };

  // ─────────── تقارير HR (طباعة + Excel عبر محرك دفعة B) ───────────
  async function _slipsOfMonth(month) {
    const { data: runs } = await sb.from('payroll_runs').select('id, month').eq('month', month);
    if (!runs || !runs.length) return { run: null, slips: [] };
    const { data: slips } = await sb.from('payroll_slips')
      .select('*, employees(name_ar, id_number, nationality, job_title)')
      .eq('run_id', runs[0].id).order('created_at');
    return { run: runs[0], slips: slips || [] };
  }

  window.hrReport = async function (kind) {
    const month = $('#hr-rep-month').value;
    if (kind !== 'advances' && !month) return toast(t('hr_pick_month'), false);
    state._hrDoc = null;
    let doc = null;
    if (kind === 'payroll' || kind === 'gosi') {
      const { run, slips } = await _slipsOfMonth(month);
      if (!run) return toast(t('hr_no_runs'), false);
      if (kind === 'payroll') {
        doc = {
          title: t('hr_rep_payroll') + ' — ' + month,
          meta: [[t('hr_month'), month], [t('hr_emp_count'), String(run.employees_count)]],
          tables: [{
            head: [t('hr_employee'), t('hr_basic'), t('hr_allowances'), t('hr_gross'),
                   t('hr_deductions'), t('hr_advance_ded'), t('hr_gosi_emp'), t('hr_net')],
            rows: slips.map(s => [esc(s.employees?.name_ar || '—'),
              { txt: fmt(s.basic), num: _num(s.basic) }, { txt: fmt(s.allowances_total), num: _num(s.allowances_total) },
              { txt: fmt(s.gross), num: _num(s.gross) }, { txt: fmt(s.deductions_total), num: _num(s.deductions_total) },
              { txt: fmt(s.advance_deduction), num: _num(s.advance_deduction) },
              { txt: fmt(s.gosi_employee), num: _num(s.gosi_employee) }, { txt: fmt(s.net), num: _num(s.net) }]),
          }],
          totals: [t('hr_gross') + ': ' + fmt(run.total_gross), t('hr_net') + ': ' + fmt(run.total_net)],
          fileName: 'payroll-' + month,
        };
      } else {
        doc = {
          title: t('hr_rep_gosi') + ' — ' + month,
          meta: [[t('hr_month'), month]],
          tables: [{
            head: [t('hr_employee'), t('hr_nationality'), t('hr_gosi_base'), t('hr_gosi_emp'), t('hr_gosi_er'), t('hr_gosi_total')],
            rows: slips.map(s => [esc(s.employees?.name_ar || '—'), esc(s.employees?.nationality || '—'),
              { txt: fmt(s.gosi_base), num: _num(s.gosi_base) },
              { txt: fmt(s.gosi_employee), num: _num(s.gosi_employee) },
              { txt: fmt(s.gosi_employer), num: _num(s.gosi_employer) },
              { txt: fmt(r2(_num(s.gosi_employee) + _num(s.gosi_employer))), num: r2(_num(s.gosi_employee) + _num(s.gosi_employer)) }]),
          }],
          totals: [t('hr_gosi_emp') + ': ' + fmt(run.total_gosi_employee),
                   t('hr_gosi_er') + ': ' + fmt(run.total_gosi_employer)],
          fileName: 'gosi-' + month,
        };
      }
    } else if (kind === 'advances') {
      const [{ data: advs }, { data: insts }] = await Promise.all([
        sb.from('employee_advances').select('*, employees(name_ar)').eq('status', 'open'),
        sb.from('advance_installments').select('*').eq('status', 'pending'),
      ]);
      const pendByAdv = {};
      (insts || []).forEach(i => { pendByAdv[i.advance_id] = r2((pendByAdv[i.advance_id] || 0) + _num(i.amount)); });
      doc = {
        title: t('hr_rep_advances'),
        meta: [[t('hr_date'), new Date().toLocaleDateString('ar-EG')]],
        tables: [{
          head: [t('hr_employee'), t('hr_amount'), t('hr_date'), t('hr_remaining')],
          rows: (advs || []).map(a => [esc(a.employees?.name_ar || '—'),
            { txt: fmt(a.amount), num: _num(a.amount) }, esc(a.advance_date || '—'),
            { txt: fmt(pendByAdv[a.id] || 0), num: pendByAdv[a.id] || 0 }]),
        }],
        totals: [t('hr_remaining') + ': ' + fmt(r2((advs || []).reduce((s, a) => s + (pendByAdv[a.id] || 0), 0)))],
        fileName: 'advances-report',
      };
      if (!(advs || []).length) return toast(t('hr_no_advances'), false);
    }
    state._hrDoc = doc;
    openPrintPreview(doc);
  };
  window.hrReportExcel = function () { if (state._hrDoc) exportDocExcel(state._hrDoc); };

  // ─────────── إعدادات GOSI ───────────
  async function loadHrSettingsForm() {
    const cfg = await getGosiCfg();
    $('#gosi-sa-emp').value = (cfg.sa_emp * 100);
    $('#gosi-sa-er').value = (cfg.sa_er * 100);
    $('#gosi-expat-er').value = (cfg.expat_er * 100);
    $('#gosi-cap').value = cfg.cap;
  }
  window.saveHrSettings = async function () {
    const cfg = {
      sa_emp: _num($('#gosi-sa-emp').value) / 100,
      sa_er: _num($('#gosi-sa-er').value) / 100,
      expat_er: _num($('#gosi-expat-er').value) / 100,
      cap: _num($('#gosi-cap').value) || HR_DEFAULT_GOSI.cap,
    };
    const { error } = await sb.from('tenants').update({ hr_settings: cfg }).eq('id', state.tenant);
    if (error) return toast(t('hr_settings_failed') + ': ' + error.message, false);
    state.hrGosi = cfg;
    toast(t('msg_saved'));
  };

  // ─────────── ربط الأحداث ───────────
  window.loadEmployees = loadEmployees;
  window.loadHr = loadHr;
  const _initHr = () => {
    const b1 = $('#btn-add-employee'); if (b1) b1.onclick = () => openEmployeeForm(null);
    const srch = $('#emp-search'); if (srch) srch.oninput = () => renderEmployees(srch.value.trim());
    const gen = $('#btn-gen-run'); if (gen) gen.onclick = generatePayrollRun;
    $$('#tab-hr .sub-tab').forEach(b => b.onclick = () => switchHrSub(b.dataset.sub));
    const bAdv = $('#btn-add-advance'); if (bAdv) bAdv.onclick = openAdvanceForm;
    const bDed = $('#btn-add-deduction'); if (bDed) bDed.onclick = openDeductionForm;
    const dm = $('#hr-ded-month'); if (dm) dm.onchange = loadDeductions;
    const eEmp = $('#eos-emp'); if (eEmp) eEmp.onchange = eosFillFromEmp;
    const eCalc = $('#btn-eos-calc'); if (eCalc) eCalc.onclick = calcEos;
    const ePost = $('#eos-post'); if (ePost) ePost.onclick = postEosEntry;
    const gSave = $('#btn-save-gosi'); if (gSave) gSave.onclick = saveHrSettings;
  };
  // السكربتات في نهاية body (DOM جاهز)، لكن نحتمي لأي ترتيب تحميل مستقبلي
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initHr);
  else _initHr();

})(typeof window !== 'undefined' ? window : globalThis);
