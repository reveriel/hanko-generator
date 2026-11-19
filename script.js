/* =========================================================================
   判子・印鑑ジェネレーター（円印・角印・楕円印）— script.js
   純粋なフロントエンドのみ。外部通信は行いません。

   印影の「本物らしさ」は、彫られた形のマスクをラスタライズし、紙の繊維・
   押し圧・インク量・かすれ・にじみをピクセル単位で合成して再現しています。
   文字の形は彫られた形のまま、輪郭だけをわずかに揺らします。
   詳細は renderImpression の直前のコメントを参照。
   ========================================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     小さなユーティリティ
     --------------------------------------------------------- */

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // 印影の決定論的シード（同じ設定・同じ文字なら必ず同じ印影になる）
  function hashSeed(str) {
    var s = String(str);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return (h % 997) + 3;
  }

  // 空白（全角スペース含む）をすべて除去
  function tidyOne(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[\s　]+/g, '');
  }

  // 改行区切り → 1行ずつの配列（空行は捨てる）
  function tidyLines(s) {
    return String(s === null || s === undefined ? '' : s)
      .split(/\r?\n/)
      .map(tidyOne)
      .filter(function (x) { return x.length > 0; });
  }

  function maxLenOf(lines) {
    var m = 1;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].length > m) m = lines[i].length;
    }
    return m;
  }

  /* ---------------------------------------------------------
     印影レンダリング
     --------------------------------------------------------- */

  var SEAL_COLOR = '#b3382c'; // 朱肉の朱色（cinnabar・やや暖色の橙赤）
  var seq = 0;

  var FONT_STACK = {
    mincho: "'Hiragino Mincho ProN','Yu Mincho','YuMincho','Noto Serif JP','Noto Serif CJK JP','MS Mincho','ＭＳ 明朝',serif",
    gothic: "'Hiragino Kaku Gothic ProN','Yu Gothic','YuGothic','Noto Sans JP','Noto Sans CJK JP','Meiryo','メイリオ',sans-serif"
  };

  /* =========================================================================
     印影エンジン（Canvas ピクセル合成）

     実際の押印を観察すると、インクは「均一な半透明の塗り」ではない。
       - 紙の繊維に沿って 1〜5px の濃淡ができる
       - 押し圧の差で 10〜40px の大きな濃淡が出る
       - 枠や画の縁は、欠け・かすれ・にじみで輪郭が揺らぐ
       - 同じ印でも場所ごとにインクの量が違う
     そのため SVG フィルターの重ね掛けではなく、幾何マスクを
     ラスタライズしてからピクセル単位で「インクの乗り方」を合成する。
     ========================================================================= */

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  // 0〜100 のスライダー値を 0〜1 に。未指定・不正値は dflt（既定 0）に倒す。
  function pct01(v, dflt) {
    var n = Number(v);
    if (!isFinite(n)) n = (dflt === undefined ? 0 : dflt);
    return clamp01(n / 100);
  }

  /* --- 決定的ノイズ（同じシードなら常に同じ印影） ------------------------- */

  function ihash(x, y, seed) {
    var n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function smoothStep(t) { return t * t * (3 - 2 * t); }

  function vnoise(x, y, seed) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var a = ihash(xi, yi, seed), b = ihash(xi + 1, yi, seed);
    var c = ihash(xi, yi + 1, seed), d = ihash(xi + 1, yi + 1, seed);
    var u = smoothStep(xf), v = smoothStep(yf);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  function fbm(x, y, seed, oct) {
    var sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (var i = 0; i < oct; i++) {
      sum += amp * vnoise(x * freq, y * freq, seed + i * 101);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  // 低周波フィールドを 4px 格子で作り、双一次補間で読む（速度優先）
  function makeField(px, scale, seed, oct) {
    var step = 4;
    var gw = Math.ceil(px / step) + 2;
    var arr = new Float32Array(gw * gw);
    for (var gy = 0; gy < gw; gy++) {
      for (var gx = 0; gx < gw; gx++) {
        arr[gy * gw + gx] = fbm(gx * step / scale, gy * step / scale, seed, oct);
      }
    }
    return { arr: arr, gw: gw, step: step };
  }

  function fieldAt(f, x, y) {
    // 端を超える座標（縁の揺らぎで +37/+71 ずらした時など）はクランプする
    var gx = Math.min(f.gw - 2, Math.max(0, x / f.step));
    var gy = Math.min(f.gw - 2, Math.max(0, y / f.step));
    var x0 = gx | 0, y0 = gy | 0;
    var tx = gx - x0, ty = gy - y0;
    var i = y0 * f.gw + x0;
    var a = f.arr[i], b = f.arr[i + 1];
    var c = f.arr[i + f.gw], d = f.arr[i + f.gw + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  // 幾何マスクを双一次補間で読む（縁の揺らぎ＝ゆるい位置ずれに使う）
  function sampleMask(alpha, px, x, y) {
    if (x <= 0 || y <= 0 || x >= px - 1 || y >= px - 1) return 0;
    var x0 = x | 0, y0 = y | 0;
    var tx = x - x0, ty = y - y0;
    var i = y0 * px + x0;
    var a = alpha[i], b = alpha[i + 1], c = alpha[i + px], d = alpha[i + px + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  // 分離型ボックスブラー（にじみ用）
  function boxBlur(src, px, r) {
    if (r <= 0) return src.slice();
    var tmp = new Float32Array(px * px);
    var out = new Float32Array(px * px);
    var win = r * 2 + 1;
    for (var y = 0; y < px; y++) {
      var row = y * px;
      var sum = 0;
      for (var k = -r; k <= r; k++) sum += src[row + Math.min(Math.max(k, 0), px - 1)];
      for (var x = 0; x < px; x++) {
        tmp[row + x] = sum / win;
        sum += src[row + Math.min(x + r + 1, px - 1)] - src[row + Math.max(x - r, 0)];
      }
    }
    for (var x2 = 0; x2 < px; x2++) {
      var sum2 = 0;
      for (var k2 = -r; k2 <= r; k2++) sum2 += tmp[Math.min(Math.max(k2, 0), px - 1) * px + x2];
      for (var y2 = 0; y2 < px; y2++) {
        out[y2 * px + x2] = sum2 / win;
        sum2 += tmp[Math.min(y2 + r + 1, px - 1) * px + x2] - tmp[Math.max(y2 - r, 0) * px + x2];
      }
    }
    return out;
  }

  function hexRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    var n = m ? parseInt(m[1], 16) : 0xb3382c;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  // 円弧に沿わせる文字のサイズ（文字数が多いほど小さく）
  function arcFontSize(len) {
    if (len <= 2) return 11.5;
    if (len <= 3) return 10.5;
    if (len <= 5) return 10.5;
    if (len <= 8) return 9;
    if (len <= 11) return 8;
    if (len <= 14) return 7;
    return 6.2;
  }

  // 中央（縦組み）の文字サイズ。maxH に収まるよう丸める。
  function centerFontSize(count, maxH) {
    var base;
    if (count <= 1) base = 30;
    else if (count === 2) base = 26;
    else if (count === 3) base = 18;
    else if (count === 4) base = 15;
    else if (count === 5) base = 12.5;
    else if (count === 6) base = 10.5;
    else base = 9;
    return Math.min(base, maxH / Math.max(count, 1) / 1.03);
  }

  function textEl(x, y, size, color, font, content, extra) {
    // 刻印の画はフォントより太い。stroke で 0.35 ほど太らせ、かすれ・にじみを乗せる。
    return '<text x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" text-anchor="middle" ' +
      'font-size="' + size.toFixed(2) + '" font-family="' + font + '" fill="' + color + '" font-weight="600"' +
      ' stroke="' + color + '" stroke-width="0.7" stroke-linejoin="round" paint-order="stroke"' +
      (extra ? ' ' + extra : '') + '>' + escapeHtml(content) + '</text>';
  }

  /* --- 円印（まるいん）: 円枠 + 上部の回り文字 + 中央の縦組み --------------- */
  // frame = 輪郭（ゆらぎ層の対象） / p = 文字（幾何学的に完全なまま）
  function buildRound(defs, frame, p, st, color, font, uid) {
    var single = st.ring === 'single';
    var outerR = 46;
    var innerR = single ? 0 : 40.5;
    // 回り文字のベースライン半径。文字の上端が内側の枠に触れない位置に置く。
    var arcR = single ? 34 : 29.5;

    // 枠は幾何学的に完全な円（ゆらぎは輪郭層のフィルタ側で与える）
    frame.push('<circle cx="50" cy="50" r="' + outerR + '" fill="none" stroke="' + color +
      '" stroke-width="' + (single ? 4.0 : 4.2) + '"/>');
    if (!single) {
      frame.push('<circle cx="50" cy="50" r="' + innerR + '" fill="none" stroke="' + color +
        '" stroke-width="1.5"/>');
    }

    // 回り文字（上部の半円・左→上→右）
    var arc = tidyOne(st.arc).slice(0, 20);
    var hasArc = arc.length > 0;
    if (hasArc) {
      var fs = arcFontSize(arc.length);
      var arcLen = Math.PI * arcR;
      var tl = Math.min(arc.length * fs * 1.16, arcLen * 0.86).toFixed(2);
      var d = 'M' + (50 - arcR) + ' 50 A' + arcR + ' ' + arcR + ' 0 0 1 50 ' + (50 - arcR) +
        ' A' + arcR + ' ' + arcR + ' 0 0 1 ' + (50 + arcR) + ' 50';
      defs.push('<path id="' + uid + '-p" d="' + d + '"/>');
      p.push('<text font-size="' + fs + '" font-family="' + font + '" fill="' + color + '" font-weight="500" stroke="' + color + '" stroke-width="0.45" stroke-linejoin="round" paint-order="stroke">' +
        '<textPath href="#' + uid + '-p" xlink:href="#' + uid + '-p" startOffset="50%" text-anchor="middle" ' +
        'textLength="' + tl + '" lengthAdjust="spacingAndGlyphs">' + escapeHtml(arc) + '</textPath></text>');
    }

    // 中央の文字（人名・社名・「○○之印」など）
    // 2文字までは1列、3文字以上は列を分ける（右列から左へ）。
    // 長い社名でも自動で縮小し、枠内に収める。
    var chars = tidyOne(st.main).slice(0, 20).split('');
    if (!chars.length) return;
    var n = chars.length;
    var cols = n <= 2 ? 1 : (n <= 8 ? 2 : 3);
    var rows = Math.ceil(n / cols);
    var maxH = hasArc ? 46 : (single ? 72 : 64);
    var maxW = hasArc ? 42 : (single ? 72 : 64);
    var cfs = Math.min(maxH / rows / 1.04, maxW / cols / 1.04, 30);
    var step = cfs * 1.02;
    var colW = maxW / cols;
    for (var c = 0; c < cols; c++) {
      var slice = chars.slice(c * rows, c * rows + rows);
      var x = 50 + ((cols - 1) / 2) * colW - c * colW;   // 右列から左へ
      var startY = 50 - (slice.length * step) / 2 + cfs * 0.72;
      for (var j = 0; j < slice.length; j++) {
        p.push(textEl(x, startY + j * step, cfs, color, font, slice[j]));
      }
    }
  }

  /* --- 角印（かくいん）: 正方形の枠 + 縦組み（右→左）or 横組み ------------- */
  function buildSquare(frame, p, st, color, font) {
    var single = st.ring === 'single';
    frame.push('<rect x="4" y="4" width="92" height="92" fill="none" stroke="' + color +
      '" stroke-width="' + (single ? 4.0 : 4.2) + '"/>');

    var box = { x: 4, y: 4, w: 92, h: 92 };
    var pad = 5;
    if (!single) {
      frame.push('<rect x="10" y="10" width="80" height="80" fill="none" stroke="' + color +
        '" stroke-width="1.5"/>');
      box = { x: 10, y: 10, w: 80, h: 80 };
      pad = 4;
    }

    var lines = tidyLines(st.main).slice(0, 6);
    if (!lines.length) return;
    var availW = box.w - pad * 2;
    var availH = box.h - pad * 2;
    var maxLen = maxLenOf(lines);

    if (st.dir === 'h') {
      // 横組み（上→下）
      var rowH = availH / lines.length;
      var hfs = Math.min(rowH * 0.78, availW / (maxLen * 0.97), 24);
      for (var r = 0; r < lines.length; r++) {
        var y = box.y + pad + rowH * (r + 0.5) + hfs * 0.35;
        var natural = lines[r].length * hfs * 1.04;
        var tl = Math.min(natural, availW * 0.96).toFixed(2);
        p.push(textEl(50, y, hfs, color, font, lines[r],
          'textLength="' + tl + '" lengthAdjust="spacingAndGlyphs"'));
      }
      return;
    }

    // 縦組み（1行目が右端、以降は左へ）
    var colW = availW / lines.length;
    var vfs = Math.min(colW * 0.92, availH / (maxLen * 1.02), 24);
    for (var c = 0; c < lines.length; c++) {
      var cx = box.x + box.w - pad - colW * (c + 0.5);
      var chars = lines[c].split('');
      var step = vfs * 1.02;
      var startY = 50 - (chars.length * step) / 2 + vfs * 0.72;
      for (var j = 0; j < chars.length; j++) {
        p.push(textEl(cx, startY + j * step, vfs, color, font, chars[j]));
      }
    }
  }

  /* --- 楕円印（だえんいん）: 楕円枠 + 横組み（銀行印・口座印） -------------- */
  function buildOval(frame, p, st, color, font) {
    var single = st.ring === 'single';
    var rx = single ? 46 : 40.5;
    var ry = single ? 30 : 25.5;

    frame.push('<ellipse cx="50" cy="50" rx="46" ry="30" fill="none" stroke="' + color +
      '" stroke-width="' + (single ? 3.8 : 4.0) + '"/>');
    if (!single) {
      frame.push('<ellipse cx="50" cy="50" rx="' + rx + '" ry="' + ry + '" fill="none" stroke="' +
        color + '" stroke-width="1.5"/>');
    }

    var lines = tidyLines(st.main).slice(0, 2);
    if (!lines.length) return;
    var availW = rx * 2 - (single ? 8 : 7);
    var maxLen = maxLenOf(lines);
    var baseFs = lines.length === 1 ? 17 : 12.5;
    var fs = Math.min(baseFs, availW / (maxLen * 0.96));
    var n = lines.length;
    var gap = fs * 1.08;

    for (var k = 0; k < n; k++) {
      var y = 50 - ((n - 1) * gap) / 2 + k * gap + fs * 0.35;
      var natural = lines[k].length * fs * 1.04;
      // 短い文字は適度に字間を広げ（銀行印らしく）、長い文字は枠に合わせて圧縮する
      var tl = natural >= availW * 0.94
        ? availW * 0.94
        : Math.max(natural, availW * 0.55);
      p.push(textEl(50, y, fs, color, font, lines[k],
        'textLength="' + tl.toFixed(2) + '" lengthAdjust="spacingAndGlyphs"'));
    }
  }

  /*
     印版（幾何マスク）の SVG を組み立てる。
     実際のインクの質感は renderImpression() 側でピクセル合成するため、
     ここでは「彫られた形」だけを返す（フィルターは掛けない）。
  */
  function buildSealSVG(st, opts) {
    opts = opts || {};
    var uid = 'hk' + (++seq);
    var color = st.color || SEAL_COLOR;
    var font = FONT_STACK[st.font] || FONT_STACK.mincho;
    var base = hashSeed([st.type, st.main, st.arc, st.ring, st.dir].join('\u0000'));
    // 乱数シード（0〜999）。「ランダム再生成」でここが変わり、印影全体が引き直される。
    var seed = ((base + (Number(st.seed) || 0)) % 997) + 3;
    // 捺印の微妙な傾き（-2°〜+2°）。円は円のまま、全体をわずかに回すだけ。
    var rot = st.tilt ? ((seed % 11) - 5) * 0.65 : 0;

    var defs = [];
    var frame = [];  // 輪郭
    var body = [];   // 文字

    if (st.type === 'square') buildSquare(frame, body, st, color, font);
    else if (st.type === 'oval') buildOval(frame, body, st, color, font);
    else buildRound(defs, frame, body, st, color, font, uid);

    var attrs = 'viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" ' +
      'xmlns:xlink="http://www.w3.org/1999/xlink"';
    if (opts.width) attrs += ' width="' + opts.width + '" height="' + (opts.height || opts.width) + '"';

    var out = ['<svg ' + attrs + '>'];
    if (defs.length) out.push('<defs>' + defs.join('') + '</defs>');
    var ox = (((seed * 13) % 7) - 3) * 0.16;
    var oy = (((seed * 29) % 7) - 3) * 0.16;
    out.push('<g transform="translate(' + ox.toFixed(2) + ' ' + oy.toFixed(2) + ') rotate(' + rot.toFixed(2) + ' 50 50)">');
    out.push(frame.join(''));
    out.push(body.join(''));
    out.push('</g></svg>');
    return out.join('');
  }

  /*
     印影を生成する。SVG の幾何マスクを px×px にラスタライズし、
     ピクセルごとに「紙の繊維・押し圧・かすれ・にじみ」を合成して返す。
     cb(canvas) は Image の読み込み後に非同期で呼ばれる。
  */
  function renderImpression(st, px, cb) {
    px = Math.max(160, Math.min(1600, px | 0));
    var svg = buildSealSVG(st, { width: px, height: px });
    var img = new Image();
    img.onload = function () {
      var cv = document.createElement('canvas');
      cv.width = px; cv.height = px;
      var ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, px, px);
      var src = ctx.getImageData(0, 0, px, px).data;

      var alpha = new Float32Array(px * px);
      for (var i = 0, n = px * px; i < n; i++) alpha[i] = src[i * 4 + 3] / 255;

      var seed = ((hashSeed([st.type, st.main, st.arc, st.ring, st.dir].join('\u0000')) +
        (Number(st.seed) || 0)) % 997) + 3;
      var inkK = pct01(st.ink, 100);
      var wearK = pct01(st.strength);
      var bleedK = pct01(st.bleed);
      var pressK = pct01(st.press);
      var scale = px / 800; // 800px を基準に物理サイズを揃える

      // 低周波フィールド（押し圧・消耗・縁の揺らぎ）
      var pressField = makeField(px, 260 * scale, seed + 3, 3);   // 大きな濃淡
      var patchField = makeField(px, 90 * scale, seed + 17, 2);   // ゆっくりした薄い斑
      var chipField = makeField(px, 9 * scale, seed + 23, 2);     // 細かい欠け（縁のかけ）
      var mottleField = makeField(px, 16 * scale, seed + 53, 2);  // インクの中ムラ
      var clumpField = makeField(px, 5 * scale, seed + 59, 2);    // 紙繊維の塊
      var warpField = makeField(px, 14 * scale, seed + 29, 2);    // 縁の大きな揺らぎ
      var warp2Field = makeField(px, 4 * scale, seed + 71, 1);    // 縁の細かいざらつき

      var chipThresh = 0.97 - 0.22 * wearK;   // 大きいほど欠けやすい
      var warpAmp = (0.25 + 5.0 * bleedK) * scale;
      var blurR = Math.max(1, Math.round((1.2 + 3.5 * bleedK) * scale));
      var haloK = 0.06 + 0.45 * bleedK;
      var inkScale = 0.72 + 0.28 * inkK;

      var blurred = boxBlur(alpha, px, blurR);
      var rgb = hexRgb(st.color || SEAL_COLOR);
      var out = ctx.createImageData(px, px);
      var od = out.data;

      // 押し圧の方向（シードで決まる。片側が薄い＝手のひらが傾いた）
      var ang = ((seed * 73) % 360) * Math.PI / 180;
      var ca = Math.cos(ang), sa = Math.sin(ang);

      for (var y = 0; y < px; y++) {
        for (var x = 0; x < px; x++) {
          var idx = y * px + x;
          var a = alpha[idx];
          var blurA = blurred[idx];

          // 縁の揺らぎ：低周波の位置ずれで輪郭をわずかに乱す
          if (a > 0) {
            var wx = fieldAt(warpField, x, y) - 0.5;
            var wy = fieldAt(warpField, x + 37, y + 71) - 0.5;
            var mx = fieldAt(warp2Field, x + 11, y + 53) - 0.5;
            var my = fieldAt(warp2Field, x + 91, y + 7) - 0.5;
            a = sampleMask(alpha, px,
              x + wx * 2 * warpAmp + mx * scale,
              y + wy * 2 * warpAmp + my * scale);
          }

          // 押し圧：大きなムラ + 方向性の傾き
          var pv = fieldAt(pressField, x, y); // 0..1
          var dirv = clamp01(0.5 + 0.5 * ((x - px / 2) * ca + (y - px / 2) * sa) / (px * 0.62));
          var press = (1 - 0.35 * pressK) + 0.35 * pressK * pv;
          press *= 1 - 0.20 * pressK * (1 - dirv);

          // 消耗：細かい欠け（小さなかけ）と、ゆっくりした薄い斑
          var chip = fieldAt(chipField, x, y);
          if (wearK > 0.02 && chip > chipThresh) a *= 0.10 + 0.25 * (1 - wearK);
          var patch = fieldAt(patchField, x, y);
          if (patch < 0.40) a *= 0.86 + 0.10 * (patch / 0.40);
          var mottle = 0.86 + 0.14 * fieldAt(mottleField, x, y);
          var clump = 0.95 + 0.05 * fieldAt(clumpField, x, y);

          // 紙の繊維（1〜3px）
          var fiber = 0.88 + 0.12 * vnoise(x * 0.55, y * 0.55, seed + 41);
          var speck = ihash(x, y, seed + 43);
          if (speck < 0.03 + 0.05 * wearK) fiber *= 0.62;

          var body = a * press * fiber * mottle * clump * inkScale;

          // にじみ（輪郭の外側に薄く広がる）
          var halo = blurA * haloK * (0.65 + 0.35 * press);

          var fin = body + halo * (1 - body);
          if (fin > 0) fin = 1 - Math.pow(1 - Math.min(1, fin), 1.9);
          if (fin < 0.035) continue;

          // 縁のインク溜まり（アンチエイリアス部分をわずかに濃く）
          if (a > 0.12 && a < 0.85) fin *= 1.05;
          if (fin > 1) fin = 1;

          var cr = rgb.r, cg = rgb.g, cb2 = rgb.b;
          // 縁（アンチエイリアス部）はインクが縁に寄ってわずかに濃く見える
          if (a > 0.10 && a < 0.75) { cr *= 0.94; cg *= 0.92; cb2 *= 0.92; }

          var o = idx * 4;
          od[o] = cr;
          od[o + 1] = cg;
          od[o + 2] = cb2;
          od[o + 3] = Math.round(fin * 255);
        }
      }

      // 仕上げ：インクの縁をわずかにぼかす（紙への吸収で輪郭が完全な刃物状にならない）
      var aOut = new Float32Array(px * px);
      for (var k = 0; k < px * px; k++) aOut[k] = od[k * 4 + 3] / 255;
      var aSoft = boxBlur(aOut, px, 1);
      for (var k2 = 0; k2 < px * px; k2++) {
        od[k2 * 4 + 3] = Math.round(clamp01(aSoft[k2]) * 255);
      }

      ctx.putImageData(out, 0, 0);
      cb(cv);
    };
    img.onerror = function () { cb(null); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* ---------------------------------------------------------
     PNG 書き出し（SVG を Canvas に描いて透過 PNG にする）
     --------------------------------------------------------- */

  function exportPng(st, px, cb) {
    renderImpression(st, px, function (cv) {
      if (!cv) { cb(null, new Error('render failed')); return; }
      try {
        cv.toBlob(function (blob) {
          if (!blob) { cb(null, new Error('toBlob failed')); return; }
          cb(blob, null);
        }, 'image/png');
      } catch (err) {
        cb(null, err);
      }
    });
  }

  function safeFileName(s) {
    return String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24) || 'hanko';
  }

  /* ---------------------------------------------------------
     アプリケーション状態
     --------------------------------------------------------- */

  var DEFAULTS = {
    type: 'round',
    main: '太郎',
    arc: '山田',
    ring: 'double',
    dir: 'v',
    font: 'mincho',
    color: SEAL_COLOR,
    ink: 80,        // 濃さ（印肉の量）
    strength: 55,   // かすれ（局部欠け）
    bleed: 28,      // にじみ（滲み・はみ出し）
    press: 45,      // 傾き（押し圧のムラ）
    seed: 0,        // 乱数シード
    tilt: true,
    px: 800,
    printMm: 15,
    lang: 'ja'
  };

  // 質感プリセット（濃さ / かすれ / にじみ / 傾き）。標準は DEFAULTS と同値。
  var TEXTURES = {
    clean:    { ink: 92,  strength: 8,  bleed: 6,  press: 8  },   // きれい
    standard: { ink: 80,  strength: 55, bleed: 28, press: 45 },   // 標準
    worn:     { ink: 58,  strength: 82, bleed: 48, press: 78 },   // 使い込んだ
    deep:     { ink: 100, strength: 30, bleed: 38, press: 32 }    // 濃い
  };

  var S = {};
  for (var dk in DEFAULTS) { if (Object.prototype.hasOwnProperty.call(DEFAULTS, dk)) S[dk] = DEFAULTS[dk]; }

  var PRESETS = {
    inkan:   { type: 'round',  ring: 'single', main: '山田', arc: '', dir: 'v' },
    ginko:   { type: 'round',  ring: 'double', main: '太郎', arc: '山田', dir: 'v' },
    jitsuin: { type: 'round',  ring: 'double', main: '山田太郎', arc: '', dir: 'v' },
    kaisha:  { type: 'square', ring: 'double', main: '株式会社\n山田', arc: '', dir: 'v' },
    kouza:   { type: 'oval',   ring: 'double', main: '山田商事', arc: '', dir: 'v' }
  };

  function currentState() {
    return {
      type: S.type,
      main: S.main,
      arc: S.arc,
      ring: S.ring,
      dir: S.dir,
      font: S.font,
      color: S.color,
      ink: S.ink,
      strength: S.strength,
      bleed: S.bleed,
      press: S.press,
      seed: S.seed,
      tilt: S.tilt
    };
  }

  /* ---------------------------------------------------------
     i18n（中文 ⇄ 日本語）
     --------------------------------------------------------- */

  var I18N = {
    brandName:  { zh: '印章生成器', ja: '判子・印鑑ジェネレーター' },
    tagline:    { zh: '免费・无需注册・浏览器内完成', ja: '無料・登録不要・ブラウザだけで完結' },
    btnLang:    { zh: '日本語', ja: '中文' },

    h1Title:    { zh: '印章（判子）生成器 — 在线免费制作印影', ja: '判子・印鑑 ジェネレーター（無料）' },
    h1Lead:     { zh: '输入文字，即可生成圆形／方形／椭圆印章的印影。支持透明背景高分辨率 PNG 下载、按实际尺寸打印，并可调整做旧（印泥浓淡・局部缺失）效果。所有处理均在浏览器内完成。',
                  ja: '文字を入れるだけで、円印・角印・楕円印の印影をその場で作成。透過PNGのダウンロード、実寸印刷、印肉のかすれ（濃淡ムラ）の再現まで対応しています。入力内容はブラウザの外に出ません。' },

    legendType: { zh: '印章类型', ja: '印章の種類' },
    tRound:     { zh: '円印（圆形）', ja: '円印（まるいん）' },
    tSquare:    { zh: '角印（方形）', ja: '角印（かくいん）' },
    tOval:      { zh: '楕円印（椭圆）', ja: '楕円印（だえんいん）' },
    hintRound:  { zh: '実印・銀行印・認印常用。中心竖排，上部可环绕文字。', ja: '実印・銀行印・認印に。中心に縦書き、上部に回り文字を入れられます。' },
    hintSquare: { zh: '法人印・公司印常用。框内竖排（从右到左）。', ja: '法人印・会社印に。枠の中に縦書き（右から左）で組みます。' },
    hintOval:   { zh: '银行印・账户印常用。横排铺满整个椭圆。', ja: '銀行印・口座印に。横書きで幅いっぱいに組みます。' },

    legendText: { zh: '印影文字', ja: '印影の文字' },
    lblMain:    { zh: '主文字（中心）', ja: '主文字（中央・縦書き）' },
    lblArc:     { zh: '环绕文字（上部圆弧）', ja: '回り文字（上部の円弧）' },
    phMain:     { zh: '例：太郎', ja: '例：太郎' },
    phArc:      { zh: '例：山田（可留空）', ja: '例：山田（空欄でもOK）' },
    helpMain_round:  { zh: '中心竖排文字。留空则只显示外框和环绕文字。', ja: '中央に縦書きで配置します。空欄にすると枠と回り文字だけになります。' },
    helpMain_square: { zh: '换行后，每一行成为一个竖列（从右到左）。例：第一行「株式会社」、第二行「山田」。', ja: '改行すると、1行が1列になります（右から左）。例：「株式会社」「山田」で2列。' },
    helpMain_oval:   { zh: '最多 2 行，横向排列。', ja: '2行まで横書きで配置します。' },

    presetLabel: { zh: '常用示例：', ja: 'よく使う例：' },
    pInkan:      { zh: '认印（仅姓氏）', ja: '認印（姓のみ）' },
    pGinko:      { zh: '银行印（姓＋名）', ja: '銀行印（姓＋名）' },
    pJitsuin:    { zh: '实印（全名）', ja: '実印（フルネーム）' },
    pKaisha:     { zh: '公司角印', ja: '会社の角印' },
    pKouza:      { zh: '账户・椭圆印', ja: '口座の楕円印' },

    legendStyle: { zh: '字体・边框・颜色', ja: '書体・枠・色' },
    lblRing:     { zh: '边框', ja: '枠線' },
    ringSingle:  { zh: '单线', ja: '一重' },
    ringDouble:  { zh: '双线', ja: '二重' },
    lblDir:      { zh: '文字排列', ja: '文字の向き' },
    dirV:        { zh: '竖排', ja: '縦書き' },
    dirH:        { zh: '横排', ja: '横書き' },
    lblFont:     { zh: '字体', ja: '書体' },
    fontMincho:  { zh: '明朝体（更像刻印）', ja: '明朝体（刻印風）' },
    fontGothic:  { zh: '黑体（清晰醒目）', ja: 'ゴシック体（くっきり）' },
    lblColor:    { zh: '印泥颜色', ja: '印肉の色' },
    colorCinnabar: { zh: '朱色（标准）', ja: '朱色（標準）' },
    colorDeep:   { zh: '浓朱', ja: '濃い朱' },
    colorLight:  { zh: '淡朱', ja: '淡い朱' },
    colorBlack:  { zh: '黑（订正印等）', ja: '黒（訂正印など）' },
    lblCustomColor: { zh: '自定义颜色', ja: '色を自分で選ぶ' },

    legendTexture: { zh: '质感（拟真度）', ja: '質感（本物らしさ）' },
    presetTextureLabel: { zh: '质感：', ja: '質感：' },
    txClean:     { zh: '干净', ja: 'きれい' },
    txStandard:  { zh: '标准', ja: '標準' },
    txWorn:      { zh: '用旧了', ja: '使い込んだ' },
    txDeep:      { zh: '浓', ja: '濃い' },

    lblInk:      { zh: '浓淡（印泥量）', ja: '濃さ（印肉の量）' },
    inkHint:     { zh: '印泥越多越浓实，越少越淡薄通透。', ja: '多いほど濃くしっかり載り、少ないほど淡く透けた印影になります。' },
    lblStrength: { zh: '缺失（かすれ）', ja: 'かすれ（局部の欠け）' },
    strengthHint:{ zh: '数值越大，局部缺失和斑驳越明显。0 则为干净的实心印影。', ja: '大きいほど局部の欠け・ムラが強くなります。0 にするとクリーンな印影になります。' },
    lblBleed:    { zh: '渗墨（晕开・溢出）', ja: 'にじみ（滲み・はみ出し）' },
    bleedHint:   { zh: '印泥向轮廓外渗透、边缘晕开的效果。', ja: '輪郭の外へ印肉が滲み出す効果です。' },
    lblPress:    { zh: '倾斜（压力不均）', ja: '傾き（押し圧のムラ）' },
    pressHint:   { zh: '模拟盖歪导致的一侧浓一侧淡、整体深浅不均。', ja: '斜めに押したときの「片側が濃く、片側が淡い」圧ムラを再現します。' },
    lblSeed:     { zh: '随机种子', ja: '乱数シード' },
    btnSeed:     { zh: '随机重新生成', ja: 'ランダム再生成' },
    seedHint:    { zh: '生成不同花纹的随机变化。', ja: '模様の出方をランダムに引き直します。' },

    lblTilt:     { zh: '盖章倾斜（轻微歪斜更真实）', ja: '捺印の傾き（わずかに傾ける）' },
    lblSampleSeedNote: { zh: '相同文字和设置会生成相同的印影（可复现）。', ja: '同じ文字・同じ設定なら、同じ印影が再現されます。' },

    legendOut:   { zh: '下载・打印', ja: 'ダウンロード・印刷' },
    lblSize:     { zh: 'PNG 尺寸', ja: 'PNGサイズ' },
    btnPng:      { zh: '下载透明 PNG', ja: '透過PNGをダウンロード' },
    btnPrint:    { zh: '打印', ja: '印刷する' },
    btnReset:    { zh: '重置', ja: 'リセット' },
    lblPrintMm:  { zh: '打印尺寸（实际大小）', ja: '印刷サイズ（実寸）' },
    printHint:   { zh: '按实际尺寸打印后可用于比对大小。请确认打印设置中未勾选「适应页面」。', ja: '実寸で印刷して大きさの確認に使えます。印刷設定で「ページに合わせる」をオフにしてください。' },

    previewTitle:{ zh: '预览', ja: 'プレビュー' },
    previewAlt:  { zh: '生成的印影预览', ja: '生成した印影のプレビュー' },
    previewNote: { zh: '背景为格子＝透明。', ja: 'チェック柄は透明部分です。' },

    shareTitle:  { zh: '分享这个工具', ja: 'このツールをシェアする' },
    shareX:      { zh: '分享到 X', ja: 'X で共有' },
    shareLine:   { zh: '分享到 LINE', ja: 'LINE で共有' },
    shareCopy:   { zh: '复制链接', ja: 'リンクをコピー' },
    toastCopied: { zh: '已复制链接', ja: 'リンクをコピーしました' },
    toastDone:   { zh: 'PNG 下载完成', ja: 'PNGをダウンロードしました' },
    toastFail:   { zh: '生成失败，请换一个浏览器再试。', ja: '生成に失敗しました。別のブラウザでお試しください。' },

    legalTitle:  { zh: '使用须知・免责声明', ja: 'ご利用にあたって（免責事項）' },
    legalBody:   { zh: '本工具生成的是印影的「样本・设计用」图片。実印・銀行印・法人印等具有法律效力的正式印章，需要由正规刻印店制作的实印，并完成印鉴登记・银行备案。请勿将本工具用于伪造他人印章、伪造文书等违法目的。',
                   ja: '本ツールが生成するのは印影の「見本・デザイン用」画像です。実印・銀行印・法人印など正式な印鑑は、印鑑登録や銀行届出に対応した正規の刻印品を印鑑店にご依頼ください。他人の印影の偽造や文書偽造など、法令に違反する目的での使用は固くお断りします。' },

    faqTitle:    { zh: '常见问题', ja: 'よくある質問' },

    faqQ1: { zh: '用这个工具做的印章，可以作为实印・银行印使用吗？', ja: 'このツールで作った印鑑は、実印や銀行印として使えますか？' },
    faqA1: { zh: '不可以。本工具生成的是印影的「样本・设计用」图片。実印・銀行印・法人印需要能用于印鉴登记和银行备案的正式刻印品，请务必委托印鉴店制作。本工具适合用于确认盖章位置、制作文件草稿、设计讨论等用途。',
             ja: 'いいえ。本ツールが生成するのは印影の「見本・デザイン用」画像です。実印・銀行印・法人印として法的に有効な印鑑は、印鑑登録や銀行届出に使える正式な刻印品が必要です。必ず印鑑店・はんこ屋にご依頼ください。押印位置の確認、書類の下書き、デザイン検討などにご利用ください。' },
    faqQ2: { zh: '真的免费吗？需要注册吗？', ja: '本当に無料ですか？登録は必要ですか？' },
    faqA2: { zh: '完全免费、无需注册。所有处理都在浏览器内完成，输入的文字不会发送到服务器。', ja: '完全無料・登録不要です。すべての処理はブラウザ内で完結し、入力した文字がサーバーに送信されることはありません。' },
    faqQ3: { zh: '下载的 PNG 是透明背景吗？', ja: 'ダウンロードしたPNGは透過（透明背景）ですか？' },
    faqA3: { zh: '是的。背景为透明的 PNG，可选 800×800 / 1200×1200 / 2000×2000 px。可以直接叠加到文件或资料上。', ja: 'はい。背景が透明なPNGで、800×800 / 1200×1200 / 2000×2000 px から選べます。書類や資料にそのまま重ねられます。' },
    faqQ4: { zh: '能再现印泥的浓淡和缺失吗？', ja: 'かすれ（印肉のムラ）は再現できますか？' },
    faqA4: { zh: '可以。保留刻字形状，逐像素合成纸张纤维、按压压力、墨量不均、局部缺失与渗墨，重现真实盖印的浓淡和轮廓波动。浓淡／缺失／渗墨／倾斜四个滑块可分别调整，并有「干净／标准／用旧了／浓」四种质感预设。', ja: 'はい。彫られた文字の形はそのままに、紙の繊維・押し圧・インク量のムラ・かすれ・にじみを1ピクセルずつ合成し、実際に押したような濃淡と輪郭の揺らぎを再現しています。濃さ／かすれ／にじみ／傾きの4つのスライダーで調整でき、「きれい／標準／使い込んだ／濃い」の質感プリセットも用意しています。' },
    faqQ5: { zh: '可以做公司的角印、银行的椭圆印吗？', ja: '会社の角印や銀行の楕円印も作れますか？' },
    faqA5: { zh: '可以。支持円印・角印・楕円印。角印支持竖排（从右到左）和横排，円印支持上部环绕文字。', ja: 'はい。円印・角印・楕円印に対応しています。角印は縦書き（右→左）と横書き、円印は上部の回り文字に対応しています。' },
    faqQ6: { zh: '生成的印影可以商用吗？', ja: '作った印影を商用利用できますか？' },
    faqA6: { zh: '用于自己制作文件的草稿・设计用途是没有问题的。但严禁用于伪造、模仿他人印章的目的。', ja: '自分で作成する書類の下書き・デザイン用途であればご利用いただけます。ただし、他人の印鑑を偽造・模倣する目的での使用は固く禁じます。' },

    footerText: { zh: '印章生成器 — 在线免费制作判子・印鑑（円印・角印・楕円印）的工具', ja: '判子・印鑑ジェネレーター — 円印・角印・楕円印の印影を無料で作成できるツール' },
    footerPrivacy: { zh: '隐私政策', ja: 'プライバシーポリシー' },
    footerCompany: { zh: '运营者信息', ja: '運営者情報' },
    footerFeedback: { zh: '意见反馈', ja: 'ご意見・フィードバック' },

    fabAria: { zh: '发送意见・反馈', ja: 'ご意見・フィードバックを送る' }
  };

  var lang = 'ja';

  function applyI18n(next) {
    lang = (next === 'zh') ? 'zh' : 'ja';
    document.documentElement.lang = (lang === 'zh') ? 'zh-CN' : 'ja';

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var entry = I18N[el.getAttribute('data-i18n')];
      if (entry && entry[lang]) el.textContent = entry[lang];
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var entry = I18N[el.getAttribute('data-i18n-html')];
      if (entry && entry[lang]) el.innerHTML = escapeHtml(entry[lang]);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      var entry = I18N[el.getAttribute('data-i18n-ph')];
      if (entry && entry[lang]) el.setAttribute('placeholder', entry[lang]);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var entry = I18N[el.getAttribute('data-i18n-aria')];
      if (entry && entry[lang]) el.setAttribute('aria-label', entry[lang]);
    });
    var btn = $('langBtn');
    if (btn) btn.textContent = I18N.btnLang[lang];
    try { localStorage.setItem('hanko.lang', lang); } catch (e) { /* ignore */ }
  }

  /* ---------------------------------------------------------
     UI 組み立て
     --------------------------------------------------------- */

  function syncSeg(container, value) {
    if (!container) return;
    container.querySelectorAll('[data-val]').forEach(function (b) {
      var on = b.getAttribute('data-val') === value;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // スライダー ⇄ 状態を繋ぐ（value を 0〜100 の数値として S[key] に入れる）
  function bindRange(inputId, outId, key) {
    var el = $(inputId);
    var out = $(outId);
    if (!el) return;
    el.addEventListener('input', function () {
      S[key] = Number(el.value);
      if (out) out.textContent = el.value + '%';
      syncTextureUI();
      render();
    });
  }

  // 質感スライダー・プリセットの表示を現在の状態に同期する
  function syncTextureUI() {
    ['ink:inkAmount:inkAmountOut', 'strength:strength:strengthOut',
     'bleed:bleed:bleedOut', 'press:press:pressOut'].forEach(function (spec) {
      var parts = spec.split(':');
      var el = $(parts[1]);
      var out = $(parts[2]);
      if (el) el.value = String(S[parts[0]]);
      if (out) out.textContent = S[parts[0]] + '%';
    });

    // どの質感プリセットと一致するかをハイライト（一致なしは非選択）
    var group = $('texturePresets');
    if (!group) return;
    var hit = null;
    for (var name in TEXTURES) {
      if (!Object.prototype.hasOwnProperty.call(TEXTURES, name)) continue;
      var T = TEXTURES[name];
      if (T.ink === S.ink && T.strength === S.strength &&
          T.bleed === S.bleed && T.press === S.press) { hit = name; break; }
    }
    group.querySelectorAll('[data-texture]').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-texture') === hit);
    });
  }

  function syncConditional() {
    var arcRow = $('arcRow');
    var dirRow = $('dirRow');
    if (arcRow) arcRow.hidden = (S.type !== 'round');
    if (dirRow) dirRow.hidden = (S.type !== 'square');

    var hintEl = $('typeHint');
    if (hintEl) {
      hintEl.setAttribute('data-i18n',
        S.type === 'square' ? 'hintSquare' : (S.type === 'oval' ? 'hintOval' : 'hintRound'));
    }
    var mainEl = $('mainText');
    var helpEl = $('mainHelp');
    if (mainEl) mainEl.setAttribute('data-i18n-ph', 'phMain');
    if (helpEl) helpEl.setAttribute('data-i18n', 'helpMain_' + S.type);
    applyI18n(lang);
  }

  var renderSeq = 0;
  var renderQueued = false;

  // 入力のたびに 80ms 前後の合成が走るため、rAF で 1 フレームに 1 回へ間引く
  function render() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      renderNow();
    });
  }

  function renderNow() {
    var host = $('sealPreview');
    if (!host) return;
    var token = ++renderSeq;
    renderImpression(currentState(), 760, function (cv) {
      if (!cv || token !== renderSeq) return;
      host.innerHTML = '';
      cv.className = 'seal-canvas';
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', I18N.previewAlt[lang]);
      host.appendChild(cv);
    });
    var wrap = $('sealWrap');
    if (wrap) wrap.style.setProperty('--print-mm', S.printMm + 'mm');
    var seedOut = $('seedOut');
    if (seedOut) seedOut.textContent = '#' + String(S.seed);
  }

  function toast(msg, ok) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('is-on');
    t.classList.toggle('is-err', ok === false);
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('is-on'); }, 2600);
  }

  function downloadPng() {
    var btn = $('btnPng');
    if (btn) btn.disabled = true;
    exportPng(currentState(), S.px, function (blob, err) {
      if (btn) btn.disabled = false;
      if (!blob) { toast(I18N.toastFail[lang], false); return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'hanko_' + S.type + '_' + safeFileName(S.arc || S.main) + '_' + S.px + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast(I18N.toastDone[lang], true);
    });
  }

  function shareUrl() {
    return 'https://www.reveriel.com/hanko-generator/';
  }

  function openShare(kind) {
    var url = encodeURIComponent(shareUrl());
    var text = encodeURIComponent(lang === 'zh'
      ? '印章（判子）生成器 — 在线免费做印影，可下载透明 PNG'
      : '判子・印鑑ジェネレーター — 円印・角印・楕円印を無料で作成、透過PNGをダウンロード');
    var href;
    if (kind === 'x') href = 'https://twitter.com/intent/tweet?text=' + text + '&url=' + url + '&hashtags=' + encodeURIComponent('印鑑,ハンコ,判子');
    else href = 'https://social-plugins.line.me/lineit/share?url=' + url + '&text=' + text;
    window.open(href, '_blank', 'noopener,noreferrer,width=680,height=560');
  }

  function copyLink() {
    var url = shareUrl();
    function done() { toast(I18N.toastCopied[lang], true); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url, done); });
    } else {
      fallbackCopy(url, done);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }


  /* ---------------------------------------------------------
     「マイ印鑑」保存・復元（この端末内のみ）
     --------------------------------------------------------- */
  var PROFILE_KEY = 'hanko.profile.v1';
  var profileStore = (function () {
    try {
      var k = '__hk_test__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return window.localStorage;
    } catch (e) { return null; }
  })();
  var profileTimer = null;

  function collectProfile() {
    var panel = document.querySelector('.panel-form');
    if (!panel) return null;
    var inputs = {}, radios = {};
    panel.querySelectorAll('input[id], select[id], textarea[id]').forEach(function (el) {
      inputs[el.id] = (el.type === 'checkbox') ? !!el.checked : el.value;
    });
    panel.querySelectorAll('input[type=radio]:checked').forEach(function (el) {
      if (el.name) radios[el.name] = el.value;
    });
    return { v: 1, savedAt: new Date().toISOString(), inputs: inputs, radios: radios };
  }

  function queueSaveProfile() {
    if (!profileStore) return;
    if (profileTimer) clearTimeout(profileTimer);
    profileTimer = setTimeout(function () {
      var d = collectProfile();
      if (!d) return;
      try { profileStore.setItem(PROFILE_KEY, JSON.stringify(d)); } catch (e) {}
    }, 500);
  }

  function restoreProfile() {
    if (!profileStore) return false;
    var raw, parsed;
    try { raw = profileStore.getItem(PROFILE_KEY); } catch (e) { return false; }
    if (!raw) return false;
    try { parsed = JSON.parse(raw); } catch (e) { return false; }
    if (!parsed || parsed.v !== 1) return false;
    var panel = document.querySelector('.panel-form');
    if (!panel) return false;
    var filled = 0;
    Object.keys(parsed.inputs || {}).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!parsed.inputs[id];
      else el.value = parsed.inputs[id];
      filled++;
    });
    Object.keys(parsed.radios || {}).forEach(function (name) {
      var el = panel.querySelector('input[type=radio][name="' + name + '"][value="' + parsed.radios[name] + '"]');
      if (el) el.checked = true;
    });
    // 各入力のリスナーを発火させて状態とプレビューを同期する
    panel.querySelectorAll('input[id], select[id], textarea[id]').forEach(function (el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return filled > 0;
  }

  function showProfileHint() {
    var panel = document.querySelector('.panel-form');
    if (!panel || !panel.parentNode) return;
    var bar = document.createElement('div');
    bar.className = 'profile-hint no-print';
    bar.innerHTML = '前回の設定を復元しました。<button type="button" class="profile-delete" id="profileDelete">保存データを削除</button>';
    panel.parentNode.insertBefore(bar, panel);
    $('profileDelete').addEventListener('click', function () {
      try { profileStore.removeItem(PROFILE_KEY); } catch (e) {}
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    });
  }

  function init() {
    // 保存済みの表示言語を復元（既定は日本語＝SEO的にも自然）
    try {
      var saved = localStorage.getItem('hanko.lang');
      if (saved === 'zh' || saved === 'ja') lang = saved;
    } catch (e) { /* ignore */ }

    // --- 印章の種類 ---
    var typeGroup = $('typeGroup');
    if (typeGroup) {
      typeGroup.addEventListener('click', function (e) {
        var b = e.target.closest('[data-val]');
        if (!b) return;
        S.type = b.getAttribute('data-val');
        syncSeg(typeGroup, S.type);
        syncConditional();
        render();
      });
    }

    // --- 枠線 ---
    var ringGroup = $('ringGroup');
    if (ringGroup) {
      ringGroup.addEventListener('click', function (e) {
        var b = e.target.closest('[data-val]');
        if (!b) return;
        S.ring = b.getAttribute('data-val');
        syncSeg(ringGroup, S.ring);
        render();
      });
    }

    // --- 文字の向き ---
    var dirGroup = $('dirGroup');
    if (dirGroup) {
      dirGroup.addEventListener('click', function (e) {
        var b = e.target.closest('[data-val]');
        if (!b) return;
        S.dir = b.getAttribute('data-val');
        syncSeg(dirGroup, S.dir);
        render();
      });
    }

    // --- 書体 ---
    var fontGroup = $('fontGroup');
    if (fontGroup) {
      fontGroup.addEventListener('click', function (e) {
        var b = e.target.closest('[data-val]');
        if (!b) return;
        S.font = b.getAttribute('data-val');
        syncSeg(fontGroup, S.font);
        render();
      });
    }

    // --- 文字入力 ---
    var mainText = $('mainText');
    if (mainText) {
      mainText.addEventListener('input', function () { S.main = mainText.value; render(); });
    }
    var arcText = $('arcText');
    if (arcText) {
      arcText.addEventListener('input', function () { S.arc = arcText.value; render(); });
    }

    // --- 色 ---
    var swatches = $('colorSwatches');
    if (swatches) {
      swatches.addEventListener('click', function (e) {
        var b = e.target.closest('[data-color]');
        if (!b) return;
        S.color = b.getAttribute('data-color');
        var custom = $('colorCustom');
        if (custom) custom.value = S.color;
        swatches.querySelectorAll('[data-color]').forEach(function (x) {
          x.classList.toggle('is-on', x.getAttribute('data-color') === S.color);
        });
        render();
      });
    }
    var colorCustom = $('colorCustom');
    if (colorCustom) {
      colorCustom.addEventListener('input', function () {
        S.color = colorCustom.value;
        if (swatches) {
          swatches.querySelectorAll('[data-color]').forEach(function (x) {
            x.classList.toggle('is-on', x.getAttribute('data-color') === S.color);
          });
        }
        render();
      });
    }

    // --- 質感スライダー（濃さ / かすれ / にじみ / 傾き）---
    bindRange('inkAmount', 'inkAmountOut', 'ink');
    bindRange('strength', 'strengthOut', 'strength');
    bindRange('bleed', 'bleedOut', 'bleed');
    bindRange('press', 'pressOut', 'press');

    // --- 乱数シード ---
    var btnSeed = $('btnSeed');
    if (btnSeed) {
      btnSeed.addEventListener('click', function () {
        // 0〜996 の別シードへ（同じ設定でも模様が引き直される）
        var next = S.seed;
        for (var i = 0; i < 8 && next === S.seed; i++) {
          next = Math.floor(Math.random() * 997);
        }
        S.seed = next;
        render();
      });
    }

    // --- 質感プリセット ---
    var texturePresets = $('texturePresets');
    if (texturePresets) {
      texturePresets.addEventListener('click', function (e) {
        var b = e.target.closest('[data-texture]');
        if (!b) return;
        var T = TEXTURES[b.getAttribute('data-texture')];
        if (!T) return;
        for (var k in T) { if (Object.prototype.hasOwnProperty.call(T, k)) S[k] = T[k]; }
        syncTextureUI();
        render();
      });
    }

    // --- 傾き ---
    var tilt = $('tiltChk');
    if (tilt) {
      tilt.addEventListener('change', function () { S.tilt = !!tilt.checked; render(); });
    }

    // --- PNG サイズ ---
    var pngSize = $('pngSize');
    if (pngSize) {
      pngSize.addEventListener('change', function () { S.px = Number(pngSize.value); });
    }

    // --- 印刷サイズ ---
    var printMm = $('printMm');
    if (printMm) {
      printMm.addEventListener('change', function () {
        S.printMm = Number(printMm.value);
        var wrap = $('sealWrap');
        if (wrap) wrap.style.setProperty('--print-mm', S.printMm + 'mm');
      });
    }

    // --- 主要ボタン ---
    var btnPng = $('btnPng');
    if (btnPng) btnPng.addEventListener('click', downloadPng);
    var btnPrint = $('btnPrint');
    if (btnPrint) btnPrint.addEventListener('click', function () { window.print(); });

    var btnReset = $('btnReset');
    if (btnReset) {
      btnReset.addEventListener('click', function () {
        for (var k in DEFAULTS) {
          if (Object.prototype.hasOwnProperty.call(DEFAULTS, k) && k !== 'lang') S[k] = DEFAULTS[k];
        }
        hydrate();
      });
    }

    // --- プリセット ---
    var presets = $('presets');
    if (presets) {
      presets.addEventListener('click', function (e) {
        var b = e.target.closest('[data-preset]');
        if (!b) return;
        var P = PRESETS[b.getAttribute('data-preset')];
        if (!P) return;
        for (var k in P) { if (Object.prototype.hasOwnProperty.call(P, k)) S[k] = P[k]; }
        hydrate();
      });
    }

    // --- シェア ---
    var sx = $('shareX'); if (sx) sx.addEventListener('click', function () { openShare('x'); });
    var sl = $('shareLine'); if (sl) sl.addEventListener('click', function () { openShare('line'); });
    var sc = $('shareCopy'); if (sc) sc.addEventListener('click', copyLink);

    // --- 言語切替 ---
    var langBtn = $('langBtn');
    if (langBtn) {
      langBtn.addEventListener('click', function () {
        lang = (lang === 'zh') ? 'ja' : 'zh';
        applyI18n(lang);
        render();
      });
    }

    hydrate();

    if (restoreProfile()) showProfileHint();
    var pf = document.querySelector('.panel-form');
    if (pf) {
      pf.addEventListener('input', queueSaveProfile);
      pf.addEventListener('change', queueSaveProfile);
    }
  }

  // 状態 S を DOM に反映する
  function hydrate() {
    var mainText = $('mainText');
    var arcText = $('arcText');
    if (mainText) mainText.value = S.main;
    if (arcText) arcText.value = S.arc;

    syncSeg($('typeGroup'), S.type);
    syncSeg($('ringGroup'), S.ring);
    syncSeg($('dirGroup'), S.dir);
    syncSeg($('fontGroup'), S.font);

    var swatches = $('colorSwatches');
    if (swatches) {
      swatches.querySelectorAll('[data-color]').forEach(function (x) {
        x.classList.toggle('is-on', x.getAttribute('data-color') === S.color);
      });
    }
    var colorCustom = $('colorCustom');
    if (colorCustom) colorCustom.value = S.color;

    syncTextureUI();

    var tilt = $('tiltChk');
    if (tilt) tilt.checked = !!S.tilt;

    var pngSize = $('pngSize');
    if (pngSize) pngSize.value = String(S.px);
    var printMm = $('printMm');
    if (printMm) printMm.value = String(S.printMm);

    syncConditional();
    render();
    applyI18n(lang);
  }

  /* ---------------------------------------------------------
     テスト用フック（純粋関数の検証用）
     --------------------------------------------------------- */
  window.__hanko = {
    buildSealSVG: buildSealSVG,
    exportPng: exportPng,
    hashSeed: hashSeed,
    currentState: currentState,
    render: render,
    getLang: function () { return lang; },
    setLang: applyI18n,
    state: S
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
