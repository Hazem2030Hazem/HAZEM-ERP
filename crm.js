/* ═══════════════════════════════════════════════════════════════
   H. ERP — المرحلة 19: CRM مبسّط (عملاء محتملون + متابعات)
   ─────────────────────────────────────────────────────────────
   • crm_leads: عميل محتمل (اسم/جوال/مصدر/حالة/ملاحظات).
     الحالات: new (جديد) → contacted (تواصل) → quoted (عرض سعر)
             → converted (تم التحويل) | lost (مفقود).
   • crm_activities: نشاط متابعة (مكالمة/زيارة/رسالة) + تذكير بتاريخ
     (remind_at) — قائمة «متابعات اليوم» تعرض المستحق اليوم وغير المنجز.
   • تحويل Lead إلى عميل فعلي: إنشاء سجل في parties (kind: customer)
     وربطه بـ converted_party_id — القيد التجاري يبقى في parties فقط.
   • لوحة CRM: kanban مبسّط بأعمدة الحالات + عدّاد لكل عمود.
   • الدوال النقية (تنظيف الحالة، جدولة المتابعات، ترتيب kanban)
     قابلة للاختبار في Node.
   يعمل في المتصفح و Node بلا build step.
   ═══════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';

  const _num = (v) => Number(v) || 0;

  // الحالات المعتمدة بالترتيب (أعمدة الـ kanban)
  const LEAD_STATUSES = ['new', 'contacted', 'quoted', 'converted', 'lost'];
  const ACTIVITY_TYPES = ['call', 'visit', 'message'];

  /* ═══ دوال نقية (قابلة للاختبار) ═══ */

  // تطبيع حالة lead — أي قيمة غير معروفة ترجع 'new'
  function normalizeLeadStatus(s) {
    return LEAD_STATUSES.includes(s) ? s : 'new';
  }

  // تجميع leads في أعمدة kanban: → {status: [leads]} + عدّادات
  function kanbanColumns(leads) {
    const cols = {}; LEAD_STATUSES.forEach(s => { cols[s] = []; });
    (leads || []).forEach(l => cols[normalizeLeadStatus(l.status)].push(l));
    const counts = {}; LEAD_STATUSES.forEach(s => { counts[s] = cols[s].length; });
    return { cols, counts };
  }

  // هل النشاط مستحق المتابعة اليوم؟ (غير منجز و remind_at <= نهاية اليوم)
  function isDueToday(act, todayIso) {
    if (!act || act.done) return false;
    if (!act.remind_at) return false;
    const d = String(act.remind_at).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= String(todayIso).slice(0, 10);
  }

  // «متابعات اليوم»: المستحقة اليوم أو المتأخرة — مرتبة بالتاريخ ثم النوع
  function followupsToday(activities, todayIso) {
    return (activities || []).filter(a => isDueToday(a, todayIso))
      .sort((a, b) => String(a.remind_at).localeCompare(String(b.remind_at)));
  }

  const pureExports = { LEAD_STATUSES, ACTIVITY_TYPES, normalizeLeadStatus, kanbanColumns, isDueToday, followupsToday };
  Object.assign(g, pureExports);
  if (typeof module !== 'undefined' && module.exports) module.exports = pureExports;

  /* ═══ واجهة المستخدم (متصفح فقط) ═══ */
  if (typeof document === 'undefined') return;

  const $id = (x) => document.getElementById(x);
  const _today = () => new Date().toISOString().slice(0, 10);
  let _leads = [];

  g.switchCrmSub = (sub) => {
    document.querySelectorAll('#tab-crm .sub-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.sub === sub));
    ['board', 'followups'].forEach(p => {
      const el = $id('crm-pane-' + p);
      if (el) el.classList.toggle('hidden', p !== sub);
    });
    if (sub === 'board') loadLeads();
    else loadFollowups();
  };

  const stLabel = (s) => t('crm_st_' + normalizeLeadStatus(s));
  const atLabel = (a) => t('crm_at_' + (ACTIVITY_TYPES.includes(a) ? a : 'call'));

  /* ─── لوحة الـ kanban ─── */
  async function loadLeads() {
    const { data, error } = await sb.from('crm_leads').select('*').order('created_at', { ascending: false });
    if (error) {
      $id('crm-board').innerHTML = `<div class="logo-note" style="color:var(--red)">${t('crm_need_sql')}</div>`;
      return;
    }
    _leads = data || [];
    const { cols, counts } = kanbanColumns(_leads);
    // عدّادات علوية
    $id('crm-counters').innerHTML = LEAD_STATUSES.map(s =>
      `<span class="card" style="padding:8px 14px;display:inline-block;margin:2px">
        <b>${counts[s]}</b> — ${stLabel(s)}</span>`).join('');
    // الأعمدة
    $id('crm-board').innerHTML = LEAD_STATUSES.map(s => `
      <div class="report-box" style="min-width:200px;flex:1;border:1px solid var(--line);border-radius:10px;padding:10px">
        <h4 style="margin:0 0 8px">${stLabel(s)} (${counts[s]})</h4>
        ${cols[s].map(l => `
          <div style="border:1px solid var(--line);border-radius:8px;padding:8px;margin-bottom:6px;background:var(--bg)">
            <b>${esc(l.name)}</b>${l.phone ? `<br><span dir="ltr">${esc(l.phone)}</span>` : ''}
            ${l.source ? `<br><small>${esc(l.source)}</small>` : ''}
            <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">
              <button class="btn btn-sm" onclick="crmLeadForm('${l.id}')">${t('btn_edit')}</button>
              <button class="btn btn-sm" onclick="crmActivityForm('${l.id}')">${t('crm_add_activity')}</button>
              ${s !== 'converted' && s !== 'lost'
                ? `<button class="btn btn-sm btn-gold" onclick="crmConvertLead('${l.id}')">${t('crm_convert')}</button>`
                : ''}
            </div>
          </div>`).join('') || `<small style="color:#7A6A5C">${t('crm_empty_col')}</small>`}
      </div>`).join('');
  }
  g.loadLeads = loadLeads;

  /* ─── نموذج lead (إضافة/تعديل) ─── */
  g.crmLeadForm = (id) => {
    const l = id ? _leads.find(x => x.id === id) : null;
    openModal(`
      <h3>${l ? t('crm_edit_lead') : t('crm_new_lead')}</h3>
      <label>${t('crm_name')}</label><input id="lead-name" value="${l ? esc(l.name) : ''}">
      <label>${t('crm_phone')}</label><input id="lead-phone" dir="ltr" value="${l ? esc(l.phone || '') : ''}">
      <label>${t('crm_source')}</label><input id="lead-source" value="${l ? esc(l.source || '') : ''}">
      <label>${t('crm_status')}</label>
      <select id="lead-status">${LEAD_STATUSES.map(s =>
        `<option value="${s}" ${l && l.status === s ? 'selected' : ''}>${stLabel(s)}</option>`).join('')}</select>
      <label>${t('mf_notes')}</label><textarea id="lead-notes" rows="2">${l ? esc(l.notes || '') : ''}</textarea>
      <div class="modal-actions">
        <button class="btn btn-gold" id="lead-save">${t('btn_save')}</button>
        ${l && l.status !== 'converted' ? `<button class="btn btn-danger" id="lead-del">${t('btn_delete')}</button>` : ''}
        <button class="btn" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);
    $id('lead-save').onclick = async () => {
      const name = $id('lead-name').value.trim();
      if (!name) return toast(t('crm_name_req'), false);
      const rec = {
        name, phone: $id('lead-phone').value.trim() || null,
        source: $id('lead-source').value.trim() || null,
        status: normalizeLeadStatus($id('lead-status').value),
        notes: $id('lead-notes').value.trim() || null,
      };
      const r = l
        ? await sb.from('crm_leads').update(rec).eq('id', l.id)
        : await sb.from('crm_leads').insert({ ...rec, tenant_id: state.tenant });
      if (r.error) return toast(t('msg_error') + ': ' + r.error.message, false);
      closeModal(); toast(t('msg_saved'));
      loadLeads();
    };
    const del = $id('lead-del');
    if (del) del.onclick = async () => {
      if (!confirm(t('crm_delete_confirm'))) return;
      await sb.from('crm_activities').delete().eq('lead_id', l.id);
      const { error } = await sb.from('crm_leads').delete().eq('id', l.id);
      if (error) return toast(t('msg_error') + ': ' + error.message, false);
      closeModal(); toast(t('msg_deleted'));
      loadLeads();
    };
  };

  /* ─── نموذج نشاط متابعة ─── */
  g.crmActivityForm = (leadId) => {
    const l = _leads.find(x => x.id === leadId);
    openModal(`
      <h3>${t('crm_add_activity')} — ${esc(l ? l.name : '')}</h3>
      <label>${t('crm_act_type')}</label>
      <select id="act-type">${ACTIVITY_TYPES.map(a =>
        `<option value="${a}">${atLabel(a)}</option>`).join('')}</select>
      <label>${t('crm_act_note')}</label><textarea id="act-note" rows="2"></textarea>
      <label>${t('crm_remind_at')}</label><input id="act-remind" type="date" value="${_today()}">
      <div class="modal-actions">
        <button class="btn btn-gold" id="act-save">${t('btn_save')}</button>
        <button class="btn" onclick="closeModal()">${t('btn_cancel')}</button>
      </div>`);
    $id('act-save').onclick = async () => {
      const { error } = await sb.from('crm_activities').insert({
        tenant_id: state.tenant, lead_id: leadId,
        type: $id('act-type').value,
        note: $id('act-note').value.trim() || null,
        remind_at: $id('act-remind').value || null,
      });
      if (error) return toast(t('msg_error') + ': ' + error.message, false);
      closeModal(); toast(t('msg_saved'));
    };
  };

  /* ─── تحويل Lead إلى عميل فعلي ─── */
  g.crmConvertLead = async (id) => {
    const l = _leads.find(x => x.id === id);
    if (!l || l.status === 'converted') return;
    if (!confirm(t('crm_convert_confirm') + ': ' + l.name)) return;
    const { data: party, error } = await sb.from('parties').insert({
      tenant_id: state.tenant, kind: 'customer', name: l.name, phone: l.phone || null,
    }).select('id').single();
    if (error) return toast(t('msg_error') + ': ' + error.message, false);
    const { error: e2 } = await sb.from('crm_leads')
      .update({ status: 'converted', converted_party_id: party.id }).eq('id', id);
    if (e2) return toast(t('msg_error') + ': ' + e2.message, false);
    toast(t('crm_converted'));
    if (typeof loadParties === 'function') loadParties();
    loadLeads();
  };

  /* ─── متابعات اليوم ─── */
  async function loadFollowups() {
    const { data, error } = await sb.from('crm_activities')
      .select('*, crm_leads(name)').order('remind_at');
    if (error) {
      $id('tbl-followups').innerHTML = `<tr><td colspan="6" style="color:var(--red)">${t('crm_need_sql')}</td></tr>`;
      return;
    }
    const due = followupsToday(data || [], _today());
    $id('tbl-followups').innerHTML = due.map(a => `<tr>
      <td>${esc((a.crm_leads && a.crm_leads.name) || '—')}</td>
      <td>${atLabel(a.type)}</td>
      <td>${esc(a.note || '—')}</td>
      <td>${String(a.remind_at).slice(0, 10)}</td>
      <td>${String(a.remind_at).slice(0, 10) < _today()
        ? `<span style="color:var(--red)">${t('crm_overdue')}</span>`
        : `<span style="color:var(--green)">${t('crm_today')}</span>`}</td>
      <td><button class="btn btn-sm btn-gold" onclick="crmDoneActivity('${a.id}')">${t('crm_mark_done')}</button></td>
    </tr>`).join('') || `<tr><td colspan="6" style="color:#7A6A5C">${t('crm_no_followups')}</td></tr>`;
  }
  g.loadFollowups = loadFollowups;

  g.crmDoneActivity = async (id) => {
    const { error } = await sb.from('crm_activities').update({ done: true }).eq('id', id);
    if (error) return toast(t('msg_error') + ': ' + error.message, false);
    toast(t('msg_saved'));
    loadFollowups();
  };

  g.loadCrmTab = () => switchCrmSub('board');
})(typeof window !== 'undefined' ? window : globalThis);
