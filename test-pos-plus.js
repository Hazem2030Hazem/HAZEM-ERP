/* اختبار (node test-pos-plus.js) — ترقية نقاط البيع POS+
   يتحقق من: تسوية الدفع المنقّس (باقي/آجل/سطور التسجيل)، التجميع الساعي
   وأعلى ساعة، إجماليات طرق الدفع، فرق جرد الوردية، تحويل canvas→ESC/POS
   raster وبناء حزمة الطباعة. */
'use strict';
const assert = require('assert');
const P = require('./pos-plus.js');

let n = 0;
const ok = (name) => { n++; console.log('✓', name); };

// ─── ١) دفع نقدي بسيط مع باقٍ ───
{
  const r = P.computeTender(37.5, [{ method: 'cash', amount: 50 }]);
  assert.strictEqual(r.paid, 50);
  assert.strictEqual(r.change, 12.5);
  assert.strictEqual(r.credit, 0);
  assert.strictEqual(r.overpayOk, true);
  // سطر التسجيل النقدي يُخصم منه الباقي → 37.5
  assert.deepStrictEqual(r.recorded.map(l => [l.method, l.amount]), [['cash', 37.5]]);
  ok('computeTender: نقدي مع باقٍ — التسجيل صافي النقدية');
}

// ─── ٢) دفع منقّس: نقدي + شبكة بالضبط ───
{
  const r = P.computeTender(100, [
    { method: 'cash', amount: 40 },
    { method: 'card', amount: 60, reference: '1234' }]);
  assert.strictEqual(r.change, 0);
  assert.strictEqual(r.credit, 0);
  assert.strictEqual(r.recorded.length, 2);
  ok('computeTender: split نقدي+شبكة بالضبط');
}

// ─── ٣) نقص التغطية → آجل ───
{
  const r = P.computeTender(100, [{ method: 'cash', amount: 70 }]);
  assert.strictEqual(r.credit, 30);
  assert.strictEqual(r.change, 0);
  const cr = r.recorded.find(l => l.method === 'credit');
  assert.strictEqual(cr.amount, 30);
  assert.strictEqual(r.recorded.filter(l => l.method !== 'credit').reduce((s, l) => s + l.amount, 0), 70);
  ok('computeTender: الفرق يتحول آجلاً بسطر credit');
}

// ─── ٤) الزيادة عبر الشبكة مرفوضة ───
{
  const r = P.computeTender(100, [{ method: 'card', amount: 150 }]);
  assert.strictEqual(r.overpayOk, false);
  // لكن مع نقدي كافٍ يقبل (الباقي من النقد)
  const r2 = P.computeTender(100, [
    { method: 'card', amount: 60 }, { method: 'cash', amount: 100 }]);
  assert.strictEqual(r2.overpayOk, true);
  assert.strictEqual(r2.change, 60);
  assert.strictEqual(r2.recorded.find(l => l.method === 'cash').amount, 40);
  ok('computeTender: الزيادة نقدية فقط + الباقي يُخصم من النقد');
}

// ─── ٥) الباقي يُوزَّع على آخر سطر نقدي ثم رجوعاً ───
{
  const r = P.computeTender(50, [
    { method: 'cash', amount: 30 }, { method: 'cash', amount: 40 }]);
  assert.strictEqual(r.change, 20);
  assert.deepStrictEqual(r.recorded.map(l => l.amount), [30, 20]);
  ok('computeTender: توزيع الباقي على سطور النقد');
}

// ─── ٦) التجميع الساعي + أعلى ساعة ───
{
  const rows = [
    { total: 10, created_at: '2025-01-05T09:15:00' },
    { total: 20, created_at: '2025-01-05T09:45:00' },
    { total: 5, created_at: '2025-01-05T22:05:00' },
  ];
  const a = P.hourlyAggregate(rows);
  assert.strictEqual(a.hours.length, 24);
  assert.strictEqual(a.hours[9].count, 2);
  assert.strictEqual(a.hours[9].total, 30);
  assert.strictEqual(a.hours[22].count, 1);
  assert.strictEqual(a.peakHour, 9);
  assert.strictEqual(a.maxTotal, 30);
  assert.strictEqual(P.hourlyAggregate([]).peakHour, null);
  ok('hourlyAggregate: 24 ساعة + count/total + أعلى ساعة');
}

// ─── ٧) إجماليات طرق الدفع (مع مرتجع سالب) ───
{
  const m = P.paymentTotals([
    { method: 'cash', amount: 100 }, { method: 'cash', amount: -20 },
    { method: 'card', amount: 50 }, { method: 'credit', amount: 30 }]);
  assert.strictEqual(m.cash, 80);
  assert.strictEqual(m.card, 50);
  assert.strictEqual(m.credit, 30);
  assert.strictEqual(m.grand, 160);
  ok('paymentTotals: تجميع لكل طريقة + مبالغ سالبة + الإجمالي');
}

// ─── ٨) فرق جرد الوردية ───
{
  assert.deepStrictEqual(P.shiftCashDiff(1000, 1000), { expected: 1000, actual: 1000, diff: 0, state: 'match' });
  assert.strictEqual(P.shiftCashDiff(1000, 995.5).state, 'short');
  assert.strictEqual(P.shiftCashDiff(1000, 995.5).diff, -4.5);
  assert.strictEqual(P.shiftCashDiff(1000, 1010).state, 'over');
  ok('shiftCashDiff: مطابق/عجز/زيادة');
}

// ─── ٩) canvas → ESC/POS raster ───
{
  // صورة 8×2: الصف الأول كله أسود، الصف الثاني أول نقطة فقط
  const raster = P.canvasToRaster(8, 2, (x, y) => y === 0 || x === 0);
  assert.deepStrictEqual(raster.slice(0, 8), [0x1D, 0x76, 0x30, 0x00, 1, 0, 2, 0]); // GS v 0 + xBytes=1 + height=2
  assert.strictEqual(raster[8], 0xFF);  // الصف الأول 8 نقاط سوداء
  assert.strictEqual(raster[9], 0x80);  // الصف الثاني: MSB فقط
  // عرض غير مضاعف 8: 9 نقاط → بايتان لكل صف
  const r2 = P.canvasToRaster(9, 1, (x) => x === 8);
  assert.strictEqual(r2[4], 2); // xBytes = 2
  assert.strictEqual(r2[8], 0x00);
  assert.strictEqual(r2[9], 0x80); // النقطة التاسعة أول بت في البايت الثاني
  ok('canvasToRaster: ترويسة GS v 0 + تعبئة البتات MSB أولاً');
}

// ─── ١٠) حزمة ESC/POS كاملة ───
{
  const bytes = P.escposBuild([1, 2, 3]);
  assert.deepStrictEqual(bytes.slice(0, 2), [0x1B, 0x40]);       // ESC @ تهيئة
  assert.deepStrictEqual(bytes.slice(2, 5), [1, 2, 3]);           // الصورة النقطية
  assert.deepStrictEqual(bytes.slice(5, 8), [0x1B, 0x64, 0x05]);  // تغذية
  assert.deepStrictEqual(bytes.slice(-4), [0x1D, 0x56, 0x42, 0x00]); // قص
  ok('escposBuild: تهيئة + raster + تغذية + قص');
}

console.log(`\n🎉 test-pos-plus: نجحت كل المجموعات (${n})`);
