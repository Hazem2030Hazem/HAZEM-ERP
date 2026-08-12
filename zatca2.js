/* ═══════════════════════════════════════════════════════════════
   HAZEM.ERP — المرحلة 17: زاتكا الجيل الثاني (الربط والتكامل)
   ─────────────────────────────────────────────────────────────
   قرارات التنفيذ الموثقة (المستوى المطبق فعلياً client-side):
   • توليد XML فاتورة UBL 2.1 (ZATCA subset) نقي بلا مكتبات:
     UBLVersionID 2.1، ProfileID reporting:1.0، UUID v4، InvoiceTypeCode
     388 (فاتورة) / 381 (إشعار دائن) مع name سباعي (01xxxxx قياسية B2B /
     02xxxxx مبسطة B2C)، TaxTotal لكل تصنيف (S/Z/E/O) و LegalMonetaryTotal.
   • أسعار النظام «شاملة الضريبة» (انظر vat.js) — لذلك تُعرض مبالغ XML
     صافية: LineExtensionAmount = الإجمالي − الضريبة المستخرجة بـ lineTax.
   • مستوى التوحيد (canonicalization) المطبق — مستوى مبسط موثّق:
     إزالة تعريف XML <?xml ...?> + إزالة المسافات البيضاء بين الوسوم
     (><) + trim الأطراف، ثم SHA-256 base64. لا نطبق C14N الكامل لأن
     XML الذي نولّده أصلاً حتمي البنية (لا توقيعات مضمّنة ولا namespaces زائدة).
   • سلسلة الهاش: كل فاتورة إلكترونية تُخزن مع uuid + invoice_hash + pih
     (هاش آخر فاتورة للشركة؛ أول فاتورة تستخدم هاش زاتكا الأساسي النظامي:
     base64(SHA-256("")) = "NWoiy...JRI=" — المعروف بـ BASE64 of zero hash
     لدى زاتكا للفاتورة الأولى).
   • التوقيع الرقمي: زوج مفاتيح ECDSA P-256 عبر Web Crypto يُخزَّن محلياً
     في localStorage بصيغة base64 — ⚠️ هذا للبيئة التجريبية (Sandbox/
     Simulation) فقط. الإنتاج يتطلب شهادة زاتكا CSID رسمية من منصة فاتورة
     واستبدال المفتاح العام بالشهادة (Tag 8 يبقى بنفس البنية).
   • QR الجيل الثاني: TLV موسّع (Tags 6=هاش الفاتورة، 7=توقيع ECDSA،
     8=المفتاح العام) — ترقية اختيارية تُفعَّل من إعدادات الجيل الثاني،
     ولا تكسر QR الجيل الأول (الافتراضي يبقى Tags 1-5).
   • الإرسال (Reporting/Clearance): fetch مباشر بـ Basic auth (CSID:secret)
     — غالباً سيرفضه CORS من خوادم زاتكا؛ لذلك جهّزنا Edge Function
     (edge-function-report-invoice.ts) وسيطاً، ورسالة فشل CORS إرشادية.
   يعمل في المتصفح و Node (الدوال النقية للاختبارات) بلا build step.
   ═══════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';

  // ─── أدوات تشفير أساسية (Base64/UTF-8 آمنة يونيكود) ───
  function _u8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(s));
    return Uint8Array.from(Buffer.from(String(s), 'utf8'));
  }
  function b64encode(str) {
    const bytes = _u8(str);
    if (typeof btoa !== 'undefined') {
      let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b));
      return btoa(bin);
    }
    return Buffer.from(bytes).toString('base64');
  }
  function b64decode(b64) {
    if (typeof atob !== 'undefined') {
      const bin = atob(b64); const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return Buffer.from(b64, 'base64').toString('utf8');
  }
  function b64FromBytes(bytes) {
    if (typeof btoa !== 'undefined') {
      let bin = ''; new Uint8Array(bytes).forEach(b => bin += String.fromCharCode(b));
      return btoa(bin);
    }
    return Buffer.from(bytes).toString('base64');
  }
  function bytesFromB64(b64) {
    if (typeof atob !== 'undefined') {
      const bin = atob(b64); return Uint8Array.from(bin, c => c.charCodeAt(0));
    }
    return Uint8Array.from(Buffer.from(b64, 'base64'));
  }

  // ─── تهريب XML entities ───
  function xmlEscape(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  // ─── UUID v4 ───
  function uuidV4() {
    const b = new Uint8Array(16);
    if (g.crypto && g.crypto.getRandomValues) g.crypto.getRandomValues(b);
    else { const c = require('crypto').randomBytes(16); b.set(c); }
    b[6] = (b[6] & 0x0f) | 0x40; // الإصدار 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant RFC4122
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // ─── SHA-256 (Web Crypto أو node:crypto) ───
  async function _sha256(bytes) {
    if (g.crypto && g.crypto.subtle) {
      const d = await g.crypto.subtle.digest('SHA-256', bytes);
      return new Uint8Array(d);
    }
    const c = require('crypto');
    return Uint8Array.from(c.createHash('sha256').update(Buffer.from(bytes)).digest());
  }
  async function sha256B64(str) { return b64FromBytes(await _sha256(_u8(str))); }
  async function sha256Hex(str) {
    return [...await _sha256(_u8(str))].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // PIH الابتدائي لأول فاتورة: base64(SHA-256('')) — قيمة زاتكا الموثقة للفاتورة الأولى
  const FIRST_PIH = 'NWoiy3O8DJzZGt0KmZlNDY5MzA0OGVkYTJmNWVlNDBkNDkyN2ZiN2QzM2YyNWM5YjE2Njc5OWY2YzY5NjkzYzk=';

  // مستوى التوحيد المبسط الموثّق (انظر ترويسة الملف)
  function canonicalizeForHash(xml) {
    return String(xml)
      .replace(/<\?xml[^?]*\?>/, '')   // إزالة التعريف
      .replace(/>\s+</g, '><')          // المسافات بين الوسوم
      .trim();
  }
  async function computeInvoiceHash(xml) { return sha256B64(canonicalizeForHash(xml)); }

  // ─── رموز زاتكا ───
  const TAX_SCHEME = { standard: 'S', zero: 'Z', exempt: 'E', out_of_scope: 'O' };
  const TYPE_NAME = { standard: '0100000', simplified: '0200000' }; // InvoiceTypeCode/@name
  const _r2 = (g.r2) || ((n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100);
  const _lineTax = (g.lineTax) || require('./vat.js').lineTax;
  const m2 = (n) => _r2(n).toFixed(2);

  // ─── ١) توليد XML الفاتورة (UBL 2.1 / ZATCA subset) ───
  // opts: { number, uuid, issueDate 'YYYY-MM-DD', issueTime 'HH:MM:SS',
  //         docType '388'|'381', subType 'standard'|'simplified', icv,
  //         pih, seller {name, vat, cr, address}, buyer {name, vat}|null,
  //         lines [{name, qty, price(شامل), tax_category}], billingRef }
  function buildInvoiceXml(opts) {
    const o = opts || {};
    const cur = 'SAR';
    const docType = o.docType === '381' ? '381' : '388';
    const subType = o.subType === 'standard' ? 'standard' : 'simplified';
    const typeName = TYPE_NAME[subType];
    const s = o.seller || {};
    const lines = (o.lines || []).map((l, i) => {
      const qty = Number(l.qty) || 0;
      const gross = qty * (Number(l.price) || 0);
      const cat = TAX_SCHEME[l.tax_category] ? l.tax_category : 'standard';
      const tax = _lineTax(gross, cat);
      return { id: i + 1, name: l.name || '—', qty, gross, cat, tax,
               net: _r2(gross - tax), unitNet: qty ? _r2((gross - tax) / qty) : 0 };
    });
    // تجميع لكل تصنيف ضريبي
    const cats = {};
    lines.forEach(l => {
      const c = cats[l.cat] = cats[l.cat] || { net: 0, tax: 0, pct: l.cat === 'standard' ? 15 : 0 };
      c.net = _r2(c.net + l.net); c.tax = _r2(c.tax + l.tax);
    });
    const totalNet = _r2(lines.reduce((a, l) => a + l.net, 0));
    const totalTax = _r2(lines.reduce((a, l) => a + l.tax, 0));
    const totalGross = _r2(totalNet + totalTax);

    const partyAddress = (addr) => `
        <cac:PostalAddress>
          <cbc:StreetName>${xmlEscape(addr || '—')}</cbc:StreetName>
          <cbc:CitySubdivisionName>—</cbc:CitySubdivisionName>
          <cbc:CityName>—</cbc:CityName>
          <cbc:PostalZone>00000</cbc:PostalZone>
          <cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country>
        </cac:PostalAddress>`;

    const supplier = `
      <cac:AccountingSupplierParty>
        <cac:Party>${partyAddress(s.address)}
          <cac:PartyTaxScheme>
            <cbc:CompanyID>${xmlEscape(s.vat || '')}</cbc:CompanyID>
            <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
          </cac:PartyTaxScheme>
          <cac:PartyLegalEntity>
            <cbc:RegistrationName>${xmlEscape(s.name || '')}</cbc:RegistrationName>
            ${s.cr ? `<cbc:CompanyID schemeID="CR">${xmlEscape(s.cr)}</cbc:CompanyID>` : ''}
          </cac:PartyLegalEntity>
        </cac:Party>
      </cac:AccountingSupplierParty>`;

    // طرف العميل: لفواتير B2B (القياسية) عند توفر الرقم الضريبي للمشتري
    const b = o.buyer;
    const customer = `
      <cac:AccountingCustomerParty>
        <cac:Party>${partyAddress(b && b.address)}
          ${b && b.vat ? `<cac:PartyTaxScheme>
            <cbc:CompanyID>${xmlEscape(b.vat)}</cbc:CompanyID>
            <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
          </cac:PartyTaxScheme>` : ''}
          <cac:PartyLegalEntity>
            <cbc:RegistrationName>${xmlEscape((b && b.name) || 'عميل نقدي')}</cbc:RegistrationName>
          </cac:PartyLegalEntity>
        </cac:Party>
      </cac:AccountingCustomerParty>`;

    const taxSubtotals = Object.keys(cats).map(cat => `
        <cac:TaxSubtotal>
          <cbc:TaxableAmount currencyID="${cur}">${m2(cats[cat].net)}</cbc:TaxableAmount>
          <cbc:TaxAmount currencyID="${cur}">${m2(cats[cat].tax)}</cbc:TaxAmount>
          <cac:TaxCategory>
            <cbc:ID>${TAX_SCHEME[cat]}</cbc:ID>
            <cbc:Percent>${cats[cat].pct.toFixed(2)}</cbc:Percent>
            <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
          </cac:TaxCategory>
        </cac:TaxSubtotal>`).join('');

    const xmlLines = lines.map(l => `
      <cac:InvoiceLine>
        <cbc:ID>${l.id}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="PCE">${m2(l.qty)}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="${cur}">${m2(l.net)}</cbc:LineExtensionAmount>
        <cac:TaxTotal>
          <cbc:TaxAmount currencyID="${cur}">${m2(l.tax)}</cbc:TaxAmount>
          <cbc:RoundingAmount currencyID="${cur}">${m2(l.gross)}</cbc:RoundingAmount>
        </cac:TaxTotal>
        <cac:Item>
          <cbc:Name>${xmlEscape(l.name)}</cbc:Name>
          <cac:ClassifiedTaxCategory>
            <cbc:ID>${TAX_SCHEME[l.cat]}</cbc:ID>
            <cbc:Percent>${(l.cat === 'standard' ? 15 : 0).toFixed(2)}</cbc:Percent>
            <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
          </cac:ClassifiedTaxCategory>
        </cac:Item>
        <cac:Price>
          <cbc:PriceAmount currencyID="${cur}">${m2(l.unitNet)}</cbc:PriceAmount>
        </cac:Price>
      </cac:InvoiceLine>`).join('');

    const billingRef = (docType === '381' && o.billingRef) ? `
      <cac:BillingReference>
        <cac:InvoiceDocumentReference><cbc:ID>${xmlEscape(o.billingRef)}</cbc:ID></cac:InvoiceDocumentReference>
      </cac:BillingReference>` : '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${xmlEscape(String(o.number || '1'))}</cbc:ID>
  <cbc:UUID>${xmlEscape(o.uuid || uuidV4())}</cbc:UUID>
  <cbc:IssueDate>${xmlEscape(o.issueDate || new Date().toISOString().slice(0, 10))}</cbc:IssueDate>
  <cbc:IssueTime>${xmlEscape(o.issueTime || '00:00:00')}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${typeName}">${docType}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>${cur}</cbc:TaxCurrencyCode>
  <cbc:LineCountNumeric>${lines.length}</cbc:LineCountNumeric>${billingRef}
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>${Number(o.icv) || 1}</cbc:UUID>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${xmlEscape(o.pih || FIRST_PIH)}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>
  </cac:AdditionalDocumentReference>
  ${supplier}
  ${customer}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${cur}">${m2(totalTax)}</cbc:TaxAmount>${taxSubtotals}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${cur}">${m2(totalNet)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${cur}">${m2(totalNet)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${cur}">${m2(totalGross)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${cur}">${m2(totalGross)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${xmlLines}
</Invoice>`;
  }

  // ─── ٢) TLV الجيل الثاني (Tags 1-8) — ترقية اختيارية فوق الجيل الأول ───
  // 6 = هاش الفاتورة (base64)، 7 = توقيع ECDSA (base64 DER)، 8 = المفتاح العام (base64 SPKI)
  function zatcaTLVP2({ seller, vat, timestamp, total, tax, hash, signature, pubkey }) {
    const tlv = g.tlvEncode || require('./qr.js').tlvEncode;
    const pairs = [[1, seller], [2, vat], [3, timestamp], [4, total], [5, tax]];
    if (hash) pairs.push([6, hash]);
    if (signature) pairs.push([7, signature]);
    if (pubkey) pairs.push([8, pubkey]);
    return b64FromBytes(tlv(pairs));
  }

  // ─── ٣) توقيع رقمي ECDSA P-256 (Web Crypto) — بيئة تجريبية موثقة ───
  async function generateP2KeyPair() {
    if (!(g.crypto && g.crypto.subtle)) throw new Error('Web Crypto API غير متاحة');
    const kp = await g.crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const priv = await g.crypto.subtle.exportKey('pkcs8', kp.privateKey);
    const pub = await g.crypto.subtle.exportKey('spki', kp.publicKey);
    return { privateKeyB64: b64FromBytes(priv), publicKeyB64: b64FromBytes(pub) };
  }
  async function _importPriv(b64) {
    return g.crypto.subtle.importKey('pkcs8', bytesFromB64(b64),
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  async function _importPub(b64) {
    return g.crypto.subtle.importKey('spki', bytesFromB64(b64),
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  }
  // توقيع هاش الفاتورة (الهاش base64 → بايتات → توقيع DER base64)
  async function signInvoiceHash(hashB64, privateKeyB64) {
    const key = await _importPriv(privateKeyB64);
    const sig = await g.crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, key, bytesFromB64(hashB64));
    return b64FromBytes(sig);
  }
  async function verifyInvoiceHash(hashB64, sigB64, publicKeyB64) {
    const key = await _importPub(publicKeyB64);
    return g.crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key,
      bytesFromB64(sigB64), bytesFromB64(hashB64));
  }

  // ─── ٤) حزمة الإرسال (Reporting/Clearance API) ───
  function buildReportingPayload(xml, invoiceHash, uuid) {
    return { invoiceHash, uuid, invoice: b64encode(xml) };
  }
  // إرسال فعلي — Basic auth (CSID:secret). رمي TypeError(fetch failed) = CORS غالباً
  async function submitInvoice({ endpoint, csid, secret, payload }) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Version': 'V2',
        'Authorization': 'Basic ' + b64encode((csid || '') + ':' + (secret || '')),
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* نص خام */ }
    return { ok: res.ok, status: res.status, body: json || text };
  }

  // تصدير الدوال النقية (متصفح + Node)
  const api = { xmlEscape, uuidV4, b64encode, b64decode, b64FromBytes, bytesFromB64,
    sha256B64, sha256Hex, FIRST_PIH, canonicalizeForHash, computeInvoiceHash,
    TAX_SCHEME, TYPE_NAME, buildInvoiceXml, zatcaTLVP2,
    generateP2KeyPair, signInvoiceHash, verifyInvoiceHash,
    buildReportingPayload, submitInvoice };
  Object.keys(api).forEach(k => { g[k] = api[k]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);


/* ═══════════════════════════════════════════════════════════════
   الجزء الثاني — ربط قاعدة البيانات والواجهة (متصفح فقط)
   جدول e_invoices + أعمدة إعدادات الجيل الثاني على tenants
   (تُنشأ عبر hazem-zatca-p2.sql). كل شيء بتدرّج آمن: لو لم يُنفَّذ
   الـ SQL تظهر رسالة إرشادية بدل كسر التطبيق.
   ═══════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';
  if (typeof document === 'undefined') return; // Node: الدوال النقية فقط

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  // كاش TLV الجيل الثاني لكل فاتورة (يملأ عند التوليد/التحميل) — يستخدمه app.js
  g.__p2tlv = g.__p2tlv || {};

  const P2_COLS = 'zatca_p2_enabled, zatca_env, zatca_compliance_url, zatca_reporting_url, zatca_clearance_url, zatca_csid, zatca_secret';
  const ENV_URLS = {
    sandbox: {
      compliance: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/compliance',
      reporting: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/invoices/reporting/single',
      clearance: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/invoices/clearance/single',
    },
    simulation: {
      compliance: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/compliance',
      reporting: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/invoices/reporting/single',
      clearance: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/invoices/clearance/single',
    },
    production: {
      compliance: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core/compliance',
      reporting: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core/invoices/reporting/single',
      clearance: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core/invoices/clearance/single',
    },
  };

  // ─── تحميل إعدادات الجيل الثاني من tenants (تدرّج آمن) ───
  async function loadP2Settings() {
    const { data, error } = await sb.from('tenants').select(P2_COLS).eq('id', state.tenant).single();
    if (!error && data) state.zatcaP2 = { ...(state.zatcaP2 || {}), ...data };
    const x = state.zatcaP2 || {};
    if ($('#zp2-enabled')) $('#zp2-enabled').checked = !!x.zatca_p2_enabled;
    if ($('#zp2-env')) {
      $('#zp2-env').value = x.zatca_env || 'sandbox';
      fillEnvUrls();
      $('#zp2-compliance-url').value = x.zatca_compliance_url || '';
      $('#zp2-reporting-url').value = x.zatca_reporting_url || '';
      $('#zp2-clearance-url').value = x.zatca_clearance_url || '';
      $('#zp2-csid').value = x.zatca_csid || '';
      $('#zp2-secret').value = x.zatca_secret || '';
      updateKeyBadge();
    }
  }
  function fillEnvUrls() {
    const env = $('#zp2-env')?.value || 'sandbox';
    const u = ENV_URLS[env] || ENV_URLS.sandbox;
    // الحقول الفارغة فقط تأخذ الافتراضي (لا ندهس تخصيص المستخدم)
    if ($('#zp2-compliance-url') && !$('#zp2-compliance-url').value) $('#zp2-compliance-url').placeholder = u.compliance;
    if ($('#zp2-reporting-url') && !$('#zp2-reporting-url').value) $('#zp2-reporting-url').placeholder = u.reporting;
    if ($('#zp2-clearance-url') && !$('#zp2-clearance-url').value) $('#zp2-clearance-url').placeholder = u.clearance;
  }
  g.zp2FillEnvUrls = fillEnvUrls;
  const _env = () => ($('#zp2-env')?.value || 'sandbox');
  const _url = (id, kind) => ($(id)?.value.trim()) || (ENV_URLS[_env()] || ENV_URLS.sandbox)[kind];

  // حفظ الإعدادات
  async function zp2Save() {
    const rec = {
      zatca_p2_enabled: !!$('#zp2-enabled').checked,
      zatca_env: _env(),
      zatca_compliance_url: $('#zp2-compliance-url').value.trim(),
      zatca_reporting_url: $('#zp2-reporting-url').value.trim(),
      zatca_clearance_url: $('#zp2-clearance-url').value.trim(),
      zatca_csid: $('#zp2-csid').value.trim(),
      zatca_secret: $('#zp2-secret').value.trim(),
    };
    const { error } = await sb.from('tenants').update(rec).eq('id', state.tenant);
    if (error) return toast(t('zp2_save_fail') + ': ' + error.message + ' — ' + t('zp2_need_sql'), false);
    state.zatcaP2 = { ...(state.zatcaP2 || {}), ...rec };
    toast(t('zp2_saved'));
    loadEinvoicesList();
  }
  g.zp2Save = zp2Save;

  // ─── مفاتيح التوقيع المحلية (بيئة تجريبية — موثق) ───
  const _keyStore = () => 'hazem_p2_keys_' + state.tenant;
  function p2Keys() {
    try { return JSON.parse(localStorage.getItem(_keyStore()) || 'null'); } catch (e) { return null; }
  }
  async function zp2GenKeys() {
    try {
      const kp = await generateP2KeyPair();
      localStorage.setItem(_keyStore(), JSON.stringify(kp));
      updateKeyBadge();
      toast(t('zp2_keys_ok'));
    } catch (e) { toast(t('zp2_keys_fail') + ': ' + e.message, false); }
  }
  g.zp2GenKeys = zp2GenKeys;
  // ترقية QR الطباعة للجيل الثاني (Tags 6-8) — ترجع TLV الجيل الأول كما هو
  // ما لم يكن P2 مفعّلاً ولهذه الفاتورة فاتورة إلكترونية مولّدة (كاش __p2tlv).
  g.zatcaP2UpgradeTLV = (invoiceId, baseTlv) =>
    (state.zatcaP2 && state.zatcaP2.zatca_p2_enabled && g.__p2tlv[invoiceId])
      ? g.__p2tlv[invoiceId] : baseTlv;
  // إعادة بناء كاش TLV من قاعدة البيانات (لفواتير مولّدة سابقاً — مثلاً بعد إعادة الدخول)
  async function rebuildP2TlvCache() {
    if (!(state.zatcaP2 && state.zatcaP2.zatca_p2_enabled)) return;
    const { data } = await sb.from('e_invoices')
      .select('invoice_id, hash, signature, public_key, created_at').eq('tenant_id', state.tenant);
    const { data: invs } = await sb.from('sales_invoices').select('id, total, tax_amount, created_at');
    const im = {}; (invs || []).forEach(v => { im[v.id] = v; });
    (data || []).forEach(e => {
      const v = im[e.invoice_id]; if (!v) return;
      g.__p2tlv[e.invoice_id] = zatcaTLVP2({
        seller: state.tax.tax_name || state.tenantName || '',
        vat: state.tax.vat_number || '',
        timestamp: new Date(v.created_at).toISOString(),
        total: (Number(v.total) || 0).toFixed(2),
        tax: (Number(v.tax_amount) || 0).toFixed(2),
        hash: e.hash, signature: e.signature, pubkey: e.public_key,
      });
    });
  }
  // نقطة استدعاء من boot في app.js (حارس التعريف هناك)
  g.loadP2SettingsBoot = async () => {
    try {
      if (typeof g.loadTaxSettings === 'function') await g.loadTaxSettings(); // البيانات الضريبية أولاً
      await loadP2Settings();
      await rebuildP2TlvCache();
    } catch (e) { /* تدرّج آمن */ }
  };
  function updateKeyBadge() {
    const el = $('#zp2-key-status'); if (!el) return;
    el.textContent = p2Keys() ? '✅ ' + t('zp2_keys_exist') : '⚠️ ' + t('zp2_keys_none');
  }

  // ─── طلب Compliance CSID (OTP) — قد يرفضه CORS ───
  async function zp2RequestCompliance() {
    const otp = $('#zp2-otp').value.trim();
    if (!/^\d{6}$/.test(otp)) return toast(t('zp2_otp_bad'), false);
    const endpoint = _url('#zp2-compliance-url', 'compliance');
    const csr = $('#zp2-csr').value.trim();
    if (!csr) return toast(t('zp2_csr_needed'), false);
    try {
      const res = await fetch(endpoint + '/compliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json',
                   'Accept-Version': 'V2', 'OTP': otp },
        body: JSON.stringify({ csr }),
      });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch (e) {}
      if (res.ok && json) {
        // استجابة زاتكا: binarySecurityToken (شهادة) + secret
        if (json.binarySecurityToken && !$('#zp2-csid').value) $('#zp2-csid').value = json.binarySecurityToken;
        if (json.secret && !$('#zp2-secret').value) $('#zp2-secret').value = json.secret;
        toast(t('zp2_compliance_ok'));
        $('#zp2-compliance-resp').textContent = JSON.stringify(json, null, 2);
      } else {
        $('#zp2-compliance-resp').textContent = (json && JSON.stringify(json, null, 2)) || text || ('HTTP ' + res.status);
        toast(t('zp2_compliance_fail') + ' (HTTP ' + res.status + ')', false);
      }
    } catch (e) {
      // فشل الشبكة/CORS — رسالة إرشادية واضحة
      openModal(`<h3>⚠️ ${t('zp2_cors_title')}</h3>
        <p style="line-height:2">${t('zp2_cors_msg')}</p>
        <p style="line-height:2;color:#7A6A5C;font-size:13px">${t('zp2_cors_fix')}</p>
        <div class="modal-actions"><button class="btn btn-gold" onclick="closeModal()">${t('btn_ok')}</button></div>`);
    }
  }
  g.zp2RequestCompliance = zp2RequestCompliance;

  // ─── توليد فاتورة إلكترونية من فاتورة مبيعات قائمة ───
  async function zp2Generate(invoiceId) {
    // الفاتورة + البنود
    const { data: inv, error: e1 } = await sb.from('sales_invoices')
      .select('*, parties(name)').eq('id', invoiceId).single();
    if (e1) return toast(e1.message, false);
    const { data: lines } = await sb.from('sales_invoice_lines')
      .select('qty, price, tax_category, items(name)').eq('invoice_id', invoiceId);
    if (!lines || !lines.length) return toast(t('zp2_no_lines'), false);

    // آخر هاش للشركة (سلسلة PIH)
    const { data: last } = await sb.from('e_invoices')
      .select('hash').eq('tenant_id', state.tenant)
      .order('created_at', { ascending: false }).limit(1);
    const pih = (last && last[0] && last[0].hash) || FIRST_PIH;

    const dt = new Date(inv.created_at);
    const uuid = uuidV4();
    const xml = buildInvoiceXml({
      number: String(inv.number), uuid,
      issueDate: dt.toISOString().slice(0, 10),
      issueTime: dt.toISOString().slice(11, 19),
      docType: '388',
      subType: inv.invoice_type === 'standard' ? 'standard' : 'simplified',
      icv: Number(inv.number) || 1, pih,
      seller: { name: state.tax.tax_name || state.tenantName, vat: state.tax.vat_number,
                cr: state.tax.cr_number, address: state.tax.national_address },
      buyer: inv.invoice_type === 'standard'
        ? { name: inv.parties?.name, vat: inv.buyer_vat_number } : null,
      lines: lines.map(l => ({ name: l.items?.name, qty: l.qty, price: l.price, tax_category: l.tax_category })),
    });
    const hash = await computeInvoiceHash(xml);

    // التوقيع (إن وُجدت مفاتيح محلية)
    const keys = p2Keys();
    let signature = null, pubkey = null;
    if (keys) {
      signature = await signInvoiceHash(hash, keys.privateKeyB64);
      pubkey = keys.publicKeyB64;
    }

    const rec = {
      tenant_id: state.tenant, invoice_id: invoiceId, uuid, xml, hash, pih,
      signature, public_key: pubkey, status: 'draft',
      invoice_number: Number(inv.number) || null,
    };
    const { error: e2 } = await sb.from('e_invoices')
      .upsert(rec, { onConflict: 'tenant_id,invoice_id' });
    if (e2) return toast(t('zp2_gen_fail') + ': ' + e2.message + ' — ' + t('zp2_need_sql'), false);

    // ترقية كاش QR للطباعة (Tags 6-8) عند تفعيل P2
    if (state.zatcaP2?.zatca_p2_enabled) {
      g.__p2tlv[invoiceId] = zatcaTLVP2({
        seller: state.tax.tax_name || state.tenantName || '',
        vat: state.tax.vat_number || '',
        timestamp: dt.toISOString(),
        total: (Number(inv.total) || 0).toFixed(2),
        tax: (Number(inv.tax_amount) || 0).toFixed(2),
        hash, signature, pubkey,
      });
    }
    toast(t('zp2_gen_ok'));
    loadEinvoicesList();
  }
  g.zp2Generate = zp2Generate;

  // ─── تنزيل XML ───
  async function zp2Download(invoiceId) {
    const { data, error } = await sb.from('e_invoices')
      .select('xml, uuid').eq('invoice_id', invoiceId).eq('tenant_id', state.tenant).single();
    if (error || !data) return toast(t('zp2_dl_first'), false);
    const blob = new Blob([data.xml], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'invoice-' + data.uuid + '.xml';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  g.zp2Download = zp2Download;

  // ─── عرض الهاش وسلسلة PIH ───
  async function zp2ShowHash(invoiceId) {
    const { data, error } = await sb.from('e_invoices')
      .select('uuid, hash, pih, status, signature, created_at, api_response')
      .eq('invoice_id', invoiceId).eq('tenant_id', state.tenant).single();
    if (error || !data) return toast(t('zp2_dl_first'), false);
    const row = (k, v) => `<tr><td style="color:#7A6A5C">${k}</td>
      <td dir="ltr" style="text-align:left;word-break:break-all;font-family:monospace;font-size:12px">${v || '—'}</td></tr>`;
    openModal(`<h3>🔐 ${t('zp2_hash_title')}</h3>
      <div class="table-wrap"><table><tbody>
        ${row('UUID', data.uuid)}
        ${row(t('zp2_hash'), data.hash)}
        ${row(t('zp2_pih'), data.pih)}
        ${row(t('zp2_signature'), data.signature)}
        ${row(t('zp2_status'), data.status)}
        ${row(t('inv_date'), new Date(data.created_at).toLocaleString('ar-EG'))}
      </tbody></table></div>
      ${data.api_response ? `<h4>${t('zp2_api_resp')}</h4>
        <pre dir="ltr" style="text-align:left;max-height:180px;overflow:auto;background:#FAF6F1;padding:10px;border-radius:8px;font-size:11px">${JSON.stringify(data.api_response, null, 2)}</pre>` : ''}
      <div class="modal-actions"><button class="btn btn-gold" onclick="closeModal()">${t('btn_close')}</button></div>`);
  }
  g.zp2ShowHash = zp2ShowHash;

  // ─── الإرسال لزاتكا (reporting B2C / clearance B2B) ───
  async function zp2Submit(invoiceId) {
    const { data: ei, error } = await sb.from('e_invoices')
      .select('*').eq('invoice_id', invoiceId).eq('tenant_id', state.tenant).single();
    if (error || !ei) return toast(t('zp2_dl_first'), false);
    const cfg = state.zatcaP2 || {};
    if (!cfg.zatca_csid || !cfg.zatca_secret) return toast(t('zp2_no_csid'), false);
    // نوع المسار: الفاتورة القياسية B2B → clearance، المبسطة B2C → reporting
    const { data: inv } = await sb.from('sales_invoices').select('invoice_type').eq('id', invoiceId).single();
    const isStandard = inv && inv.invoice_type === 'standard';
    const endpoint = _url(isStandard ? '#zp2-clearance-url' : '#zp2-reporting-url',
                          isStandard ? 'clearance' : 'reporting');
    const payload = buildReportingPayload(ei.xml, ei.hash, ei.uuid);
    let result;
    try {
      result = await submitInvoice({ endpoint, csid: cfg.zatca_csid, secret: cfg.zatca_secret, payload });
    } catch (e) {
      await sb.from('e_invoices').update({ status: 'failed',
        api_response: { network_error: String(e) } }).eq('id', ei.id);
      loadEinvoicesList();
      openModal(`<h3>⚠️ ${t('zp2_cors_title')}</h3>
        <p style="line-height:2">${t('zp2_cors_msg')}</p>
        <p style="line-height:2;color:#7A6A5C;font-size:13px">${t('zp2_cors_fix')}</p>
        <div class="modal-actions"><button class="btn btn-gold" onclick="closeModal()">${t('btn_ok')}</button></div>`);
      return;
    }
    const status = result.ok ? (isStandard ? 'cleared' : 'reported') : 'failed';
    await sb.from('e_invoices').update({ status, api_response: result }).eq('id', ei.id);
    toast(result.ok ? t('zp2_submit_ok') : t('zp2_submit_fail') + ' (HTTP ' + result.status + ')', result.ok);
    loadEinvoicesList();
  }
  g.zp2Submit = zp2Submit;

  // ─── قائمة الفواتير الإلكترونية (كل فواتير المبيعات + حالتها الإلكترونية) ───
  async function loadEinvoicesList() {
    const tb = $('#tbl-einvoices'); if (!tb) return;
    const { data: invs } = await sb.from('sales_invoices')
      .select('id, number, created_at, total, invoice_type, parties(name)')
      .order('number', { ascending: false }).limit(100);
    const { data: eis, error } = await sb.from('e_invoices')
      .select('invoice_id, uuid, hash, status').eq('tenant_id', state.tenant);
    if (error) {
      tb.innerHTML = '<tr><td colspan="7" style="color:#B42318">' + t('zp2_need_sql_msg') + '</td></tr>';
      return;
    }
    const map = {}; (eis || []).forEach(e => { map[e.invoice_id] = e; });
    const statusLbl = (s) => ({
      draft: t('zp2_st_draft'), reported: t('zp2_st_reported'),
      cleared: t('zp2_st_cleared'), failed: t('zp2_st_failed') }[s] || '—');
    const statusColor = { draft: '#7A6A5C', reported: '#166534', cleared: '#166534', failed: '#B42318' };
    tb.innerHTML = (invs || []).map(v => {
      const e = map[v.id];
      const typeLbl = v.invoice_type === 'standard' ? t('zp2_type_std') : t('zp2_type_simp');
      return `<tr>
        <td>${v.number}</td>
        <td>${new Date(v.created_at).toLocaleDateString('ar-EG')}</td>
        <td>${typeLbl}</td>
        <td>${fmt(v.total)}</td>
        <td>${e ? `<b style="color:${statusColor[e.status] || '#7A6A5C'}">${statusLbl(e.status)}</b>` : '<span style="color:#7A6A5C">—</span>'}</td>
        <td dir="ltr" style="font-family:monospace;font-size:11px">${e ? String(e.hash || '').slice(0, 14) + '…' : '—'}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-gold btn-sm" onclick="zp2Generate('${v.id}')">⚡ ${t('zp2_gen_btn')}</button>
          ${e ? `<button class="btn btn-ghost btn-sm" onclick="zp2Download('${v.id}')">📥 XML</button>
          <button class="btn btn-ghost btn-sm" onclick="zp2ShowHash('${v.id}')">🔐</button>
          <button class="btn btn-ghost btn-sm" onclick="zp2Submit('${v.id}')">${e.status === 'failed' ? '🔁' : '📤'} ${t('zp2_send_btn')}</button>` : ''}
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" style="color:#7A6A5C">' + t('zp2_empty') + '</td></tr>';
  }

  // ─── تبديل التابات الفرعية ───
  g.switchZp2Sub = (sub) => {
    $$('#tab-einvoices .sub-tab').forEach(b => b.classList.toggle('active', b.dataset.sub === sub));
    $$('#tab-einvoices [id^="zp2-pane-"]').forEach(p => p.classList.add('hidden'));
    $('#zp2-pane-' + sub)?.classList.remove('hidden');
  };
  $$('#tab-einvoices .sub-tab').forEach(b => b.onclick = () => switchZp2Sub(b.dataset.sub));

  // نقطة الدخول من switchTab في app.js
  g.loadEinvoicesTab = async () => {
    switchZp2Sub('list');
    await loadP2Settings();
    await loadEinvoicesList();
  };
})(typeof window !== 'undefined' ? window : globalThis);
