# hanko-generator（判子・印鑑ジェネレーター）— NEXT-STEPS

> 定位：**全矩阵中 ASP 变现价值最高的站**。印鑑类案件佣金 10〜11%（はんこdeハンコ afb 11% / A8 10%），
> 与工具主题 100% 匹配、审核相对宽松、客单价约 8,000 円 → **最该先接联盟的站**。
> URL：https://www.reveriel.com/hanko-generator/
> 站点性质：纯静态（HTML + CSS + 原生 JS），无后端、无上传、数据不出浏览器。

---

## 0. 现状盘点（本轮开始前，2026-10-12）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| canonical 绝对 URL | ✅ | 首页 + 3 篇教程页各自指向自身 |
| JSON-LD | ✅ | 首页 `WebApplication` + `FAQPage`；教程页 `Article` + `FAQPage` |
| og / twitter card | ✅ | og-image.png 1200×630 |
| 分享裂变 | ✅ | X / LINE / 复制链接 三按钮 |
| 反馈 FAB | ✅ | 右下固定，Google Form 带 `entry.1745177199` 预填 |
| Cloudflare beacon | ✅ | token `6fc01bf3ac5e457ba1bd16b91e5b653e` |
| 互链 | ✅ | 页脚相关工具 6 个 + 教程页「あわせて読みたい」矩阵 |
| print 隐藏 FAB | ✅ | `@media print` 隐藏 `.no-print` / `.feedback-fab` |
| 日语 SEO 教程内容层 | ✅ | 3 篇（実印vs認印 / 銀行印 / 押し方）≈ 4,000 字 |
| **プライバシーポリシー** | ✅ | 本轮新增（含**广告/联盟条款**，见 §2） |
| **運営者情報（company）** | ✅ | 本轮新增 |
| **【PR】印鑑注文联盟区块** | 🟡 | 本轮回落 scaffold（占位链接，待 A8 注册后替换） |
| sitemap.xml | ✅ | 6 条 URL |

### 结论
**信任层（法务三件套）已补齐，转化层（PR 区块）已就位** —— ASP 落审的两个主因已消除。
现在唯一卡点是**站外的 A8.net 注册与案件提携审查**，属运营动作，非代码动作。

---

## 1. 战略对齐（三方向并行）

| 方向 | 本轮动作 | 目的 |
| --- | --- | --- |
| ① 内容层补日语 SEO 教程页 | 补法务页（法务页同时是信任层与长尾入口） | 提高 ASP 提携通过率 + 吃「印鑑 注文 / はんこ 通販」等交易意图词 |
| ② 日本 ASP 联盟 | **补齐法务三件套 + 预置 PR 区块 scaffold** | 扫清 A8 / もしも / afb 的媒体审查与案件提携审查落审理由 |
| ③ 继续滚工具 | 工具本体零改动 | 保持静态、零成本、可无限复制 |

### 合规红线（硬性，违反会被 ASP 解约/扣款）
1. **ステマ規制（景表法 5 条 3 号）**：联盟区块必须**在用户一眼可见的位置**以 `【PR】` 明示，
   对比度/字号不能做得隐蔽 → 本轮 PR 区块顶部固定 `【PR】` 徽章，样式与正文同级。
2. **A8.net 只允许日语站** → A8 链接**只挂日语页**。本站全站 `lang="ja"`，
   唯一的中文是 `script.js` 里 `#langBtn` 切换出来的界面文案（同一 URL）→ **PR 区块不含任何 `data-i18n`，切到中文也不会变**，
   且 PR 区块仅在日语语境下展示（见 §4 待办：切换中文时应隐藏）。
3. **`rel="nofollow sponsored noopener"`** + `target="_blank"`：Google 推荐写法，且**不影响 ASP 归因**
   （跟踪完全在 ASP 域完成：`px.a8.net` 302 → 广告主，cookie 写在 ASP 域）。
4. **1×1 追踪像素必须保留**（`<img border="0" width="1" height="1" src="https://www1X.a8.net/0.gif?a8mat=...">`）。

