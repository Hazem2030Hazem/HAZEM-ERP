// ═══════════════════════════════════════════════════════════════
// H. ERP — المرحلة 18: وسيط مزامنة طلبات زد (Edge Function)
// الهدف: تجاوز CORS — خوادم زد ترفض طلبات المتصفح المباشرة.
//
// دليل النشر (خطوات يدوية — لا تُنشر تلقائياً):
//   1) ثبّت Supabase CLI وسجّل الدخول:  npm i -g supabase && supabase login
//   2) اربط المشروع:                     supabase link --project-ref <ref>
//   3) أنشئ الدالة:                      supabase functions new zid-sync
//      ثم انسخ محتوى هذا الملف إلى supabase/functions/zid-sync/index.ts
//   4) انشرها (بدون تحقق JWT — المصادقة تتم بتوكنات زد نفسها):
//      supabase functions deploy zid-sync --no-verify-jwt
//   5) استدعها من خادمك أو كرون مجدول.
//
// الاستخدام: POST { action: 'orders'|'test', access_token, manager_token, params? }
//   - test:   يجلب /v1/managers/store/profile        (فحص الاتصال)
//   - orders: يجلب /v1/managers/store/orders (مع params اختيارية)
// التوثيق عند زد: Authorization: Bearer <access_token> + X-Manager-Token.
// ═══════════════════════════════════════════════════════════════

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
    const { action, access_token, manager_token, params } = await req.json();
    if (!access_token || !manager_token) {
      return new Response(JSON.stringify({ error: 'access_token and manager_token required' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    const path = action === 'test' ? '/v1/managers/store/profile' : '/v1/managers/store/orders';
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const res = await fetch('https://api.zid.sa' + path + qs, {
      headers: {
        'Authorization': 'Bearer ' + access_token,
        'X-Manager-Token': manager_token,
        'Accept': 'application/json',
      },
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
});
