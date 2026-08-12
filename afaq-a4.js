/* ═══════════════════════════════════════════════════════════════
   HAZEM.ERP — دفعة v27: قالب طباعة «نموذج آفاق A4» للفاتورة الضريبية
   مبني على قالب متجر درة فارس الشمال (invoice-a4.html) ويعمل داخل
   محرك الطباعة الموجود (#pv-sheet عبر openPrintPreview):
   • هيدر: لوجو+اسم الكيان يمين وQR زاتكا (TLV) شمال.
   • «فاتورة ضريبية / Tax Invoice» + صفّا بيانات البائع/العميل.
   • جدول أصناف 12 عموداً + إجماليات + تفقيط عربي + تاريخ هجري
     (Intl islamic-umalqura) + «الارجاع او الاستبدال بفاتورة فقط»
     + صف توقيعات (أعدت بواسطة/المراجع/المستلم).
   • بيانات البائع من الكيان المختار (entities.js — window.__zentity)
     مع رجوع لبيانات tenants الضريبية.
   ═══════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* ── التفقيط العربي (ريال/هللة) — منقول من قالب المتجر ── */
  const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
    'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر',
    'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const TENS = ['', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const HUNDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة',
    'سبعمائة', 'ثمانمائة', 'تسعمائة'];
  function threeDigits(n, feminine) {
    const parts = [], h = Math.floor(n / 100), r = n % 100;
    if (h) parts.push(HUNDS[h]);
    if (r) {
      const one = r % 10;
      if (feminine && r === 1) parts.push('واحدة');
      else if (feminine && r === 2) parts.push('اثنتان');
      else if (r < 20) parts.push(ONES[r]);
      else if (one === 0) parts.push(TENS[Math.floor(r / 10)]);
      else parts.push(ONES[one] + ' و' + TENS[Math.floor(r / 10)]);
    }
    return parts.join(' و');
  }
  function scaleWord(n, one, two, few, many, feminine) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return threeDigits(n, feminine) + ' ' + few;
    return threeDigits(n, feminine) + ' ' + many;
  }
  function tafqeet(amount) {
    const total = Math.round((Number(amount) || 0) * 100);
    const riyal = Math.floor(total / 100), halala = total % 100;
    const parts = [];
    if (riyal === 0) parts.push('صفر');
    else {
      const groups = [];
      const m = Math.floor(riyal / 1000000), t = Math.floor((riyal % 1000000) / 1000), r = riyal % 1000;
      if (m) groups.push(scaleWord(m, 'مليون', 'مليونان', 'ملايين', 'مليون', false));
      if (t) groups.push(scaleWord(t, 'ألف', 'ألفان', 'آلاف', 'ألفاً', false));
      if (r) groups.push(threeDigits(r, false));
      parts.push(groups.join(' و'));
    }
    let out = 'فقط ' + parts.join('') + ' ريال سعودي';
    if (halala) out += ' و' + threeDigits(halala, true) + ' هللة';
    return out + ' لا غير';
  }
  g.tafqeet = tafqeet;

  /* ── CSS القالب (مرة واحدة) ── */
  function injectCss() {
    if (document.getElementById('a4afaq-css')) return;
    const st = document.createElement('style');
    st.id = 'a4afaq-css';
    st.textContent = `
.a4afaq { --ink:#111827; --line:#9CA3AF; --head:#F3F4F6; color:var(--ink);
  font-family:'Tajawal','Cairo',Tahoma,Arial,sans-serif; direction:rtl; background:#fff; }
.a4afaq * { box-sizing:border-box; }
.a4afaq .hdr { display:flex; justify-content:space-between; align-items:flex-start;
  border-bottom:2.5px solid var(--ink); padding-bottom:8px; }
.a4afaq .hdr .co { text-align:right; }
.a4afaq .hdr .co img { max-height:64px; max-width:180px; display:block; margin-bottom:4px; }
.a4afaq .hdr .co h1 { font-size:20px; margin:0; font-weight:800; }
.a4afaq .hdr .qr { text-align:center; }
.a4afaq .hdr .qr img { display:block; width:110px; height:110px; }
.a4afaq .hdr .qr .cap { font-size:10px; color:#4B5563; margin-top:2px; }
.a4afaq .doctitle { text-align:center; font-size:22px; font-weight:800; margin:10px 0 8px; }
.a4afaq .doctitle small { font-size:14px; font-weight:500; color:#4B5563; }
.a4afaq .meta { display:flex; gap:8px; margin-bottom:10px; }
.a4afaq .meta .col { flex:1; border:1px solid var(--line); border-radius:6px; overflow:hidden; }
.a4afaq .meta .col h3 { background:var(--head); margin:0; padding:5px 8px; font-size:13px;
  border-bottom:1px solid var(--line); }
.a4afaq .meta .row { display:flex; justify-content:space-between; padding:3px 8px;
  font-size:12px; border-bottom:1px dashed #E5E7EB; }
.a4afaq .meta .row:last-child { border-bottom:0; }
.a4afaq .meta .row span:first-child { color:#4B5563; }
.a4afaq table.items { width:100%; border-collapse:collapse; font-size:11px; }
.a4afaq table.items th, .a4afaq table.items td { border:1px solid var(--line); padding:4px; text-align:center; }
.a4afaq table.items thead th { background:var(--head); font-weight:700; font-size:10.5px; }
.a4afaq table.items td.desc { text-align:right; }
.a4afaq .foot { display:flex; gap:10px; margin-top:10px; align-items:flex-start; }
.a4afaq .tafqeet { flex:1.4; border:1px solid var(--line); border-radius:6px; padding:8px; font-size:12px; min-height:60px; }
.a4afaq .tafqeet h4 { margin:0 0 4px; font-size:12px; color:#4B5563; }
.a4afaq table.totals { flex:1; border-collapse:collapse; font-size:13px; }
.a4afaq table.totals td { border:1px solid var(--line); padding:5px 8px; }
.a4afaq table.totals td:last-child { text-align:center; font-weight:700; min-width:90px; }
.a4afaq table.totals tr.grand td { background:var(--head); font-size:15px; font-weight:800; }
.a4afaq .thanks { text-align:center; margin-top:14px; font-size:12px; color:#4B5563; }
.a4afaq .policy { text-align:center; margin-top:10px; font-size:12px; font-weight:700; color:#374151;
  border-top:1px dashed var(--line); padding-top:10px; }
.a4afaq .signs { display:flex; justify-content:space-between; margin-top:26px; font-size:12px;
  color:#374151; text-align:center; }
.a4afaq .signs div { flex:1; }`;
    document.head.appendChild(st);
  }

  /* ── QR زاتكا: من e_invoices.qr_tlv لو موجود وإلا TLV عميل (وسوم 1-5) ── */
  async function fetchQrTlv(invId) {
    try {
      if (typeof sb === 'undefined' || !sb || !invId) return null;
      const r = await sb.from('e_invoices').select('qr_tlv')
        .or('invoice_id.eq.' + invId + ',sales_invoice_id.eq.' + invId).limit(1).maybeSingle();
      return (r.data && r.data.qr_tlv) || null;
    } catch (e) { return null; }
  }

  /* ── بناء ورقة A4 — a4data: {kind, d, lines, subtotal, taxAmt, gross, priceField} ── */
  g.afaqA4Sheet = async function (a4data) {
    injectCss();
    const { d, lines } = a4data;
    const ent = (typeof g.__zentity === 'function' && g.__zentity()) || {};
    const t0 = (typeof state !== 'undefined' && state.tax) || {};
    const sellerName = ent.name || t0.tax_name || (typeof state !== 'undefined' && state.tenantName) || '—';
    const sellerVat = ent.vat_number || t0.vat_number || '';
    const sellerCr = ent.cr_number || t0.cr_number || '';
    const sellerAddr = ent.address || t0.national_address ||
      [ent.city, ent.district, ent.postal_code].filter(Boolean).join(' — ');
    const logoUrl = ent.logo_url || (typeof state !== 'undefined' && state.logoUrl) || 'logo.png';

    const gross = a4data.gross, taxAmt = a4data.taxAmount ?? a4data.taxAmt, subtotal = a4data.subtotal;
    const dt = d.created_at ? new Date(d.created_at) : new Date();
    const dtStr = dt.toLocaleDateString('ar-SA') + ' ' + dt.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    let hijriStr = '—';
    try {
      hijriStr = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura',
        { day: '2-digit', month: '2-digit', year: 'numeric' }).format(dt);
    } catch (e) { /* ignore */ }

    const priceF = a4data.priceField || 'price';
    const rows = (lines || []).map((l, i) => {
      const qty = Number(l.qty) || 0, price = Number(l[priceF]) || 0;
      const grossL = qty * price;
      const tax = (typeof lineTax === 'function') ? lineTax(grossL, l.tax_category || 'standard')
        : grossL * 15 / 115;
      return { i: i + 1, code: l.items?.sku || l.sku || l.barcode || (i + 1),
        name: l.items?.name || l.name || 'صنف', unit: l.items?.unit || l.unit || 'حبة',
        qty, price, gross: grossL, taxPct: 15, tax, total: grossL };
    });

    // QR: TLV من e_invoices وإلا توليد عميل عبر qr.js
    let tlv = await fetchQrTlv(d.id);
    if (!tlv && typeof zatcaTLV === 'function' && sellerVat) {
      try { tlv = zatcaTLV({ seller: sellerName, vat: sellerVat, timestamp: dt.toISOString(), total: gross, tax: taxAmt }); } catch (e) { tlv = null; }
    }
    let qrImg = '';
    if (tlv && typeof qrDataUrl === 'function') {
      try { qrImg = qrDataUrl(tlv, 5); } catch (e) { qrImg = ''; }
    }

    let html = '<div class="a4afaq">';
    html += '<div class="hdr"><div class="co">' +
      (logoUrl ? '<img src="' + esc(logoUrl) + '" alt="">' : '') +
      '<h1>' + esc(sellerName) + '</h1></div>' +
      '<div class="qr">' + (qrImg ? '<img src="' + qrImg + '" alt="QR">' : '') +
      '<div class="cap">رمز التحقق — زاتكا</div></div></div>';
    html += '<div class="doctitle">فاتورة ضريبية <small>/ Tax Invoice</small></div>';
    html += '<div class="meta"><div class="col"><h3>بيانات البائع</h3>' +
      '<div class="row"><span>الفرع</span><b>' + esc(ent.branch_name || 'الرئيسي') + '</b></div>' +
      '<div class="row"><span>العنوان</span><b>' + esc(sellerAddr || '—') + '</b></div>' +
      '<div class="row"><span>الرقم الضريبي</span><b dir="ltr">' + esc(sellerVat || '—') + '</b></div>' +
      '<div class="row"><span>السجل التجاري</span><b dir="ltr">' + esc(sellerCr || '—') + '</b></div>' +
      '<div class="row"><span>رقم الفاتورة</span><b>' + esc(d.number) + '</b></div>' +
      '<div class="row"><span>التاريخ</span><b>' + esc(dtStr) + '</b></div>' +
      '<div class="row"><span>التاريخ هجري</span><b>' + esc(hijriStr) + '</b></div>' +
      '</div>';
    html += '<div class="col"><h3>بيانات العميل</h3>' +
      '<div class="row"><span>العميل</span><b>' + esc(d.parties?.name || 'عميل نقدي') + '</b></div>' +
      '<div class="row"><span>الجوال</span><b dir="ltr">' + esc(d.parties?.phone || '—') + '</b></div>' +
      '<div class="row"><span>العنوان</span><b>' + esc(d.parties?.address || '—') + '</b></div>' +
      '<div class="row"><span>الرقم الضريبي</span><b dir="ltr">' + esc(d.buyer_vat_number || d.parties?.vat_number || '—') + '</b></div>' +
      '<div class="row"><span>السجل التجاري</span><b dir="ltr">' + esc(d.parties?.cr_number || '—') + '</b></div>' +
      '</div></div>';
    html += '<table class="items"><thead><tr>' +
      '<th>م</th><th>كود الصنف</th><th>الوصف</th><th>الوحدة</th><th>الكمية</th>' +
      '<th>سعر الوحدة</th><th>إجمالي المبلغ</th><th>نسبة خصم</th><th>خصم</th>' +
      '<th>نسبة الضريبة</th><th>ضريبة القيمة المضافة</th><th>الإجمالي</th>' +
      '</tr></thead><tbody>';
    rows.forEach(r => {
      html += '<tr><td>' + r.i + '</td><td dir="ltr">' + esc(r.code) + '</td>' +
        '<td class="desc">' + esc(r.name) + '</td><td>' + esc(r.unit) + '</td><td>' + r.qty + '</td>' +
        '<td>' + money(r.price) + '</td><td>' + money(r.gross) + '</td>' +
        '<td>—</td><td>—</td><td>' + r.taxPct + '%</td><td>' + money(r.tax) + '</td>' +
        '<td><b>' + money(r.total) + '</b></td></tr>';
    });
    html += '</tbody></table>';
    html += '<div class="foot">' +
      '<div class="tafqeet"><h4>المبلغ كتابةً (التفقيط)</h4><b>' + esc(tafqeet(gross)) + '</b></div>' +
      '<table class="totals">' +
      '<tr><td>الإجمالي قبل الضريبة</td><td>' + money(subtotal) + '</td></tr>' +
      '<tr><td>الخصم</td><td>' + money(0) + '</td></tr>' +
      '<tr><td>ضريبة القيمة المضافة (15%)</td><td>' + money(taxAmt) + '</td></tr>' +
      '<tr class="grand"><td>الإجمالي النهائي</td><td>' + money(gross) + ' ر.س</td></tr>' +
      '</table></div>';
    html += '<div class="thanks">شكراً لتعاملكم معنا — هذه الفاتورة صادرة إلكترونياً ولا تحتاج توقيعاً أو ختماً</div>';
    html += '<div class="policy">الارجاع او الاستبدال بفاتورة فقط</div>';
    html += '<div class="signs"><div>أعدت بواسطة<br><br>....................</div>' +
      '<div>المراجع<br><br>....................</div>' +
      '<div>المستلم<br><br>....................</div></div>';
    html += '</div>';
    return html;
  };
})(typeof window !== 'undefined' ? window : globalThis);
