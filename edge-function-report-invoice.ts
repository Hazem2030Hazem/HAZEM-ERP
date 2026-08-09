// ═══════════════════════════════════════════════════════════════
// H. ERP — المرحلة 17: وسيط إرسال الفواتير إلى زاتكا (Edge Function)
// الهدف: تجاوز CORS — خوادم زاتكا لا تقبل طلبات المتصفح المباشرة.
//
// دليل النشر (لا تُنشر تلقائياً — خطوات يدوية):
//   1) ثبّت Supabase CLI وسجّل الدخول:  npm i -g supabase && supabase login
//   2) اربط المشروع:                     supabase link --project-ref <ref>
//   3) أنشئ الدالة:                      supabase functions new zatca-proxy
//      ثم انسخ محتوى هذا الملف إلى supabase/functions/zatca-proxy/index.ts
//   4) انشرها (بدون تحقق JWT — المصادقة تتم ببيانات CSID نفسها):
//      supabase functions deploy zatca-proxy --no-verify-jwt
//   5) في واجهة النظام (الفوترة الإلكترونية ← الإعدادات): ضع عنوان الدالة
//      https://<ref>.functions.supabase.co/zatca-proxy
//      في حقلي Reporting/Clearance Endpoint (و Compliance إن رغبت).
//
// الاستخدام: POST { action: 'report'|'clear'|'compliance', env, endpoint?, csid?, secret?, otp?, payload }
//   - report/clear: تحتاج csid + secret + payload {invoiceHash, uuid, invoice}
//   - compliance:   تحتاج otp + payload {csr}
// ═══════════════════════════════════════════════════════════════

const BASES: Record<string, string> = {
  sandbox: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  simulation: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }),
      { status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
  try {
    const { action, env, csid, secret, otp, payload } = await req.json();
    const base = BASES[env] || BASES.sandbox;
    let url = '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Version': 'V2',
    };
    if (action === 'report') url = base + '/invoices/reporting/single';
    else if (action === 'clear') url = base + '/invoices/clearance/single';
    else if (action === 'compliance') url = base + '/compliance';
    else throw new Error('action غير معروف: ' + action);

    if (action === 'compliance') {
      if (!otp) throw new Error('OTP مطلوب');
      headers['OTP'] = String(otp);
    } else {
      if (!csid || !secret) throw new Error('CSID/Secret مطلوبان');
      headers['Authorization'] = 'Basic ' + btoa(csid + ':' + secret);
    }

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const text = await res.text();
    return new Response(JSON.stringify({ upstreamStatus: res.status, body: safeJson(text) }), {
      status: 200, // نمرّر نتيجة زاتكا دائماً بـ 200 ليقرأها العميل
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
});

function safeJson(text: string) {
  try { return JSON.parse(text); } catch { return text; }
}
