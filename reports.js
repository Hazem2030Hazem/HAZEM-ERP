/* ═══════════════════════════════════════════════════════════════
   HAZEM.ERP — المرحلة 16: تقارير متقدمة (أعمار الذمم / التدفقات النقدية /
   هامش الربح) + قفل الفترات المحاسبية + تسجيل Service Worker (PWA)
   جزآن في ملف واحد (بلا build step):
   • منطق نقي قابل للاختبار في Node: شرائح الأعمار (0-30/31-60/61-90/+90
     حسب تاريخ الاستحقاق = الفاتورة + 30 يوماً — نفس منطق تذكيرات التحصيل
     في expenses.js مع توزيع FIFO للسندات)، تصنيف حركات النقدية على
     حسابات 11xx (تشغيلية/استثمارية/تمويلية)، متوسط التكلفة من فواتير
     الشراء وتحليل هامش الربح، فحص قفل الفترة.
   • واجهات المتصفح (بعد app.js): 3 تابات فرعية جديدة داخل تبويب
     التقارير + صندوق «قفل الفترة» في الإعدادات + تسجيل sw.js.
   قرارات موثقة:
   • FIFO: نفس منطق allocateFifo في expenses.js (المقبوضات/المدفوعات
     تُوزَّع على الفواتير الأقدم أولاً) — نُعيد تنفيذه هنا ليبقى الملف
     مستقلاً قابلاً للاختبار بلا ترتيب تحميل إجباري.
   • التكلفة في تحليل الهامش = متوسط موزون بالكمية من سطور فواتير
     الشراء (purchase_invoice_lines.cost) — لا يوجد متوسط تكلفة مخزّن
     في جدول الأصناف حالياً (افتراض موثق). صنف بلا مشتريات → تكلفة 0.
   • قفل الفترة: فحص client-side في نقاط الترحيل (قيد يدوي/مصروف/رواتب/
     إهلاك) + trigger على journal_entries في hazem-period-lock.sql يغطي
     كل الـ RPCs (خط الدفاع النهائي في القاعدة).
   • شاشة إدارة القفل: متاحة لكل الأعضاء في الواجهة مع ملاحظة أن
     الصلاحية النهائية تحكمها RLS على جدول tenants (التحديث عادةً للمالك
     فقط حسب سياسات المخطط) — التحقق من الدور client-side غير كافٍ وحده.
   يعمل في المتصفح و Node (للاختبارات) بلا build step.
   ═══════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';

  const r2 = (typeof g.r2 === 'function') ? g.r2
    : (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const _num = (v) => Number(v) || 0;
  const _iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
    '-' + String(d.getDate()).padStart(2, '0');

  /* ─────────── ١) أعمار الذمم (Aging) ─────────── */
  // توزيع FIFO: إجمالي السندات على الفواتير الأقدم→الأحدث (نفس منطق expenses.js)
  function allocateFifo(invoices, paymentsTotal) {
    let pool = r2(_num(paymentsTotal));
    return (invoices || []).map(inv => {
      const total = r2(_num(inv.total));
      const paid = r2(Math.min(pool, total));
      pool = r2(Math.max(pool - paid, 0));
      return Object.assign({}, inv, { paid, remaining: r2(total - paid) });
    });
  }
  // أيام التأخير (لا سالبة) بين الاستحقاق واليوم
  function overdueDays(dueIso, todayIso) {
    const a = new Date(dueIso), b = new Date(todayIso);
    if (isNaN(a) || isNaN(b)) return 0;
    return Math.max(0, Math.floor((b - a) / 86400000));
  }
  // صفوف عمر الذمة لفواتير طرف واحد: المتبقي + الاستحقاق (+30 افتراضي) + أيام التأخير
  function agingRows(invoices, paymentsTotal, todayIso, termDays) {
    const term = termDays == null ? 30 : _num(termDays);
    return allocateFifo(invoices, paymentsTotal)
      .filter(i => i.remaining > 0)
      .map(i => {
        const base = new Date(i.created_at);
        const due = isNaN(base) ? null : _iso(new Date(base.getTime() + term * 86400000));
        return Object.assign({}, i, { due_date: due, overdue_days: due ? overdueDays(due, todayIso) : 0 });
      });
  }
  // الشريحة حسب أيام التأخير: b30 (0-30) / b60 (31-60) / b90 (61-90) / b90p (+90)
  function agingBucket(days) {
    const d = _num(days);
    if (d <= 30) return 'b30';
    if (d <= 60) return 'b60';
    if (d <= 90) return 'b90';
    return 'b90p';
  }
  // تجميع الشرائح لكل طرف من صفوف agingRows
  // in: [{party_id, party_name, remaining, overdue_days}]
  // out: [{party_id, party_name, b30, b60, b90, b90p, total}] + totals
  function aggregateAging(rows) {
    const by = {};
    (rows || []).forEach(r => {
      const k = String(r.party_id);
      if (!by[k]) by[k] = { party_id: r.party_id, party_name: r.party_name || '—',
        b30: 0, b60: 0, b90: 0, b90p: 0, total: 0 };
      const b = agingBucket(r.overdue_days);
      by[k][b] = r2(by[k][b] + _num(r.remaining));
      by[k].total = r2(by[k].total + _num(r.remaining));
    });
    const list = Object.values(by).sort((a, b) => b.total - a.total);
    const totals = { b30: 0, b60: 0, b90: 0, b90p: 0, total: 0 };
    list.forEach(r => { ['b30', 'b60', 'b90', 'b90p', 'total'].forEach(k => { totals[k] = r2(totals[k] + r[k]); }); });
    return { rows: list, totals };
  }

  /* ─────────── ٢) قائمة التدفقات النقدية (مبسطة مباشرة) ─────────── */
  // تصنيف الحساب المقابل لحركة نقدية (على حساب 11xx) حسب كوده
  function classifyCounter(code) {
    const c = String(code || '');
    if (c.startsWith('11')) return 'transfer'; // تحويل بين خزن — يُستبعد
    if (c.startsWith('12')) return 'cust';     // عملاء (ذمم مدينة)
    if (c.startsWith('13') || c.startsWith('14')) return 'op_other'; // مخزون/ذمم أخرى
    if (c.startsWith('15') || c.startsWith('16') || c.startsWith('17')) return 'invest'; // أصول ثابتة/استثمارات
    if (c.startsWith('21')) return 'supp';     // موردون
    if (c.startsWith('52') || c.startsWith('23')) return 'payroll';  // رواتب ومستحقاتها
    if (c.startsWith('5')) return 'expense';   // مصروفات 5xxx
    if (c.startsWith('4')) return 'revenue';   // إيرادات (مبيعات نقدية)
    if (c.startsWith('3')) return 'finance';   // حقوق ملكية/قروض
    return 'other';
  }
  // فئة النشاط: op تشغيلية / inv استثمارية / fin تمويلية
  const CF_CLASS_CATEGORY = {
    cust: 'op', supp: 'op', payroll: 'op', expense: 'op', revenue: 'op',
    op_other: 'op', other: 'op', invest: 'inv', finance: 'fin', transfer: 'skip',
  };
  // تجميع الحركات: movs = [{ dir: 'in'|'out', counter: '1200', amount }]
  // out: buckets لكل صنف (مدخلات موجبة، مخرجات سالبة الإشارة في net) + إجماليات
  function aggregateCashFlow(movs) {
    const b = {
      cust_receipts: 0, supp_payments: 0, payroll: 0, expenses: 0,
      revenue: 0, op_other_in: 0, op_other_out: 0,
      investing: 0, financing: 0, other_in: 0, other_out: 0,
    };
    (movs || []).forEach(m => {
      const cls = classifyCounter(m.counter);
      const amt = r2(_num(m.amount));
      if (amt <= 0) return;
      if (cls === 'transfer') return; // تحويل داخلي بين الخزن — لا تدفق
      if (cls === 'cust') { if (m.dir === 'in') b.cust_receipts = r2(b.cust_receipts + amt); else b.other_out = r2(b.other_out + amt); return; }
      if (cls === 'supp') { if (m.dir === 'out') b.supp_payments = r2(b.supp_payments + amt); else b.other_in = r2(b.other_in + amt); return; }
      if (cls === 'payroll') { if (m.dir === 'out') b.payroll = r2(b.payroll + amt); else b.other_in = r2(b.other_in + amt); return; }
      if (cls === 'expense') { if (m.dir === 'out') b.expenses = r2(b.expenses + amt); else b.other_in = r2(b.other_in + amt); return; }
      if (cls === 'revenue') { if (m.dir === 'in') b.revenue = r2(b.revenue + amt); else b.other_out = r2(b.other_out + amt); return; }
      if (cls === 'op_other') { if (m.dir === 'in') b.op_other_in = r2(b.op_other_in + amt); else b.op_other_out = r2(b.op_other_out + amt); return; }
      if (cls === 'invest') { b.investing = r2(b.investing + (m.dir === 'in' ? amt : -amt)); return; }
      if (cls === 'finance') { b.financing = r2(b.financing + (m.dir === 'in' ? amt : -amt)); return; }
      if (m.dir === 'in') b.other_in = r2(b.other_in + amt); else b.other_out = r2(b.other_out + amt);
    });
    const op = r2(b.cust_receipts + b.revenue + b.op_other_in + b.other_in
      - b.supp_payments - b.payroll - b.expenses - b.op_other_out - b.other_out);
    const net = r2(op + b.investing + b.financing);
    return { buckets: b, operating: op, investing: b.investing, financing: b.financing, net };
  }

  /* ─────────── ٣) تحليل هامش الربح ─────────── */
  // متوسط التكلفة الموزون بالكمية لكل صنف من سطور فواتير الشراء
  function avgCosts(purchaseLines) {
    const acc = {};
    (purchaseLines || []).forEach(l => {
      const k = String(l.item_id);
      if (!acc[k]) acc[k] = { qty: 0, val: 0 };
      acc[k].qty += _num(l.qty);
      acc[k].val += _num(l.qty) * _num(l.cost);
    });
    const out = {};
    Object.keys(acc).forEach(k => { out[k] = acc[k].qty > 0 ? r2(acc[k].val / acc[k].qty) : 0; });
    return out;
  }
  // صفوف الهامش من سطور المبيعات: مبيعات/تكلفة/مجمل ربح/هامش% — مرتبة تنازلياً بالربح
  function marginRows(saleLines, costMap) {
    const by = {};
    (saleLines || []).forEach(l => {
      const k = String(l.item_id);
      if (!by[k]) by[k] = { item_id: l.item_id, name: l.name || '—', qty: 0, sales: 0, cost: 0 };
      const avg = _num(costMap && costMap[k]);
      by[k].qty = r2(by[k].qty + _num(l.qty));
      by[k].sales = r2(by[k].sales + _num(l.qty) * _num(l.price));
      by[k].cost = r2(by[k].cost + _num(l.qty) * avg);
    });
    const rows = Object.values(by).map(r => {
      const profit = r2(r.sales - r.cost);
      return Object.assign({}, r, { profit,
        margin: r.sales > 0 ? r2(profit * 100 / r.sales) : 0 });
    }).sort((a, b) => b.profit - a.profit);
    const totals = rows.reduce((s, r) => ({
      sales: r2(s.sales + r.sales), cost: r2(s.cost + r.cost), profit: r2(s.profit + r.profit),
    }), { sales: 0, cost: 0, profit: 0 });
    totals.margin = totals.sales > 0 ? r2(totals.profit * 100 / totals.sales) : 0;
    return { rows, totals };
  }

  /* ─────────── ٤) قفل الفترة ─────────── */
  // هل التاريخ مقفل؟ (locked_before = «لا قيود قبل هذا التاريخ» — يقبل المقارنة النصية ISO)
  function isPeriodLocked(dateIso, lockedBefore) {
    if (!lockedBefore || !dateIso) return false;
    const d = String(dateIso).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && d < String(lockedBefore).slice(0, 10);
  }

  const pureExports = {
    allocateFifo, overdueDays, agingRows, agingBucket, aggregateAging,
    classifyCounter, aggregateCashFlow, avgCosts, marginRows, isPeriodLocked,
    CF_CLASS_CATEGORY,
  };
  Object.assign(g, pureExports);
  if (typeof module !== 'undefined' && module.exports) module.exports = pureExports;
  if (typeof document === 'undefined') return; // Node: منطق نقي فقط

  /* ═══════════════════════ واجهات المتصفح ═══════════════════════ */

  const _todayIso = () => _iso(new Date());
  const _firstOfMonth = () => { const n = new Date(); return _iso(new Date(n.getFullYear(), n.getMonth(), 1)); };

  // ─── التواريخ الافتراضية للتقارير الجديدة ───
  function _fillDates() {
    if ($('#rep-aging-date') && !$('#rep-aging-date').value) $('#rep-aging-date').value = _todayIso();
    if ($('#rep-cf-from') && !$('#rep-cf-from').value) $('#rep-cf-from').value = _firstOfMonth();
    if ($('#rep-cf-to') && !$('#rep-cf-to').value) $('#rep-cf-to').value = _todayIso();
    if ($('#rep-margin-from') && !$('#rep-margin-from').value) $('#rep-margin-from').value = _firstOfMonth();
    if ($('#rep-margin-to') && !$('#rep-margin-to').value) $('#rep-margin-to').value = _todayIso();
  }

  /* ═══════════ ١) تقرير أعمار الذمم ═══════════ */
  let _agingDoc = null;

  async function _agingSide(kind, today) {
    const isCust = kind === 'customers';
    const invTable = isCust ? 'sales_invoices' : 'purchase_invoices';
    const vType = isCust ? 'receipt' : 'payment';
    const [{ data: invs, error: e1 }, { data: vchs }] = await Promise.all([
      sb.from(invTable).select('id, number, total, created_at, party_id, parties(name)').order('created_at'),
      sb.from('vouchers').select('party_id, amount, voucher_type').eq('voucher_type', vType),
    ]);
    if (e1) throw new Error(e1.message);
    const paid = {};
    (vchs || []).forEach(v => { paid[v.party_id] = r2((paid[v.party_id] || 0) + _num(v.amount)); });
    const byParty = {};
    (invs || []).forEach(v => { (byParty[v.party_id] = byParty[v.party_id] || []).push(v); });
    let rows = [];
    Object.keys(byParty).forEach(pid => {
      agingRows(byParty[pid], paid[pid] || 0, today, 30).forEach(rw =>
        rows.push(Object.assign({}, rw, { party_name: byParty[pid][0].parties?.name || '—' })));
    });
    return aggregateAging(rows);
  }

  window.runAgingReport = async function () {
    const today = $('#rep-aging-date').value || _todayIso();
    try {
      const [cust, supp] = await Promise.all([_agingSide('customers', today), _agingSide('suppliers', today)]);
      const renderRows = (agg, empty) => agg.rows.map(r => `
        <tr><td>${esc(r.party_name)}</td><td>${fmt(r.b30)}</td><td>${fmt(r.b60)}</td>
          <td>${fmt(r.b90)}</td><td><b style="color:#B42318">${fmt(r.b90p)}</b></td><td><b>${fmt(r.total)}</b></td></tr>`
      ).join('') || `<tr><td colspan="6" style="color:#66707E">${empty}</td></tr>`;
      $('#tbl-rep-aging-cust').innerHTML = renderRows(cust, t('rep_aging_none'));
      $('#tbl-rep-aging-supp').innerHTML = renderRows(supp, t('rep_aging_none'));
      $('#rep-aging-cust-totals').innerHTML = cust.rows.length ? `
        <span class="t-d">0-30: ${fmt(cust.totals.b30)}</span><span class="t-d">31-60: ${fmt(cust.totals.b60)}</span>
        <span class="t-c">61-90: ${fmt(cust.totals.b90)}</span><span class="t-c">+90: ${fmt(cust.totals.b90p)}</span>
        <span class="je-balance ok">${t('tot_gross')}: ${fmt(cust.totals.total)}</span>` : '';
      $('#rep-aging-supp-totals').innerHTML = supp.rows.length ? `
        <span class="t-d">0-30: ${fmt(supp.totals.b30)}</span><span class="t-d">31-60: ${fmt(supp.totals.b60)}</span>
        <span class="t-c">61-90: ${fmt(supp.totals.b90)}</span><span class="t-c">+90: ${fmt(supp.totals.b90p)}</span>
        <span class="je-balance ok">${t('tot_gross')}: ${fmt(supp.totals.total)}</span>` : '';
      const mkTable = (caption, agg) => agg.rows.length ? {
        caption,
        head: [t(isCustName(caption)), t('rep_aging_b30'), t('rep_aging_b60'), t('rep_aging_b90'), t('rep_aging_b90p'), t('tot_gross')],
        rows: agg.rows.map(r => [r.party_name,
          { txt: fmt(r.b30), num: r.b30 }, { txt: fmt(r.b60), num: r.b60 },
          { txt: fmt(r.b90), num: r.b90 }, { txt: fmt(r.b90p), num: r.b90p },
          { txt: fmt(r.total), num: r.total }]),
      } : null;
      function isCustName(cap) { return cap === t('rep_aging_cust') ? 'frm_customer' : 'frm_supplier'; }
      _agingDoc = (cust.rows.length || supp.rows.length) ? {
        title: t('rep_aging_title'),
        meta: [[t('rep_aging_asof'), today], [t('rem_hint'), '']],
        tables: [mkTable(t('rep_aging_cust'), cust), mkTable(t('rep_aging_supp'), supp)].filter(Boolean),
        totals: [t('rep_aging_cust') + ': ' + fmt(cust.totals.total),
                 t('rep_aging_supp') + ': ' + fmt(supp.totals.total)],
        fileName: 'aging-report',
      } : null;
    } catch (err) { toast(t('rep_run_fail') + ': ' + err.message, false); }
  };
  if ($('#btn-rep-aging')) $('#btn-rep-aging').onclick = () => window.runAgingReport();
  if ($('#btn-aging-print')) $('#btn-aging-print').onclick = () => {
    if (!_agingDoc) return toast(t('rep_run_first'), false);
    openPrintPreview(_agingDoc);
  };
  if ($('#btn-aging-excel')) $('#btn-aging-excel').onclick = () => {
    if (!_agingDoc) return toast(t('rep_run_first'), false);
    exportDocExcel(_agingDoc);
  };

  /* ═══════════ ٢) قائمة التدفقات النقدية ═══════════ */
  let _cfDoc = null;

  window.runCashFlow = async function () {
    const from = $('#rep-cf-from').value, to = $('#rep-cf-to').value;
    const { data: lines, error } = await sb.from('journal_entry_lines')
      .select('entry_id, account_id, debit, credit, accounts(code, kind), journal_entries(created_at)');
    if (error) return toast(t('rep_run_fail') + ': ' + error.message, false);
    // تجميع القيود التي تلمس حسابات 11xx مع سطورها المقابلة
    const byEntry = {};
    (lines || []).forEach(l => {
      (byEntry[l.entry_id] = byEntry[l.entry_id] || []).push({
        code: l.accounts?.code || '', debit: _num(l.debit), credit: _num(l.credit),
        date: l.journal_entries?.created_at,
      });
    });
    const movs = [];
    let opening = 0; // حركات 11xx قبل الفترة
    Object.keys(byEntry).forEach(eid => {
      const ls = byEntry[eid];
      const cash = ls.filter(l => String(l.code).startsWith('11'));
      if (!cash.length) return;
      const date = cash[0].date;
      const cashNet = r2(cash.reduce((s, l) => s + l.debit - l.credit, 0));
      if (date && from && new Date(date) < new Date(from + 'T00:00:00')) { opening = r2(opening + cashNet); return; }
      if (date && !((!from || new Date(date) >= new Date(from + 'T00:00:00')) &&
                    (!to || new Date(date) <= new Date(to + 'T23:59:59.999')))) return;
      // الحركة موزعة على السطور المقابلة (غير 11xx)
      const counters = ls.filter(l => !String(l.code).startsWith('11'));
      if (!counters.length) return;
      counters.forEach(c => {
        const amt = r2(c.debit - c.credit); // مقابل مدين = خروج نقدية، دائن = دخول
        if (amt === 0) return;
        movs.push({ dir: amt > 0 ? 'out' : 'in', counter: c.code, amount: Math.abs(amt) });
      });
    });
    const cf = aggregateCashFlow(movs);
    const b = cf.buckets;
    const row = (lbl, amt, sign) => `<tr><td>${lbl}</td>
      <td style="font-weight:700;color:${sign >= 0 ? 'var(--green)' : 'var(--red)'}">${sign >= 0 ? fmt(amt) : '(' + fmt(amt) + ')'}</td></tr>`;
    let html = '';
    html += row(t('cf_cust_receipts'), b.cust_receipts, 1);
    html += row(t('cf_supp_payments'), b.supp_payments, -1);
    html += row(t('cf_payroll'), b.payroll, -1);
    html += row(t('cf_expenses'), b.expenses, -1);
    html += row(t('cf_revenue_other'), b.revenue, 1);
    html += row(t('cf_op_other_in'), b.op_other_in, 1);
    html += row(t('cf_op_other_out'), b.op_other_out, -1);
    html += row(t('cf_other_in'), b.other_in, 1);
    html += row(t('cf_other_out'), b.other_out, -1);
    html += `<tr style="background:#FAF6F1"><td><b>${t('cf_net_operating')}</b></td>
      <td><b style="color:${cf.operating >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(cf.operating)}</b></td></tr>`;
    html += row(t('cf_investing'), Math.abs(cf.investing), cf.investing >= 0 ? 1 : -1);
    html += row(t('cf_financing'), Math.abs(cf.financing), cf.financing >= 0 ? 1 : -1);
    $('#tbl-rep-cf').innerHTML = html;
    const closing = r2(opening + cf.net);
    $('#rep-cf-totals').innerHTML = `
      <span class="t-d">${t('cf_opening')}: ${fmt(opening)}</span>
      <span class="t-c">${t('cf_net')}: ${fmt(cf.net)}</span>
      <span class="je-balance ${closing >= 0 ? 'ok' : 'bad'}">${t('cf_closing')}: ${fmt(closing)}</span>`;
    _cfDoc = {
      title: t('cf_title'),
      meta: [[t('rep_from'), from || '—'], [t('rep_to'), to || '—']],
      tables: [{ caption: t('cf_title'),
        head: [t('cf_item'), t('cf_amount')],
        rows: [
          [t('cf_cust_receipts'), { txt: fmt(b.cust_receipts), num: b.cust_receipts }],
          [t('cf_supp_payments'), { txt: fmt(-b.supp_payments), num: -b.supp_payments }],
          [t('cf_payroll'), { txt: fmt(-b.payroll), num: -b.payroll }],
          [t('cf_expenses'), { txt: fmt(-b.expenses), num: -b.expenses }],
          [t('cf_revenue_other'), { txt: fmt(b.revenue), num: b.revenue }],
          [t('cf_op_other_in'), { txt: fmt(b.op_other_in), num: b.op_other_in }],
          [t('cf_op_other_out'), { txt: fmt(-b.op_other_out), num: -b.op_other_out }],
          [t('cf_other_in'), { txt: fmt(b.other_in), num: b.other_in }],
          [t('cf_other_out'), { txt: fmt(-b.other_out), num: -b.other_out }],
          [t('cf_net_operating'), { txt: fmt(cf.operating), num: cf.operating }],
          [t('cf_investing'), { txt: fmt(cf.investing), num: cf.investing }],
          [t('cf_financing'), { txt: fmt(cf.financing), num: cf.financing }],
        ] }],
      totals: [t('cf_opening') + ': ' + fmt(opening),
               t('cf_net') + ': ' + fmt(cf.net),
               t('cf_closing') + ': ' + fmt(closing)],
      fileName: 'cash-flow',
    };
  };
  if ($('#btn-rep-cf')) $('#btn-rep-cf').onclick = () => window.runCashFlow();
  if ($('#btn-cf-print')) $('#btn-cf-print').onclick = () => {
    if (!_cfDoc) return toast(t('rep_run_first'), false);
    openPrintPreview(_cfDoc);
  };
  if ($('#btn-cf-excel')) $('#btn-cf-excel').onclick = () => {
    if (!_cfDoc) return toast(t('rep_run_first'), false);
    exportDocExcel(_cfDoc);
  };

  /* ═══════════ ٣) تحليل هامش الربح ═══════════ */
  let _marginDoc = null;

  window.runMarginReport = async function () {
    const from = $('#rep-margin-from').value, to = $('#rep-margin-to').value;
    const [sl, pl] = await Promise.all([
      sb.from('sales_invoice_lines').select('item_id, qty, price, items(name), sales_invoices(created_at)'),
      sb.from('purchase_invoice_lines').select('item_id, qty, cost'),
    ]);
    if (sl.error) return toast(t('rep_run_fail') + ': ' + sl.error.message, false);
    const inPer = (iso) => (!iso) ? false : ((!from || new Date(iso) >= new Date(from + 'T00:00:00')) &&
      (!to || new Date(iso) <= new Date(to + 'T23:59:59.999')));
    const saleLines = (sl.data || [])
      .filter(l => inPer(l.sales_invoices?.created_at))
      .map(l => ({ item_id: l.item_id, name: l.items?.name || '—', qty: l.qty, price: l.price }));
    const m = marginRows(saleLines, avgCosts(pl.data || []));
    $('#tbl-rep-margin').innerHTML = m.rows.map(r => `
      <tr><td>${esc(r.name)}</td><td>${fmt(r.qty)}</td><td>${fmt(r.sales)}</td><td>${fmt(r.cost)}</td>
        <td style="font-weight:700;color:${r.profit >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(r.profit)}</td>
        <td>${fmt(r.margin)}%</td></tr>`
    ).join('') || `<tr><td colspan="6" style="color:#66707E">${t('rep_none')}</td></tr>`;
    $('#rep-margin-totals').innerHTML = m.rows.length ? `
      <span class="t-d">${t('rep_margin_sales')}: ${fmt(m.totals.sales)}</span>
      <span class="t-c">${t('rep_margin_cost')}: ${fmt(m.totals.cost)}</span>
      <span class="je-balance ${m.totals.profit >= 0 ? 'ok' : 'bad'}">${t('rep_margin_profit')}: ${fmt(m.totals.profit)} (${fmt(m.totals.margin)}%)</span>` : '';
    _marginDoc = m.rows.length ? {
      title: t('rep_margin_title'),
      meta: [[t('rep_from'), from || '—'], [t('rep_to'), to || '—']],
      tables: [{ head: [t('bc_item'), t('col_qty'), t('rep_margin_sales'), t('rep_margin_cost'),
          t('rep_margin_profit'), t('rep_margin_pct')],
        rows: m.rows.map(r => [r.name, { txt: fmt(r.qty), num: r.qty },
          { txt: fmt(r.sales), num: r.sales }, { txt: fmt(r.cost), num: r.cost },
          { txt: fmt(r.profit), num: r.profit }, { txt: fmt(r.margin) + '%', num: r.margin }]) }],
      totals: [t('rep_margin_sales') + ': ' + fmt(m.totals.sales),
               t('rep_margin_cost') + ': ' + fmt(m.totals.cost),
               t('rep_margin_profit') + ': ' + fmt(m.totals.profit) + ' (' + fmt(m.totals.margin) + '%)'],
      fileName: 'profit-margin',
    } : null;
  };
  if ($('#btn-rep-margin')) $('#btn-rep-margin').onclick = () => window.runMarginReport();
  if ($('#btn-margin-print')) $('#btn-margin-print').onclick = () => {
    if (!_marginDoc) return toast(t('rep_run_first'), false);
    openPrintPreview(_marginDoc);
  };
  if ($('#btn-margin-excel')) $('#btn-margin-excel').onclick = () => {
    if (!_marginDoc) return toast(t('rep_run_first'), false);
    exportDocExcel(_marginDoc);
  };

  /* ═══════════ ٤) قفل الفترة المحاسبية ═══════════ */
  // تحميل تاريخ القفل من tenants.locked_before (تدرّج آمن لو العمود غير مهجَّر)
  window.loadPeriodLock = async function () {
    try {
      const { data, error } = await sb.from('tenants').select('locked_before').eq('id', state.tenant).single();
      state.lockedBefore = (!error && data && data.locked_before) ? String(data.locked_before).slice(0, 10) : null;
    } catch (e) { state.lockedBefore = null; }
    return state.lockedBefore;
  };

  // فحص مشترك قبل الترحيل — true يعني مقفل (يرفض مع رسالة عربية/إنجليزية)
  window.checkPeriodLock = function (dateIso) {
    if (!isPeriodLocked(dateIso, state.lockedBefore)) return false;
    toast(t('pl_locked_msg') + ' (' + state.lockedBefore + ')', false);
    return true;
  };

  // صندوق إدارة القفل داخل تبويب الإعدادات
  async function loadPeriodLockBox() {
    const box = $('#pl-box');
    if (!box) return;
    await window.loadPeriodLock();
    const cur = state.lockedBefore;
    $('#pl-current').textContent = cur || t('pl_none');
    const inp = $('#pl-date');
    if (inp && !inp.value) inp.value = cur || '';
    const isOwner = state.myRole === 'owner';
    const note = $('#pl-note');
    if (note) note.textContent = isOwner ? t('pl_hint') : t('pl_hint_member');
    const saveBtn = $('#btn-pl-save'), clearBtn = $('#btn-pl-clear');
    if (saveBtn) saveBtn.onclick = async () => {
      const v = ($('#pl-date').value || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return toast(t('pl_bad_date'), false);
      const { error } = await sb.from('tenants').update({ locked_before: v }).eq('id', state.tenant);
      if (error) return toast(t('pl_save_fail') + ': ' + error.message + ' — ' + t('pl_need_sql'), false);
      state.lockedBefore = v;
      $('#pl-current').textContent = v;
      toast(t('pl_saved'));
    };
    if (clearBtn) clearBtn.onclick = async () => {
      const { error } = await sb.from('tenants').update({ locked_before: null }).eq('id', state.tenant);
      if (error) return toast(t('pl_save_fail') + ': ' + error.message, false);
      state.lockedBefore = null;
      $('#pl-current').textContent = t('pl_none');
      if (inp) inp.value = '';
      toast(t('pl_saved'));
    };
  }
  window.loadPeriodLockBox = loadPeriodLockBox;

  _fillDates();

  /* ═══════════ ٥) PWA — تسجيل Service Worker ═══════════ */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then(() => toast(t('pwa_ready')))
        .catch(() => { /* التطبيق يعمل بدون SW */ });
    });
  }

})(typeof window !== 'undefined' ? window : globalThis);
