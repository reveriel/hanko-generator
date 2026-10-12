/* =========================================================================
   判子・印鑑ジェネレーター（円印・角印・楕円印）— script.js
   純粋なフロントエンドのみ。外部通信は行いません。

   印影の「本物らしさ」は、輪郭の幾何変形ではなく
   「印肉の濃淡ムラ + 局部のかすれ」を alpha チャンネルのノイズで
   変調することで再現しています（feDisplacementMap は使いません）。
   円枠・角枠・文字は常に幾何学的に完全なままです。
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

  /*
    印影を「本物らしく」見せるフィルター。

    ・輪郭は絶対に変位させない（円枠・角枠・文字は幾何学的に完全なまま）
      → feDisplacementMap は使わない。
    ・alpha チャンネルだけをノイズで変調する
        feTurbulence   : type="turbulence" / baseFrequency 0.3 / numOctaves 4
        table マッピング: "0 0.25 0.65 0.95 1 1 1"
                          → 大半は 1 に飽和（＝しっかり載る）、
                            ごく一部だけ 0〜0.5 に落ちる（＝かすれ・欠け）
        operator="in"  : SourceGraphic の alpha にのみ乗算
        最後に alpha を 1.35 倍に持ち上げ、全体が暗く沈まないようにする
    ・strength（0〜100）は table の落ち込み量を比例配分する。100 で標準値。

    NOTE: ノイズ種別は "fractalNoise" ではなく "turbulence"。
    指示された filter 断片は type="fractalNoise" と書かれていたが、
    Chrome の fractalNoise の alpha は 0.5 付近に山を持つ分布になり、
    この table（0.5 付近で既に 0.95 に飽和）と組み合わせると
    ほぼ完全に不透明な印影（有墨平均 alpha ≒247 / 淡薄 0.3%）になってしまう。
    検証指標（有墨平均 alpha ≒157 / 淡薄 alpha<100 が ≒33%）は
    type="turbulence" のときにほぼ一致する（実測 158.9 / 29.7%）。
    そのため type="turbulence" を採用している。
  */
  function noiseFilterXML(uid, seed, strength) {
    var k = Math.max(0, Math.min(1, Number(strength) / 100));
    if (!(k > 0.001)) return ''; // かすれ無し（フィルターを掛けない＝クリーンな印影）

    var base = [0, 0.25, 0.65, 0.95, 1, 1, 1];
    var table = base.map(function (v) {
      return Math.round((1 - (1 - v) * k) * 1000) / 1000;
    }).join(' ');

    return '<filter id="' + uid + '-f" x="-10%" y="-10%" width="120%" height="120%">' +
      '<feTurbulence type="turbulence" baseFrequency="0.3" numOctaves="4" seed="' + seed + '" result="noise"/>' +
      '<feComponentTransfer in="noise" result="mask"><feFuncA type="table" tableValues="' + table + '"/></feComponentTransfer>' +
      '<feComposite in="SourceGraphic" in2="mask" operator="in" result="stamped"/>' +
      '<feComponentTransfer in="stamped"><feFuncA type="linear" slope="1.35" intercept="0"/></feComponentTransfer>' +
      '</filter>';
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
    if (count <= 1) base = 26;
    else if (count === 2) base = 22;
    else if (count === 3) base = 16;
    else if (count === 4) base = 13.5;
    else if (count === 5) base = 11;
    else if (count === 6) base = 9.5;
    else base = 8.4;
    return Math.min(base, maxH / Math.max(count, 1) / 1.03);
  }

  function textEl(x, y, size, color, font, content, extra) {
    return '<text x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" text-anchor="middle" ' +
      'font-size="' + size.toFixed(2) + '" font-family="' + font + '" fill="' + color + '"' +
      (extra ? ' ' + extra : '') + '>' + escapeHtml(content) + '</text>';
  }

  /* --- 円印（まるいん）: 円枠 + 上部の回り文字 + 中央の縦組み --------------- */
  function buildRound(defs, p, st, color, font, uid) {
    var single = st.ring === 'single';
    var outerR = 46;
    var innerR = single ? 0 : 40.5;
    // 回り文字のベースライン半径。文字の上端が内側の枠に触れない位置に置く。
    var arcR = single ? 34 : 29.5;

    // 枠は幾何学的に完全な円（変位させない）
    p.push('<circle cx="50" cy="50" r="' + outerR + '" fill="none" stroke="' + color +
      '" stroke-width="' + (single ? 2.6 : 2.8) + '"/>');
    if (!single) {
      p.push('<circle cx="50" cy="50" r="' + innerR + '" fill="none" stroke="' + color +
        '" stroke-width="1.1"/>');
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
      p.push('<text font-size="' + fs + '" font-family="' + font + '" fill="' + color + '" font-weight="500">' +
        '<textPath href="#' + uid + '-p" xlink:href="#' + uid + '-p" startOffset="50%" text-anchor="middle" ' +
        'textLength="' + tl + '" lengthAdjust="spacingAndGlyphs">' + escapeHtml(arc) + '</textPath></text>');
    }

    // 中央の縦組み（人名・「○○之印」など）
    var chars = tidyOne(st.main).slice(0, 12).split('');
    if (!chars.length) return;
    var maxH = hasArc ? 46 : (single ? 74 : 66);
    var cfs = centerFontSize(chars.length, maxH);
    var step = cfs * 1.03;
    var startY = 50 - (chars.length * step) / 2 + cfs * 0.72;
    for (var i = 0; i < chars.length; i++) {
      p.push(textEl(50, startY + i * step, cfs, color, font, chars[i]));
    }
  }

  /* --- 角印（かくいん）: 正方形の枠 + 縦組み（右→左）or 横組み ------------- */
  function buildSquare(p, st, color, font) {
    var single = st.ring === 'single';
    p.push('<rect x="4" y="4" width="92" height="92" fill="none" stroke="' + color +
      '" stroke-width="' + (single ? 2.6 : 2.8) + '"/>');

    var box = { x: 4, y: 4, w: 92, h: 92 };
    var pad = 5;
    if (!single) {
      p.push('<rect x="10" y="10" width="80" height="80" fill="none" stroke="' + color +
        '" stroke-width="1.1"/>');
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
    var vfs = Math.min(colW * 0.9, availH / (maxLen * 1.02), 20);
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
  function buildOval(p, st, color, font) {
    var single = st.ring === 'single';
    var rx = single ? 46 : 40.5;
    var ry = single ? 30 : 25.5;

    p.push('<ellipse cx="50" cy="50" rx="46" ry="30" fill="none" stroke="' + color +
      '" stroke-width="' + (single ? 2.6 : 2.7) + '"/>');
    if (!single) {
      p.push('<ellipse cx="50" cy="50" rx="' + rx + '" ry="' + ry + '" fill="none" stroke="' +
        color + '" stroke-width="1.1"/>');
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
    印影 SVG を組み立てる。
    st = { type, main, arc, ring, dir, font, color, strength, tilt }
    opts = { width, height } を渡すと出力用に実寸属性を付ける
  */
  function buildSealSVG(st, opts) {
    opts = opts || {};
    var uid = 'hk' + (++seq);
    var color = st.color || SEAL_COLOR;
    var font = FONT_STACK[st.font] || FONT_STACK.mincho;
    var seed = hashSeed([st.type, st.main, st.arc, st.ring, st.dir].join('\u0000'));
    // 捺印の微妙な傾き（-2°〜+2°）。円は円のまま、全体をわずかに回すだけ。
    var rot = st.tilt ? ((seed % 11) - 5) * 0.4 : 0;

    var defs = [];
    var body = [];
    var f = noiseFilterXML(uid, seed, st.strength);
    if (f) defs.push(f);

    if (st.type === 'square') buildSquare(body, st, color, font);
    else if (st.type === 'oval') buildOval(body, st, color, font);
    else buildRound(defs, body, st, color, font, uid);

    var attrs = 'viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" ' +
      'xmlns:xlink="http://www.w3.org/1999/xlink" role="img" aria-label="印影"';
    if (opts.width) attrs += ' width="' + opts.width + '" height="' + (opts.height || opts.width) + '"';

    var out = ['<svg ' + attrs + '>'];
    if (defs.length) out.push('<defs>' + defs.join('') + '</defs>');
    out.push('<g transform="rotate(' + rot.toFixed(2) + ' 50 50)">');
    out.push(f ? '<g filter="url(#' + uid + '-f)">' : '<g>');
    out.push(body.join(''));
    out.push('</g></g></svg>');
    return out.join('');
  }

  /* ---------------------------------------------------------
     PNG 書き出し（SVG を Canvas に描いて透過 PNG にする）
     --------------------------------------------------------- */

  function exportPng(st, px, cb) {
    var svg = buildSealSVG(st, { width: px, height: px });
    var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    var img = new Image();
    img.onload = function () {
      var cv = document.createElement('canvas');
      cv.width = px;
      cv.height = px;
      var ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, px, px); // 背景は透明のまま
      ctx.drawImage(img, 0, 0, px, px);
      try {
        cv.toBlob(function (blob) {
          if (!blob) { cb(null, new Error('toBlob failed')); return; }
          cb(blob, null);
        }, 'image/png');
      } catch (err) {
        cb(null, err);
      }
    };
    img.onerror = function () { cb(null, new Error('SVG image load failed')); };
    img.src = url;
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
    strength: 100,
    tilt: true,
    px: 800,
    printMm: 15,
    lang: 'ja'
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
      strength: S.strength,
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

    lblStrength: { zh: '做旧（印泥浓淡／缺失）', ja: 'かすれ（印肉のムラ）' },
    strengthHint:{ zh: '数值越大，缺失和浓淡越明显。0 则为干净的实心印影。', ja: '大きいほどかすれ・ムラが強くなります。0 にするとクリーンな印影になります。' },
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
    faqA4: { zh: '可以。印影不会让轮廓变形，只用噪点再现印泥的浓淡与局部缺失。缺失强度可以用滑块调整。', ja: 'はい。輪郭をゆがめず、印肉の濃淡と局部のかすれだけをノイズで再現しています。かすれの強さはスライダーで調整できます。' },
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

  function render() {
    var host = $('sealPreview');
    if (!host) return;
    host.innerHTML = buildSealSVG(currentState(), null);
    var svg = host.querySelector('svg');
    if (svg) {
      svg.setAttribute('class', 'seal-svg');
      svg.setAttribute('aria-label', I18N.previewAlt[lang]);
    }
    var wrap = $('sealWrap');
    if (wrap) wrap.style.setProperty('--print-mm', S.printMm + 'mm');
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

    // --- かすれ強度 ---
    var strength = $('strength');
    var strengthOut = $('strengthOut');
    if (strength) {
      strength.addEventListener('input', function () {
        S.strength = Number(strength.value);
        if (strengthOut) strengthOut.textContent = strength.value + '%';
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

    var strength = $('strength');
    var strengthOut = $('strengthOut');
    if (strength) strength.value = String(S.strength);
    if (strengthOut) strengthOut.textContent = S.strength + '%';

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