### 法务口径（已确认，全站一致）
- 运营者 **GUO XING**；只披露 **大阪府大阪市**；**不公开**电话 / 详细地址 / 番地。
- 邮箱**仅在对方要求时提供** → 页面统一走反馈表单（company.html 已写明此句）。
- **特定商取引法表記不需要**：本站完全免费、无任何付费交易（款是**印鑑店**收的，不是我们收的）。

---

## 2. 本轮实施清单（已执行）

### 2.1 新增法务页（日文，`lang="ja"`）
- [x] `privacy.html` — プライバシーポリシー（10 条）
  - ① 基本方针：输入文字与**生成的印影图像**均不出浏览器、不上传、不保存。
  - ③ アクセス解析：Cloudflare Web Analytics（Cookie 不使用・个人不特定）。
  - ④ お問い合わせ：Google フォーム（任意提交，第三方）。
  - ⑤ **広告・アフィリエイトプログラム（A8.net 等）** — **新增条款**：Cookie 用于效果测量、`【PR】` 表记、**「广告链接不影响工具功能」**。
  - ⑥ 第三者提供 / ⑦ 安全管理 / ⑧ Cookie / ⑨ 変更 / ⑩ お問い合わせ窓口。
- [x] `company.html` — 運営者情報
  - 屋号、運営者 GUO XING、所在地 大阪府大阪市、サービスの内容（+「生成物は見本用途」免责）、
    **広告・アフィリエイトについて**（`【PR】` 表记说明）、お問い合わせ＝反馈表单、関連ページ（privacy + 3 教程）。
  - JSON-LD `Organization`（`founder` + `address` 大阪府/大阪市 + `contactPoint`）。
- [x] 两页均：canonical 绝对 URL、**不设 `noindex`**（要能被 ASP 审查抓取）、beacon、反馈 FAB、回首页链接。
- [x] `guide.css` 追加**法務ページ样式段**（`.legal-page/.legal/.legal-table/.legal-contact/.legal-back/.legal-meta`，
      从 mitsumori-pdf 复用，同一设计系统），print 规则同步补 `.legal-back`。

### 2.2 页脚互链（4 个页面）
- [x] `index.html`：页脚加 `プライバシーポリシー` / `運営者情報`（与既有反馈链接并列），
      并补 `data-i18n` key `footerPrivacy` / `footerCompany`（`script.js` 字典同步）。
- [x] `jitsuin-vs-mitomein.html` / `ginkoin.html` / `osikata.html`：页脚同样加两链接。

### 2.3 首页【PR】印鑑注文联盟区块（scaffold）
- [x] 位置：`</main>` 正下方（**生成结果预览区的正下方**，全宽），`class="pr-affiliate no-print"`、`lang="ja"`、**无 `data-i18n`**（禁止翻译成中文）。
- [x] 顶部固定 `【PR】` 徽章（`.pr-badge`）+ 副标题「できあがった印影を、本物の印鑑として注文する」。
- [x] 2 个占位直リンク（`rel="nofollow sponsored noopener"`、`target="_blank"`）：
  - はんこdeハンコ → `https://px.a8.net/svt/ejp?a8mat=PLACEHOLDER_HANKODEHANKO`
  - ハンコヤドットコム → `https://px.a8.net/svt/ejp?a8mat=PLACEHOLDER_HANKOYA`
- [x] 1×1 追踪像素 `img.pr-pixel` 占位（当前用 data URI 透明 GIF，**不发外部请求**；
      HTML 注释内写明替换为 `https://www1X.a8.net/0.gif?a8mat=...` 的真实标签）。
- [x] HTML 注释块写明「未接続のプレースホルダ／登録後に (1) href (2) pixel src を差し替える／日本語ページ専用」。
- [x] 「※ 上記は広告（アフィリエイト）リンクです」的利益相反说明（ステマ規制加分项）。
- [x] `style.css` 追加 `.pr-affiliate / .pr-box / .pr-badge / .pr-title / .pr-lead / .pr-actions / .pr-note / .pr-pixel`
      （CSS 变量继承，深浅色主题自动适配；`.no-print` + guide.css print 规则双重隐藏）。

