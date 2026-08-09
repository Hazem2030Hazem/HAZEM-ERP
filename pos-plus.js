/* ═══════════════════════════════════════════════════════════════
   H. ERP — ترقية نقاط البيع (POS+): مدفوعات منقّسة + تقارير مدفوعات
   + مبيعات بالساعة + صنف جديد سريع + إيصال حراري (80/58مم + ESC/POS
   raster عبر WebSerial) + إقفال وردية Z-report + تعليق/استرجاع + مرتجع.
   قرارات التنفيذ:
   • الفاتورة تُحفظ بنفس آلية pos_checkout القائمة (قيد نقدي 1100/4100 +
     مخزون + shift_id) — لا نعيد اختراع الترحيل.
   • طرق الدفع تُسجَّل في pos_payments (hazem-pos-upgrade.sql)، ثم قيود
     تسوية مستقلة عبر post_manual_entry: شبكة/تحويل مدين 1110 / دائن 1100،
     آجل مدين 1200 (بطرف العميل) / دائن 1100 — نفس دليل الحسابات القائم.
   • كل خطوة ملحقة مغلفة بمحاولة: فشلها (هجرة لم تُنفَّذ) لا يكسر البيع.
   • منطق نقي قابل للاختبار في Node أسفل الملف (module.exports).
   ═══════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';

  const _r2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

  // ─── منطق نقي ١: تسوية الدفع المنقّس ───
  // lines: [{method:'cash|card|transfer', amount, reference}]
  // يعيد: الإجماليات + الباقي + الآجل + سطور التسجيل (بعد خصم الباقي من النقد).
  function computeTender(total, lines) {
    total = _r2(total);
    const ls = (lines || [])
      .map(l => ({ method: String(l.method || 'cash'), amount: _r2(l.amount), reference: l.reference || '' }))
      .filter(l => l.amount !== 0);
    const paid = _r2(ls.reduce((s, l) => s + l.amount, 0));
    const cashGiven = _r2(ls.filter(l => l.method === 'cash').reduce((s, l) => s + l.amount, 0));
    const over = _r2(paid - total);
    const change = over > 0 ? over : 0;
    const credit = over < 0 ? _r2(-over) : 0;
    // سطور التسجيل: الباقي يُخصم من النقدية المسلَّمة (من آخر سطر نقدي رجوعاً)
    const recorded = ls.map(l => ({ ...l }));
    let rem = change;
    for (let i = recorded.length - 1; i >= 0 && rem > 0; i--) {
      if (recorded[i].method !== 'cash') continue;
      const d = Math.min(recorded[i].amount, rem);
      recorded[i].amount = _r2(recorded[i].amount - d);
      rem = _r2(rem - d);
    }
    if (credit > 0) recorded.push({ method: 'credit', amount: credit, reference: '' });
    // الزيادة فوق الإجمالي مشروعة فقط من النقد (الشبكة/التحويل بالضبط)
    const overpayOk = over <= 0 || _r2(over - cashGiven) <= 0;
    return { total, paid, cashGiven, change, credit, recorded, overpayOk };
  }

  // ─── منطق نقي ٢: التجميع الساعي للمبيعات ───
  function hourlyAggregate(rows) {
    const hours = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0, total: 0 }));
    (rows || []).forEach(r => {
      const d = new Date(r.created_at);
      if (isNaN(d)) return;
      const h = d.getHours();
      hours[h].count++;
      hours[h].total = _r2(hours[h].total + Number(r.total || 0));
    });
    let peak = 0;
    hours.forEach((x, i) => { if (x.total > hours[peak].total) peak = i; });
    return { hours, peakHour: hours[peak].total > 0 ? peak : null, maxTotal: hours[peak].total };
  }

  // ─── منطق نقي ٣: إجماليات طرق الدفع ───
  function paymentTotals(rows) {
    const m = { cash: 0, card: 0, transfer: 0, credit: 0 };
    (rows || []).forEach(r => {
      if (!(r.method in m)) m[r.method] = 0;
      m[r.method] = _r2(m[r.method] + Number(r.amount || 0));
    });
    m.grand = _r2(Object.keys(m).filter(k => k !== 'grand').reduce((s, k) => s + m[k], 0));
    return m;
  }

  // ─── منطق نقي ٤: فرق جرد الوردية ───
  function shiftCashDiff(expected, actual) {
    const e = _r2(expected), a = _r2(actual), d = _r2(a - e);
    return { expected: e, actual: a, diff: d,
      state: d === 0 ? 'match' : (d < 0 ? 'short' : 'over') };
  }

  // ─── منطق نقي ٥: تحويل نقطية canvas → ESC/POS raster (GS v 0) ───
  // getPixel(x, y) ترجع قيمة truthy للنقطة السوداء. العرض يُكمل لمضاعف 8.
  function canvasToRaster(width, height, getPixel) {
    const xBytes = Math.ceil(width / 8);
    const out = [0x1D, 0x76, 0x30, 0x00, xBytes & 0xFF, (xBytes >> 8) & 0xFF,
      height & 0xFF, (height >> 8) & 0xFF];
    for (let y = 0; y < height; y++) {
      for (let xb = 0; xb < xBytes; xb++) {
        let byte = 0;
        for (let b = 0; b < 8; b++) {
          const x = xb * 8 + b;
          if (x < width && getPixel(x, y)) byte |= (0x80 >> b);
        }
        out.push(byte);
      }
    }
    return out;
  }

  // ─── منطق نقي ٦: حزمة ESC/POS كاملة (تهيئة + raster + تغذية + قص) ───
  function escposBuild(rasterBytes) {
    return [0x1B, 0x40,                    // ESC @ تهيئة
      ...(rasterBytes || []),              // GS v 0 صورة نقطية
      0x1B, 0x64, 0x05,                    // ESC d تغذية 5 أسطر
      0x1D, 0x56, 0x42, 0x00];             // GS V قص مع تغذية
  }

  const pureExports = { computeTender, hourlyAggregate, paymentTotals,
    shiftCashDiff, canvasToRaster, escposBuild };
  if (typeof module !== 'undefined' && module.exports) module.exports = pureExports;
  if (typeof document === 'undefined') { Object.assign(g, pureExports); return; } // Node: منطق نقي فقط

  /* ═══════════════ واجهات المتصفح (تعمل بعد app.js) ═══════════════ */

  const PM_KEYS = ['cash', 'card', 'transfer', 'credit'];
  const pmName = (m) => (typeof t === 'function' ? t('pm_' + m) : m);
  const _parkKey = () => 'hazem_pos_parked_' + (state.tenant || 'x');

  // ─────────── إعدادات طابعة POS (tenants.pos_settings jsonb) ───────────
  let _poss = { paper: '80', shop_name: '', footer: '', copies: 1 };
  async function loadPosSettings() {
    try {
      const { data, error } = await sb.from('tenants').select('pos_settings').eq('id', state.tenant).single();
      if (!error && data && data.pos_settings) _poss = { ..._poss, ...data.pos_settings };
    } catch (e) { /* العمود غير موجود بعد — الافتراضيات تكفي */ }
    if ($('#poss-paper')) {
      $('#poss-paper').value = _poss.paper || '80';
      $('#poss-shop').value = _poss.shop_name || '';
      $('#poss-footer').value = _poss.footer || '';
      $('#poss-copies').value = _poss.copies || 1;
    }
  }
  window.openPosSettings = () => {
    switchTab('settings');
    setTimeout(() => $('#pos-settings-box')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  $('#btn-save-poss').onclick = async () => {
    const rec = { paper: $('#poss-paper').value === '58' ? '58' : '80',
      shop_name: $('#poss-shop').value.trim(), footer: $('#poss-footer').value.trim(),
      copies: Math.min(4, Math.max(1, Number($('#poss-copies').value) || 1)) };
    const { error } = await sb.from('tenants').update({ pos_settings: rec }).eq('id', state.tenant);
    if (error) return toast(t('poss_need_sql') + ' — ' + error.message, false);
    _poss = rec;
    toast(t('poss_saved'));
  };
  // تحميل الإعدادات مع شاشة الإعدادات العامة (تراكمي على loadTaxSettings)
  const _origLoadTax = window.loadTaxSettings;
  if (typeof _origLoadTax === 'function') {
    window.loadTaxSettings = function () { _origLoadTax(); loadPosSettings(); };
  }

  // ─────────── ١) شاشة الدفع المنقّس (split tender) ───────────
  const QUICK_AMOUNTS = [50, 100, 200, 500];

  window.posPlusCheckout = () => {
    if (!state.shift) return toast('لا توجد وردية مفتوحة — افتح وردية أولاً', false);
    const cart = (typeof window.posCartGet === 'function') ? window.posCartGet() : [];
    if (!cart.length) return toast('السلة فارغة — أضف صنفاً على الأقل', false);
    const total = _r2(cart.reduce((s, l) => s + l.qty * l.price, 0));
    let payLines = [{ method: 'cash', amount: total, reference: '' }];

    openModal(`
      <h3>${t('pos_pay_title')}</h3>
      <div class="pos-total" style="text-align:center;font-size:28px;margin-bottom:10px">${t('pos_pay_total')}: ${fmt(total)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-bottom:10px">
        <button class="btn btn-ghost btn-sm" data-quick="exact">${t('pos_pay_exact')} (${fmt(total)})</button>
        ${QUICK_AMOUNTS.map(a => `<button class="btn btn-ghost btn-sm" data-quick="${a}">${fmt(a)}</button>`).join('')}
      </div>
      <div id="pay-lines"></div>
      <button class="btn btn-ghost btn-sm" id="pay-add-line">${t('pos_pay_add_line')}</button>
      <div id="pay-cust-box" class="hidden" style="margin-top:8px">
        <label class="lbl">${t('pos_pay_customer')}</label>
        <select id="pay-customer"></select>
      </div>
      <div class="je-totals" style="justify-content:center;gap:18px;margin-top:10px">
        <span>${t('pos_pay_paid')}: <b id="pay-sum">0</b></span>
        <span>${t('pos_pay_change')}: <b id="pay-change" class="je-balance ok">0</b></span>
        <span id="pay-credit-lbl" class="hidden">${t('pos_pay_credit')}: <b id="pay-credit" class="je-balance bad">0</b></span>
      </div>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn btn-gold" id="pay-confirm" style="font-size:17px;padding:12px 30px">${t('pos_pay_confirm')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">إلغاء (Esc)</button>
      </div>`);
    $('#modal-body').classList.add('modal-lg');

    const customers = (state.parties || []).filter(p => p.kind === 'customer');
    $('#pay-customer').innerHTML = customers.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')
      || '<option value="">—</option>';

    function renderLines() {
      $('#pay-lines').innerHTML = payLines.map((l, i) => `
        <div class="inv-line" style="grid-template-columns:110px 1fr 1fr auto;gap:6px;margin-bottom:6px">
          <select data-i="${i}" class="pl-method">
            ${['cash', 'card', 'transfer'].map(m =>
              `<option value="${m}" ${l.method === m ? 'selected' : ''}>${pmName(m)}</option>`).join('')}
          </select>
          <input data-i="${i}" class="pl-amount" type="number" min="0" step="any" dir="ltr"
                 value="${l.amount}" placeholder="${t('pos_pay_amount')}">
          <input data-i="${i}" class="pl-ref" value="${esc(l.reference || '')}"
                 placeholder="${t('pos_pay_ref')}" ${l.method === 'cash' ? 'disabled' : ''}>
          <button class="del-line" data-i="${i}" title="✕">✕</button>
        </div>`).join('');
      $$('#pay-lines .pl-method').forEach(s => s.onchange = () => {
        payLines[Number(s.dataset.i)].method = s.value; renderLines(); sync();
      });
      $$('#pay-lines .pl-amount').forEach(inp => inp.oninput = () => {
        payLines[Number(inp.dataset.i)].amount = Number(inp.value) || 0; sync();
      });
      $$('#pay-lines .pl-ref').forEach(inp => inp.oninput = () => {
        payLines[Number(inp.dataset.i)].reference = inp.value;
      });
      $$('#pay-lines .del-line').forEach(b => b.onclick = () => {
        if (payLines.length <= 1) return;
        payLines.splice(Number(b.dataset.i), 1); renderLines(); sync();
      });
    }

    function tender() { return computeTender(total, payLines); }

    function sync() {
      const r = tender();
      $('#pay-sum').textContent = fmt(r.paid);
      const ch = $('#pay-change');
      ch.textContent = fmt(r.change);
      ch.className = 'je-balance ' + (r.change >= 0 && r.overpayOk ? 'ok' : 'bad');
      const hasCredit = r.credit > 0;
      $('#pay-credit-lbl').classList.toggle('hidden', !hasCredit);
      $('#pay-credit').textContent = fmt(r.credit);
      $('#pay-cust-box').classList.toggle('hidden', !hasCredit);
      const ok = r.paid > 0 && r.overpayOk && (!hasCredit || !!$('#pay-customer').value);
      $('#pay-confirm').disabled = !ok;
    }

    renderLines(); sync();
    $$('[data-quick]').forEach(b => b.onclick = () => {
      const v = b.dataset.quick === 'exact' ? total : Number(b.dataset.quick);
      const cashIdx = payLines.findIndex(l => l.method === 'cash');
      if (cashIdx >= 0) payLines[cashIdx].amount = v;
      else payLines.unshift({ method: 'cash', amount: v, reference: '' });
      renderLines(); sync();
    });
    $('#pay-add-line').onclick = () => {
      payLines.push({ method: 'card', amount: 0, reference: '' });
      renderLines(); sync();
    };
    $('#pay-customer').onchange = sync;

    $('#pay-confirm').onclick = async () => {
      const r = tender();
      if (r.change > 0 && !r.overpayOk) return toast(t('pos_pay_over_nocash'), false);
      const customerId = $('#pay-customer').value || null;
      if (r.credit > 0 && !customerId) return toast(t('pos_pay_need_customer'), false);
      const lines = cart.map(l => ({ item_id: l.item_id, qty: l.qty, price: l.price }));
      // pos_checkout يتعامل مع «المدفوع نقداً»: آجل → نمرر الإجمالي بالضبط، زيادة → المدفوع كاملاً
      const pPaid = r.credit > 0 ? total : r.paid;
      const btn = $('#pay-confirm'); btn.disabled = true; btn.textContent = '⏳ جاري الترحيل...';
      const { data, error } = await sb.rpc('pos_checkout', {
        p_tenant: state.tenant, p_shift: state.shift.id, p_lines: lines, p_paid: pPaid });
      if (error) { btn.disabled = false; btn.textContent = t('pos_pay_confirm'); return toast('فشل التحصيل: ' + error.message, false); }
      const invNumber = data?.invoice_number;
      // سطور pos_payments مرتبطة بالفاتورة (تدرّج آمن لو الهجرة لم تُنفَّذ)
      let inv = null;
      try {
        const q = await sb.from('sales_invoices').select('id, number, total, created_at, customer_id')
          .eq('number', invNumber).order('created_at', { ascending: false }).limit(1).single();
        inv = q.data || null;
      } catch (e) { /* غير حرج */ }
      try {
        const rows = r.recorded.filter(l => l.amount !== 0).map(l => ({
          tenant_id: state.tenant, invoice_id: inv?.id || null, shift_id: state.shift.id,
          method: l.method, amount: l.amount, reference: l.reference || null }));
        if (rows.length) {
          const { error: pErr } = await sb.from('pos_payments').insert(rows);
          if (pErr) toast(t('posrep_need_sql'), false);
        }
      } catch (e) { toast(t('posrep_need_sql'), false); }
      // قيود تسوية طرق الدفع — نفس منطق القيود القائم ودليل حساباته
      await postPaymentAdjustments(r, customerId, invNumber);
      window.posCartSet([]);
      loadItems();
      closeModal();
      // إيصال حراري تلقائياً بعد كل بيع (مقاس الورق من إعدادات POS)
      const receipt = buildReceiptData(inv, invNumber, cart, total, r);
      printThermalReceipt(receipt);
      showSaleSuccess(invNumber, total, r, receipt);
    };
  };

  // قيود تسوية: شبكة/تحويل مدين 1110 / دائن 1100 — آجل مدين 1200 (طرف) / دائن 1100
  async function postPaymentAdjustments(r, customerId, invNumber) {
    try {
      if (!state.accounts || !state.accounts.length) await loadAccounts();
      const cashAcc = _findAccount(a => String(a.code) === '1100');
      const bankAcc = _findAccount(a => String(a.code) === '1110')
        || _findAccount(a => String(a.code).startsWith('11') && a.id !== (cashAcc && cashAcc.id));
      const custAcc = _findAccount(a => String(a.code) === '1200');
      const nonCash = _r2(r.recorded.filter(l => l.method === 'card' || l.method === 'transfer')
        .reduce((s, l) => s + l.amount, 0));
      if (nonCash > 0 && bankAcc && cashAcc) {
        await sb.rpc('post_manual_entry', { p_tenant: state.tenant,
          p_memo: 'تسوية دفع شبكة/تحويل فاتورة POS رقم ' + invNumber,
          p_lines: [{ account_id: bankAcc.id, party_id: null, debit: nonCash, credit: 0 },
                    { account_id: cashAcc.id, party_id: null, debit: 0, credit: nonCash }] });
      }
      if (r.credit > 0 && custAcc && cashAcc) {
        await sb.rpc('post_manual_entry', { p_tenant: state.tenant,
          p_memo: 'بيع آجل POS فاتورة رقم ' + invNumber,
          p_lines: [{ account_id: custAcc.id, party_id: customerId, debit: r.credit, credit: 0 },
                    { account_id: cashAcc.id, party_id: null, debit: 0, credit: r.credit }] });
      }
    } catch (e) { /* تسوية اختيارية — لا تكسر البيع */ }
  }

  function showSaleSuccess(invNumber, total, r, receipt) {
    openModal(`
      <h3 style="text-align:center">✅ تم البيع بنجاح</h3>
      <div class="table-wrap"><table><tbody>
        <tr><td style="color:var(--muted)">رقم الفاتورة</td><td style="font-weight:700;font-size:20px">${invNumber ?? '—'}</td></tr>
        <tr><td style="color:var(--muted)">${t('pos_pay_total')}</td><td style="font-weight:700">${fmt(total)}</td></tr>
        ${r.recorded.map(l => `<tr><td style="color:var(--muted)">${pmName(l.method)}</td><td>${fmt(l.amount)}</td></tr>`).join('')}
        <tr><td style="color:var(--muted)">${t('pos_pay_change')}</td>
            <td style="font-weight:700;font-size:24px;color:var(--green)">${fmt(r.change)}</td></tr>
      </tbody></table></div>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn btn-ghost" id="btn-reprint-last">${t('pos_reprint')}</button>
        ${('serial' in navigator) ? `<button class="btn btn-ghost" id="btn-escpos-last">${t('pos_print_direct')}</button>` : ''}
        <button class="btn btn-gold" onclick="closeModal()">بيع جديد (F9)</button></div>`);
    $('#btn-reprint-last').onclick = () => printThermalReceipt(receipt);
    const direct = $('#btn-escpos-last');
    if (direct) direct.onclick = () => escposPrintReceipt(receipt);
  }

  // ─────────── ٥) الإيصال الحراري (80/58مم) ───────────
  // receipt = { number, created_at, lines:[{name,qty,price}], total, payments:[{method,amount}], change, qrText }
  function buildReceiptData(inv, invNumber, cartLines, total, tender) {
    let qrText = null;
    try {
      if (state.tax && state.tax.vat_number) {
        const gross = Number(total) || 0;
        const tax = _r2(gross - gross / 1.15); // أسعار POS شاملة ضريبة 15%
        const tlv = zatcaTLV({ seller: state.tax.tax_name || state.tenantName || '',
          vat: state.tax.vat_number,
          timestamp: new Date(inv?.created_at || Date.now()).toISOString(),
          total: gross.toFixed(2), tax: tax.toFixed(2) });
        qrText = (typeof zatcaP2UpgradeTLV === 'function' && inv?.id) ? zatcaP2UpgradeTLV(inv.id, tlv) : tlv;
      }
    } catch (e) { qrText = null; }
    return { number: invNumber ?? inv?.number ?? '—',
      created_at: inv?.created_at || new Date().toISOString(),
      lines: cartLines.map(l => ({ name: l.name, qty: l.qty, price: l.price })),
      total, payments: tender.recorded, change: tender.change, qrText };
  }

  // HTML إيصال مستقل بمقاس الورق المختار — RTL خالص بدون مكتبات
  function buildReceiptHtml(rc) {
    const w = _poss.paper === '58' ? 58 : 80;
    const shop = _poss.shop_name || state.tenantName || '';
    const footer = _poss.footer || t('pos_thanks');
    let qrImg = '';
    if (rc.qrText) { try { qrImg = `<img src="${qrDataUrl(rc.qrText, 3)}" style="width:28mm;height:28mm">`; } catch (e) { } }
    const rows = rc.lines.map(l => `
      <tr><td>${esc(l.name)}</td><td class="n">${fmt(l.qty)}</td>
          <td class="n">${fmt(l.price)}</td><td class="n">${fmt(l.qty * l.price)}</td></tr>`).join('');
    const pays = (rc.payments || []).map(p => `
      <tr><td colspan="3">${pmName(p.method)}${p.reference ? ' (' + esc(p.reference) + ')' : ''}</td>
          <td class="n">${fmt(p.amount)}</td></tr>`).join('');
    return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${t('pos_receipt')} ${rc.number}</title>
      <style>
        @page { size: ${w}mm auto; margin: 0; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { width: ${w - 4}mm; margin: 2mm; font-family: 'Segoe UI', Tahoma, sans-serif;
               font-size: 11px; color: #000; direction: rtl; }
        .c { text-align: center; } .b { font-weight: 700; }
        .shop { font-size: 16px; font-weight: 800; }
        hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 1px 0; vertical-align: top; }
        .n { text-align: left; white-space: nowrap; }
        .tot { font-size: 14px; font-weight: 800; }
      </style></head><body>
      <div class="c shop">${esc(shop)}</div>
      <div class="c">${t('pos_receipt')} #: <b>${esc(String(rc.number))}</b></div>
      <div class="c" dir="ltr">${new Date(rc.created_at).toLocaleString('ar-EG')}</div>
      ${state.tax && state.tax.vat_number ? `<div class="c">الرقم الضريبي: ${esc(state.tax.vat_number)}</div>` : ''}
      <hr><table><tbody>${rows}</tbody></table><hr>
      <table><tbody>
        <tr class="tot"><td colspan="3">${t('pos_pay_total')}</td><td class="n">${fmt(rc.total)}</td></tr>
        ${pays}
        <tr><td colspan="3">${t('pos_pay_change')}</td><td class="n b">${fmt(rc.change || 0)}</td></tr>
      </tbody></table>
      ${qrImg ? '<hr><div class="c">' + qrImg + '</div>' : ''}
      <hr><div class="c b">${esc(footer)}</div>
      <div class="c" style="font-size:9px;margin-top:4px">H. ERP SYSTEM MANAGER</div>
      </body></html>`;
  }

  function printThermalReceipt(rc) {
    const html = buildReceiptHtml(rc);
    const copies = Math.min(4, Math.max(1, Number(_poss.copies) || 1));
    try {
      const w = window.open('', '_blank', 'width=420,height=640');
      if (!w) return;
      w.document.write(html);
      w.document.close();
      // نسخ متعددة: تسلسل طباعة بسيط بعد تحميل النافذة (best-effort)
      w.addEventListener('load', () => {
        w.focus();
        for (let i = 0; i < copies; i++) setTimeout(() => w.print(), i * 400);
      });
      setTimeout(() => { try { w.focus(); w.print(); } catch (e) { } }, 600);
    } catch (e) { /* الطباعة اختيارية */ }
  }

  // إعادة طباعة إيصال من شاشة الفواتير
  window.posReprint = async (invoiceId) => {
    const { data: inv, error } = await sb.from('sales_invoices')
      .select('id, number, total, created_at').eq('id', invoiceId).single();
    if (error || !inv) return toast('تعذر تحميل الفاتورة', false);
    let lines = [];
    for (const fk of ['invoice_id']) {
      const r = await sb.from('sales_invoice_lines').select('qty, price, items(name)').eq(fk, invoiceId);
      if (!r.error) { lines = (r.data || []).map(l => ({ name: l.items?.name || '—', qty: l.qty, price: l.price })); break; }
    }
    let payments = [{ method: 'cash', amount: inv.total }];
    try {
      const { data: pays } = await sb.from('pos_payments')
        .select('method, amount, reference').eq('invoice_id', invoiceId);
      if (pays && pays.length) payments = pays;
    } catch (e) { }
    const paidSum = _r2(payments.reduce((s, p) => s + Number(p.amount), 0));
    const rc = buildReceiptData(inv, inv.number, lines.map(l => ({ ...l })), inv.total,
      { recorded: payments, change: Math.max(0, _r2(paidSum - Number(inv.total))) });
    rc.lines = lines;
    printThermalReceipt(rc);
  };

  // ─── طباعة مباشرة ESC/POS عبر WebSerial (تجريبية محروسة) ───
  // العربية على الطابعات الصينية مشكلة codepage — لذلك نرسم الإيصال نقطياً
  // على canvas (العربية تعمل في fillText) ونرسله كـ raster bit image.
  function drawReceiptCanvas(rc) {
    const W = _poss.paper === '58' ? 384 : 576;
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    const lineH = 22;
    const estH = 140 + rc.lines.length * lineH + (rc.payments || []).length * lineH + (rc.qrText ? 190 : 0);
    cv.width = W; cv.height = estH;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, estH);
    ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.direction = 'rtl';
    let y = 30;
    const shop = _poss.shop_name || state.tenantName || '';
    ctx.font = 'bold 26px Tahoma'; ctx.fillText(shop, W / 2, y); y += 26;
    ctx.font = '18px Tahoma';
    ctx.fillText(`${t('pos_receipt')} #${rc.number}`, W / 2, y); y += 22;
    ctx.fillText(new Date(rc.created_at).toLocaleString('ar-EG'), W / 2, y); y += 26;
    ctx.textAlign = 'right';
    rc.lines.forEach(l => {
      ctx.font = '16px Tahoma';
      ctx.fillText(`${l.name} ×${l.qty}`, W - 8, y);
      ctx.textAlign = 'left'; ctx.fillText(fmt(l.qty * l.price), 8, y); ctx.textAlign = 'right';
      y += lineH;
    });
    y += 6;
    ctx.font = 'bold 20px Tahoma';
    ctx.fillText(t('pos_pay_total'), W - 8, y);
    ctx.textAlign = 'left'; ctx.fillText(fmt(rc.total), 8, y); ctx.textAlign = 'right'; y += lineH;
    ctx.font = '16px Tahoma';
    (rc.payments || []).forEach(p => {
      ctx.fillText(pmName(p.method), W - 8, y);
      ctx.textAlign = 'left'; ctx.fillText(fmt(p.amount), 8, y); ctx.textAlign = 'right';
      y += lineH;
    });
    ctx.fillText(t('pos_pay_change'), W - 8, y);
    ctx.textAlign = 'left'; ctx.fillText(fmt(rc.change || 0), 8, y); ctx.textAlign = 'right'; y += 28;
    if (rc.qrText) {
      try {
        const M = qrMatrix(rc.qrText), scale = 4, qs = M.length * scale;
        const ox = (W - qs) / 2;
        for (let r = 0; r < M.length; r++) for (let c = 0; c < M.length; c++)
          if (M[r][c]) ctx.fillRect(ox + c * scale, y + r * scale, scale, scale);
        y += qs + 12;
      } catch (e) { }
    }
    ctx.font = 'bold 18px Tahoma'; ctx.textAlign = 'center';
    ctx.fillText(_poss.footer || t('pos_thanks'), W / 2, y + 10);
    return cv;
  }

  async function escposPrintReceipt(rc) {
    if (!('serial' in navigator)) return toast(t('pos_serial_unsupported'), false);
    try {
      const cv = drawReceiptCanvas(rc);
      const ctx = cv.getContext('2d');
      const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const raster = canvasToRaster(cv.width, cv.height, (x, y) => img[(y * cv.width + x) * 4] < 128);
      const bytes = new Uint8Array(escposBuild(raster));
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
      const writer = port.writable.getWriter();
      await writer.write(bytes);
      writer.releaseLock();
      await port.close();
      toast('🖨️ تمت الطباعة المباشرة');
    } catch (e) {
      if (e && e.name !== 'NotFoundError') toast('ESC/POS: ' + e.message, false);
    }
  }

  // ─────────── ٦) إقفال وردية Z-report ───────────
  window.posPlusCloseShift = async () => {
    if (!state.shift) return toast('لا توجد وردية مفتوحة', false);
    const sh = state.shift;
    const [{ data: invs }, { data: pays }] = await Promise.all([
      sb.from('sales_invoices').select('id, number, total, created_at').eq('shift_id', sh.id),
      sb.from('pos_payments').select('method, amount').eq('shift_id', sh.id).then(r => r, () => ({ data: null })),
    ]);
    const invoices = invs || [];
    const count = invoices.length;
    const total = _r2(invoices.reduce((s, r) => s + Number(r.total), 0));
    const methods = paymentTotals(pays || []);
    // النقدية المتوقعة: الافتتاحي + نقدية الوردية (لو لا مدفوعات مسجلة بعد: كل المبيعات نقدية)
    const cashSales = (pays && pays.length) ? methods.cash : total;
    const expected = _r2(Number(sh.opening_cash) + cashSales);
    // أعلى الأصناف من بنود فواتير الوردية
    let topItems = [];
    if (invoices.length) {
      try {
        const { data: lines } = await sb.from('sales_invoice_lines')
          .select('qty, price, items(name)')
          .in('invoice_id', invoices.map(v => v.id).slice(0, 200));
        const agg = {};
        (lines || []).forEach(l => {
          const n = l.items?.name || '—';
          agg[n] = agg[n] || { name: n, qty: 0, total: 0 };
          agg[n].qty += Number(l.qty); agg[n].total = _r2(agg[n].total + Number(l.qty) * Number(l.price));
        });
        topItems = Object.values(agg).sort((a, b) => b.total - a.total).slice(0, 5);
      } catch (e) { }
    }
    const methodRows = PM_KEYS.filter(k => methods[k]).map(k =>
      `<tr><td>${pmName(k)}</td><td style="font-weight:700">${fmt(methods[k])}</td></tr>`).join('');
    openModal(`
      <h3>${t('pos_z_title')} — وردية ${sh.number}</h3>
      <div class="table-wrap"><table><tbody>
        <tr><td style="color:var(--muted)">عدد الفواتير</td><td style="font-weight:700">${fmt(count)}</td></tr>
        <tr><td style="color:var(--muted)">إجمالي المبيعات</td><td style="font-weight:700">${fmt(total)}</td></tr>
        ${methodRows}
        <tr><td style="color:var(--muted)">الرصيد الافتتاحي</td><td>${fmt(sh.opening_cash)}</td></tr>
        <tr><td style="color:var(--muted)">${t('pos_z_expected')}</td><td style="font-weight:700">${fmt(expected)}</td></tr>
      </tbody></table></div>
      <label class="lbl">${t('pos_z_actual')}</label>
      <input id="z-actual" type="number" min="0" step="any" value="${expected}" dir="ltr"
             style="text-align:center;font-size:22px;font-weight:700">
      <div class="je-totals" style="justify-content:center">
        <span>${t('pos_z_diff')}:</span><span id="z-diff" class="je-balance ok" style="font-size:20px">0</span>
      </div>
      <div class="modal-actions">
        <button class="btn btn-gold" id="z-confirm">${t('pos_z_confirm')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
      </div>`);
    const syncDiff = () => {
      const d = shiftCashDiff(expected, Number($('#z-actual').value) || 0);
      const el = $('#z-diff');
      el.textContent = `${fmt(d.diff)} (${t(d.state === 'match' ? 'pos_z_match' : d.state === 'short' ? 'pos_z_short' : 'pos_z_over')})`;
      el.className = 'je-balance ' + (d.state === 'match' ? 'ok' : 'bad');
    };
    $('#z-actual').oninput = syncDiff; syncDiff();

    $('#z-confirm').onclick = async () => {
      const actual = Number($('#z-actual').value) || 0;
      const { data, error } = await sb.rpc('close_shift', {
        p_tenant: state.tenant, p_shift: sh.id, p_closing_cash: actual });
      if (error) return toast('فشل قفل الوردية: ' + error.message, false);
      const z = shiftCashDiff(expected, actual);
      // تخزين تفاصيل الإقفال (أعمدة hazem-pos-upgrade.sql — تدرّج آمن)
      try {
        await sb.from('pos_shifts').update({ expected_cash: z.expected,
          actual_cash: z.actual, difference: z.diff, closed_at: new Date().toISOString() }).eq('id', sh.id);
      } catch (e) { }
      state.shift = null;
      window.posCartSet([]);
      loadPos();
      showZReport(sh, { count, total, methods, topItems, z });
    };
  };

  function showZReport(sh, R) {
    const doc = {
      title: t('pos_z_title') + ' — ' + sh.number,
      meta: [['الكاشير', state.user?.email || '—'],
             ['الفتح', new Date(sh.opened_at).toLocaleString('ar-EG')],
             ['الإقفال', new Date().toLocaleString('ar-EG')],
             ['عدد الفواتير', fmt(R.count)],
             ['الرصيد الافتتاحي', fmt(sh.opening_cash)]],
      tables: [
        { caption: t('pos_z_methods'), head: [t('pos_pay_method'), t('pos_pay_amount')],
          rows: PM_KEYS.filter(k => R.methods[k]).map(k => [pmName(k), { txt: fmt(R.methods[k]), num: R.methods[k] }]) },
        { caption: t('pos_z_top_items'), head: ['الصنف', 'الكمية', 'الإجمالي'],
          rows: R.topItems.map(i => [i.name, { txt: fmt(i.qty), num: i.qty }, { txt: fmt(i.total), num: i.total }]) },
      ].filter(tb => tb.rows.length),
      totals: ['إجمالي المبيعات: ' + fmt(R.total),
               t('pos_z_expected') + ': ' + fmt(R.z.expected),
               t('pos_z_actual') + ': ' + fmt(R.z.actual),
               t('pos_z_diff') + ': ' + fmt(R.z.diff)],
      fileName: 'z-report-shift-' + sh.number,
    };
    openModal(`
      <h3 style="text-align:center">⚫ أُقفلت الوردية ${sh.number}</h3>
      <div class="table-wrap"><table><tbody>
        <tr><td style="color:var(--muted)">إجمالي المبيعات</td><td style="font-weight:700">${fmt(R.total)}</td></tr>
        <tr><td style="color:var(--muted)">${t('pos_z_expected')}</td><td>${fmt(R.z.expected)}</td></tr>
        <tr><td style="color:var(--muted)">${t('pos_z_actual')}</td><td>${fmt(R.z.actual)}</td></tr>
        <tr><td style="color:var(--muted)">${t('pos_z_diff')}</td>
            <td style="font-weight:700;color:${R.z.state === 'match' ? 'var(--green)' : 'var(--red,#e05)'}">${fmt(R.z.diff)}</td></tr>
      </tbody></table></div>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn btn-gold" id="z-print">${t('pos_z_print')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">إغلاق</button>
      </div>`);
    $('#z-print').onclick = () => openPrintPreview(doc);
  }

  // ─────────── تعليق / استرجاع فاتورة (park sale — localStorage) ───────────
  $('#btn-pos-park').onclick = () => {
    const cart = window.posCartGet();
    if (!cart.length) return toast('السلة فارغة', false);
    openModal(`
      <h3>${t('pos_park_title')}</h3>
      <label class="lbl">${t('pos_park_name')}</label>
      <input id="park-name" placeholder="طاولة ٥ / أبو محمد...">
      <div class="modal-actions">
        <button class="btn btn-gold" id="park-save">${t('pos_park')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
      </div>`);
    $('#park-name').focus();
    $('#park-save').onclick = () => {
      try {
        const list = JSON.parse(localStorage.getItem(_parkKey()) || '[]');
        list.push({ id: Date.now(), name: $('#park-name').value.trim() || ('#' + (list.length + 1)),
          at: new Date().toISOString(), cart });
        localStorage.setItem(_parkKey(), JSON.stringify(list));
      } catch (e) { return toast('تعذر التعليق: ' + e.message, false); }
      window.posCartSet([]);
      closeModal();
      toast(t('pos_park_done') + ' ✅');
    };
  };

  $('#btn-pos-parked').onclick = () => {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(_parkKey()) || '[]'); } catch (e) { }
    if (!list.length) return toast(t('pos_parked_empty'), false);
    openModal(`
      <h3>${t('pos_parked_title')}</h3>
      <div class="table-wrap"><table><tbody>
        ${list.map(p => `<tr>
          <td style="font-weight:700">${esc(p.name)}</td>
          <td>${new Date(p.at).toLocaleString('ar-EG')}</td>
          <td>${fmt(p.cart.reduce((s, l) => s + l.qty * l.price, 0))}</td>
          <td><button class="btn btn-gold btn-sm" data-restore="${p.id}">${t('pos_park_restore')}</button>
              <button class="btn btn-danger btn-sm" data-delpark="${p.id}">${t('pos_park_del')}</button></td>
        </tr>`).join('')}
      </tbody></table></div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">إغلاق</button></div>`);
    const saveList = (l) => localStorage.setItem(_parkKey(), JSON.stringify(l));
    $$('[data-restore]').forEach(b => b.onclick = () => {
      const p = list.find(x => String(x.id) === b.dataset.restore);
      if (!p) return;
      window.posCartSet(p.cart);
      saveList(list.filter(x => x !== p));
      closeModal();
      toast(t('pos_park_restore') + ' ✅ — ' + p.name);
    });
    $$('[data-delpark]').forEach(b => b.onclick = () => {
      saveList(list.filter(x => String(x.id) !== b.dataset.delpark));
      closeModal();
    });
  };

  // ─────────── مرتجع من POS ───────────
  $('#btn-pos-return').onclick = () => {
    openModal(`
      <h3>${t('pos_ret_title')}</h3>
      <label class="lbl">${t('pos_ret_inv_no')}</label>
      <div style="display:flex;gap:6px">
        <input id="ret-inv-no" type="number" min="1" dir="ltr" style="flex:1;margin-bottom:0">
        <button class="btn btn-gold" id="ret-find">${t('pos_ret_find')}</button>
      </div>
      <div id="ret-body" style="margin-top:10px"></div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button></div>`);
    $('#ret-inv-no').focus();
    $('#ret-inv-no').onkeydown = (e) => { if (e.key === 'Enter') $('#ret-find').click(); };
    $('#ret-find').onclick = async () => {
      const no = Number($('#ret-inv-no').value);
      if (!no) return;
      const { data: inv, error } = await sb.from('sales_invoices')
        .select('id, number, total, created_at, customer_id, parties(name)')
        .eq('number', no).order('created_at', { ascending: false }).limit(1).single();
      if (error || !inv) return toast(t('pos_ret_not_found'), false);
      const { data: lines } = await sb.from('sales_invoice_lines')
        .select('item_id, qty, price, items(name)').eq('invoice_id', inv.id);
      if (!lines || !lines.length) return toast('لا بنود لهذه الفاتورة', false);
      $('#ret-body').innerHTML = `
        <p style="color:var(--muted)">فاتورة ${inv.number} — ${new Date(inv.created_at).toLocaleString('ar-EG')} — ${esc(inv.parties?.name || '')}</p>
        <div class="table-wrap"><table>
          <thead><tr><th>الصنف</th><th>الكمية</th><th>${t('pos_ret_qty')}</th><th>السعر</th></tr></thead>
          <tbody>${lines.map((l, i) => `<tr>
            <td>${esc(l.items?.name || '—')}</td><td>${fmt(l.qty)}</td>
            <td><input type="number" class="ret-qty" data-i="${i}" min="0" max="${l.qty}" step="any" value="0"
                 dir="ltr" style="width:80px;text-align:center;margin:0"></td>
            <td>${fmt(l.price)}</td></tr>`).join('')}</tbody>
        </table></div>
        <button class="btn btn-gold btn-block" id="ret-do" style="margin-top:8px">${t('pos_ret_do')}</button>`;
      $('#ret-do').onclick = async () => {
        const sel = $$('.ret-qty').map(inp => ({ l: lines[Number(inp.dataset.i)], q: Number(inp.value) || 0 }))
          .filter(x => x.q > 0);
        if (!sel.length) return toast('حدد كميات الإرجاع', false);
        const retLines = sel.map(x => ({ item_id: x.l.item_id, qty: x.q, price: Number(x.l.price) }));
        const refund = _r2(sel.reduce((s, x) => s + x.q * Number(x.l.price), 0));
        const btn = $('#ret-do'); btn.disabled = true;
        // تنفيذ عبر آلية مرتجع المبيعات القائمة (قيد + مخزون موجب)
        const { data, error: rErr } = await sb.rpc('create_sales_return', {
          p_tenant: state.tenant, p_customer: inv.customer_id, p_lines: retLines });
        if (rErr) { btn.disabled = false; return toast('فشل المرتجع: ' + rErr.message, false); }
        // استرداد نقدي: pos_payments بمبلغ سالب + قيد مدين 1200 / دائن 1100
        try {
          await sb.from('pos_payments').insert({ tenant_id: state.tenant,
            invoice_id: inv.id, shift_id: state.shift?.id || null,
            method: 'cash', amount: -refund, reference: 'مرتجع ' + (data?.number ?? '') + ' لفاتورة ' + inv.number });
        } catch (e) { }
        try {
          if (!state.accounts || !state.accounts.length) await loadAccounts();
          const cashAcc = _findAccount(a => String(a.code) === '1100');
          const custAcc = _findAccount(a => String(a.code) === '1200');
          if (cashAcc && custAcc) {
            await sb.rpc('post_manual_entry', { p_tenant: state.tenant,
              p_memo: 'استرداد نقدي مرتجع POS ' + (data?.number ?? '') + ' لفاتورة ' + inv.number,
              p_lines: [{ account_id: custAcc.id, party_id: inv.customer_id, debit: refund, credit: 0 },
                        { account_id: cashAcc.id, party_id: null, debit: 0, credit: refund }] });
          }
        } catch (e) { }
        closeModal();
        toast(t('pos_ret_done') + ' ' + fmt(refund) + ' ✅');
        loadItems();
      };
    };
  };

  // ─────────── ٤) صنف جديد سريع من شاشة الكاشير ───────────
  $('#btn-pos-newitem').onclick = () => {
    openModal(`
      <h3>${t('pos_ni_title')}</h3>
      <input id="ni-name" placeholder="${t('pos_ni_name')}">
      <input id="ni-price" type="number" min="0" step="any" placeholder="${t('pos_ni_price')}" dir="ltr">
      <div style="display:flex;gap:6px;align-items:center">
        <input id="ni-barcode" dir="ltr" placeholder="${t('pos_ni_barcode')}" style="flex:1;margin-bottom:0">
        <button class="btn btn-ghost btn-sm" id="ni-gen">${t('pos_ni_gen')}</button>
      </div>
      <input id="ni-unit" placeholder="${t('pos_ni_unit')}" value="حبة">
      <div class="modal-actions">
        <button class="btn btn-gold" id="ni-save">${t('pos_ni_save')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
      </div>`);
    $('#ni-name').focus();
    $('#ni-gen').onclick = () => {
      if (typeof makeInternalBarcode === 'function')
        $('#ni-barcode').value = makeInternalBarcode(Date.now() % 1e9);
    };
    $('#ni-save').onclick = async () => {
      const rec = { name: $('#ni-name').value.trim(),
        sale_price: Number($('#ni-price').value) || 0,
        unit: $('#ni-unit').value.trim() || 'حبة',
        barcode: $('#ni-barcode').value.trim() || null };
      if (!rec.name) return toast(t('msg_name_req'), false);
      if (rec.barcode === null) delete rec.barcode;
      let r = await sb.from('items').insert({ ...rec, tenant_id: state.tenant });
      if (r.error && rec.barcode && /barcode/i.test(r.error.message)) {
        delete rec.barcode;
        r = await sb.from('items').insert({ ...rec, tenant_id: state.tenant });
      }
      if (r.error) return toast('خطأ: ' + r.error.message, false);
      closeModal();
      toast('✅ ' + rec.name);
      await loadItems();
      if (typeof window.renderPosGrid === 'function') window.renderPosGrid();
    };
  };

  // ─────────── ٢) تقرير المدفوعات ───────────
  let _posrepDoc = null;
  const _today = () => new Date().toISOString().slice(0, 10);
  const _monthStart = () => _today().slice(0, 8) + '01';

  window.loadPosPaymentsReport = async () => {
    if (!$('#posrep-from').value) { $('#posrep-from').value = _monthStart(); $('#posrep-to').value = _today(); }
    // قائمة الورديات للفلتر
    try {
      const { data: shifts } = await sb.from('pos_shifts').select('id, number')
        .order('number', { ascending: false }).limit(100);
      const cur = $('#posrep-shift').value;
      $('#posrep-shift').innerHTML = `<option value="">${t('posrep_all')}</option>` +
        (shifts || []).map(s => `<option value="${s.id}">${s.number}</option>`).join('');
      $('#posrep-shift').value = cur;
    } catch (e) { }
    $('#btn-posrep-run').onclick = runPosRep;
    $('#btn-posrep-print').onclick = () => { if (_posrepDoc) openPrintPreview(_posrepDoc); };
    $('#btn-posrep-excel').onclick = () => { if (_posrepDoc) exportDocExcel(_posrepDoc); };
    runPosRep();
  };

  async function runPosRep() {
    const from = $('#posrep-from').value || _monthStart();
    const to = $('#posrep-to').value || _today();
    const method = $('#posrep-method').value;
    const shift = $('#posrep-shift').value;
    let q = sb.from('pos_payments')
      .select('*, sales_invoices(number), pos_shifts(number)')
      .gte('created_at', from + 'T00:00:00').lte('created_at', to + 'T23:59:59.999')
      .order('created_at', { ascending: false });
    if (method) q = q.eq('method', method);
    if (shift) q = q.eq('shift_id', shift);
    const { data, error } = await q;
    if (error) {
      $('#tbl-posrep').innerHTML = `<tr><td colspan="6" style="color:var(--red,#e05)">${t('posrep_need_sql')}</td></tr>`;
      $('#tfoot-posrep').innerHTML = '';
      return toast(t('posrep_need_sql'), false);
    }
    const rows = data || [];
    $('#tbl-posrep').innerHTML = rows.map(p => `
      <tr>
        <td dir="ltr">${new Date(p.created_at).toLocaleString('ar-EG')}</td>
        <td>${p.sales_invoices?.number ?? '—'}</td>
        <td>${pmName(p.method)}</td>
        <td style="font-weight:700;${Number(p.amount) < 0 ? 'color:var(--red,#e05)' : ''}">${fmt(p.amount)}</td>
        <td>${esc(p.reference || '—')}</td>
        <td>${p.pos_shifts?.number ?? '—'}</td>
      </tr>`).join('') || `<tr><td colspan="6" style="color:var(--muted)">${t('posrep_empty')}</td></tr>`;
    const totals = paymentTotals(rows);
    $('#tfoot-posrep').innerHTML =
      PM_KEYS.filter(k => totals[k]).map(k => `
        <tr style="font-weight:700"><td colspan="3">${pmName(k)}</td><td>${fmt(totals[k])}</td><td colspan="2"></td></tr>`).join('') +
      `<tr style="font-weight:800;background:var(--bg2)"><td colspan="3">${t('posrep_totals')}</td><td>${fmt(totals.grand)}</td><td colspan="2"></td></tr>`;
    _posrepDoc = {
      title: t('tab_posrep') + ' (' + from + ' → ' + to + ')',
      tables: [{ head: [t('posrep_date'), t('posrep_inv'), t('posrep_method'), t('pos_pay_amount'), t('pos_pay_ref'), t('posrep_shift')],
        rows: rows.map(p => [new Date(p.created_at).toLocaleString('ar-EG'),
          String(p.sales_invoices?.number ?? '—'), pmName(p.method),
          { txt: fmt(p.amount), num: Number(p.amount) },
          p.reference || '—', String(p.pos_shifts?.number ?? '—')]) }],
      totals: PM_KEYS.filter(k => totals[k]).map(k => pmName(k) + ': ' + fmt(totals[k]))
        .concat([t('posrep_totals') + ': ' + fmt(totals.grand)]),
      fileName: 'pos-payments-' + from + '_' + to,
    };
  }

  // ─────────── ٣) المبيعات بالساعة ───────────
  window.loadPosHourly = () => {
    if (!$('#posh-date').value) $('#posh-date').value = _today();
    $('#btn-posh-run').onclick = runPosHourly;
    runPosHourly();
  };

  async function runPosHourly() {
    const day = $('#posh-date').value || _today();
    const d0 = new Date(day + 'T00:00:00');
    const d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
    const { data, error } = await sb.from('sales_invoices').select('total, created_at')
      .gte('created_at', d0.toISOString()).lt('created_at', d1.toISOString());
    if (error) return toast('تعذر الجلب: ' + error.message, false);
    const agg = hourlyAggregate(data || []);
    const maxT = agg.maxTotal || 1;
    $('#posh-peak').textContent = agg.peakHour == null ? t('posh_empty')
      : `${t('posh_peak')}: ${agg.peakHour}:00 — ${fmt(agg.maxTotal)}`;
    $('#tbl-poshourly').innerHTML = agg.hours.map(h => `
      <tr ${h.hour === agg.peakHour ? 'style="background:rgba(201,162,39,.12);font-weight:700"' : ''}>
        <td dir="ltr">${String(h.hour).padStart(2, '0')}:00</td>
        <td>${fmt(h.count)}</td>
        <td>${fmt(h.total)}</td>
        <td><div style="background:linear-gradient(90deg,#c9a227,#F0563F);border-radius:3px;height:14px;width:${Math.round(h.total / maxT * 100)}%;min-width:${h.total > 0 ? '3px' : '0'}"></div></td>
      </tr>`).join('');
  }

  // تحميل إعدادات الطابعة أول مرة بعد الدخول (state.tenant يُضبط في app.js)
  const _possBoot = setInterval(() => {
    if (state.tenant) { clearInterval(_possBoot); loadPosSettings(); }
  }, 800);
  setTimeout(() => clearInterval(_possBoot), 20000);

})(typeof window !== 'undefined' ? window : globalThis);
