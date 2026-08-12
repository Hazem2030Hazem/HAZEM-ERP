/* ═══════════════════════════════════════════════════════════════
   HAZEM.ERP — المرحلة 16: Service Worker (PWA)
   • cache-first للملفات الثابتة المحلية (HTML/CSS/JS/أيقونات/شعار).
   • لا نكاشط إطلاقاً: أي طلب POST، وأي طلب إلى Supabase
     (nqporduxtzrojnclkdbu.supabase.co أو أي *.supabase.co) أو أي
     نطاق خارجي (CDN) — تمرير مباشر للشبكة دائماً.
   • عند فشل الشبكة في طلب تنقّل (GET لمستند) نعرض offline.html.
   • التحديث: CACHE_NAME يُرفَع مع كل إصدار؛ activate يحذف الكاشات القديمة.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const CACHE_NAME = 'hazem-erp-v26';
const STATIC_FILES = [
  'index.html',
  'styles.css',
  'config.js',
  'i18n.js',
  'vat.js',
  'qr.js',
  'zatca2.js',
  'app.js',
  'afaq-windows.js',
  'pos-plus.js',
  'hr.js',
  'assets.js',
  'procurement.js',
  'expenses.js',
  'reports.js',
  'integrations.js',
  'manufacturing.js',
  'crm.js',
  'assistant.js',
  'manifest.webmanifest',
  'logo.png',
  'icon-192.png',
  'icon-512.png',
  'offline.html',
];

// تثبيت: تجهيز الكاش (بأفضل جهد — ملف مفقود لا يُفشل التثبيت)
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(STATIC_FILES.map((f) => cache.add(f).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

// تفعيل: حذف الكاشات القديمة
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// اعتراض الطلبات
self.addEventListener('fetch', (e) => {
  const req = e.request;

  // أبداً لا نكاشط: غير GET (POST/PUT/...) — تمرير مباشر
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // أبداً لا نكاشط Supabase (أي نطاق supabase.co) ولا أي نطاق خارجي (CDN وغيره)
  if (url.origin !== self.location.origin) return;

  // طلب تنقّل (فتح صفحة) — الشبكة أولاً ثم الكاش ثم صفحة عدم الاتصال
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put('index.html', copy));
          return res;
        })
        .catch(() => caches.match('index.html').then((r) => r || caches.match('offline.html')))
    );
    return;
  }

  // ملفات ثابتة محلية GET — الكاش أولاً ثم الشبكة (مع تخزين النتيجة)
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => cached || caches.match('offline.html')))
  );
});