### 2.4 sitemap.xml
- [x] 由 4 条扩到 **6 条**：首页 + 3 教程 + `privacy.html` + `company.html`，`lastmod` 2026-10-12。

---

## 3. 验证（本轮已完成）

- `node --check script.js` 通过。
- 6 个页面 JSON-LD 全部 `JSON.parse` 通过（privacy.html 无 JSON-LD，符合预期）。
- `sitemap.xml` XML 解析通过。
- headless Chrome（CDP，1280×900 + 390×844）逐页渲染 6 个页面：
  - **横向溢出 = 0**（全部页面，桌面与移动）。
  - **关键元素**：canonical 正确、`h1` 唯一、footer 两法务链接存在、FAB 存在、beacon 存在、`#sealPreview svg` 生成成功。
  - **法务页样式生效**：`.legal` computed `max-width: 780px`（证明 `guide.css` 补丁生效）。
  - **PR 区块**：`.pr-affiliate` 存在、2 个 `a.pr-link` 的 `rel` 均为 `nofollow sponsored noopener`、`img.pr-pixel` 为 1×1。
  - **console error / 本地资源 404 = 0**。
    *唯一出现的一条 error 是 Cloudflare beacon 向 `cloudflareinsights.com/cdn-cgi/rum` 的请求被 CORS 拦截，
    原因是本地以 `file://` 打开（`Origin: null`），**http(s) 线上环境不会有此问题，且 3 篇既有教程页同样如此**，非本轮引入。*
- 视觉确认（截图）：PR 区块桌面/移动版式正常，`privacy.html` / `company.html` 版式与全站一致。

---

## 4. 下一轮待办（Next）

### P0 — 变现路径（**本轮之后的第一优先级**）

**阶段 1｜注册 ASP（第 1 周）—— 目标：拿到链接**
1. 注册 **A8.net**（无审查、当天可用；海外在住可注册，见报告 §8 链接）。
2. 同步注册 **もしもアフィリエイト**（1〜5 日审查）与 **afb**（3 营业日 + SMS 认证，勿用 050 号码）。
   - 媒体审查提交的站 URL 用 `https://www.reveriel.com/hanko-generator/`，
     **务必在申请前先把 privacy.html / company.html 部署上线**（否则审查抓不到）。

**阶段 2｜申请印鑑类案件（第 2〜3 周）—— 目标：批下高转化案件**

| 优先级 | 案件 | 佣金 | 落地页 |
| --- | --- | --- | --- |
| 1 | **はんこdeハンコ** | afb 11% / A8 10% | 首页 PR 区块 + `osikata.html` |
| 2 | **ハンコヤドットコム** | 点规还元 2.5〜10.4% | 首页 PR 区块 + `ginkoin.html` |
| 3 | Inkans.com（はんこプレミアム）/ ハンコズ | ASP 内查 | 备用（A/B） |
| 4 | ラクスル（名刺・印刷） | 定额〜5〜20% | 后期，跨站导流 |
| 5 | エックスサーバー | 5,000〜10,000 円/件 | 全站页脚（通用） |

> 印鑑类**审核相对宽松 + 主题 100% 匹配 + 客单价 ~8,000 円**，是全矩阵 ROI 最高的联盟动作。

**阶段 3｜技术接入 + 归因验证（批下案件后，约 30 分钟）**
1. 用 A8 后台给的 **a8mat** 替换 `index.html` 里 `PLACEHOLDER_HANKODEHANKO` / `PLACEHOLDER_HANKOYA` 两处 href。
2. 把 `img.pr-pixel` 的 `src` 换成真实 1×1 像素（`https://www1X.a8.net/0.gif?a8mat=...`），
   并把 `class="pr-pixel"` 的 `position:absolute;left:-9999px` 保留（视觉隐藏但**不 `display:none`**，否则可能不触发）。
3. 浏览器 Network 面板确认点击后出现 `px.a8.net` 302、页面加载 `www1X.a8.net/0.gif` 返回 200。
4. 上线 1 周后查 A8 后台「クリック」计数是否 > 0（确认归因打通），再加「成果」监控。

