// ═══════════════════════════════════════════════════════════════
// H. ERP — المرحلة 18: وسيط مزامنة طلبات سلة (Edge Function)
// الهدف: تجاوز CORS — خوادم سلة ترفض طلبات المتصفح المباشرة.
//
// دليل النشر (خطوات يدوية — لا تُنشر تلقائياً):
//   1) ثبّت Supabase CLI وسجّل الدخول:  npm i -g supabase && supabase login
//   2) اربط المشروع:                     supabase link --project-ref <ref>
//   3) أنشئ الدالة:                      supabase functions new salla-sync
//      ثم انسخ محتوى هذا الملف إلى supabase/functions/salla-sync/index.ts
//   4) انشرها (بدون تحقق JWT — المصادقة تتم بتوكن سلة نفسه):
//      supabase functions deploy salla-sync --no-verify-jwt
//   5) استدعها من خادمك أو كرون مجدول.
//
// الاستخدام: POST { action: 'orders'|'test', store_url, access_token, params? }
//   - test:   يجلب /admin/v2/products?page=1&per_page=1  (فحص الاتصال)
//   - orders: يجلب /admin/v2/orders (مع params اختيارية مثل status/date)
// التوكن يأتي من لوحة تحكم سلة (OAuth token يُدخله المستخدم يدوياً).
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
    const { action, store_url, access_token, params } = await req.json();
    if (!store_url || !access_token) {
      return new Response(JSON.stringify({ error: 'store_url and access_token required' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    const base = String(store_url).replace(/\/+$/, '');
    const path = action === 'test' ? '/admin/v2/products?page=1&per_page=1' : '/admin/v2/orders';
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const res = await fetch(base + path + (action === 'test' ? '' : qs), {
      headers: { 'Authorization': 'Bearer ' + access_token, 'Accept': 'application/json' },
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
