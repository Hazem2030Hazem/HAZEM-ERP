/* ═══════════════════════════════════════════════════════════════
   HAZEM.ERP — المرحلة 14: دورة المشتريات + الإشعارات + الباركود
   جزآن في ملف واحد (بلا build step):
   • منطق نقي قابل للاختبار في Node: EAN-13 (checksum + توليد داخلي 200)،
     راسم Code128-B (SVG بلا مكتبات)، حالة استلام أمر الشراء،
     توازن قيد الإشعار المدين، مجاميع الإشعارات.
   • واجهات المتصفح (بعد app.js): أوامر الشراء + الاستلام الجزئي/الكامل،
     إشعارات الدائن/المدين، ملصقات الباركود، تقارير المشتريات.
   قرارات موثقة:
   • الإشعار الدائن (مرتجع مشتريات/مبيعات) يستخدم RPCs المرتجعات القائمة
     (create_purchase_return / create_sales_return) — قيد عكسي ذري وحركة
     مخزون — وجدول credit_debit_notes يسجّل الربط بالفاتورة الأصلية فقط.
     لا مسار مرتجعات موازٍ ولا تعديل على القيود (immutable).
   • الإشعار المدين يُرحَّل بقيد يدوي متوازن عبر post_manual_entry.
   • التحويل لفاتورة شراء يمر بنفس RPC فواتير الشراء القائم ثم يربط
     الفاتورة بالأمر (po_id) ويحدّث الكميات المستلمة والحالة.
   • الباركود الداخلي: EAN-13 يبدأ بـ 200 (نطاق داخلي قياسي).
   يعمل في المتصفح و Node (للاختبارات) بلا build step.
   ═══════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';

  const r2 = (typeof g.r2 === 'function') ? g.r2
    : (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  // ─────────── EAN-13 ───────────
  // رقم التحقق: خانات المواقع الفردية (من اليسار، 1-based) ×1 والزوجية ×3
  function ean13CheckDigit(digits12) {
    const d = String(digits12).replace(/\D/g, '');
    if (d.length !== 12) return null;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
    return (10 - (sum % 10)) % 10;
  }
  function isValidEan13(code) {
    const d = String(code || '').replace(/\D/g, '');
    if (d.length !== 13) return false;
    return ean13CheckDigit(d.slice(0, 12)) === Number(d[12]);
  }
  // باركود داخلي: 200 + تسلسل 9 خانات + رقم تحقق
  function makeInternalBarcode(seq) {
    const s = String(Math.max(0, Math.floor(Number(seq) || 0)) % 1e9).padStart(9, '0');
    const base = '200' + s;
    return base + ean13CheckDigit(base);
  }

  // ─────────── Code128-B ───────────
  // جدول العرض القياسي (bar/space متناوبة، 11 وحدة لكل رمز ما عدا الوقف 13)
  const C128 = [
    '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
    '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
    '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
    '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
    '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
    '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
    '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
    '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
    '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
    '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
    '114131','311141','411131','211412','211214','211232','2331112'];
  // قيم Code128-B لنص ASCII 32..127: [StartB, ...chars, checksum, Stop]
  function code128BValues(text) {
    const s = String(text);
    const vals = [104];
    let sum = 104;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 32 || c > 127) throw new Error('Code128-B: ASCII 32..127 فقط');
      const v = c - 32;
      vals.push(v);
      sum += v * (i + 1);
    }
    vals.push(sum % 103, 106);
    return vals;
  }
  // SVG باركود (bars سوداء على خلفية بيضاء) — بلا مكتبات
  function code128Svg(text, opts) {
    opts = opts || {};
    const mw = opts.moduleWidth ?? 2, h = opts.height ?? 48, quiet = opts.quiet ?? 10;
    const vals = code128BValues(text);
    let x = quiet;
    let rects = '';
    vals.forEach(v => {
      const pat = C128[v];
      for (let i = 0; i < pat.length; i++) {
        const w = Number(pat[i]) * mw;
        if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${h}"/>`;
        x += w;
      }
    });
    const width = x + quiet;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" ` +
      `viewBox="0 0 ${width} ${h}" shape-rendering="crispEdges">` +
      `<rect x="0" y="0" width="${width}" height="${h}" fill="#fff"/>` +
      `<g fill="#000">${rects}</g></svg>`;
  }

  // ─────────── حالة أمر الشراء من كميات الاستلام ───────────
  // lines: [{qty, received_qty}] — current: الحالة الحالية (draft|sent|partial|received|cancelled)
  function computePoStatus(lines, current) {
    if (current === 'cancelled') return 'cancelled';
    const ls = lines || [];
    if (!ls.length) return current || 'draft';
    const all = ls.every(l => Number(l.received_qty) >= Number(l.qty));
    if (all) return 'received';
    const any = ls.some(l => Number(l.received_qty) > 0);
    if (any) return 'partial';
    return current || 'draft';
  }
  // المتبقي لبند (لا سالب)
  const poRemaining = (l) => Math.max(0, (Number(l.qty) || 0) - (Number(l.received_qty) || 0));

  // ─────────── مجاميع إشعار (بنود بضريبة مستخرجة — نفس قاعدة الفواتير) ───────────
  function noteTotals(lines) {
    // summarizeLines من vat.js إن وُجدت، وإلا حساب محلي مكافئ
    if (typeof g.summarizeLines === 'function') return g.summarizeLines(lines, 'price');
    const s = { subtotal: 0, tax_amount: 0, total: 0 };
    (lines || []).forEach(l => {
      const gross = (Number(l.qty) || 0) * (Number(l.price) || 0);
      const tax = (!l.tax_category || l.tax_category === 'standard') ? r2(gross * 15 / 115) : 0;
      s.total = r2(s.total + gross);
      s.tax_amount = r2(s.tax_amount + tax);
      s.subtotal = r2(s.subtotal + gross - tax);
    });
    return s;
  }

  // ─────────── قيد الإشعار المدين (متوازن — immutable عبر post_manual_entry) ───────────
  // مدين: حساب الطرف (يصبح مستحقاً لنا/عليه) / دائن: الحساب المقابل المختار
  function buildDebitNoteJournal(o) {
    const amt = r2(o.amount);
    if (!(amt > 0)) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
    if (!o.partyAccountId || !o.contraAccountId) throw new Error('الحسابان مطلوبان');
    return [
      { account_id: o.partyAccountId, party_id: o.partyId || null, debit: amt, credit: 0 },
      { account_id: o.contraAccountId, party_id: null, debit: 0, credit: amt },
    ];
  }
  const journalBalanced = (lines) =>
    r2((lines || []).reduce((s, l) => s + (Number(l.debit) || 0), 0)) ===
    r2((lines || []).reduce((s, l) => s + (Number(l.credit) || 0), 0));

  const pureExports = { ean13CheckDigit, isValidEan13, makeInternalBarcode,
    code128BValues, code128Svg, computePoStatus, poRemaining, noteTotals,
    buildDebitNoteJournal, journalBalanced, C128 };
  if (typeof module !== 'undefined' && module.exports) module.exports = pureExports;
  if (typeof document === 'undefined') { Object.assign(g, pureExports); return; } // Node: منطق نقي فقط

  /* ═══════════════ واجهات المتصفح (تعمل بعد app.js) ═══════════════ */

  const _poStatusLbl = () => ({ draft: t('po_st_draft'), sent: t('po_st_sent'),
    partial: t('po_st_partial'), received: t('po_st_received'), cancelled: t('po_st_cancelled') });

  // رقم تالي لمستند: أقصى رقم + 1 (قراءة RLS-safe) — تدرّج لو الجدول غير موجود بعد
  async function _nextNo(table, kind) {
    let q = sb.from(table).select('number').order('number', { ascending: false }).limit(1);
    if (kind) q = q.eq('kind', kind);
    const { data, error } = await q;
    if (error) throw error;
    return ((data && data[0] && Number(data[0].number)) || 0) + 1;
  }

  // ─────────── أوامر الشراء: القائمة ───────────
  async function loadPurchaseOrders() {
    const { data, error } = await sb.from('purchase_orders')
      .select('*, parties(name)').order('number', { ascending: false });
    if (error) return toast(t('po_load_fail') + ': ' + error.message, false);
    state.purchaseOrders = data || [];
    renderPoTable();
  }
  function renderPoTable() {
    const q = ($('#po-search') && $('#po-search').value || '').trim();
    const L = _poStatusLbl();
    const list = (state.purchaseOrders || []).filter(p =>
      !q || String(p.number).includes(q) || (p.parties?.name || '').includes(q));
    $('#tbl-purchase-orders').innerHTML = list.map(p => `
      <tr>
        <td>${p.number}</td>
        <td>${esc(p.order_date || '')}</td>
        <td>${esc(p.parties?.name)}</td>
        <td>${esc(p.expected_date || '—')}</td>
        <td>${fmt(p.total)}</td>
        <td>${L[p.status] || esc(p.status)}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="poPrint('${p.id}')">🖨️ ${t('btn_print')}</button>
          ${p.status === 'draft' ? `<button class="btn btn-gold btn-sm" onclick="poSend('${p.id}')">${t('po_send')}</button>` : ''}
          ${['draft','sent','partial'].includes(p.status) ? `<button class="btn btn-gold btn-sm" onclick="poReceive('${p.id}')">${t('po_receive')}</button>` : ''}
          ${!['received','cancelled'].includes(p.status) ? `<button class="btn btn-danger" onclick="poCancel('${p.id}')">${t('po_cancel')}</button>` : ''}
        </td>
      </tr>`).join('') || `<tr><td colspan="7" style="color:#66707E">${t('po_none')}</td></tr>`;
  }

  // ─────────── أمر شراء جديد ───────────
  async function poForm() {
    if (!state.parties.length) await loadParties();
    if (!state.items.length) await loadItems();
    const suppliers = state.parties.filter(p => p.kind === 'supplier');
    if (!suppliers.length) return toast(t('po_need_supplier'), false);
    if (!state.items.length) return toast(t('po_need_item'), false);
    const today = new Date().toISOString().slice(0, 10);

    openModal(`
      <h3>${t('po_new')}</h3>
      <label class="lbl">${t('frm_supplier')}</label>
      <select id="po-supplier">${suppliers.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div><label class="lbl">${t('po_date')}</label><input type="date" id="po-date" value="${today}" style="width:auto"></div>
        <div><label class="lbl">${t('po_expected')}</label><input type="date" id="po-expected" style="width:auto"></div>
      </div>
      <input id="po-barcode" placeholder="${t('bc_scan_ph')}" dir="ltr" style="margin:4px 0">
      <div id="po-lines"></div>
      <button class="btn btn-ghost btn-sm" id="po-add-line">${t('btn_add_line')}</button>
      <div class="je-totals" style="margin-top:8px">
        <span class="t-d">${t('tot_subtotal')}: <span id="po-subtotal">0</span></span>
        <span class="t-c">${t('tot_vat')}: <span id="po-tax">0</span></span>
        <span class="je-balance ok">${t('tot_gross')}: <span id="po-total">0</span></span>
      </div>
      <label class="lbl">${t('po_notes')}</label>
      <input id="po-notes">
      <div class="modal-actions">
        <button class="btn btn-gold" id="po-save">${t('btn_save')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);
    $('#modal-body').classList.add('modal-lg');

    const itemOpts = () => state.items.map(i =>
      `<option value="${i.id}" data-cost="${i.sale_price}">${esc(i.name)}</option>`).join('');
    const addLine = () => {
      const d = document.createElement('div');
      d.className = 'inv-line doc-line';
      d.innerHTML = `
        <select class="ln-item">${itemOpts()}</select>
        <input class="ln-qty" type="number" min="0" step="any" value="1" placeholder="${t('col_qty')}">
        <input class="ln-price" type="number" min="0" step="any" placeholder="${t('po_cost')}">
        <select class="ln-tax-cat" title="${t('tax_cat')}">
          <option value="standard">${t('tax_cat_standard')}</option>
          <option value="zero">${t('tax_cat_zero')}</option>
          <option value="exempt">${t('tax_cat_exempt')}</option>
          <option value="out_of_scope">${t('tax_cat_out')}</option>
        </select>
        <button class="del-line" title="${t('btn_delete')}">✕</button>`;
      const sel = d.querySelector('.ln-item');
      sel.onchange = calc;
      d.querySelectorAll('input').forEach(i => i.oninput = calc);
      d.querySelector('.ln-tax-cat').onchange = calc;
      d.querySelector('.del-line').onclick = () => { d.remove(); calc(); };
      $('#po-lines').appendChild(d);
      calc();
    };
    function calc() {
      const s = summarizeLines($$('#po-lines .doc-line').map(l => ({
        qty: l.querySelector('.ln-qty').value, price: l.querySelector('.ln-price').value,
        tax_category: l.querySelector('.ln-tax-cat').value })));
      $('#po-subtotal').textContent = fmt(s.subtotal);
      $('#po-tax').textContent = fmt(s.tax_amount);
      $('#po-total').textContent = fmt(s.total);
    }
    $('#po-add-line').onclick = addLine;
    addLine();
    // إدخال بالباركود: Enter يضيف سطراً بالصنف مباشرة
    $('#po-barcode').onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      const q = e.target.value.trim(); if (!q) return;
      const it = state.items.find(i => i.barcode === q || i.sku === q);
      if (!it) return toast(t('bc_not_found'), false);
      addLine();
      const rows = $$('#po-lines .doc-line');
      const sel = rows[rows.length - 1].querySelector('.ln-item');
      sel.value = it.id;
      e.target.value = ''; e.target.focus();
    };

    $('#po-save').onclick = async () => {
      const lines = $$('#po-lines .doc-line').map(l => ({
        item_id: l.querySelector('.ln-item').value,
        qty: Number(l.querySelector('.ln-qty').value),
        cost: Number(l.querySelector('.ln-price').value) || 0,
        tax_category: l.querySelector('.ln-tax-cat').value,
      }));
      if (!lines.length || lines.some(l => !l.qty || l.qty <= 0))
        return toast(t('msg_check_lines'), false);
      const sum = summarizeLines(lines, 'cost');
      let number;
      try { number = await _nextNo('purchase_orders'); }
      catch (e) { return toast(t('po_save_fail') + ': ' + e.message, false); }
      const { data: po, error } = await sb.from('purchase_orders').insert({
        tenant_id: state.tenant, number,
        supplier_id: $('#po-supplier').value,
        order_date: $('#po-date').value || today,
        expected_date: $('#po-expected').value || null,
        notes: $('#po-notes').value.trim() || null,
        total: sum.total, status: 'draft',
      }).select('id').single();
      if (error) return toast(t('po_save_fail') + ': ' + error.message, false);
      const { error: e2 } = await sb.from('purchase_order_lines')
        .insert(lines.map(l => ({ ...l, po_id: po.id })));
      if (e2) return toast(t('po_save_fail') + ': ' + e2.message, false);
      closeModal();
      toast(t('po_saved') + ' ' + number);
      loadPurchaseOrders();
    };
  }

  // ─────────── اعتماد/إرسال + إلغاء ───────────
  window.poSend = async (id) => {
    const { error } = await sb.from('purchase_orders').update({ status: 'sent' }).eq('id', id);
    if (error) return toast(t('msg_error') + ': ' + error.message, false);
    toast(t('po_sent_ok'));
    loadPurchaseOrders();
  };
  window.poCancel = async (id) => {
    if (!confirm(t('po_cancel_confirm'))) return;
    const { error } = await sb.from('purchase_orders').update({ status: 'cancelled' }).eq('id', id);
    if (error) return toast(t('msg_error') + ': ' + error.message, false);
    toast(t('po_cancelled_ok'));
    loadPurchaseOrders();
  };

  // ─────────── الاستلام (جزئي/كامل) → فاتورة شراء عبر المسار القائم ───────────
  window.poReceive = async (id) => {
    const po = (state.purchaseOrders || []).find(p => p.id === id);
    if (!po) return;
    const { data: lines, error } = await sb.from('purchase_order_lines')
      .select('*, items(name)').eq('po_id', id);
    if (error) return toast(t('msg_error') + ': ' + error.message, false);
    const open = (lines || []).filter(l => poRemaining(l) > 0);
    if (!open.length) return toast(t('po_fully_received'), false);

    openModal(`
      <h3>${t('po_receive_title')} — ${t('po_number')} ${po.number}</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>${t('bc_item')}</th><th>${t('po_qty')}</th><th>${t('po_received')}</th><th>${t('po_remaining')}</th><th>${t('po_recv_now')}</th></tr></thead>
        <tbody>${open.map(l => `
          <tr data-line="${l.id}">
            <td>${esc(l.items?.name)}</td>
            <td>${fmt(l.qty)}</td>
            <td>${fmt(l.received_qty)}</td>
            <td>${fmt(poRemaining(l))}</td>
            <td><input class="recv-qty" type="number" min="0" max="${poRemaining(l)}" step="any"
                 value="${poRemaining(l)}" style="width:90px"></td>
          </tr>`).join('')}</tbody>
      </table></div>
      <div class="modal-actions">
        <button class="btn btn-gold" id="recv-confirm">${t('po_recv_confirm')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);

    $('#recv-confirm').onclick = async () => {
      const recv = $$('#modal-body tr[data-line]').map(tr => ({
        line: open.find(l => l.id === tr.dataset.line),
        qty: Number(tr.querySelector('.recv-qty').value) || 0,
      })).filter(r => r.qty > 0);
      if (!recv.length) return toast(t('po_recv_none'), false);
      if (recv.some(r => r.qty > poRemaining(r.line)))
        return toast(t('po_recv_over'), false);
      // فاتورة شراء حقيقية عبر نفس RPC القائم (قيد + مخزون ذرياً)
      const invLines = recv.map(r => ({ item_id: r.line.item_id, qty: r.qty,
        cost: Number(r.line.cost) || 0, tax_category: r.line.tax_category || 'standard' }));
      const { data: inv, error: e1 } = await sb.rpc('create_purchase_invoice', {
        p_tenant: state.tenant, p_supplier: po.supplier_id, p_lines: invLines });
      if (e1) return toast(t('po_recv_fail') + ': ' + e1.message, false);
      // ربط الفاتورة بأمر الشراء (تدرّج آمن لو العمود غير موجود بعد)
      if (inv && inv.number != null) {
        const uq = sb.from('purchase_invoices').update({ po_id: id });
        const ur = await (inv.id ? uq.eq('id', inv.id) : uq.eq('number', inv.number));
        if (ur.error) console.warn('po_id link:', ur.error.message);
        // الحقول الضريبية + قيد ضريبة المدخلات — نفس مسار فواتير الشراء
        const sum = summarizeLines(invLines, 'cost');
        await applyInvoiceTaxMeta('purch', inv.number, { sum, lines: invLines });
      }
      // تحديث الكميات المستلمة ثم الحالة
      for (const r of recv) {
        await sb.from('purchase_order_lines')
          .update({ received_qty: r2((Number(r.line.received_qty) || 0) + r.qty) })
          .eq('id', r.line.id);
      }
      const { data: fresh } = await sb.from('purchase_order_lines')
        .select('qty, received_qty').eq('po_id', id);
      const status = computePoStatus(fresh || [], po.status);
      await sb.from('purchase_orders').update({ status }).eq('id', id);
      closeModal();
      toast(t('po_recv_done') + ' — ' + t('inv_number') + ' ' + (inv?.number ?? ''));
      loadPurchaseOrders(); loadItems();
    };
  };

  // ─────────── طباعة أمر الشراء ───────────
  window.poPrint = async (id) => {
    const { data: po, error } = await sb.from('purchase_orders')
      .select('*, parties(name)').eq('id', id).single();
    if (error || !po) return toast(t('msg_error'), false);
    const { data: lines } = await sb.from('purchase_order_lines')
      .select('*, items(name)').eq('po_id', id);
    const L = _poStatusLbl();
    openPrintPreview({
      title: t('po_title') + ' ' + t('po_number') + ' ' + po.number,
      meta: [
        [t('po_number'), String(po.number)],
        [t('po_date'), po.order_date || '—'],
        [t('po_expected'), po.expected_date || '—'],
        [t('frm_supplier'), po.parties?.name || '—'],
        [t('po_status'), L[po.status] || po.status],
        ...(po.notes ? [[t('po_notes'), po.notes]] : []),
      ],
      tables: [{
        head: [t('bc_item'), t('po_qty'), t('po_received'), t('po_cost'), t('col_total')],
        rows: (lines || []).map(l => [
          esc(l.items?.name || '—'),
          { txt: fmt(l.qty), num: Number(l.qty) },
          { txt: fmt(l.received_qty), num: Number(l.received_qty) },
          { txt: fmt(l.cost), num: Number(l.cost) },
          { txt: fmt(Number(l.qty) * Number(l.cost)), num: Number(l.qty) * Number(l.cost) },
        ]),
      }],
      totals: [t('tot_gross') + ': ' + fmt(po.total)],
      fileName: 'po-' + po.number,
    });
  };

  window.loadPurchaseOrders = loadPurchaseOrders;
  window.openPurchaseOrder = () => { switchTab('purchases'); switchPurchSub('po'); poForm(); };
  const _btnNewPo = $('#btn-new-po');
  if (_btnNewPo) _btnNewPo.onclick = poForm;
  const _poSearch = $('#po-search');
  if (_poSearch) _poSearch.oninput = renderPoTable;

  /* ═══════════════ إشعارات الدائن/المدين ═══════════════ */
  const CDN_KINDS = () => ({ credit_purchase: t('cdn_k_credit_purchase'),
    credit_sales: t('cdn_k_credit_sales'), debit: t('cdn_k_debit') });

  async function loadCreditNotes() {
    const { data, error } = await sb.from('credit_debit_notes')
      .select('*, parties(name)').order('number', { ascending: false });
    if (error) return toast(t('cdn_load_fail') + ': ' + error.message, false);
    state.creditNotes = data || [];
    const K = CDN_KINDS();
    $('#tbl-credit-notes').innerHTML = (state.creditNotes).map(n => `
      <tr>
        <td>${n.number}</td>
        <td>${esc(n.note_date || '')}</td>
        <td>${K[n.kind] || esc(n.kind)}</td>
        <td>${esc(n.parties?.name)}</td>
        <td>${n.ref_invoice_number != null ? esc(String(n.ref_invoice_number)) : '—'}</td>
        <td>${fmt(n.total)}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="cdnPrint('${n.id}')">🖨️ ${t('btn_print')}</button></td>
      </tr>`).join('') || `<tr><td colspan="7" style="color:#66707E">${t('cdn_none')}</td></tr>`;
  }

  // نموذج إشعار جديد: دائن مشتريات (مرتجع) / دائن مبيعات (مرتجع) / مدين
  async function cdnForm() {
    if (!state.parties.length) await loadParties();
    if (!state.items.length) await loadItems();
    if (!state.accounts || !state.accounts.length) await loadAccounts();
    if (!state.items.length) return toast(t('po_need_item'), false);
    const today = new Date().toISOString().slice(0, 10);
    const K = CDN_KINDS();

    openModal(`
      <h3>${t('cdn_new')}</h3>
      <label class="lbl">${t('cdn_kind')}</label>
      <select id="cdn-kind">
        ${Object.entries(K).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
      </select>
      <label class="lbl">${t('cdn_party')}</label>
      <select id="cdn-party"></select>
      <div id="cdn-ref-box">
        <label class="lbl">${t('cdn_ref_invoice')}</label>
        <select id="cdn-ref"><option value="">—</option></select>
      </div>
      <div><label class="lbl">${t('cdn_date')}</label>
        <input type="date" id="cdn-date" value="${today}" style="width:auto"></div>
      <div id="cdn-contra-box" class="hidden">
        <label class="lbl">${t('cdn_contra')}</label>
        <select id="cdn-contra">${(state.accounts || []).map(a =>
          `<option value="${a.id}">${esc(a.code)} — ${esc(a.name)}</option>`).join('')}</select>
      </div>
      <div id="cdn-lines"></div>
      <button class="btn btn-ghost btn-sm" id="cdn-add-line">${t('btn_add_line')}</button>
      <div class="je-totals" style="margin-top:8px">
        <span class="t-d">${t('tot_subtotal')}: <span id="cdn-subtotal">0</span></span>
        <span class="t-c">${t('tot_vat')}: <span id="cdn-tax">0</span></span>
        <span class="je-balance ok">${t('tot_gross')}: <span id="cdn-total">0</span></span>
      </div>
      <label class="lbl">${t('cdn_memo')}</label>
      <input id="cdn-memo">
      <div class="modal-actions">
        <button class="btn btn-gold" id="cdn-save">${t('btn_save_post')}</button>
        <button class="btn btn-ghost" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);
    $('#modal-body').classList.add('modal-lg');

    const kindEl = $('#cdn-kind'), partyEl = $('#cdn-party'), refEl = $('#cdn-ref');
    let refInvoices = [];

    // إعادة بناء خيارات الطرف والفاتورة المرجعية حسب النوع
    async function syncPartyRefs() {
      const kind = kindEl.value;
      const pkind = kind === 'credit_sales' ? 'customer' : kind === 'credit_purchase' ? 'supplier' : null;
      const list = state.parties.filter(p => !pkind || p.kind === pkind);
      partyEl.innerHTML = list.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
      $('#cdn-contra-box').classList.toggle('hidden', kind !== 'debit');
      $('#cdn-ref-box').classList.toggle('hidden', kind === 'debit');
      refInvoices = [];
      refEl.innerHTML = '<option value="">—</option>';
      if (kind !== 'debit' && list.length) await syncInvoices();
      rebuildLines();
    }
    async function syncInvoices() {
      const kind = kindEl.value;
      const table = kind === 'credit_sales' ? 'sales_invoices' : 'purchase_invoices';
      const fk = kind === 'credit_sales' ? 'customer_id' : 'supplier_id';
      const { data } = await sb.from(table).select('id, number, total, created_at')
        .eq(fk, partyEl.value).order('number', { ascending: false });
      refInvoices = data || [];
      refEl.innerHTML = '<option value="">—</option>' + refInvoices.map(v =>
        `<option value="${v.id}">${v.number} — ${fmt(v.total)}</option>`).join('');
    }
    kindEl.onchange = syncPartyRefs;
    partyEl.onchange = () => { if (kindEl.value !== 'debit') syncInvoices(); };

    // سطور الإشعار: بنود أصناف (دائن) أو بنود حرة وصف+مبلغ (مدين)
    const itemOpts = () => state.items.map(i =>
      `<option value="${i.id}" data-price="${i.sale_price}">${esc(i.name)}</option>`).join('');
    function rebuildLines() { $('#cdn-lines').innerHTML = ''; addLine(); }
    function addLine() {
      const isDebit = kindEl.value === 'debit';
      const d = document.createElement('div');
      d.className = 'inv-line doc-line';
      d.innerHTML = isDebit ? `
        <input class="ln-desc" placeholder="${t('cdn_desc')}" style="flex:2">
        <input class="ln-qty" type="number" min="0" step="any" value="1" placeholder="${t('col_qty')}" style="max-width:80px">
        <input class="ln-price" type="number" min="0" step="any" placeholder="${t('cdn_amount')}">
        <button class="del-line" title="${t('btn_delete')}">✕</button>` : `
        <select class="ln-item">${itemOpts()}</select>
        <input class="ln-qty" type="number" min="0" step="any" value="1" placeholder="${t('col_qty')}">
        <input class="ln-price" type="number" min="0" step="any" placeholder="${t('col_price')}">
        <select class="ln-tax-cat" title="${t('tax_cat')}">
          <option value="standard">${t('tax_cat_standard')}</option>
          <option value="zero">${t('tax_cat_zero')}</option>
          <option value="exempt">${t('tax_cat_exempt')}</option>
          <option value="out_of_scope">${t('tax_cat_out')}</option>
        </select>
        <button class="del-line" title="${t('btn_delete')}">✕</button>`;
      const sel = d.querySelector('.ln-item');
      if (sel) sel.onchange = () => {
        d.querySelector('.ln-price').value = sel.selectedOptions[0]?.dataset.price ?? 0; calc();
      };
      d.querySelectorAll('input').forEach(i => i.oninput = calc);
      const tc = d.querySelector('.ln-tax-cat');
      if (tc) tc.onchange = calc;
      d.querySelector('.del-line').onclick = () => { d.remove(); calc(); };
      $('#cdn-lines').appendChild(d);
      calc();
    }
    function collectLines() {
      const isDebit = kindEl.value === 'debit';
      return $$('#cdn-lines .doc-line').map(l => isDebit ? {
        description: l.querySelector('.ln-desc').value.trim() || t('cdn_k_debit'),
        qty: Number(l.querySelector('.ln-qty').value) || 1,
        price: Number(l.querySelector('.ln-price').value) || 0,
      } : {
        item_id: l.querySelector('.ln-item').value,
        qty: Number(l.querySelector('.ln-qty').value),
        price: Number(l.querySelector('.ln-price').value) || 0,
        tax_category: l.querySelector('.ln-tax-cat').value,
      });
    }
    function calc() {
      const s = noteTotals(collectLines());
      $('#cdn-subtotal').textContent = fmt(s.subtotal);
      $('#cdn-tax').textContent = fmt(s.tax_amount);
      $('#cdn-total').textContent = fmt(s.total);
    }
    $('#cdn-add-line').onclick = addLine;
    await syncPartyRefs();

    $('#cdn-save').onclick = async () => {
      const kind = kindEl.value;
      const lines = collectLines();
      if (!lines.length || lines.some(l => !l.qty || l.qty <= 0))
        return toast(t('msg_check_lines'), false);
      const sum = noteTotals(lines);
      if (!(sum.total > 0)) return toast(t('cdn_total_zero'), false);
      const memo = $('#cdn-memo').value.trim();
      const ref = refInvoices.find(v => v.id === refEl.value) || null;
      let number;
      try { number = await _nextNo('credit_debit_notes', kind); }
      catch (e) { return toast(t('cdn_save_fail') + ': ' + e.message, false); }

      let returnId = null;
      if (kind === 'credit_purchase' || kind === 'credit_sales') {
        // الإشعار الدائن = مرتجع عبر RPC القائم (قيد عكسي + مخزون ذرياً)
        const priceField = kind === 'credit_purchase' ? 'cost' : 'price';
        const rpc = kind === 'credit_purchase' ? 'create_purchase_return' : 'create_sales_return';
        const params = { p_tenant: state.tenant,
          p_lines: lines.map(l => ({ item_id: l.item_id, qty: l.qty, [priceField]: l.price,
            ...(kind === 'credit_purchase' ? { tax_category: l.tax_category } : {}) })) };
        if (kind === 'credit_purchase') params.p_supplier = partyEl.value;
        else params.p_customer = partyEl.value;
        const { data, error } = await sb.rpc(rpc, params);
        if (error) return toast(t('cdn_save_fail') + ': ' + error.message, false);
        returnId = data?.id ?? null;
        // ضريبة المرتجع: قيد تسوية عكسي مستقل (immutable) — عكس ضريبة المدخلات،
        // بلا أي تعديل على قيد الفاتورة الأصلية (تدرّج آمن: فشل القيد لا يكسر الحفظ)
        if (kind === 'credit_purchase' && data && data.number != null && sum.tax_amount > 0) {
          try {
            const vatAcc = await ensureVatAccount();
            const purchAcc = _purchAccount();
            if (vatAcc && purchAcc) {
              await sb.rpc('post_manual_entry', { p_tenant: state.tenant,
                p_memo: 'عكس ضريبة مدخلات — إشعار دائن مشتريات رقم ' + number,
                p_lines: [
                  { account_id: purchAcc.id, party_id: null, debit: sum.tax_amount, credit: 0 },
                  { account_id: vatAcc.id, party_id: null, debit: 0, credit: sum.tax_amount },
                ] });
            }
          } catch (e) { /* لا نكسر الإشعار الناجح */ }
        }
      } else {
        // الإشعار المدين: قيد يدوي متوازن عبر post_manual_entry (immutable)
        const isCust = state.parties.find(p => p.id === partyEl.value)?.kind === 'customer';
        // حساب الطرف من البذرة المعتمدة: عملاء 1020 (أصل) / موردون 2010 (التزام)
        const partyAcc = _findAccount(a => String(a.code) === (isCust ? '1020' : '2010'))
          || _findAccount(a => a.kind === (isCust ? 'asset' : 'liability')
            && String(a.code).startsWith(isCust ? '102' : '201'));
        if (!partyAcc) return toast(t('cdn_no_party_acc'), false);
        try {
          const jLines = buildDebitNoteJournal({ amount: sum.total,
            partyAccountId: partyAcc.id, contraAccountId: $('#cdn-contra').value,
            partyId: partyEl.value });
          const { error } = await sb.rpc('post_manual_entry', {
            p_tenant: state.tenant,
            p_memo: (memo || t('cdn_k_debit') + ' ' + number), p_lines: jLines });
          if (error) return toast(t('cdn_save_fail') + ': ' + error.message, false);
        } catch (e) { return toast(t('cdn_save_fail') + ': ' + e.message, false); }
      }

      const { data: note, error: e3 } = await sb.from('credit_debit_notes').insert({
        tenant_id: state.tenant, number, kind,
        party_id: partyEl.value,
        note_date: $('#cdn-date').value || today,
        ref_invoice_id: ref ? ref.id : null,
        ref_invoice_kind: kind === 'debit' ? null
          : (kind === 'credit_sales' ? 'sales_invoice' : 'purchase_invoice'),
        ref_invoice_number: ref ? ref.number : null,
        ref_return_id: returnId,
        total: sum.total,
        memo: memo || null,
      }).select('id').single();
      if (e3) return toast(t('cdn_save_fail') + ': ' + e3.message, false);
      await sb.from('credit_debit_note_lines').insert(lines.map(l => ({
        note_id: note.id, item_id: l.item_id || null, description: l.description || null,
        qty: l.qty, price: l.price, tax_category: l.tax_category || 'standard' })));
      closeModal();
      toast(t('cdn_saved') + ' ' + number);
      loadCreditNotes(); loadItems();
      if (kind === 'credit_purchase') loadPurchases();
      if (kind === 'credit_sales') loadSalesReturns();
    };
  }

  // طباعة الإشعار — قالب فاتورة مع ذكر النوع والفاتورة المرجعية + QR زاتكا للمبيعات
  window.cdnPrint = async (id) => {
    const { data: n, error } = await sb.from('credit_debit_notes')
      .select('*, parties(name)').eq('id', id).single();
    if (error || !n) return toast(t('msg_error'), false);
    const { data: lines } = await sb.from('credit_debit_note_lines')
      .select('*, items(name)').eq('note_id', id);
    const K = CDN_KINDS();
    const sum = noteTotals(lines || []);
    const title = (n.kind === 'debit' ? t('cdn_title_debit') : t('cdn_title_credit'));
    const meta = [
      [t('cdn_number'), String(n.number)],
      [t('cdn_kind'), K[n.kind] || n.kind],
      [t('cdn_date'), n.note_date || '—'],
      [t('cdn_party'), n.parties?.name || '—'],
    ];
    if (n.ref_invoice_number != null)
      meta.push([t('cdn_ref_invoice'), String(n.ref_invoice_number)]);
    if (n.memo) meta.push([t('cdn_memo'), n.memo]);

    // QR زاتكا للإشعارات الضريبية على المبيعات (إشعار دائن)
    let qrUrl = null, qrNote = '';
    if (n.kind === 'credit_sales') {
      if (state.tax && state.tax.vat_number) {
        try {
          qrUrl = qrDataUrl(zatcaTLV({
            seller: state.tax.tax_name || state.tenantName || '',
            vat: state.tax.vat_number,
            timestamp: new Date(n.created_at).toISOString(),
            total: Number(n.total).toFixed(2), tax: sum.tax_amount.toFixed(2),
          }), 5);
        } catch (e) { qrNote = t('cdn_qr_fail') + ': ' + e.message; }
      } else qrNote = t('cdn_qr_need_vat');
    }
    openPrintPreview({
      title: title + ' ' + t('cdn_number') + ' ' + n.number,
      meta,
      tables: [{
        head: [t('col_desc'), t('col_qty'), t('col_price'), t('col_tax'), t('col_total')],
        rows: (lines || []).map(l => {
          const gross = Number(l.qty) * Number(l.price);
          const lt = lineTax(gross, l.tax_category || 'standard');
          return [
            esc(l.items?.name || l.description || '—'),
            { txt: fmt(l.qty), num: Number(l.qty) },
            { txt: fmt(l.price), num: Number(l.price) },
            { txt: fmt(lt), num: lt },
            { txt: fmt(gross), num: gross },
          ];
        }),
      }],
      totals: [t('tot_subtotal') + ': ' + fmt(sum.subtotal),
               t('tot_vat') + ': ' + fmt(sum.tax_amount),
               t('tot_gross') + ': ' + fmt(n.total)],
      note: qrNote,
      qrUrl,
      fileName: 'note-' + n.number,
    });
  };

  window.loadCreditNotes = loadCreditNotes;
  window.openCreditNote = () => { switchTab('purchases'); switchPurchSub('cdn'); cdnForm(); };
  const _btnNewCdn = $('#btn-new-cdn');
  if (_btnNewCdn) _btnNewCdn.onclick = cdnForm;

  /* ═══════════════ الباركود: التوليد + ملصقات الطباعة ═══════════════ */
  async function loadBarcodeTab() {
    if (!state.items.length) await loadItems();
    renderBarcodeTable();
  }
  function renderBarcodeTable() {
    const q = ($('#bc-search') && $('#bc-search').value || '').trim();
    const list = state.items.filter(i =>
      !q || i.name.includes(q) || (i.sku || '').includes(q) || (i.barcode || '').includes(q));
    $('#tbl-barcode').innerHTML = list.map(i => `
      <tr>
        <td><input type="checkbox" class="bc-pick" data-id="${i.id}" ${i.barcode ? '' : 'disabled title="' + t('bc_no_barcode') + '"'}></td>
        <td>${esc(i.name)}</td>
        <td dir="ltr">${esc(i.barcode || '—')}</td>
        <td>${fmt(i.sale_price)}</td>
        <td><input class="bc-count" data-id="${i.id}" type="number" min="1" step="1" value="1" style="width:70px"></td>
      </tr>`).join('') || `<tr><td colspan="5" style="color:#66707E">${t('bc_none')}</td></tr>`;
  }

  // توليد باركود داخلي (EAN-13 بادئة 200) لكل صنف بلا باركود
  async function genMissingBarcodes() {
    const missing = state.items.filter(i => !i.barcode);
    if (!missing.length) return toast(t('bc_all_have'), false);
    // تسلسل البداية: بعد أكبر تسلسل داخلي قائم
    let seq = 1;
    state.items.forEach(i => {
      const m = /^200(\d{9})\d$/.exec(i.barcode || '');
      if (m) seq = Math.max(seq, Number(m[1]) + 1);
    });
    let done = 0, failed = 0;
    for (const it of missing) {
      let okUpd = false, tries = 0;
      while (!okUpd && tries < 50) {
        const bc = makeInternalBarcode(seq++);
        tries++;
        const { error } = await sb.from('items').update({ barcode: bc }).eq('id', it.id);
        if (!error) { okUpd = true; done++; }
        else if (!/duplicate|unique/i.test(error.message)) { failed++; break; }
        // تعارض فريد → جرّب التسلسل التالي
      }
      if (!okUpd && tries >= 50) failed++;
    }
    await loadItems();
    renderBarcodeTable();
    toast(t('bc_gen_done') + ' ' + done + (failed ? ' — ' + t('msg_error') + ': ' + failed : ''), !failed);
  }

  // طباعة ملصقات: SVG Code128-B مرسوم بالكود + اسم الصنف والسعر
  function printBarcodeLabels() {
    const picks = $$('#tbl-barcode .bc-pick:checked');
    if (!picks.length) return toast(t('bc_pick_first'), false);
    let html = '';
    picks.forEach(cb => {
      const it = state.items.find(i => i.id === cb.dataset.id);
      const count = Math.max(1, Math.floor(Number(
        $(`#tbl-barcode .bc-count[data-id="${it.id}"]`)?.value) || 1));
      if (!it || !it.barcode) return;
      let svg;
      try { svg = code128Svg(it.barcode, { moduleWidth: 2, height: 44 }); }
      catch (e) { return; }
      for (let k = 0; k < count; k++) {
        html += `<div class="bc-label">
          <div class="bc-label-name">${esc(it.name)}</div>
          ${svg}
          <div class="bc-label-code" dir="ltr">${esc(it.barcode)}</div>
          <div class="bc-label-price">${fmt(it.sale_price)} ${esc(state.currency || '')}</div>
        </div>`;
      }
    });
    if (!html) return toast(t('bc_no_valid'), false);
    $('#lbl-sheet').innerHTML = html;
    $('#lbl-overlay').classList.remove('hidden');
  }

  /* ═══════════════ تقارير المشتريات الإضافية ═══════════════ */
  // مشتريات حسب المورد/الفترة: فواتير مورد واحد (أو الكل) خلال فترة
  async function runPurchSuppReport() {
    if (!state.parties.length) await loadParties();
    const supEl = $('#rep-ps-supp');
    if (supEl && !supEl.options.length) {
      supEl.innerHTML = `<option value="">${t('rep_ps_all')}</option>` +
        state.parties.filter(p => p.kind === 'supplier')
          .map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    }
    const from = $('#rep-ps-from').value, to = $('#rep-ps-to').value;
    const { data, error } = await sb.from('purchase_invoices')
      .select('id, number, total, created_at, supplier_id, parties(name)');
    if (error) return toast(t('msg_error') + ': ' + error.message, false);
    const sid = supEl.value;
    const list = (data || []).filter(v => _inPeriod(v.created_at, from, to) && (!sid || v.supplier_id === sid));
    let tot = 0;
    $('#tbl-rep-ps').innerHTML = list.map(v => {
      tot += Number(v.total);
      return `<tr><td>${v.number}</td>
        <td>${new Date(v.created_at).toLocaleDateString('ar-EG')}</td>
        <td>${esc(v.parties?.name)}</td><td>${fmt(v.total)}</td></tr>`;
    }).join('') || `<tr><td colspan="4" style="color:#66707E">${t('rep_none')}</td></tr>`;
    $('#rep-ps-total').textContent = fmt(tot);
    $('#rep-ps-count').textContent = fmt(list.length);
  }

  // أوامر الشراء المفتوحة (لم تُستلم بالكامل)
  async function runOpenPoReport() {
    const [{ data: pos, error }, { data: lines }] = await Promise.all([
      sb.from('purchase_orders').select('*, parties(name)').in('status', ['draft', 'sent', 'partial'])
        .order('number', { ascending: false }),
      sb.from('purchase_order_lines').select('po_id, qty, received_qty, items(name)'),
    ]);
    if (error) return toast(t('msg_error') + ': ' + error.message, false);
    const byPo = {};
    (lines || []).forEach(l => {
      const s = byPo[l.po_id] = byPo[l.po_id] || { qty: 0, recv: 0 };
      s.qty += Number(l.qty); s.recv += Number(l.received_qty);
    });
    const L = _poStatusLbl();
    $('#tbl-rep-poopen').innerHTML = (pos || []).map(p => {
      const s = byPo[p.id] || { qty: 0, recv: 0 };
      return `<tr><td>${p.number}</td><td>${esc(p.order_date || '')}</td>
        <td>${esc(p.parties?.name)}</td><td>${esc(p.expected_date || '—')}</td>
        <td>${fmt(p.total)}</td><td>${fmt(s.recv)} / ${fmt(s.qty)}</td>
        <td>${L[p.status] || esc(p.status)}</td></tr>`;
    }).join('') || `<tr><td colspan="7" style="color:#66707E">${t('rep_poopen_none')}</td></tr>`;
  }

  // ربط أزرار التقارير الجديدة
  const _btnPs = $('#btn-rep-ps');
  if (_btnPs) _btnPs.onclick = runPurchSuppReport;
  const _btnPoOpen = $('#btn-rep-poopen');
  if (_btnPoOpen) _btnPoOpen.onclick = runOpenPoReport;

  // ربط أزرار تبويب الباركود
  const _bcSearch = $('#bc-search');
  if (_bcSearch) _bcSearch.oninput = renderBarcodeTable;
  const _btnBcGen = $('#btn-bc-gen');
  if (_btnBcGen) _btnBcGen.onclick = genMissingBarcodes;
  const _btnBcPrint = $('#btn-bc-print');
  if (_btnBcPrint) _btnBcPrint.onclick = printBarcodeLabels;
  const _btnBcAll = $('#btn-bc-all');
  if (_btnBcAll) _btnBcAll.onclick = () =>
    $$('#tbl-barcode .bc-pick:not([disabled])').forEach(cb => cb.checked = true);
  const _lblClose = $('#lbl-close');
  if (_lblClose) _lblClose.onclick = () => $('#lbl-overlay').classList.add('hidden');
  const _lblPrint = $('#lbl-print');
  if (_lblPrint) _lblPrint.onclick = () => window.print();

  window.loadBarcodeTab = loadBarcodeTab;

  Object.assign(g, pureExports);
})(typeof window !== 'undefined' ? window : globalThis);