**阶段 4｜A/B 与位置扩展（有数据后）**
- [ ] 教程页（`osikata.html` / `ginkoin.html`）正文中段插入**同款 PR 区块**（教程页交易意图更强，转化通常高于首页）。
- [ ] 测试「1 个 CTA vs 2 个 CTA」「按钮文案：印鑑を注文する vs 実印を作る」。
- [ ] 在 `.seal-stage`（预览区）下方、**紧贴下载按钮**加一行文字链 CTA（当前只有全宽区块）。

### P1 — 合规补强（做完再上线更稳）
- [ ] **语言切换时隐藏 PR 区块**：现在 `#langBtn` 切到中文时 PR 区块仍显示日语 → 建议在 `applyI18n` 里
      对 `document.querySelector('.pr-affiliate')` 加 `hidden = (lang === 'zh')`。
      理由：A8 要求「日语站」，中文界面下标示日语广告体验割裂；也避免被判定面向非日语用户。
- [ ] 若日后挂**多条线路**（不同 ASP 同一广告主），确认无「同一广告主双重计佣」的契约冲突。

### P2 — 内容层扩充（SEO，每页 1,200 字+，带 `Article` + `FAQPage` JSON-LD）
交易/决策意图词优先（离钱最近）：
1. `inkan-tsucho.html` — 印鑑を通販で買うときの選び方（素材・サイズ・価格相場・納期・実印登録の流れ）
   → **本页是最适合放 PR 区块的教程页**。
2. `jitsuin-toroku.html` — 実印登録（印鑑登録）の手続きと必要書類
3. `inkan-sozai.html` — 印鑑の素材（柘植・黒水牛・チタン）と価格の違い
4. `kaisha-in.html` — 法人印（代表者印・角印・銀行印）の揃え方
5. 教程页 → 教程页「あわせて読みたい」矩阵补到 3 条互链；每页 ≥3 处回首页 CTA。
6. 首页「書き方ガイド」区块随篇数增长改成卡片式列表（当前 3 条 inline style 硬编码，扩到 6 条需重构为 CSS 类）。

### P3 — 转化与增长
- [ ] 首页 `.seo` / 教程导航区块加内链权重下沉。
- [ ] 分享图（若加「保存图片」）里带 URL 水印，提升 LINE 外流回流。
- [ ] 部署后到 Google Search Console 提交 6 条 sitemap，对新 URL 请求索引。
- [ ] 观察「印鑑 作成 無料」等主词的曝光→CTR，决定是否做 `og:image` A/B。

### P4 — 数据层预留（为将来 app 化）
- 当前输入态全在 DOM，无持久化。若日后做「保存草稿 / 履歴」，把存储抽象成 `storage.js` 接口
  （localStorage → IndexedDB → 后端），**先留接口不接线**。

---

## 5. 本轮交付文件清单

| 文件 | 变更 |
| --- | --- |
| `privacy.html` | **新增** — プライバシーポリシー（含 A8 广告条款） |
| `company.html` | **新增** — 運営者情報（GUO XING / 大阪府大阪市） |
| `index.html` | 页脚加 2 法务链接；`</main>` 后新增【PR】印鑑注文区块（scaffold） |
| `jitsuin-vs-mitomein.html` / `ginkoin.html` / `osikata.html` | 页脚加 2 法务链接 |
| `script.js` | i18n 字典新增 `footerPrivacy` / `footerCompany` |
| `style.css` | 新增 PR ブロック样式段 |
| `guide.css` | 新增法務ページ样式段 + print 规则补 `.legal-back` / `.pr-affiliate` |
| `sitemap.xml` | 4 → 6 条 URL |
| `NEXT-STEPS.md` | **新增** — 本文件 |

> **本轮不部署**。部署顺序建议：先传 6 个 HTML + CSS/JS + sitemap → 确认线上可访问 →
> 再去 A8.net 注册与媒体审查（审查要抓取 privacy/company 页）。
