/* ═══════════════════════════════════════════════════════════════
   HAZEM.ERP — المرحلة 15: المصروفات + مراكز التكلفة + الفواتير المتكررة + تذكيرات التحصيل
   جزآن في ملف واحد (بلا build step):
   • منطق نقي قابل للاختبار في Node: بناء قيد المصروف (مع/بدون ضريبة مدخلات)،
     حساب next_run_date للتكرارات (شهري/ربع سنوي/سنوي مع ضبط نهاية الشهر)،
     استحقاق القوالب، أيام التأخير، توزيع المقبوضات FIFO على الفواتير،
     تجميع أرباح/مصروفات مراكز التكلفة.
   • واجهات المتصفح (بعد app.js): سندات المصروفات، تصنيفات المصروفات،
     مراكز التكلفة + تقريرها، الفواتير المتكررة (المستحقة اليوم + توليد)،
     تذكيرات التحصيل + خطاب تحصيل ثنائي اللغة.
   قرارات موثقة:
   • مبلغ المصروف «شامل الضريبة» اتساقاً مع قرار المرحلة 11 (vat.js):
     الصافي = الإجمالي − lineTax(الإجمالي, التصنيف). القيد: مدين حساب
     المصروف بالصافي + مدين 2200 بضريبة المدخلات / دائن الخزينة بالإجمالي.
     ضريبة مدخلات المصروفات تُضاف لخلايا مشتريات الإقرار (تعديل تراكمي
     صغير في runVatReturn بـ app.js).
   • كل القيود عبر post_manual_entry القائمة (immutable) — لا قيد عكسي آلي هنا.
   • مركز التكلفة على بنود القيد: نمرّر cost_center_id ضمن p_lines؛ إن رفض
     الـ RPC (نسخة قديمة لا تدعمه) نعيد المحاولة بدونه ثم نحدّث
     journal_entry_lines.cost_center_id مباشرةً بأفضل جهد (لا يُعدَّل مبلغ).
   • لا خلفية تلقائية للفواتير المتكررة (لا سيرفر): التوليد يدوي من شاشة
     «المستحقة اليوم» عبر نفس RPC فواتير البيع (post_sales_invoice) ثم
     تحديث next_run_date وعدد الإصدارات.
   • تاريخ استحقاق الفاتورة للتذكيرات = تاريخ الفاتورة + 30 يوماً (افتراض
     موثق — لا يوجد عمود شروط دفع حالياً)، والمقبوضات تُوزَّع FIFO على
     فواتير العميل الأقدم فالأحدث.
   يعمل في المتصفح و Node (للاختبارات) بلا build step.
   ═══════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';

  const r2 = (typeof g.r2 === 'function') ? g.r2
    : (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const _num = (v) => Number(v) || 0;
  // ضريبة بند: من vat.js إن وُجد (المتصفح)، وإلا نفس المعادلة 15% شاملة
  const _lineTax = (typeof g.lineTax === 'function') ? g.lineTax
    : (gross, cat) => (cat === 'standard' || !cat ? r2((_num(gross)) * 0.15 / 1.15) : 0);

  /* ─────────── ١) قيد المصروف ───────────
     in: { gross (شامل الضريبة), taxCategory, expenseAccountId, vatAccountId,
           treasuryAccountId, costCenterId? }
     out: { lines, net, tax, gross, balanced } — مدين المصروف بالصافي +
           مدين الضريبة (إن وجدت) / دائن الخزينة بالإجمالي */
  function expenseEntry(o) {
    const gross = r2(_num(o.gross));
    const tax = _lineTax(gross, o.taxCategory);
    const net = r2(gross - tax);
    if (gross <= 0 || net < 0 || !o.expenseAccountId || !o.treasuryAccountId) {
      return { lines: [], net: 0, tax: 0, gross, balanced: false };
    }
    const lines = [{
      account_id: o.expenseAccountId, party_id: null,
      debit: net, credit: 0, cost_center_id: o.costCenterId || null,
    }];
    if (tax > 0 && o.vatAccountId) {
      lines.push({
        account_id: o.vatAccountId, party_id: null,
        debit: tax, credit: 0, cost_center_id: o.costCenterId || null,
      });
    }
    lines.push({ account_id: o.treasuryAccountId, party_id: null, debit: 0, credit: gross });
    const td = r2(lines.reduce((s, l) => s + l.debit, 0));
    const tc = r2(lines.reduce((s, l) => s + l.credit, 0));
    return { lines, net, tax, gross, balanced: td === tc && td > 0 };
  }

  /* ─────────── ٢) تواريخ التكرار ─────────── */
  const _iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
    '-' + String(d.getDate()).padStart(2, '0');
  // إضافة أشهر مع ضبط اليوم لنهاية الشهر (31 يناير + شهر → 28/29 فبراير)
  function addMonthsClamped(isoDate, months) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const target = new Date(y, mo - 1 + months, 1); // أول الشهر الهدف
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    return _iso(new Date(target.getFullYear(), target.getMonth(), Math.min(d, lastDay)));
  }
  const FREQ_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };
  // تاريخ التشغيل التالي بعد تاريخ معيّن حسب التكرار
  function nextRunDate(fromIso, freq) {
    const m = FREQ_MONTHS[freq];
    return m ? addMonthsClamped(fromIso, m) : null;
  }
  // هل القالب مستحق الإصدار اليوم؟ (نشط + حان الموعد + ضمن فترة الانتهاء)
  function recurringIsDue(tpl, todayIso) {
    if (!tpl || tpl.is_active === false) return false;
    const next = tpl.next_run_date;
    if (!next || !todayIso) return false;
    if (next > todayIso) return false;
    if (tpl.end_date && next > tpl.end_date) return false;
    return true;
  }

  /* ─────────── ٣) تذكيرات التحصيل ─────────── */
  // أيام التأخير بين تاريخ الاستحقاق واليوم (لا سالبة)
  function overdueDays(dueIso, todayIso) {
    const a = new Date(dueIso), b = new Date(todayIso);
    if (isNaN(a) || isNaN(b)) return 0;
    return Math.max(0, Math.floor((b - a) / 86400000));
  }
  // توزيع إجمالي المقبوضات FIFO على فواتير عميل (مصنفة أقدم→أحدث)
  // in: invoices [{id, number, total, created_at}], paymentsTotal
  // out: [{...inv, paid, remaining}]
  function allocateFifo(invoices, paymentsTotal) {
    let pool = r2(_num(paymentsTotal));
    return (invoices || []).map(inv => {
      const total = r2(_num(inv.total));
      const paid = r2(Math.min(pool, total));
      pool = r2(Math.max(pool - paid, 0));
      return Object.assign({}, inv, { paid, remaining: r2(total - paid) });
    });
  }
  // بناء صفوف التقرير: فواتير متبقية + تاريخ استحقاق (افتراضي: +30 يوماً) + أيام تأخير
  function buildReminderRows(invoices, paymentsTotal, todayIso, termDays) {
    const term = termDays == null ? 30 : _num(termDays);
    return allocateFifo(invoices, paymentsTotal)
      .filter(i => i.remaining > 0)
      .map(i => {
        const base = new Date(i.created_at);
        const due = isNaN(base) ? null : _iso(new Date(base.getTime() + term * 86400000));
        const days = due ? overdueDays(due, todayIso) : 0;
        return Object.assign({}, i, { due_date: due, overdue_days: days });
      })
      .filter(i => i.overdue_days > 0);
  }

  /* ─────────── ٤) تجميع مراكز التكلفة ───────────
     in: بنود قيود موسومة [{cost_center_id, debit, credit, kind (revenue|expense|...)}]
     out: خريطة String(ccId) → { cost_center_id, revenue, expense, net }
     (cost_center_id = null → «بدون مركز تكلفة») */
  function ccAggregate(lines) {
    const map = {};
    (lines || []).forEach(l => {
      const key = l.cost_center_id || null;
      const k = String(key);
      if (!map[k]) map[k] = { cost_center_id: key, revenue: 0, expense: 0, net: 0 };
      if (l.kind === 'revenue') map[k].revenue = r2(map[k].revenue + (_num(l.credit) - _num(l.debit)));
      else if (l.kind === 'expense') map[k].expense = r2(map[k].expense + (_num(l.debit) - _num(l.credit)));
    });
    Object.keys(map).forEach(k => { map[k].net = r2(map[k].revenue - map[k].expense); });
    return map;
  }

  const pureExports = {
    expenseEntry, addMonthsClamped, nextRunDate, recurringIsDue,
    overdueDays, allocateFifo, buildReminderRows, ccAggregate, FREQ_MONTHS,
  };
  Object.assign(g, pureExports);
  if (typeof module !== 'undefined' && module.exports) module.exports = pureExports;
  if (typeof document === 'undefined') return; // Node: منطق نقي فقط

  /* ═══════════════════════ واجهات المتصفح ═══════════════════════ */

  const _todayIso = () => _iso(new Date());
  const FREQ_LBL = { monthly: 'ex_freq_monthly', quarterly: 'ex_freq_quarterly', yearly: 'ex_freq_yearly' };
  const PAY_LBL = { cash: 'ex_pay_cash', bank: 'ex_pay_bank' };

  // حسابات الخزن: أصول 11xx (نفس منطق app.js)
  const _treasAccounts = () => (state.accounts || [])
    .filter(a => a.kind === 'asset' && String(a.code).startsWith('11'));
  const _vatAcc = () => (state.accounts || []).find(a => String(a.code) === '2200');
  const _accName = (id) => {
    const a = (state.accounts || []).find(x => x.id === id);
    return a ? a.code + ' — ' + a.name : '—';
  };
  const _ccName = (id) => {
    if (!id) return t('ex_no_cc');
    const c = (state.costCenters || []).find(x => x.id === id);
    return c ? c.code + ' — ' + c.name : '—';
  };

  // ضمان بيانات المرحلة 15 محمّلة في state
  async function ensureExpensesData() {
    if (!state.accounts || !state.accounts.length) await loadAccounts();
    const [cats, ccs, recs] = await Promise.all([
      sb.from('expense_categories').select('*').order('name_ar'),
      sb.from('cost_centers').select('*, branches(name)').order('code'),
      sb.from('recurring_invoices').select('*, parties(name), recurring_invoice_lines(*)').order('next_run_date'),
    ]);
    state.expenseCategories = cats.data || [];
    state.costCenters = ccs.data || [];
    state.recurringInvoices = (recs.data || []).map(r =>
      Object.assign({}, r, { lines: (r.recurring_invoice_lines || []).sort((a, b) => (a.sort || 0) - (b.sort || 0)) }));
    if (cats.error) toast(t('ex_load_fail') + ': ' + cats.error.message, false);
  }

  // ─────────── التبويبات الفرعية ───────────
  const EX_SUBS = ['list', 'cats', 'ccs', 'ccrep', 'rec', 'rem'];
  function switchExSub(sub) {
    if (!EX_SUBS.includes(sub)) sub = 'list';
    $$('#tab-expenses .sub-tab').forEach(b => b.classList.toggle('active', b.dataset.sub === sub));
    EX_SUBS.forEach(s => $('#ex-pane-' + s).classList.toggle('hidden', s !== sub));
    if (sub === 'rec') renderRecurring();
  }
  window.switchExSub = switchExSub;
  window.openExpenses = (sub) => { switchTab('expenses'); switchExSub(sub || 'list'); };

  async function loadExpensesTab() {
    await ensureExpensesData();
    await loadExpenses();
    renderCats();
    renderCcs();
    renderRecurring();
    updateDueBadge();
    const active = $$('#tab-expenses .sub-tab').find(b => b.classList.contains('active'));
    switchExSub(active ? active.dataset.sub : 'list');
    // تواريخ التقارير الافتراضية (أول الشهر → اليوم)
    const now = new Date();
    const first = _iso(new Date(now.getFullYear(), now.getMonth(), 1));
    if ($('#ex-ccrep-from') && !$('#ex-ccrep-from').value) $('#ex-ccrep-from').value = first;
    if ($('#ex-ccrep-to') && !$('#ex-ccrep-to').value) $('#ex-ccrep-to').value = _todayIso();
  }
  window.loadExpensesTab = loadExpensesTab;

  // عدّاد «مستحق» على تبويب الفواتير المتكررة
  function dueTemplates(todayIso) {
    return (state.recurringInvoices || []).filter(r => recurringIsDue(r, todayIso || _todayIso()));
  }
  function updateDueBadge() {
    const n = dueTemplates().length;
    const badge = $('#ex-due-badge');
    if (badge) { badge.textContent = n; badge.classList.toggle('hidden', n === 0); }
  }

  /* ═══════════ ١) المصروفات التشغيلية ═══════════ */
  async function loadExpenses() {
    const { data, error } = await sb.from('expenses')
      .select('*, expense_categories(name_ar, name_en), cost_centers(code, name)')
      .order('expense_date', { ascending: false }).order('created_at', { ascending: false });
    if (error) return toast(t('ex_load_fail') + ': ' + error.message, false);
    state.expenses = data || [];
    renderExpenses(($('#ex-search') && $('#ex-search').value || '').trim());
  }

  function renderExpenses(q) {
    const list = (state.expenses || []).filter(e => !q ||
      String(e.number).includes(q) ||
      (e.expense_categories?.name_ar || '').includes(q) ||
      (e.reference || '').includes(q) ||
      (e.notes || '').includes(q));
    $('#tbl-expenses').innerHTML = list.map(e => `
      <tr>
        <td>${e.number}</td>
        <td dir="ltr">${esc(e.expense_date || '')}</td>
        <td>${esc(e.expense_categories?.name_ar || '—')}</td>
        <td>${fmt(e.amount)}</td>
        <td>${fmt(e.tax_amount || 0)}</td>
        <td>${t(PAY_LBL[e.payment_method] || e.payment_method)}</td>
        <td>${esc(_accName(e.treasury_account_id))}</td>
        <td>${esc(_ccName(e.cost_center_id))}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="exPrint('${e.id}')">🖨️ ${t('btn_print')}</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="9" style="color:#66707E">${t('ex_none')}</td></tr>`;
  }
  if ($('#ex-search')) $('#ex-search').oninput = () => renderExpenses($('#ex-search').value.trim());

  // نموذج سند مصروف جديد
  window.openExpenseForm = async function () {
    await ensureExpensesData();
    if (!state.expenseCategories.length) return toast(t('ex_need_cat'), false);
    const treas = _treasAccounts();
    if (!treas.length) return toast(t('ex_need_treasury'), false);
    const catOpts = state.expenseCategories.map(c =>
      `<option value="${c.id}" data-account="${c.account_id}">${esc(c.name_ar)}${c.name_en ? ' (' + esc(c.name_en) + ')' : ''}</option>`).join('');
    const treasOpts = (pm) => treas.map(a =>
      `<option value="${a.id}" ${(pm === 'cash' ? String(a.code) === '1100' : String(a.code) !== '1100') ? 'selected' : ''}>${esc(a.code)} — ${esc(a.name)}</option>`).join('');
    const ccOpts = '<option value="">' + t('ex_no_cc') + '</option>' +
      state.costCenters.map(c => `<option value="${c.id}">${esc(c.code)} — ${esc(c.name)}</option>`).join('');
    const taxOpts = (window.TAX_CATS || ['standard', 'zero', 'exempt', 'out_of_scope']).map(c =>
      `<option value="${c}">${t('tax_cat_' + (c === 'out_of_scope' ? 'out' : c))}</option>`).join('');

    openModal(`
      <h3>🧾 ${t('ex_new')}</h3>
      <div class="form-grid">
        <div><label class="lbl">${t('ex_date')}</label><input type="date" id="exf-date" value="${_todayIso()}"></div>
        <div><label class="lbl">${t('ex_category')}</label><select id="exf-cat">${catOpts}</select></div>
        <div><label class="lbl">${t('ex_amount')} (${t('ex_incl_vat')})</label><input type="number" id="exf-amount" min="0" step="any"></div>
        <div><label class="lbl">${t('ex_tax_cat')}</label><select id="exf-taxcat">${taxOpts}</select></div>
        <div><label class="lbl">${t('ex_pay_method')}</label><select id="exf-pay">
          <option value="cash">${t('ex_pay_cash')}</option><option value="bank">${t('ex_pay_bank')}</option></select></div>
        <div><label class="lbl">${t('ex_treasury')}</label><select id="exf-treas">${treasOpts('cash')}</select></div>
        <div><label class="lbl">${t('ex_cc')}</label><select id="exf-cc">${ccOpts}</select></div>
        <div><label class="lbl">${t('ex_reference')}</label><input id="exf-ref" dir="ltr"></div>
      </div>
      <div class="je-totals" style="margin:8px 0">
        <span class="t-d">${t('tot_net')}: <span id="exf-net">0</span></span>
        <span class="t-c">${t('tot_vat')}: <span id="exf-tax">0</span></span>
        <span class="je-balance ok">${t('tot_gross')}: <span id="exf-gross">0</span></span>
      </div>
      <label class="lbl">${t('ex_notes')}</label>
      <input id="exf-notes">
      <div class="modal-actions">
        <button class="btn btn-gold" id="exf-save">${t('btn_save_post')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);
    $('#modal-body').classList.add('modal-lg');

    const recalc = () => {
      const gross = Number($('#exf-amount').value) || 0;
      const tax = _lineTax(gross, $('#exf-taxcat').value);
      $('#exf-net').textContent = fmt(r2(gross - tax));
      $('#exf-tax').textContent = fmt(tax);
      $('#exf-gross').textContent = fmt(gross);
    };
    $('#exf-amount').oninput = recalc;
    $('#exf-taxcat').onchange = recalc;
    $('#exf-pay').onchange = () => { $('#exf-treas').innerHTML = treasOpts($('#exf-pay').value); };
    recalc();

    $('#exf-save').onclick = async () => {
      const gross = Number($('#exf-amount').value) || 0;
      if (gross <= 0) return toast(t('ex_amount_required'), false);
      const catSel = $('#exf-cat').selectedOptions[0];
      const entry = expenseEntry({
        gross, taxCategory: $('#exf-taxcat').value,
        expenseAccountId: catSel.dataset.account,
        vatAccountId: (_vatAcc() || {}).id,
        treasuryAccountId: $('#exf-treas').value,
        costCenterId: $('#exf-cc').value || null,
      });
      if (!entry.balanced) return toast(t('ex_entry_unbalanced'), false);
      // المرحلة 16: رفض المصروف بتاريخ فترة مقفلة
      if (typeof window.checkPeriodLock === 'function' &&
          window.checkPeriodLock($('#exf-date').value || _todayIso())) return;
      const cat = state.expenseCategories.find(c => c.id === $('#exf-cat').value);
      const memo = t('ex_memo') + ' — ' + (cat ? cat.name_ar : '') +
        ($('#exf-ref').value.trim() ? ' (' + $('#exf-ref').value.trim() + ')' : '');
      const posted = await _postEntryWithCc(memo, entry.lines);
      if (!posted) return; // toast داخل الدالة
      // رقم تالي للمصروف
      const maxNo = (state.expenses || []).reduce((m, e) => Math.max(m, Number(e.number) || 0), 0);
      const { error } = await sb.from('expenses').insert({
        tenant_id: state.tenant,
        number: maxNo + 1,
        expense_date: $('#exf-date').value || _todayIso(),
        category_id: $('#exf-cat').value,
        amount: entry.gross,
        tax_amount: entry.tax,
        tax_category: $('#exf-taxcat').value,
        payment_method: $('#exf-pay').value,
        treasury_account_id: $('#exf-treas').value,
        cost_center_id: $('#exf-cc').value || null,
        reference: $('#exf-ref').value.trim() || null,
        notes: $('#exf-notes').value.trim() || null,
        journal_entry_id: posted.id || null,
      });
      if (error) return toast(t('ex_save_fail') + ': ' + error.message, false);
      closeModal();
      toast(t('ex_saved'));
      await loadExpenses();
    };
  };
  if ($('#btn-add-expense')) $('#btn-add-expense').onclick = () => window.openExpenseForm();

  // ترحيل قيد مع محاولة تمرير cost_center_id ثم الرجوع بدونه + تحديث مباشر بأفضل جهد
  async function _postEntryWithCc(memo, lines) {
    let { data, error } = await sb.rpc('post_manual_entry', {
      p_tenant: state.tenant, p_memo: memo, p_lines: lines });
    if (error) {
      // نسخة RPC قديمة لا تعرف cost_center_id: أعد المحاولة بدونه
      const plain = lines.map(l => ({ account_id: l.account_id, party_id: l.party_id || null,
        debit: l.debit, credit: l.credit }));
      const r2nd = await sb.rpc('post_manual_entry', {
        p_tenant: state.tenant, p_memo: memo, p_lines: plain });
      if (r2nd.error) { toast(t('ex_post_fail') + ': ' + r2nd.error.message, false); return null; }
      data = r2nd.data;
      // بأفضل جهد: وسم بنود القيد الناتج بمراكز التكلفة (لا يُعدَّل مبلغ)
      try {
        const entryId = data && (data.id || data.entry_id);
        if (entryId) {
          const { data: jl } = await sb.from('journal_entry_lines')
            .select('id, account_id, debit, credit').eq('entry_id', entryId);
          for (const dl of (jl || [])) {
            const src = lines.find(l => l.cost_center_id &&
              l.account_id === dl.account_id && Number(l.debit) === Number(dl.debit) &&
              Number(l.credit) === Number(dl.credit));
            if (src) await sb.from('journal_entry_lines')
              .update({ cost_center_id: src.cost_center_id }).eq('id', dl.id);
          }
        }
      } catch (e) { /* العمود غير موجود بعد — نفّذ hazem-expenses.sql */ }
    }
    return data || {};
  }
  window.__postEntryWithCc = _postEntryWithCc; // يستخدمه نموذج القيد اليدوي في app.js

  // طباعة سند مصروف
  window.exPrint = function (id) {
    const e = (state.expenses || []).find(x => x.id === id);
    if (!e) return;
    const entry = expenseEntry({
      gross: e.amount, taxCategory: e.tax_category,
      expenseAccountId: 'x', vatAccountId: 'v', treasuryAccountId: 't',
    });
    openPrintPreview({
      title: t('ex_voucher_title') + ' رقم ' + e.number,
      meta: [
        [t('ex_date'), e.expense_date || '—'],
        [t('ex_category'), e.expense_categories?.name_ar || '—'],
        [t('ex_pay_method'), t(PAY_LBL[e.payment_method] || e.payment_method)],
        [t('ex_treasury'), _accName(e.treasury_account_id)],
        [t('ex_cc'), _ccName(e.cost_center_id)],
        [t('ex_reference'), e.reference || '—'],
        [t('ex_notes'), e.notes || '—'],
      ],
      tables: [{
        caption: t('ex_voucher_lines'),
        head: [t('col_desc'), t('col_debit'), t('col_credit')],
        rows: [
          [t('ex_category') + ': ' + (e.expense_categories?.name_ar || '—'),
            { txt: fmt(entry.net), num: entry.net }, { txt: fmt(0), num: 0 }],
          ...(entry.tax > 0 ? [[t('ex_input_vat'),
            { txt: fmt(entry.tax), num: entry.tax }, { txt: fmt(0), num: 0 }]] : []),
          [t('ex_treasury') + ' (' + t(PAY_LBL[e.payment_method] || '') + ')',
            { txt: fmt(0), num: 0 }, { txt: fmt(entry.gross), num: entry.gross }],
        ],
      }],
      totals: [t('tot_gross') + ': ' + fmt(e.amount),
               t('tot_vat') + ': ' + fmt(e.tax_amount || 0)],
      fileName: 'expense-' + e.number,
    });
  };

  /* ═══════════ ٢) تصنيفات المصروفات ═══════════ */
  function renderCats() {
    $('#tbl-expense-cats').innerHTML = (state.expenseCategories || []).map(c => `
      <tr>
        <td>${esc(c.name_ar)}</td>
        <td>${esc(c.name_en || '—')}</td>
        <td>${esc(_accName(c.account_id))}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="exCatForm('${c.id}')">✏️ ${t('btn_edit')}</button>
          <button class="btn btn-danger" onclick="exCatDel('${c.id}')">${t('btn_delete')}</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="4" style="color:#66707E">${t('ex_cats_none')}</td></tr>`;
  }

  // حسابات المصروفات 5xxx المتاحة للربط
  const _expAccountOpts = (sel) => (state.accounts || [])
    .filter(a => a.kind === 'expense' || String(a.code).startsWith('5'))
    .map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.code)} — ${esc(a.name)}</option>`).join('');

  window.exCatForm = async function (id) {
    await ensureExpensesData();
    const c = id ? state.expenseCategories.find(x => x.id === id) : null;
    openModal(`
      <h3>${c ? '✏️ ' + t('ex_cat_edit') : '➕ ' + t('ex_cat_new')}</h3>
      <label class="lbl">${t('as_name_ar')} *</label><input id="ecf-name-ar" value="${esc(c?.name_ar || '')}">
      <label class="lbl">${t('as_name_en')}</label><input id="ecf-name-en" value="${esc(c?.name_en || '')}">
      <label class="lbl">${t('ex_cat_account')} (5xxx) *</label>
      <select id="ecf-account">${_expAccountOpts(c?.account_id)}</select>
      <div class="modal-actions">
        <button class="btn btn-gold" id="ecf-save">${t('btn_save')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);
    $('#ecf-save').onclick = async () => {
      const rec = {
        tenant_id: state.tenant,
        name_ar: $('#ecf-name-ar').value.trim(),
        name_en: $('#ecf-name-en').value.trim() || null,
        account_id: $('#ecf-account').value,
      };
      if (!rec.name_ar || !rec.account_id) return toast(t('ex_cat_required'), false);
      const { error } = c
        ? await sb.from('expense_categories').update(rec).eq('id', c.id)
        : await sb.from('expense_categories').insert(rec);
      if (error) return toast(t('ex_save_fail') + ': ' + error.message, false);
      closeModal(); toast(t('ex_saved'));
      await ensureExpensesData(); renderCats();
    };
  };

  window.exCatDel = async function (id) {
    if (!confirm(t('ex_cat_del_confirm'))) return;
    const used = (state.expenses || []).some(e => e.category_id === id);
    if (used) return toast(t('ex_cat_in_use'), false);
    const { error } = await sb.from('expense_categories').delete().eq('id', id);
    if (error) return toast(t('ex_save_fail') + ': ' + error.message, false);
    toast(t('ex_saved'));
    await ensureExpensesData(); renderCats();
  };
  if ($('#btn-add-excat')) $('#btn-add-excat').onclick = () => window.exCatForm();

  /* ═══════════ ٣) مراكز التكلفة ═══════════ */
  function renderCcs() {
    $('#tbl-cost-centers').innerHTML = (state.costCenters || []).map(c => `
      <tr>
        <td dir="ltr">${esc(c.code)}</td>
        <td>${esc(c.name)}</td>
        <td>${esc(c.branches?.name || '—')}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="ccForm('${c.id}')">✏️ ${t('btn_edit')}</button>
          <button class="btn btn-danger" onclick="ccDel('${c.id}')">${t('btn_delete')}</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="4" style="color:#66707E">${t('cc_none')}</td></tr>`;
  }

  window.ccForm = async function (id) {
    if (!state.branches || !state.branches.length) {
      const { data } = await sb.from('branches').select('id, name');
      state.branches = data || [];
    }
    const c = id ? (state.costCenters || []).find(x => x.id === id) : null;
    const brOpts = '<option value="">—</option>' + (state.branches || []).map(b =>
      `<option value="${b.id}" ${c && c.branch_id === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
    const nextCode = 'CC-' + String((state.costCenters || []).length + 1).padStart(2, '0');
    openModal(`
      <h3>${c ? '✏️ ' + t('cc_edit') : '➕ ' + t('cc_new')}</h3>
      <label class="lbl">${t('cc_code')} *</label><input id="ccf-code" dir="ltr" value="${esc(c?.code || nextCode)}">
      <label class="lbl">${t('cc_name')} *</label><input id="ccf-name" value="${esc(c?.name || '')}">
      <label class="lbl">${t('hr_branch')}</label><select id="ccf-branch">${brOpts}</select>
      <div class="modal-actions">
        <button class="btn btn-gold" id="ccf-save">${t('btn_save')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);
    $('#ccf-save').onclick = async () => {
      const rec = {
        tenant_id: state.tenant,
        code: $('#ccf-code').value.trim(),
        name: $('#ccf-name').value.trim(),
        branch_id: $('#ccf-branch').value || null,
      };
      if (!rec.code || !rec.name) return toast(t('cc_required'), false);
      const { error } = c
        ? await sb.from('cost_centers').update(rec).eq('id', c.id)
        : await sb.from('cost_centers').insert(rec);
      if (error) return toast(t('ex_save_fail') + ': ' + error.message, false);
      closeModal(); toast(t('ex_saved'));
      await ensureExpensesData(); renderCcs();
    };
  };

  window.ccDel = async function (id) {
    if (!confirm(t('cc_del_confirm'))) return;
    const { error } = await sb.from('cost_centers').delete().eq('id', id);
    if (error) return toast(t('ex_save_fail') + ': ' + error.message, false);
    toast(t('ex_saved'));
    await ensureExpensesData(); renderCcs();
  };
  if ($('#btn-add-cc')) $('#btn-add-cc').onclick = () => window.ccForm();

  /* ═══════════ ٤) تقرير مراكز التكلفة ═══════════ */
  let _ccRepDoc = null;
  window.runCcReport = async function () {
    const from = $('#ex-ccrep-from').value, to = $('#ex-ccrep-to').value;
    const { data, error } = await sb.from('journal_entry_lines')
      .select('cost_center_id, debit, credit, journal_entries(created_at), accounts(kind)')
      .not('cost_center_id', 'is', null);
    if (error) {
      $('#tbl-ccrep').innerHTML = `<tr><td colspan="5" style="color:#B42318">${esc(t('ccrep_need_sql') + ' (' + error.message + ')')}</td></tr>`;
      return;
    }
    const lines = (data || [])
      .filter(l => l.journal_entries && (!from || l.journal_entries.created_at >= from) &&
        (!to || l.journal_entries.created_at <= to + 'T23:59:59.999'))
      .map(l => ({ cost_center_id: l.cost_center_id, debit: l.debit, credit: l.credit,
        kind: l.accounts?.kind }));
    const agg = ccAggregate(lines);
    const rows = Object.values(agg).sort((a, b) =>
      _ccName(a.cost_center_id).localeCompare(_ccName(b.cost_center_id), 'ar'));
    let tRev = 0, tExp = 0;
    $('#tbl-ccrep').innerHTML = rows.map(r => {
      tRev = r2(tRev + r.revenue); tExp = r2(tExp + r.expense);
      return `<tr>
        <td>${esc(_ccName(r.cost_center_id))}</td>
        <td>${fmt(r.revenue)}</td><td>${fmt(r.expense)}</td>
        <td><b style="color:${r.net >= 0 ? '#166534' : '#B42318'}">${fmt(r.net)}</b></td>
      </tr>`;
    }).join('') || `<tr><td colspan="4" style="color:#66707E">${t('ccrep_none')}</td></tr>`;
    $('#ccrep-totals').innerHTML = rows.length ? `
      <span class="t-c">${t('ccrep_revenue')}: ${fmt(tRev)}</span>
      <span class="t-d">${t('ccrep_expense')}: ${fmt(tExp)}</span>
      <span class="je-balance ok">${t('ccrep_net')}: ${fmt(r2(tRev - tExp))}</span>` : '';
    _ccRepDoc = rows.length ? {
      title: t('ccrep_title'),
      meta: [[t('vat_period_from'), from || '—'], [t('vat_period_to'), to || '—']],
      tables: [{
        head: [t('ex_cc'), t('ccrep_revenue'), t('ccrep_expense'), t('ccrep_net')],
        rows: rows.map(r => [ _ccName(r.cost_center_id),
          { txt: fmt(r.revenue), num: r.revenue },
          { txt: fmt(r.expense), num: r.expense },
          { txt: fmt(r.net), num: r.net } ]),
      }],
      totals: [t('ccrep_revenue') + ': ' + fmt(tRev),
               t('ccrep_expense') + ': ' + fmt(tExp),
               t('ccrep_net') + ': ' + fmt(r2(tRev - tExp))],
      fileName: 'cost-centers-report',
    } : null;
  };
  if ($('#btn-ccrep-run')) $('#btn-ccrep-run').onclick = () => window.runCcReport();
  if ($('#btn-ccrep-print')) $('#btn-ccrep-print').onclick = () => {
    if (!_ccRepDoc) return toast(t('ccrep_run_first'), false);
    openPrintPreview(_ccRepDoc);
  };
  if ($('#btn-ccrep-excel')) $('#btn-ccrep-excel').onclick = () => {
    if (!_ccRepDoc) return toast(t('ccrep_run_first'), false);
    exportDocExcel(_ccRepDoc);
  };

  /* ═══════════ ٥) الفواتير المتكررة ═══════════ */
  function renderRecurring() {
    const today = _todayIso();
    const due = dueTemplates(today);
    // لوحة المستحقة اليوم
    $('#tbl-rec-due').innerHTML = due.map(r => `
      <tr>
        <td>${esc(r.parties?.name || '—')}</td>
        <td>${t(FREQ_LBL[r.frequency] || r.frequency)}</td>
        <td dir="ltr">${esc(r.next_run_date || '—')}</td>
        <td>${fmt(r.total || _recTotal(r))}</td>
        <td><button class="btn btn-gold btn-sm" onclick="recGenerate('${r.id}')">⚙️ ${t('rec_generate')}</button></td>
      </tr>`).join('') || `<tr><td colspan="5" style="color:#66707E">${t('rec_none_due')}</td></tr>`;
    // كل القوالب
    $('#tbl-recurring').innerHTML = (state.recurringInvoices || []).map(r => `
      <tr>
        <td>${esc(r.name || '—')}</td>
        <td>${esc(r.parties?.name || '—')}</td>
        <td>${t(FREQ_LBL[r.frequency] || r.frequency)}</td>
        <td dir="ltr">${esc(r.start_date || '—')}</td>
        <td dir="ltr">${esc(r.end_date || '—')}</td>
        <td dir="ltr">${esc(r.next_run_date || '—')}</td>
        <td>${r.times_run || 0}</td>
        <td>${r.is_active !== false ? t('rec_active') : t('rec_paused')}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="recForm('${r.id}')">✏️ ${t('btn_edit')}</button>
          <button class="btn btn-ghost btn-sm" onclick="recToggle('${r.id}')">${r.is_active !== false ? '⏸️' : '▶️'}</button>
          ${recurringIsDue(r, today) ? `<button class="btn btn-gold btn-sm" onclick="recGenerate('${r.id}')">⚙️</button>` : ''}
        </td>
      </tr>`).join('') || `<tr><td colspan="9" style="color:#66707E">${t('rec_none')}</td></tr>`;
    updateDueBadge();
  }

  // إجمالي قالب (شامل الضريبة) من بنوده
  function _recTotal(r) {
    return r2((r.lines || []).reduce((s, l) => s + _num(l.qty) * _num(l.price), 0));
  }

  // نموذج قالب فاتورة متكررة
  window.recForm = async function (id) {
    await ensureExpensesData();
    if (!state.parties.length) await loadParties();
    if (!state.items.length) await loadItems();
    const customers = state.parties.filter(p => p.kind === 'customer');
    if (!customers.length) return toast(t('po_need_customer'), false);
    if (!state.items.length) return toast(t('po_need_item'), false);
    const r = id ? state.recurringInvoices.find(x => x.id === id) : null;

    openModal(`
      <h3>${r ? '✏️ ' + t('rec_edit') : '➕ ' + t('rec_new')}</h3>
      <div class="form-grid">
        <div><label class="lbl">${t('rec_name')} *</label><input id="rcf-name" value="${esc(r?.name || '')}"></div>
        <div><label class="lbl">${t('frm_customer')} *</label><select id="rcf-customer">
          ${customers.map(p => `<option value="${p.id}" ${r && r.party_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select></div>
        <div><label class="lbl">${t('rec_freq')}</label><select id="rcf-freq">
          ${Object.keys(FREQ_MONTHS).map(f => `<option value="${f}" ${r && r.frequency === f ? 'selected' : ''}>${t(FREQ_LBL[f])}</option>`).join('')}
        </select></div>
        <div><label class="lbl">${t('rec_start')}</label><input type="date" id="rcf-start" value="${esc(r?.start_date || _todayIso())}"></div>
        <div><label class="lbl">${t('rec_end')}</label><input type="date" id="rcf-end" value="${esc(r?.end_date || '')}"></div>
      </div>
      <div id="rcf-lines"></div>
      <button class="btn btn-ghost btn-sm" id="rcf-add-line">${t('btn_add_line')}</button>
      <div class="je-totals" style="margin-top:8px">
        <span class="je-balance ok">${t('tot_gross')}: <span id="rcf-total">0</span></span>
      </div>
      <div class="modal-actions">
        <button class="btn btn-gold" id="rcf-save">${t('btn_save')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);
    $('#modal-body').classList.add('modal-lg');

    const taxOpts = (sel) => (window.TAX_CATS || ['standard', 'zero', 'exempt', 'out_of_scope']).map(c =>
      `<option value="${c}" ${c === (sel || 'standard') ? 'selected' : ''}>${t('tax_cat_' + (c === 'out_of_scope' ? 'out' : c))}</option>`).join('');
    const addLine = (line) => {
      const d = document.createElement('div');
      d.className = 'inv-line doc-line';
      d.innerHTML = `
        <select class="ln-item">${state.items.map(i =>
          `<option value="${i.id}" data-price="${i.sale_price}" ${line && line.item_id === i.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select>
        <input class="ln-qty" type="number" min="0" step="any" value="${line ? line.qty : 1}" placeholder="${t('col_qty')}">
        <input class="ln-price" type="number" min="0" step="any" value="${line ? line.price : ''}" placeholder="${t('col_price')}">
        <select class="ln-tax-cat">${taxOpts(line?.tax_category)}</select>
        <button class="del-line">✕</button>`;
      if (!line) d.querySelector('.ln-price').value =
        d.querySelector('.ln-item').selectedOptions[0]?.dataset.price || '';
      d.querySelector('.ln-item').onchange = (e) => {
        d.querySelector('.ln-price').value = e.target.selectedOptions[0]?.dataset.price || '';
        calc();
      };
      d.querySelectorAll('input').forEach(i => i.oninput = calc);
      d.querySelector('.del-line').onclick = () => { d.remove(); calc(); };
      $('#rcf-lines').appendChild(d);
      calc();
    };
    const calc = () => {
      const tot = r2($$('#rcf-lines .doc-line').reduce((s, l) =>
        s + (Number(l.querySelector('.ln-qty').value) || 0) *
            (Number(l.querySelector('.ln-price').value) || 0), 0));
      $('#rcf-total').textContent = fmt(tot);
    };
    $('#rcf-add-line').onclick = () => addLine();
    (r && r.lines && r.lines.length ? r.lines : [null]).forEach(addLine);

    $('#rcf-save').onclick = async () => {
      const name = $('#rcf-name').value.trim();
      const lines = $$('#rcf-lines .doc-line').map(l => ({
        item_id: l.querySelector('.ln-item').value,
        qty: Number(l.querySelector('.ln-qty').value) || 0,
        price: Number(l.querySelector('.ln-price').value) || 0,
        tax_category: l.querySelector('.ln-tax-cat').value,
      })).filter(l => l.qty > 0);
      if (!name) return toast(t('rec_name_required'), false);
      if (!lines.length) return toast(t('msg_check_lines'), false);
      const start = $('#rcf-start').value || _todayIso();
      const rec = {
        tenant_id: state.tenant,
        name,
        party_id: $('#rcf-customer').value,
        frequency: $('#rcf-freq').value,
        start_date: start,
        end_date: $('#rcf-end').value || null,
        total: r2(lines.reduce((s, l) => s + l.qty * l.price, 0)),
      };
      if (!r) rec.next_run_date = start; // أول تشغيل عند تاريخ البدء
      else rec.next_run_date = r.next_run_date || start;
      let tplId = r && r.id;
      if (r) {
        const { error } = await sb.from('recurring_invoices').update(rec).eq('id', r.id);
        if (error) return toast(t('ex_save_fail') + ': ' + error.message, false);
        await sb.from('recurring_invoice_lines').delete().eq('template_id', r.id);
      } else {
        const { data, error } = await sb.from('recurring_invoices').insert(rec).select('id').single();
        if (error) return toast(t('ex_save_fail') + ': ' + error.message, false);
        tplId = data.id;
      }
      const { error: lErr } = await sb.from('recurring_invoice_lines').insert(
        lines.map((l, i) => Object.assign({ tenant_id: state.tenant, template_id: tplId, sort: i }, l)));
      if (lErr) return toast(t('ex_save_fail') + ': ' + lErr.message, false);
      closeModal(); toast(t('ex_saved'));
      await ensureExpensesData(); renderRecurring();
    };
  };

  window.recToggle = async function (id) {
    const r = (state.recurringInvoices || []).find(x => x.id === id);
    if (!r) return;
    const { error } = await sb.from('recurring_invoices')
      .update({ is_active: r.is_active === false }).eq('id', id);
    if (error) return toast(t('ex_save_fail') + ': ' + error.message, false);
    await ensureExpensesData(); renderRecurring();
  };

  // توليد فاتورة بيع حقيقية من قالب عبر نفس RPC القائم (post_sales_invoice)
  window.recGenerate = async function (id) {
    const r = (state.recurringInvoices || []).find(x => x.id === id);
    if (!r || !recurringIsDue(r, _todayIso())) return;
    if (!confirm(t('rec_gen_confirm') + ' — ' + (r.parties?.name || ''))) return;
    const lines = r.lines || [];
    if (!lines.length) return toast(t('msg_check_lines'), false);
    const { data: number, error } = await sb.rpc('post_sales_invoice', {
      p_customer: r.party_id,
      p_lines: lines.map(({ item_id, qty, price }) => ({ item_id, qty, price })),
    });
    if (error) return toast(t('rec_gen_fail') + ': ' + error.message, false);

    // مزامنة ضريبية (تدرّج آمن — نفس منطق فواتير البيع): تصنيفات البنود + قيد ضريبة المخرجات
    try {
      const sum = window.summarizeLines ? summarizeLines(lines, 'price') : null;
      const { data: inv } = await sb.from('sales_invoices').select('id')
        .eq('number', number).order('created_at', { ascending: false }).limit(1).single();
      if (inv) {
        if (sum) await sb.from('sales_invoices').update({
          subtotal: sum.subtotal, tax_amount: sum.tax_amount, total_with_tax: sum.total,
        }).eq('id', inv.id);
        const { data: dbLines } = await sb.from('sales_invoice_lines')
          .select('id, item_id, qty, price').eq('invoice_id', inv.id);
        const pool = lines.map(l => ({ ...l }));
        for (const dl of (dbLines || [])) {
          const i = pool.findIndex(l => l.item_id === dl.item_id &&
            Number(l.qty) === Number(dl.qty) && Number(l.price) === Number(dl.price));
          const cat = i >= 0 ? pool.splice(i, 1)[0].tax_category : 'standard';
          await sb.from('sales_invoice_lines').update({ tax_category: cat }).eq('id', dl.id);
        }
        if (sum && sum.tax_amount > 0) {
          const vatAcc = _vatAcc();
          const salesAcc = (state.accounts || []).find(a =>
            String(a.code).startsWith('4') && a.kind === 'revenue');
          if (vatAcc && salesAcc) {
            await _postEntryWithCc(t('rec_vat_memo') + ' ' + number, [
              { account_id: salesAcc.id, party_id: null, debit: sum.tax_amount, credit: 0 },
              { account_id: vatAcc.id, party_id: null, debit: 0, credit: sum.tax_amount },
            ]);
          }
        }
      }
    } catch (e) { /* لا نكسر التوليد الناجح */ }

    // تحديث موعد التشغيل التالي
    const next = nextRunDate(r.next_run_date, r.frequency);
    await sb.from('recurring_invoices').update({
      next_run_date: next,
      times_run: (r.times_run || 0) + 1,
      is_active: !(r.end_date && next && next > r.end_date), // إيقاف تلقائي بعد الانتهاء
    }).eq('id', id);
    toast(t('rec_generated') + ' — ' + t('inv_number') + ' ' + number);
    await ensureExpensesData(); renderRecurring();
  };
  if ($('#btn-add-rec')) $('#btn-add-rec').onclick = () => window.recForm();

  /* ═══════════ ٦) تذكيرات التحصيل ═══════════ */
  let _remRows = []; // آخر صفوف التقرير المعروضة

  window.runReminders = async function () {
    const today = _todayIso();
    const [{ data: invs, error: e1 }, { data: vchs }] = await Promise.all([
      sb.from('sales_invoices').select('id, number, total, created_at, party_id, parties(name)')
        .order('created_at'),
      sb.from('vouchers').select('party_id, amount, voucher_type').eq('voucher_type', 'receipt'),
    ]);
    if (e1) return toast(t('ex_load_fail') + ': ' + e1.message, false);
    // تجميع المقبوضات لكل عميل
    const paid = {};
    (vchs || []).forEach(v => { paid[v.party_id] = r2((paid[v.party_id] || 0) + _num(v.amount)); });
    // تجميع الفواتير لكل عميل (أقدم→أحدث) ثم FIFO
    const byParty = {};
    (invs || []).forEach(v => { (byParty[v.party_id] = byParty[v.party_id] || []).push(v); });
    _remRows = [];
    Object.keys(byParty).forEach(pid => {
      const rows = buildReminderRows(byParty[pid], paid[pid] || 0, today, 30);
      rows.forEach(rw => _remRows.push(Object.assign({}, rw, {
        party_name: byParty[pid][0].parties?.name || '—' })));
    });
    _remRows.sort((a, b) => b.overdue_days - a.overdue_days);

    $('#tbl-reminders').innerHTML = _remRows.map((rw, i) => `
      <tr>
        <td>${esc(rw.party_name)}</td>
        <td>${rw.number}</td>
        <td dir="ltr">${esc(rw.due_date || '—')}</td>
        <td>${fmt(rw.remaining)}</td>
        <td><b style="color:${rw.overdue_days > 60 ? '#B42318' : '#92400e'}">${rw.overdue_days}</b></td>
        <td><button class="btn btn-gold btn-sm" onclick="remLetter('${rw.party_id}')">📨 ${t('rem_letter')}</button></td>
      </tr>`).join('') || `<tr><td colspan="6" style="color:#66707E">${t('rem_none')}</td></tr>`;
    const totRem = r2(_remRows.reduce((s, r) => s + r.remaining, 0));
    $('#rem-totals').innerHTML = _remRows.length ? `
      <span class="t-d">${t('rem_total')}: ${fmt(totRem)}</span>
      <span class="je-balance ok">${t('rem_count')}: ${_remRows.length}</span>` : '';
  };
  if ($('#btn-rem-run')) $('#btn-rem-run').onclick = () => window.runReminders();

  // خطاب تذكير قابل للطباعة لكل عميل (ثنائي اللغة، صيغة رسمية مهذبة)
  window.remLetter = function (partyId) {
    const rows = _remRows.filter(r => r.party_id === partyId);
    if (!rows.length) return;
    const name = rows[0].party_name;
    const total = r2(rows.reduce((s, r) => s + r.remaining, 0));
    const today = _todayIso();
    const maxDays = Math.max(...rows.map(r => r.overdue_days));
    openPrintPreview({
      title: t('rem_letter_title'),
      meta: [
        [t('rem_to'), name],
        [t('ex_date'), today],
        [t('rem_subject'), t('rem_subject_txt')],
      ],
      paragraphs: [
        t('rem_dear') + ' ' + name + '،',
        t('rem_body_ar').replace('{days}', maxDays),
      ],
      tables: [{
        caption: t('rem_overdue_invoices'),
        head: [t('inv_number'), t('ex_date'), t('rem_due_date'), t('rem_remaining'), t('rem_days')],
        rows: rows.map(r => [
          String(r.number),
          new Date(r.created_at).toLocaleDateString('ar-EG'),
          r.due_date || '—',
          { txt: fmt(r.remaining), num: r.remaining },
          String(r.overdue_days),
        ]),
      }],
      totals: [t('rem_total') + ': ' + fmt(total)],
      paragraphsAfter: [
        t('rem_footer_ar'),
        '— English —',
        'Dear ' + name + ',',
        'This is a kind reminder that the invoices listed above remain unpaid past their due date. ' +
        'The total outstanding balance is ' + fmt(total) + '. We would appreciate your prompt settlement. ' +
        'If payment has already been made, please disregard this notice and accept our thanks.',
        'Best regards,',
        (state.tenantName || '') + ' — ' + t('rem_signature'),
      ],
      fileName: 'reminder-' + name,
    });
  };

  // ربط التبويبات الفرعية
  $$('#tab-expenses .sub-tab').forEach(b => b.onclick = () => switchExSub(b.dataset.sub));

})(typeof window !== 'undefined' ? window : globalThis);
