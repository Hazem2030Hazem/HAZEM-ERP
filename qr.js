/* ═══════════════════════════════════════════════
   H. ERP — زاتكا الجيل الأول: TLV + مولّد QR مدمج خفيف
   قرار التنفيذ (موثّق حسب المطلوب): لا مكتبات CDN جديدة إطلاقاً.
   كتبنا QR encoder خاص بنا (~120 سطر منطق): byte mode، تصحيح أخطاء
   Reed-Solomon بمستوى L، إصدارات 1-9 تلقائياً (تكفي TLV حتى ~232 بايت)،
   قناع 0 مع Format Info القياسي. الناتج يُرسم على <canvas>.
   - zatcaTLV(fields) → Base64 (Tags 1..5: البائع/الرقم الضريبي/الوقت/الإجمالي/الضريبة)
   - qrMatrix(text) → مصفوفة boolean
   - drawQrToCanvas(canvas, text, scale)
   يعمل في المتصفح و Node (للاختبار) بلا build step.
   ═══════════════════════════════════════════════ */
(function (g) {
  'use strict';

  // ─── TLV (Tag-Length-Value) بترميز UTF-8 ثم Base64 للكل ───
  function _utf8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(s));
    // Node قديم / احتياط
    return Uint8Array.from(Buffer.from(String(s), 'utf8'));
  }
  function _b64(bytes) {
    if (typeof btoa !== 'undefined') {
      let bin = '';
      bytes.forEach(b => bin += String.fromCharCode(b));
      return btoa(bin);
    }
    return Buffer.from(bytes).toString('base64');
  }
  // fields: [tag, value]... — كل قيمة: byte(tag) + byte(length) + bytes(utf8)
  function tlvEncode(pairs) {
    const out = [];
    pairs.forEach(([tag, val]) => {
      const v = _utf8(val);
      if (v.length > 255) throw new Error('TLV value too long (tag ' + tag + ')');
      out.push(tag & 0xff, v.length, ...v);
    });
    return Uint8Array.from(out);
  }
  // الترتيب القياسي لزاتكا: 1 اسم البائع، 2 الرقم الضريبي، 3 التوقيت ISO8601،
  // 4 الإجمالي شامل الضريبة، 5 مبلغ الضريبة
  function zatcaTLV({ seller, vat, timestamp, total, tax }) {
    return _b64(tlvEncode([
      [1, seller], [2, vat], [3, timestamp], [4, total], [5, tax],
    ]));
  }

  // ─── جدول إصدارات QR المدعومة (ECC Level L، byte mode) ───
  // [dataCodewords, ecPerBlock, blocksOf, ...] — blocks: [عدد الكتل, كلمات بيانات/كتلة]
  const VER = {
    1: { dc: 19,  ec: 7,  blocks: [[1, 19]],  align: [] },
    2: { dc: 34,  ec: 10, blocks: [[1, 34]],  align: [6, 18] },
    3: { dc: 55,  ec: 15, blocks: [[1, 55]],  align: [6, 22] },
    4: { dc: 80,  ec: 20, blocks: [[1, 80]],  align: [6, 26] },
    5: { dc: 108, ec: 26, blocks: [[1, 108]], align: [6, 30] },
    6: { dc: 136, ec: 18, blocks: [[2, 68]],  align: [6, 34] },
    7: { dc: 156, ec: 20, blocks: [[2, 78]],  align: [6, 22, 38] },
    8: { dc: 194, ec: 24, blocks: [[2, 97]],  align: [6, 24, 42] },
    9: { dc: 232, ec: 30, blocks: [[2, 116]], align: [6, 26, 46] },
    // المرحلة 17 (زاتكا الجيل الثاني): TLV الموسّع (Tags 1-8 مع الهاش والتوقيع
    // والمفتاح العام، ~380 بايت) يتجاوز سعة الإصدار 9 — أضفنا 10-13 بجداول RS القياسية.
    10: { dc: 274, ec: 18, blocks: [[2, 68], [2, 69]],  align: [6, 28, 50] },
    11: { dc: 324, ec: 20, blocks: [[4, 81]],           align: [6, 30, 54] },
    12: { dc: 370, ec: 24, blocks: [[2, 92], [2, 93]],  align: [6, 32, 58] },
    13: { dc: 428, ec: 26, blocks: [[4, 107]],          align: [6, 34, 62] },
    // محتوى QR هو نص base64 لحزمة TLV (≈ 580 حرفاً للجيل الثاني) — نحتاج حتى الإصدار 20
    14: { dc: 461, ec: 30, blocks: [[3, 115], [1, 116]], align: [6, 26, 46, 66] },
    15: { dc: 523, ec: 22, blocks: [[5, 87], [1, 88]],   align: [6, 26, 48, 70] },
    16: { dc: 589, ec: 24, blocks: [[5, 98], [1, 99]],   align: [6, 26, 50, 74] },
    17: { dc: 647, ec: 28, blocks: [[1, 107], [5, 108]], align: [6, 30, 54, 78] },
    18: { dc: 721, ec: 30, blocks: [[5, 120], [1, 121]], align: [6, 30, 56, 82] },
    19: { dc: 795, ec: 28, blocks: [[3, 113], [4, 114]], align: [6, 30, 58, 86] },
    20: { dc: 861, ec: 28, blocks: [[3, 107], [5, 108]], align: [6, 34, 62, 90] },
  };
  // Format Info لـ ECC=L (بتات 15) لكل قناع 0..7
  const FMT_L = [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976];
  // Version Info (18 بت = 6 بت إصدار + 12 بت BCH بمولّد 0x1F25) — يُحسب برمجياً
  // للإصدارات 7+ بدل جدول ثابت (مطابق للقيم القياسية المعروفة 7..13 ويمتد حتى 20).
  function _versionInfo(v) {
    let rem = v;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
    return (v << 12) | rem;
  }

  // ─── حساب GF(256) لـ Reed-Solomon ───
  const GF_EXP = new Uint8Array(512), GF_LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF_EXP[i] = x; GF_LOG[x] = i;
      x <<= 1; if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
  })();
  const gfMul = (a, b) => (a && b) ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0;

  function rsGenerator(n) {
    let poly = [1];
    for (let i = 0; i < n; i++) {
      const np = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        np[j] ^= gfMul(poly[j], GF_EXP[i]);
        np[j + 1] ^= poly[j];
      }
      poly = np;
    }
    return poly; // مرتّب من الحد الأدنى إلى الأعلى
  }

  function rsEncode(data, nEc) {
    // المعاملات من الأعلى للأدنى بدون الحد الرئيسي (x^nEc) — ترتيب القسمة القياسي
    const gen = rsGenerator(nEc).slice(0, nEc).reverse();
    const res = new Array(nEc).fill(0);
    for (const d of data) {
      const factor = d ^ res.shift();
      res.push(0);
      if (factor) for (let i = 0; i < nEc; i++) res[i] ^= gfMul(gen[i], factor);
    }
    return res;
  }

  // ─── بناء تدفق البيانات (bit stream → codewords → interleave) ───
  function _buildCodewords(bytes, v) {
    const V = VER[v];
    const bits = [];
    const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(0b0100, 4);          // byte mode
    push(bytes.length, v >= 10 ? 16 : 8); // مؤشر الطول: 8 بت (v1-9) / 16 بت (v10+)
    bytes.forEach(b => push(b, 8));
    const capBits = V.dc * 8;
    push(0, Math.min(4, capBits - bits.length)); // terminator
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8)
      data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    const pads = [0xec, 0x11];
    for (let i = 0; data.length < V.dc; i++) data.push(pads[i % 2]);

    // تقسيم إلى كتل + ECC لكل كتلة ثم interleave
    const blocks = [];
    let off = 0;
    V.blocks.forEach(([n, sz]) => {
      for (let i = 0; i < n; i++) {
        const d = data.slice(off, off + sz); off += sz;
        blocks.push({ d, e: rsEncode(d, V.ec) });
      }
    });
    const out = [];
    const maxD = Math.max(...blocks.map(b => b.d.length));
    for (let i = 0; i < maxD; i++) blocks.forEach(b => { if (i < b.d.length) out.push(b.d[i]); });
    for (let i = 0; i < V.ec; i++) blocks.forEach(b => out.push(b.e[i]));
    return out;
  }

  // ─── بناء مصفوفة QR ───
  function qrMatrix(text) {
    const bytes = Array.from(_utf8(text));
    let v = 0;
    // السعة: وضع(4بت) + طول(8/16بت) — أي بايتان إضافيان في v1-9 وثلاثة في v10+
    for (let i = 1; i <= 20; i++) if (bytes.length <= VER[i].dc - (i >= 10 ? 3 : 2)) { v = i; break; }
    if (!v) throw new Error('QR: النص أطول من السعة المدعومة (إصدار 20-L)');
    const size = 21 + 4 * (v - 1);
    const M = Array.from({ length: size }, () => new Array(size).fill(null));
    const R = Array.from({ length: size }, () => new Array(size).fill(false)); // محجوز (وظيفي)
    const set = (r, c, val) => { if (r >= 0 && c >= 0 && r < size && c < size) { M[r][c] = val; R[r][c] = true; } };

    // أنماط البحث الثلاثة + الفواصل
    const finder = (r0, c0) => {
      for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
        const inPat = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const dark = inPat && (dr === 0 || dr === 6 || dc === 0 || dc === 6 ||
          (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        set(r0 + dr, c0 + dc, inPat ? dark : false);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    // أنماط المحاذاة
    const al = VER[v].align;
    al.forEach(r => al.forEach(c => {
      if (R[r] && R[r][c]) return; // لا نرسم فوق أنماط البحث
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
        set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }));

    // خطوط التوقيت
    for (let i = 8; i < size - 8; i++) {
      if (!R[6][i]) set(6, i, i % 2 === 0);
      if (!R[i][6]) set(i, 6, i % 2 === 0);
    }
    // الوحدة المظلمة الثابتة
    set(size - 8, 8, true);

    // حجز مناطق Format Info (تُملأ لاحقاً)
    for (let i = 0; i <= 8; i++) { if (!R[8][i]) { M[8][i] = false; R[8][i] = true; } if (!R[i][8]) { M[i][8] = false; R[i][8] = true; } }
    for (let i = 0; i < 8; i++) {
      M[8][size - 1 - i] = false; R[8][size - 1 - i] = true;
      M[size - 1 - i][8] = false; R[size - 1 - i][8] = true;
    }
    // Version Info (v ≥ 7)
    if (v >= 7) {
      const vi = _versionInfo(v);
      for (let i = 0; i < 18; i++) {
        const bit = (vi >> i) & 1;
        const r = Math.floor(i / 3), c = i % 3;
        set(r, size - 11 + c, !!bit);
        set(size - 11 + c, r, !!bit);
      }
    }

    // وضع البيانات zigzag من الأسفل يميناً
    const cw = _buildCodewords(bytes, v);
    const bits = [];
    cw.forEach(b => { for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1); });
    let bi = 0, upward = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--; // تخطي عمود التوقيت
      for (let i = 0; i < size; i++) {
        const r = upward ? size - 1 - i : i;
        for (const c of [col, col - 1]) {
          if (R[r][c]) continue;
          const bit = bi < bits.length ? bits[bi++] : 0;
          // قناع 0: (r + c) زوجي → عكس البت
          M[r][c] = ((r + c) % 2 === 0) ? !bit : !!bit;
        }
      }
      upward = !upward;
    }

    // Format Info (ECC=L، قناع 0) — البتات توضع MSB أولاً
    const fmt = FMT_L[0];
    const fbits = [];
    for (let i = 14; i >= 0; i--) fbits.push((fmt >> i) & 1);
    // حول الزاوية العليا اليسرى
    const posA = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
    posA.forEach(([r, c], i) => { M[r][c] = !!fbits[i]; });
    // النسخة الثانية
    const posB = [];
    for (let i = 0; i < 7; i++) posB.push([size - 1 - i, 8]);
    for (let i = 0; i < 8; i++) posB.push([8, size - 8 + i]);
    posB.forEach(([r, c], i) => { M[r][c] = !!fbits[i]; });

    return M.map(row => row.map(x => !!x));
  }

  // ─── الرسم على canvas (مع منطقة هادئة Quiet Zone = 4 وحدات) ───
  function drawQrToCanvas(canvas, text, scale = 4) {
    const M = qrMatrix(text);
    const n = M.length, q = 4, total = (n + q * 2) * scale;
    canvas.width = canvas.height = total;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, total, total);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
      if (M[r][c]) ctx.fillRect((c + q) * scale, (r + q) * scale, scale, scale);
    return canvas;
  }

  // صورة QR كـ data URL (لتضمينها في HTML الفاتورة)
  function qrDataUrl(text, scale = 4) {
    const cv = document.createElement('canvas');
    drawQrToCanvas(cv, text, scale);
    return cv.toDataURL('image/png');
  }

  g.zatcaTLV = zatcaTLV;
  g.tlvEncode = tlvEncode;
  g.qrMatrix = qrMatrix;
  g.drawQrToCanvas = drawQrToCanvas;
  g.qrDataUrl = qrDataUrl;
  if (typeof module !== 'undefined' && module.exports)
    module.exports = { zatcaTLV, tlvEncode, qrMatrix };
})(typeof window !== 'undefined' ? window : globalThis);
