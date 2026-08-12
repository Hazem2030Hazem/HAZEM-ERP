/* ═══════════════════════════════════════════════════════════════
   HAZEM.ERP — المرحلة 19: التصنيع / قوائم المكونات (BOM) + أوامر التصنيع
   ─────────────────────────────────────────────────────────────
   قرارات التنفيذ الموثقة:
   • bom_headers/bom_lines: لكل منتج تام قائمة مكونات (صنف خام + كمية لكل وحدة).
   • تكلفة المنتج = Σ(كمية المكوّن × متوسط تكلفته الموزون) — إعادة استخدام
     avgCosts من reports.js (متوسط موزون من سطور فواتير الشراء). لا يوجد
     متوسط تكلفة مخزّن في النظام — يُشتق دائماً بنفس المنطق المعتمد.
   • التحقق من التوفر: من v_item_balances (مجمّعاً على كل المستودعات).
   • تنفيذ أمر التصنيع:
       1) قيد يومية عبر RPC post_manual_entry (القيود immutable — لا مسار
          موازٍ): مدين مخزون المنتج التام / دائن مخزون الخامات بتكلفة المكونات.
          الحسابات: يُفضَّل 1310 (مخزون منتج تام) و 1320 (مخزون خامات) إن
          وُجدا في شجرة الحسابات، وإلا الرجوع لحساب المخزون الافتراضي 1300
          للطرفين (القيد توثيقي — القيمة تنتقل داخل نفس الحساب) — موثق هنا.
       2) تحديث المخزون: الإدراج المباشر في stock_movements متاح عبر RLS
          (نفس المسار المستخدم في استيراد آفاق والجرد) — حركة سالبة لكل
          مكوّن (reason: production_consume) وموجبة للمنتج التام
          (reason: production_output) في المستودع الرئيسي.
   • حالات الأمر: draft (مسودة) / done (منفذ) / cancelled (ملغي).
     الإلغاء بعد التنفيذ غير متاح (القيد immutable) — فقط المسودة تُلغى.
   يعمل في المتصفح و Node (الدوال النقية للاختبارات) بلا build step.
   ═══════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';

  const r2 = g.r2 || require('./vat.js').r2;
  const _num = (v) => Number(v) || 0;

  /* ═══ دوال نقية (قابلة للاختبار) ═══ */

  // تكلفة وحدة المنتج من بنود BOM + خريطة متوسط التكلفة لكل صنف
  // lines: [{item_id, qty}] ، costMap: {item_id: avg} → {lines:[{...,avg,cost}], total}
  function bomUnitCost(lines, costMap) {
    const out = (lines || []).map(l => {
      const avg = _num(costMap && costMap[String(l.item_id)]);
      return { item_id: l.item_id, qty: _num(l.qty), avg, cost: r2(_num(l.qty) * avg) };
    });
    return { lines: out, total: r2(out.reduce((a, l) => a + l.cost, 0)) };
  }

  // التحقق من توفر المكونات لكمية إنتاج: balances {item_id: balance}
  // → { ok, rows:[{item_id, need, have, short}] }
  function checkAvailability(lines, balances, orderQty) {
    const q = Math.max(0, _num(orderQty));
    const rows = (lines || []).map(l => {
      const need = r2(_num(l.qty) * q);
      const have = r2(_num(balances && balances[String(l.item_id)]));
      return { item_id: l.item_id, need, have, short: r2(Math.max(0, need - have)) };
    });
    return { ok: rows.every(r => r.short <= 0), rows };
  }

  // بناء سطور قيد التصنيع: مدين مخزون منتج تام / دائن مخزون خامات
  // accounts: [{id, code}] — يُفضَّل 1310/1320 ثم الرجوع إلى 1300 للطرفين
  function buildProductionEntry(accounts, totalCost) {
    const byCode = (c) => (accounts || []).find(a => String(a.code) === c);
    const fin = byCode('1310') || byCode('1300');
    const raw = byCode('1320') || byCode('1300');
    if (!fin || !raw || !(totalCost > 0)) return null;
    return [
      { account_id: fin.id, party_id: null, debit: r2(totalCost), credit: 0 },
      { account_id: raw.id, party_id: null, debit: 0, credit: r2(totalCost) },
    ];
  }

  const pureExports = { bomUnitCost, checkAvailability, buildProductionEntry };
  Object.assign(g, pureExports);
  if (typeof module !== 'undefined' && module.exports) module.exports = pureExports;

  /* ═══ واجهة المستخدم (متصفح فقط) ═══ */
  if (typeof document === 'undefined') return;

  const $id = (x) => document.getElementById(x);
  let _boms = [], _bomLines = {}, _orders = [];

  g.switchMfSub = (sub) => {
    document.querySelectorAll('#tab-manufacturing .sub-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.sub === sub));
    ['bom', 'orders'].forEach(p => {
      const el = $id('mf-pane-' + p);
      if (el) el.classList.toggle('hidden', p !== sub);
    });
    if (sub === 'bom') loadBoms();
    else loadOrders();
  };

  // خريطة متوسط التكلفة لكل الأصناف (من سطور فواتير الشراء — منطق reports.js)
  async function _costMap() {
    const avg = g.avgCosts || require('./reports.js').avgCosts;
    const { data, error } = await sb.from('purchase_invoice_lines').select('item_id, qty, cost');
    if (error) throw error;
    return avg(data || []);
  }
  // خريطة الأرصدة مجمعة على المستودعات
  async function _balanceMap() {
    const { data, error } = await sb.from('v_item_balances').select('item_id, balance');
    if (error) throw error;
    const m = {};
    (data || []).forEach(r => { m[String(r.item_id)] = r2((m[String(r.item_id)] || 0) + _num(r.balance)); });
    return m;
  }

  /* ─── إدارة قوائم المكونات ─── */
  async function loadBoms() {
    const { data, error } = await sb.from('bom_headers').select('*, items(name)').order('created_at', { ascending: false });
    if (error) {
      $id('tbl-boms').innerHTML = `<tr><td colspan="5" style="color:var(--red)">${t('mf_need_sql')}</td></tr>`;
      return;
    }
    _boms = data || [];
    if (_boms.length) {
      const { data: lines } = await sb.from('bom_lines').select('*, items(name)')
        .in('bom_id', _boms.map(b => b.id));
      _bomLines = {};
      (lines || []).forEach(l => {
        (_bomLines[l.bom_id] = _bomLines[l.bom_id] || []).push(l);
      });
    } else _bomLines = {};
    $id('tbl-boms').innerHTML = _boms.map(b => {
      const n = (_bomLines[b.id] || []).length;
      return `<tr>
        <td>${esc(b.items && b.items.name || '—')}</td>
        <td>${n}</td>
        <td>${esc(b.notes || '—')}</td>
        <td>${(b.created_at || '').slice(0, 10)}</td>
        <td>
          <button class="btn btn-sm" onclick="mfViewBom('${b.id}')">${t('btn_show')}</button>
          <button class="btn btn-sm btn-gold" onclick="mfNewOrder('${b.id}')">${t('mf_new_order')}</button>
          <button class="btn btn-sm btn-danger" onclick="mfDeleteBom('${b.id}')">${t('btn_delete')}</button>
        </td></tr>`;
    }).join('') || `<tr><td colspan="5" style="color:#66707E">${t('mf_no_boms')}</td></tr>`;
  }
  g.loadBoms = loadBoms;

  // نموذج إنشاء/تعديل BOM: منتج تام + بنود مكونات
  g.mfBomForm = () => {
    const itemOpts = (sel) => (state.items || []).map(i =>
      `<option value="${i.id}">${esc(i.name)}</option>`).join('');
    openModal(`
      <h3>${t('mf_bom_form_title')}</h3>
      <label>${t('mf_finished_item')}</label>
      <select id="bom-item">${itemOpts()}</select>
      <label>${t('mf_notes')}</label>
      <input id="bom-notes">
      <label>${t('mf_components')}</label>
      <div id="bom-lines"></div>
      <div class="modal-actions" style="justify-content:flex-start">
        <button class="btn btn-sm" id="bom-add-line">${t('btn_add_line')}</button>
      </div>
      <div class="modal-actions">
        <button class="btn btn-gold" id="bom-save">${t('btn_save')}</button>
        <button class="btn" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);
    const addLine = () => {
      const div = document.createElement('div');
      div.className = 'bom-line';
      div.style.cssText = 'display:grid;grid-template-columns:1fr 110px 40px;gap:6px;margin-bottom:6px';
      div.innerHTML = `<select class="bom-comp">${itemOpts()}</select>
        <input class="bom-qty" type="number" min="0.001" step="any" value="1" placeholder="${t('col_qty')}">
        <button class="btn btn-sm btn-danger bom-del">×</button>`;
      div.querySelector('.bom-del').onclick = () => div.remove();
      $id('bom-lines').appendChild(div);
    };
    $id('bom-add-line').onclick = addLine;
    addLine();
    $id('bom-save').onclick = async () => {
      const lines = Array.from(document.querySelectorAll('#bom-lines .bom-line')).map(d => ({
        item_id: d.querySelector('.bom-comp').value,
        qty: Number(d.querySelector('.bom-qty').value) || 0,
      })).filter(l => l.qty > 0);
      const finishedId = $id('bom-item').value;
      if (!finishedId) return toast(t('mf_pick_item'), false);
      if (!lines.length) return toast(t('msg_add_line_first'), false);
      if (lines.some(l => l.item_id === finishedId)) return toast(t('mf_self_component'), false);
      const { data: h, error } = await sb.from('bom_headers').insert({
        tenant_id: state.tenant, item_id: finishedId,
        notes: $id('bom-notes').value.trim() || null,
      }).select('id').single();
      if (error) return toast(t('msg_error') + ': ' + error.message, false);
      const { error: e2 } = await sb.from('bom_lines').insert(
        lines.map(l => ({ tenant_id: state.tenant, bom_id: h.id, item_id: l.item_id, qty: l.qty })));
      if (e2) return toast(t('msg_error') + ': ' + e2.message, false);
      closeModal(); toast(t('msg_saved'));
      loadBoms();
    };
  };

  g.mfViewBom = async (id) => {
    const b = _boms.find(x => x.id === id);
    if (!b) return;
    const lines = _bomLines[id] || [];
    const costs = await _costMap().catch(() => ({}));
    const uc = bomUnitCost(lines, costs);
    openModal(`
      <h3>${t('mf_bom_of')}: ${esc(b.items && b.items.name || '')}</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>${t('mf_component')}</th><th>${t('mf_qty_per_unit')}</th>
          <th>${t('mf_avg_cost')}</th><th>${t('mf_line_cost')}</th></tr></thead>
        <tbody>${uc.lines.map((l, i) => `<tr>
          <td>${esc((lines[i].items && lines[i].items.name) || '—')}</td>
          <td>${fmt(l.qty)}</td><td>${fmt(l.avg)}</td><td>${fmt(l.cost)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="je-balance ok">${t('mf_unit_cost')}: ${fmt(uc.total)}</div>
      <div class="modal-actions"><button class="btn" onclick="closeModal()">${t('btn_close')}</button></div>`);
  };

  g.mfDeleteBom = async (id) => {
    if (!confirm(t('mf_delete_bom_confirm'))) return;
    await sb.from('bom_lines').delete().eq('bom_id', id);
    const { error } = await sb.from('bom_headers').delete().eq('id', id);
    if (error) return toast(t('msg_error') + ': ' + error.message, false);
    toast(t('msg_deleted'));
    loadBoms();
  };

  /* ─── أوامر التصنيع ─── */
  g.mfNewOrder = (bomId) => {
    const bom = _boms.find(b => b.id === bomId);
    if (!bom) return;
    openModal(`
      <h3>${t('mf_order_form_title')}</h3>
      <p><b>${esc(bom.items && bom.items.name || '')}</b></p>
      <label>${t('mf_order_qty')}</label>
      <input id="po-qty" type="number" min="0.001" step="any" value="1">
      <div id="po-check" style="margin:8px 0"></div>
      <div class="modal-actions">
        <button class="btn" id="po-check-btn">${t('mf_check_avail')}</button>
        <button class="btn btn-gold" id="po-save">${t('btn_save')}</button>
        <button class="btn" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);
    const lines = _bomLines[bomId] || [];
    $id('po-check-btn').onclick = async () => {
      const qty = Number($id('po-qty').value) || 0;
      const balances = await _balanceMap().catch(() => ({}));
      const chk = checkAvailability(lines, balances, qty);
      $id('po-check').innerHTML = chk.rows.map((r, i) => {
        const nm = (lines[i].items && lines[i].items.name) || '—';
        const cls = r.short > 0 ? 'color:var(--red)' : 'color:var(--green)';
        return `<div style="${cls}">• ${esc(nm)}: ${t('mf_need')} ${fmt(r.need)} / ${t('mf_have')} ${fmt(r.have)}${r.short > 0 ? ' — ' + t('mf_short') + ' ' + fmt(r.short) : ' ✓'}</div>`;
      }).join('') + (chk.ok
        ? `<div class="je-balance ok">${t('mf_avail_ok')}</div>`
        : `<div class="je-balance bad">${t('mf_avail_short')}</div>`);
    };
    $id('po-save').onclick = async () => {
      const qty = Number($id('po-qty').value) || 0;
      if (!(qty > 0)) return toast(t('mf_qty_req'), false);
      const { error } = await sb.from('production_orders').insert({
        tenant_id: state.tenant, bom_id: bomId, item_id: bom.item_id,
        qty, status: 'draft',
      });
      if (error) return toast(t('msg_error') + ': ' + error.message, false);
      closeModal(); toast(t('msg_saved'));
      switchMfSub('orders');
    };
  };

  async function loadOrders() {
    const { data, error } = await sb.from('production_orders')
      .select('*, items(name)').order('created_at', { ascending: false });
    if (error) {
      $id('tbl-orders').innerHTML = `<tr><td colspan="6" style="color:var(--red)">${t('mf_need_sql')}</td></tr>`;
      return;
    }
    _orders = data || [];
    const stName = { draft: t('mf_st_draft'), done: t('mf_st_done'), cancelled: t('mf_st_cancelled') };
    $id('tbl-orders').innerHTML = _orders.map(o => `<tr>
      <td>PO-${String(o.number || '').padStart(4, '0')}</td>
      <td>${esc(o.items && o.items.name || '—')}</td>
      <td>${fmt(o.qty)}</td>
      <td>${fmt(o.total_cost || 0)}</td>
      <td>${stName[o.status] || o.status}</td>
      <td>${o.status === 'draft'
        ? `<button class="btn btn-sm btn-gold" onclick="mfExecuteOrder('${o.id}')">${t('mf_execute')}</button>
           <button class="btn btn-sm btn-danger" onclick="mfCancelOrder('${o.id}')">${t('btn_cancel')}</button>`
        : (o.created_at || '').slice(0, 10)}</td></tr>`
    ).join('') || `<tr><td colspan="6" style="color:#66707E">${t('mf_no_orders')}</td></tr>`;
  }
  g.loadOrders = loadOrders;

  // تنفيذ أمر: تحقق توفر → قيد يومية → حركات مخزون → تحديث الحالة
  g.mfExecuteOrder = async (id) => {
    const o = _orders.find(x => x.id === id);
    if (!o || o.status !== 'draft') return;
    const { data: lines, error } = await sb.from('bom_lines').select('*, items(name)').eq('bom_id', o.bom_id);
    if (error) return toast(t('msg_error') + ': ' + error.message, false);
    if (!lines || !lines.length) return toast(t('mf_no_lines'), false);
    const [costs, balances] = await Promise.all([_costMap(), _balanceMap()]);
    const chk = checkAvailability(lines, balances, o.qty);
    if (!chk.ok) {
      const miss = chk.rows.filter(r => r.short > 0)
        .map(r => { const l = lines.find(x => String(x.item_id) === String(r.item_id)); return `${l && l.items ? l.items.name : r.item_id} (${fmt(r.short)})`; });
      return toast(t('mf_cannot_execute') + ': ' + miss.join('، '), false);
    }
    const uc = bomUnitCost(lines, costs);
    const totalCost = r2(uc.total * _num(o.qty));
    const jLines = buildProductionEntry(state.accounts || [], totalCost);
    if (!jLines) return toast(t('mf_no_inv_account'), false);
    // فحص قفل الفترة (نفس نمط القيد اليدوي)
    if (typeof g.checkPeriodLock === 'function' &&
        g.checkPeriodLock(new Date().toISOString().slice(0, 10))) return;
    if (!confirm(t('mf_execute_confirm') + ': ' + fmt(totalCost))) return;
    // 1) القيد المحاسبي
    const { error: e1 } = await sb.rpc('post_manual_entry', {
      p_tenant: state.tenant,
      p_memo: `أمر تصنيع PO-${String(o.number || '').padStart(4, '0')} — ${o.qty} × ${(o.items && o.items.name) || ''}`,
      p_lines: jLines,
    });
    if (e1) return toast(t('msg_error') + ': ' + e1.message, false);
    // 2) حركات المخزون (المستودع الرئيسي — نفس مسار استيراد آفاق/الجرد)
    const { data: wh } = await sb.from('warehouses').select('id').eq('is_main', true).limit(1).single();
    if (wh) {
      const mvts = lines.map(l => ({
        tenant_id: state.tenant, item_id: l.item_id, warehouse_id: wh.id,
        qty: -r2(_num(l.qty) * _num(o.qty)), reason: 'production_consume',
      })).concat([{
        tenant_id: state.tenant, item_id: o.item_id, warehouse_id: wh.id,
        qty: _num(o.qty), reason: 'production_output',
      }]);
      const { error: e2 } = await sb.from('stock_movements').insert(mvts);
      if (e2) return toast(t('msg_error') + ': ' + e2.message, false);
    }
    // 3) تحديث حالة الأمر
    const { error: e3 } = await sb.from('production_orders')
      .update({ status: 'done', total_cost: totalCost, executed_at: new Date().toISOString() })
      .eq('id', id);
    if (e3) return toast(t('msg_error') + ': ' + e3.message, false);
    toast(t('mf_executed'));
    loadOrders();
    if (typeof loadItems === 'function') loadItems();
  };

  g.mfCancelOrder = async (id) => {
    if (!confirm(t('mf_cancel_confirm'))) return;
    const { error } = await sb.from('production_orders').update({ status: 'cancelled' }).eq('id', id).eq('status', 'draft');
    if (error) return toast(t('msg_error') + ': ' + error.message, false);
    toast(t('msg_saved'));
    loadOrders();
  };

  g.loadManufacturingTab = () => switchMfSub('bom');
})(typeof window !== 'undefined' ? window : globalThis);
