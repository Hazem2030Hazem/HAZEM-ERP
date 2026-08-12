/* ═══════════════════════════════════════════════════════════════
   HAZEM.ERP — المرحلة 19: المساعد الذكي العربي (تحليلي داخلي)
   ─────────────────────────────────────────────────────────────
   • محرك قواعد محلي خالص (pattern matching عربي) — بلا أي API خارجي
     ولا إرسال لأي بيانات خارج المتصفح. كل الإجابات تُشتق من بيانات
     Supabase الخاصة بالمستأجر فقط.
   • التصميم قابل للتوسع: جدول ASSISTANT_INTENTS — كل intent:
       { id, patterns: [regex...], needsPeriod: bool,
         report: {tab, sub}  (وجهة زر «عرض التقرير»),
         fetch: async (db, params) => data,
         render: (data, params) => نص الإجابة }
     لإضافة أمر جديد: أضف عنصراً للجدول + مفاتيح ترجمته (as_*) —
     لا حاجة لتعديل أي منطق آخر. الأنماط تُفحص بالترتيب وأول تطابق يفوز.
   • استخراج الفترات (parsePeriod): «الشهر ده/الحالي»، «الشهر الماضي»،
     اسم شهر عربي (يناير..ديسمبر) مع سنة اختيارية، «السنة دي/العام».
   • زر عائم 🤖 يفتح لوحة محادثة بسيطة؛ عند عدم الفهم تُعرض الأوامر
     المتاحة من جدول المساعدة نفسه.
   يعمل في المتصفح و Node (الدوال النقية للاختبارات) بلا build step.
   ═══════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';

  const r2 = g.r2 || require('./vat.js').r2;
  const _num = (v) => Number(v) || 0;

  // ─── أسماء الأشهر العربية (مع بدائل شائعة) ───
  const AR_MONTHS = {
    'يناير': 0, 'كانون الثاني': 0,
    'فبراير': 1, 'شباط': 1,
    'مارس': 2, 'آذار': 2, 'اذار': 2,
    'أبريل': 3, 'ابريل': 3, 'نيسان': 3,
    'مايو': 4, 'أيار': 4, 'ايار': 4,
    'يونيو': 5, 'حزيران': 5,
    'يوليو': 6, 'تموز': 6,
    'أغسطس': 7, 'اغسطس': 7, 'آب': 7, 'اب': 7,
    'سبتمبر': 8, 'أيلول': 8, 'ايلول': 8,
    'أكتوبر': 9, 'اكتوبر': 9, 'تشرين الأول': 9, 'تشرين الاول': 9,
    'نوفمبر': 10, 'تشرين الثاني': 10,
    'ديسمبر': 11, 'كانون الأول': 11, 'كانون الاول': 11,
  };
  const MONTH_NAMES_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

  const _iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const _lastDay = (y, m) => new Date(y, m + 1, 0).getDate();

  /* parsePeriod(text, now): استخراج الفترة من النص العربي
     الناتج: { from:'YYYY-MM-DD', to:'YYYY-MM-DD', label } — الافتراضي: الشهر الحالي */
  function parsePeriod(text, now) {
    now = now || new Date();
    text = String(text || '');
    const y = now.getFullYear(), m = now.getMonth();

    // «الشهر الماضي / السابق»
    if (/شهر/.test(text) && /ماضي|السابق|اللي فات|الفائت/.test(text)) {
      const d = new Date(y, m - 1, 1);
      const yy = d.getFullYear(), mm = d.getMonth();
      return { from: _iso(new Date(yy, mm, 1)), to: _iso(new Date(yy, mm, _lastDay(yy, mm))),
        label: MONTH_NAMES_AR[mm] + ' ' + yy };
    }
    // «السنة دي / هذا العام / السنة الحالية»
    if (/السنه|السنة|العام/.test(text) && /ده|دي|هذا|هذه|الحالي/.test(text)) {
      return { from: _iso(new Date(y, 0, 1)), to: _iso(now), label: String(y) };
    }
    // اسم شهر صريح (+ سنة اختيارية من 4 أرقام)
    for (const name of Object.keys(AR_MONTHS)) {
      if (text.includes(name)) {
        const mm = AR_MONTHS[name];
        const ym = text.match(/(19|20)\d{2}/);
        const yy = ym ? Number(ym[0]) : y;
        return { from: _iso(new Date(yy, mm, 1)), to: _iso(new Date(yy, mm, _lastDay(yy, mm))),
          label: MONTH_NAMES_AR[mm] + ' ' + yy };
      }
    }
    // الافتراضي: الشهر الحالي («الشهر ده» أو أي سؤال بلا فترة)
    return { from: _iso(new Date(y, m, 1)), to: _iso(now),
      label: MONTH_NAMES_AR[m] + ' ' + y };
  }

  /* ═══ جدول الـ Intents — نقطة التوسع الوحيدة ═══
     ترتيب الفحص: أول pattern يطابق يفوز. الأكثر تحديداً أولاً. */
  const ASSISTANT_INTENTS = [
    {
      id: 'top_customers',
      patterns: [/أعلى.*عملاء|افضل.*عملاء|أفضل.*عملاء|أكبر.*عملاء|اكبر.*عملاء/],
      needsPeriod: true,
      report: { tab: 'reports', sub: 'sales' },
      // fetch: فواتير المبيعات في الفترة مجمعة حسب العميل
      fetch: async (db, p) => {
        const { data, error } = await db.from('sales_invoices')
          .select('total, parties(name)')
          .gte('created_at', p.from + 'T00:00:00').lte('created_at', p.to + 'T23:59:59.999');
        if (error) throw error;
        const by = {};
        (data || []).forEach(inv => {
          const n = (inv.parties && inv.parties.name) || '—';
          by[n] = r2((by[n] || 0) + _num(inv.total));
        });
        return Object.entries(by).map(([name, total]) => ({ name, total }))
          .sort((a, b) => b.total - a.total).slice(0, 5);
      },
      render: (rows) => rows.length
        ? rows.map((r, i) => `${i + 1}. ${r.name}: <b>${fmtN(r.total)}</b>`).join('<br>')
        : tSafe('as_no_data'),
    },
    {
      id: 'top_items',
      patterns: [/أفضل.*أصناف|افضل.*اصناف|أكثر.*أصناف|اكثر.*اصناف|أعلى.*أصناف|الأصناف.*مبيعا|الاصناف.*مبيعا/],
      needsPeriod: true,
      report: { tab: 'reports', sub: 'margin' },
      fetch: async (db, p) => {
        const { data, error } = await db.from('sales_invoice_lines')
          .select('qty, price, items(name), sales_invoices(created_at)');
        if (error) throw error;
        const by = {};
        (data || []).forEach(l => {
          const iso = l.sales_invoices && l.sales_invoices.created_at;
          if (!iso || iso < p.from + 'T00:00:00' || iso > p.to + 'T23:59:59.999') return;
          const n = (l.items && l.items.name) || '—';
          if (!by[n]) by[n] = { name: n, qty: 0, total: 0 };
          by[n].qty = r2(by[n].qty + _num(l.qty));
          by[n].total = r2(by[n].total + _num(l.qty) * _num(l.price));
        });
        return Object.values(by).sort((a, b) => b.total - a.total).slice(0, 5);
      },
      render: (rows) => rows.length
        ? rows.map((r, i) => `${i + 1}. ${r.name}: <b>${fmtN(r.total)}</b> (${fmtN(r.qty)})`).join('<br>')
        : tSafe('as_no_data'),
    },
    {
      id: 'sales_period',
      patterns: [/مبيعات/],
      needsPeriod: true,
      report: { tab: 'reports', sub: 'sales' },
      fetch: async (db, p) => {
        const { data, error } = await db.from('sales_invoices')
          .select('total')
          .gte('created_at', p.from + 'T00:00:00').lte('created_at', p.to + 'T23:59:59.999');
        if (error) throw error;
        return { total: r2((data || []).reduce((a, i) => a + _num(i.total), 0)), count: (data || []).length };
      },
      render: (d, p) => tSafe('as_sales_answer', { period: p.label, total: fmtN(d.total), count: d.count }),
    },
    {
      id: 'overdue',
      patterns: [/متأخر|مستحقات|أعمار الذمم|اعمار الذمم|ديون العملاء/],
      needsPeriod: false,
      report: { tab: 'reports', sub: 'aging' },
      // يعيد استخدام منطق aging من reports.js (allocateFifo + agingRows)
      fetch: async (db) => {
        const [{ data: invs, error: e1 }, { data: pays, error: e2 }] = await Promise.all([
          db.from('sales_invoices').select('id, number, total, created_at, party_id, parties(name)').order('created_at'),
          db.from('vouchers').select('party_id, amount').eq('voucher_type', 'receipt'),
        ]);
        if (e1) throw e1; if (e2) throw e2;
        const arows = g.agingRows || require('./reports.js').agingRows;
        const today = new Date().toISOString().slice(0, 10);
        const paidBy = {};
        (pays || []).forEach(v => { paidBy[v.party_id] = r2((paidBy[v.party_id] || 0) + _num(v.amount)); });
        // تجميع الفواتير حسب العميل ثم تشغيل منطق aging (FIFO) لكل عميل
        const byParty = {};
        (invs || []).forEach(i => {
          const pid = i.party_id || '—';
          if (!byParty[pid]) byParty[pid] = { name: (i.parties && i.parties.name) || '—', invs: [] };
          byParty[pid].invs.push(i);
        });
        let rows = [];
        for (const pid of Object.keys(byParty)) {
          rows = rows.concat(arows(byParty[pid].invs, paidBy[pid] || 0, today, 30)
            .map(r => ({ name: byParty[pid].name, due: r.remaining, days: r.overdue_days })));
        }
        const overdue = rows.filter(r => r.due > 0.004 && r.days > 0);
        return { rows: overdue.sort((a, b) => b.due - a.due).slice(0, 5),
          total: r2(overdue.reduce((a, r) => a + r.due, 0)) };
      },
      render: (d) => d.total > 0
        ? tSafe('as_overdue_total', { total: fmtN(d.total) }) + '<br>' +
          d.rows.map(r => `• ${r.name}: <b>${fmtN(r.due)}</b> (${r.days} ${tSafe('as_days')})`).join('<br>')
        : tSafe('as_no_overdue'),
    },
    {
      id: 'treasury',
      patterns: [/رصيد.*خزين|رصيد.*بنك|الخزينة|الخزن|البنك|الكاش|النقدية|السيولة/],
      needsPeriod: false,
      report: { tab: 'reports', sub: 'cashflow' },
      fetch: async (db) => {
        const [{ data: accs, error: e1 }, { data: lines, error: e2 }] = await Promise.all([
          db.from('accounts').select('id, code, name'),
          db.from('journal_entry_lines').select('account_id, debit, credit'),
        ]);
        if (e1) throw e1; if (e2) throw e2;
        const cash = (accs || []).filter(a => /^11/.test(String(a.code)));
        const out = cash.map(a => {
          const bal = (lines || []).filter(l => l.account_id === a.id)
            .reduce((s, l) => s + _num(l.debit) - _num(l.credit), 0);
          return { name: a.name, code: a.code, bal: r2(bal) };
        });
        return { rows: out, total: r2(out.reduce((a, r) => a + r.bal, 0)) };
      },
      render: (d) => (d.rows.length
        ? d.rows.map(r => `• ${r.name} (${r.code}): <b>${fmtN(r.bal)}</b>`).join('<br>') + '<br>'
        : '') + tSafe('as_treasury_total', { total: fmtN(d.total) }),
    },
    {
      id: 'net_profit',
      patterns: [/صافي.*ربح|الربح|الأرباح|الارباح|ربحية|نتيجة.*نشاط/],
      needsPeriod: true,
      report: { tab: 'reports', sub: 'income' },
      fetch: async (db, p) => {
        const [{ data: accs, error: e1 }, { data: lines, error: e2 }] = await Promise.all([
          db.from('accounts').select('id, kind'),
          db.from('journal_entry_lines').select('account_id, debit, credit, journal_entries(created_at)'),
        ]);
        if (e1) throw e1; if (e2) throw e2;
        const kind = {}; (accs || []).forEach(a => { kind[a.id] = a.kind; });
        let rev = 0, exp = 0;
        (lines || []).forEach(l => {
          const iso = l.journal_entries && l.journal_entries.created_at;
          if (iso && (iso < p.from + 'T00:00:00' || iso > p.to + 'T23:59:59.999')) return;
          const k = kind[l.account_id];
          if (k === 'revenue') rev += _num(l.credit) - _num(l.debit);
          else if (k === 'expense') exp += _num(l.debit) - _num(l.credit);
        });
        return { revenue: r2(rev), expense: r2(exp), profit: r2(rev - exp) };
      },
      render: (d, p) => tSafe('as_profit_answer', { period: p.label,
        rev: fmtN(d.revenue), exp: fmtN(d.expense), profit: fmtN(d.profit) }),
    },
    {
      id: 'vat_return',
      patterns: [/إقرار|اقرار|الضريبة|ضريبة القيمة/],
      needsPeriod: true,
      report: { tab: 'reports', sub: 'vat' },
      fetch: async (db, p) => {
        const cv = g.computeVatReturn || require('./vat.js').computeVatReturn;
        const [{ data: s, error: e1 }, { data: q, error: e2 }] = await Promise.all([
          db.from('sales_invoices').select('*').gte('created_at', p.from + 'T00:00:00').lte('created_at', p.to + 'T23:59:59.999'),
          db.from('purchase_invoices').select('*').gte('created_at', p.from + 'T00:00:00').lte('created_at', p.to + 'T23:59:59.999'),
        ]);
        if (e1) throw e1; if (e2) throw e2;
        return cv(s || [], q || []);
      },
      render: (d, p) => tSafe('as_vat_answer', { period: p.label,
        out: fmtN(d.output_tax), inp: fmtN(d.input_tax), due: fmtN(d.net_due) }),
    },
  ];

  /* matchIntent(text): أول intent يطابق نمطه.
     الناتج: { intent, params:{period?} } أو null عند عدم الفهم */
  function matchIntent(text, now) {
    const t0 = String(text || '').trim();
    if (!t0) return null;
    for (const intent of ASSISTANT_INTENTS) {
      if (intent.patterns.some(rx => rx.test(t0))) {
        const params = intent.needsPeriod ? { period: parsePeriod(t0, now) } : {};
        return { intent, params };
      }
    }
    return null;
  }

  // قائمة الأوامر المتاحة (لرسالة عدم الفهم وزر المساعدة)
  const HELP_COMMANDS = [
    'as_help_sales', 'as_help_top_cust', 'as_help_top_items',
    'as_help_overdue', 'as_help_treasury', 'as_help_profit', 'as_help_vat',
  ];

  function tSafe(key, vars) {
    let s = (typeof g.t === 'function' ? g.t(key) : key);
    if (vars) Object.keys(vars).forEach(k => { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  }
  function fmtN(n) {
    return (typeof g.fmt === 'function') ? g.fmt(n) : String(r2(n));
  }

  const pureExports = { AR_MONTHS, MONTH_NAMES_AR, parsePeriod, matchIntent, ASSISTANT_INTENTS, HELP_COMMANDS };
  Object.assign(g, pureExports);
  if (typeof module !== 'undefined' && module.exports) module.exports = pureExports;

  /* ═══ واجهة المستخدم (متصفح فقط) ═══ */
  if (typeof document === 'undefined') return;

  let _history = [];
  function _pushMsg(html, who) {
    _history.push({ html, who });
    const box = document.getElementById('as-messages');
    if (!box) return;
    box.innerHTML = _history.map(m =>
      `<div class="as-msg as-${m.who}">${m.html}</div>`).join('');
    box.scrollTop = box.scrollHeight;
  }

  function _helpHtml() {
    return `<b>${tSafe('as_help_title')}</b><ul style="margin:6px 0;padding-inline-start:18px">` +
      HELP_COMMANDS.map(k => `<li>${tSafe(k)}</li>`).join('') + '</ul>';
  }

  async function askAssistant(text) {
    const q = String(text || '').trim();
    if (!q) return;
    _pushMsg((typeof esc === 'function' ? esc(q) : q), 'user');
    const m = matchIntent(q);
    if (!m) { _pushMsg(tSafe('as_not_understood') + '<br>' + _helpHtml(), 'bot'); return; }
    _pushMsg(tSafe('as_thinking'), 'bot');
    try {
      const data = await m.intent.fetch(sb, m.params.period ? m.params.period : {});
      _history.pop(); // إزالة «جارٍ الحساب»
      const rep = m.intent.report;
      const answer = m.intent.render(data, m.params.period || {});
      const btn = rep ? `<div style="margin-top:8px"><button class="btn btn-sm btn-gold" onclick="asOpenReport('${rep.tab}','${rep.sub}')">${tSafe('as_open_report')}</button></div>` : '';
      _pushMsg(answer + btn, 'bot');
    } catch (e) {
      _history.pop();
      _pushMsg(tSafe('as_error') + ': ' + (e && e.message ? (typeof esc === 'function' ? esc(e.message) : e.message) : ''), 'bot');
    }
  }
  g.askAssistant = askAssistant;

  g.asOpenReport = (tab, sub) => {
    g.toggleAssistant(false);
    if (typeof g.openReport === 'function' && tab === 'reports') return g.openReport(sub);
    if (typeof g.switchTab === 'function') g.switchTab(tab);
  };

  g.toggleAssistant = (force) => {
    const panel = document.getElementById('assistant-panel');
    if (!panel) return;
    const show = typeof force === 'boolean' ? force : panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !show);
    if (show && !_history.length) _pushMsg(tSafe('as_welcome') + '<br>' + _helpHtml(), 'bot');
    if (show) { const inp = document.getElementById('as-input'); if (inp) setTimeout(() => inp.focus(), 50); }
  };

  // تهيئة الربط بعد تحميل DOM
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bind);
  else _bind();
  function _bind() {
    const fab = document.getElementById('assistant-fab');
    if (fab) fab.onclick = () => g.toggleAssistant();
    const close = document.getElementById('as-close');
    if (close) close.onclick = () => g.toggleAssistant(false);
    const send = document.getElementById('as-send');
    if (send) send.onclick = () => {
      const inp = document.getElementById('as-input');
      if (inp && inp.value.trim()) { askAssistant(inp.value); inp.value = ''; }
    };
    const inp = document.getElementById('as-input');
    if (inp) inp.onkeydown = (e) => {
      if (e.key === 'Enter' && inp.value.trim()) { askAssistant(inp.value); inp.value = ''; }
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
