/* ═══════════════════════════════════════════════
   HAZEM.ERP — المرحلة 11: منطق ضريبة القيمة المضافة (15%) — دوال نقية
   قرارات التصميم الموثقة:
   • أسعار البنود «شاملة الضريبة» (tax-inclusive) — القرار معلن للمستخدم
     في نموذج الفاتورة، وهو الأنسب للفواتير المبسطة B2C ولا يكسر أرصدة
     العملاء/الموردين المحتسبة من RPCs القائمة (إجمالي الفاتورة لا يتغير).
   • ضريبة البند الخاضع = الإجمالي × 15/115 (مستخرجة من السعر الشامل)،
     مقرّبة لأقرب هللتين (رقمين عشريين). الصفري/المعفى/خارج النطاق = 0.
   • القيد المحاسبي للضريبة يُرحَّل كقيد تسوية مستقل (immutable):
     مبيعات: مدين حساب المبيعات / دائن 2200 ضريبة القيمة المضافة
     مشتريات: مدين 2200 / دائن حساب المشتريات
     فلا يُعدَّل أي قيد قائم — التزاماً بقاعدة عدم تعديل القيود.
   يعمل في المتصفح و Node (للاختبارات) بلا build step.
   ═══════════════════════════════════════════════ */
(function (g) {
  'use strict';

  const VAT_RATE = 0.15;
  const TAX_CATS = ['standard', 'zero', 'exempt', 'out_of_scope'];

  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  // ضريبة بند واحد: المبلغ الإجمالي (شامل) + التصنيف → ضريبة مستخرجة
  function lineTax(gross, category) {
    gross = Number(gross) || 0;
    if (category === 'standard' || !category) return r2(gross * VAT_RATE / (1 + VAT_RATE));
    return 0;
  }

  // تجميع بنود فاتورة: [{qty, price|cost, tax_category}] → ملخص ضريبي
  function summarizeLines(lines, priceField) {
    const pf = priceField || 'price';
    const s = { standard: { net: 0, tax: 0 }, zero: { net: 0, tax: 0 },
                exempt: { net: 0, tax: 0 }, out_of_scope: { net: 0, tax: 0 },
                subtotal: 0, tax_amount: 0, total: 0 };
    (lines || []).forEach(l => {
      const gross = (Number(l.qty) || 0) * (Number(l[pf]) || 0);
      const cat = TAX_CATS.includes(l.tax_category) ? l.tax_category : 'standard';
      const tax = lineTax(gross, cat);
      const net = r2(gross - tax);
      s[cat].net = r2(s[cat].net + net);
      s[cat].tax = r2(s[cat].tax + tax);
      s.subtotal = r2(s.subtotal + net);
      s.tax_amount = r2(s.tax_amount + tax);
      s.total = r2(s.total + gross);
    });
    return s;
  }

  // ملخص فاتورة واحدة للإقرار: يستخدم الأعمدة الضريبية إن وُجدت،
  // وإلا (فواتير قديمة) يفترض خاضعة 15% شاملة الضريبة — قرار موثّق.
  function invoiceVat(inv) {
    if (inv && inv.tax_amount != null && inv.subtotal != null) {
      return { net: r2(inv.subtotal), tax: r2(inv.tax_amount),
               cat: inv.tax_category_mode || 'standard' };
    }
    const gross = Number(inv && inv.total) || 0;
    return { net: r2(gross - lineTax(gross, 'standard')), tax: lineTax(gross, 'standard'), cat: 'standard' };
  }

  // حساب الإقرار الكامل لفترة: مبيعات + مشتريات → صافي الضريبة المستحقة
  function computeVatReturn(salesInvoices, purchaseInvoices) {
    const out = {
      sales: { standard: { net: 0, tax: 0 }, zero: { net: 0, tax: 0 },
               exempt: { net: 0, tax: 0 }, out_of_scope: { net: 0, tax: 0 } },
      purchases: { standard: { net: 0, tax: 0 }, exempt: { net: 0, tax: 0 } },
      output_tax: 0, input_tax: 0, net_due: 0,
    };
    (salesInvoices || []).forEach(v => {
      const t = invoiceVat(v);
      const cat = out.sales[t.cat] ? t.cat : 'standard';
      out.sales[cat].net = r2(out.sales[cat].net + t.net);
      out.sales[cat].tax = r2(out.sales[cat].tax + t.tax);
    });
    (purchaseInvoices || []).forEach(v => {
      const t = invoiceVat(v);
      const cat = t.cat === 'exempt' ? 'exempt' : 'standard'; // الصفري/خارج النطاق للمشتريات يُجمع مع الخاضع بضريبة فعلية
      out.purchases[cat].net = r2(out.purchases[cat].net + t.net);
      out.purchases[cat].tax = r2(out.purchases[cat].tax + t.tax);
    });
    out.output_tax = r2(out.sales.standard.tax);
    out.input_tax = r2(out.purchases.standard.tax);
    out.net_due = r2(out.output_tax - out.input_tax);
    return out;
  }

  // التحقق من الرقم الضريبي السعودي: 15 رقماً يبدأ بـ 3 وينتهي بـ 3
  const isValidVatNumber = (v) => /^3\d{13}3$/.test(String(v || '').trim());

  g.r2 = r2;
  g.VAT_RATE = VAT_RATE;
  g.TAX_CATS = TAX_CATS;
  g.lineTax = lineTax;
  g.summarizeLines = summarizeLines;
  g.invoiceVat = invoiceVat;
  g.computeVatReturn = computeVatReturn;
  g.isValidVatNumber = isValidVatNumber;
  if (typeof module !== 'undefined' && module.exports)
    module.exports = { r2, VAT_RATE, TAX_CATS, lineTax, summarizeLines, invoiceVat, computeVatReturn, isValidVatNumber };
})(typeof window !== 'undefined' ? window : globalThis);
