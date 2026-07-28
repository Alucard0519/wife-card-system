# 罚款钱包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变现有卡牌积分行为的前提下，为单文件移动端应用增加独立罚款钱包、统一历史和兼容旧备份的数据迁移。

**Architecture:** 继续以 `index.html` 作为唯一运行文件，将纯数据规则放在现有 `CORE_START/CORE_END` 区域，通过 Node 内置模块提取核心代码做无依赖测试。罚款钱包与卡牌状态分开存储，读取时统一规范化为版本 2，展示总历史时再按时间合并。

**Tech Stack:** HTML5、CSS3、原生 JavaScript、LocalStorage、Node.js 内置 `assert/fs/vm`；不使用第三方库。

## Global Constraints

- 应用运行产物仍只有一个 `index.html`，HTML、CSS、JavaScript 和卡片图片全部内嵌。
- 移动端优先，兼容 iPhone Safari、微信浏览器和安卓浏览器。
- 罚款独立入口，提交即视为已支付，只累计、不支出。
- 金额单位为人民币整数元，最小 1 元。
- 罚款不改变 `total_points`，不生成、消耗或拆解卡片。
- 版本 1 数据与备份必须无损升级，旧积分和卡片历史保持不变。
- 首页不增加钱包内容，继续满足 iPhone 16 一屏展示目标。
- 本地数据仍保存在同一个 LocalStorage key：`wife-card-system-v1`，避免因换 key 丢失旧数据。

---

## File Map

- Modify: `index.html`
  - 核心数据规范化、版本迁移、罚款记录计算。
  - 钱包页面、底部导航、表单、历史合并、备份和清空。
  - 钱包视觉与移动端响应式样式。
- Create: `tests/card-app-core.test.js`
  - 从 `index.html` 提取核心代码，验证版本迁移、金额规则、累计重算和卡牌回归。
- Modify: `docs/superpowers/plans/2026-07-28-fine-wallet.md`
  - 实施时勾选完成项并记录验证结果。

---

### Task 1: 建立核心数据测试与版本 2 迁移

**Files:**
- Create: `tests/card-app-core.test.js`
- Modify: `index.html:1123-1238`

**Interfaces:**
- Produces: `CardAppCore.ERROR_TYPES: string[]`
- Produces: `CardAppCore.normalizeBackup(input: object): Version2State`
- Produces: `CardAppCore.addFineEntry(wallet: FineWallet, entry: FineInput): FineWallet`
- `Version2State = {version: 2, total_points: number, history: CardHistory[], fine_wallet: FineWallet}`
- `FineWallet = {total_yuan: number, history: FineRecord[]}`
- `FineInput = {id: string, timestamp: string, errorType: string, description: string, amountYuan: number}`
- `FineRecord = FineInput & {totalAfter: number}`

- [ ] **Step 1: 写核心测试执行器和失败用例**

创建 `tests/card-app-core.test.js`：

```js
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const coreSource = html.match(/\/\* CORE_START \*\/([\s\S]*?)\/\* CORE_END \*\//);
assert.ok(coreSource, "index.html 中应包含核心代码标记");

const sandbox = { globalThis: {} };
vm.runInNewContext(coreSource[1], sandbox);
const core = sandbox.globalThis.CardAppCore;

function test(name, fn) {
  try {
    fn();
    console.log("✓", name);
  } catch (error) {
    console.error("✗", name);
    throw error;
  }
}

const version1 = {
  version: 1,
  total_points: 4,
  history: [{
    id: "old-1",
    kind: "add",
    timestamp: "2026-07-27T10:00:00.000Z",
    title: "态度问题",
    description: "旧记录",
    cardKey: "longemont",
    quantity: 1,
    pointsDelta: 4,
    balanceAfter: 4,
    cardChanges: []
  }]
};

test("版本 1 自动升级且保留卡片数据", () => {
  const normalized = core.normalizeBackup(version1);
  assert.equal(normalized.version, 2);
  assert.equal(normalized.total_points, 4);
  assert.equal(normalized.history.length, 1);
  assert.deepEqual(normalized.fine_wallet, { total_yuan: 0, history: [] });
});

test("罚款累计按照明细重新计算", () => {
  const normalized = core.normalizeBackup({
    ...version1,
    version: 2,
    fine_wallet: {
      total_yuan: 9999,
      history: [
        { id: "f2", timestamp: "2026-07-27T11:00:00.000Z", errorType: "态度问题", description: "第二笔", amountYuan: 80, totalAfter: 9999 },
        { id: "f1", timestamp: "2026-07-27T09:00:00.000Z", errorType: "沟通问题", description: "第一笔", amountYuan: 20, totalAfter: 9999 }
      ]
    }
  });
  assert.equal(normalized.fine_wallet.total_yuan, 100);
  assert.equal(normalized.fine_wallet.history[0].totalAfter, 100);
  assert.equal(normalized.fine_wallet.history[1].totalAfter, 20);
});

test("新增罚款不改变输入钱包并返回正确累计", () => {
  const before = { total_yuan: 20, history: [
    { id: "f1", timestamp: "2026-07-27T09:00:00.000Z", errorType: "沟通问题", description: "第一笔", amountYuan: 20, totalAfter: 20 }
  ] };
  const after = core.addFineEntry(before, {
    id: "f2",
    timestamp: "2026-07-27T11:00:00.000Z",
    errorType: "态度问题",
    description: "第二笔",
    amountYuan: 80
  });
  assert.equal(before.total_yuan, 20);
  assert.equal(after.total_yuan, 100);
  assert.equal(after.history[0].totalAfter, 100);
});

for (const amountYuan of [0, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
  test(`拒绝非法金额 ${amountYuan}`, () => {
    assert.throws(() => core.addFineEntry({ total_yuan: 1, history: [] }, {
      id: "bad",
      timestamp: "2026-07-27T11:00:00.000Z",
      errorType: "态度问题",
      description: "非法金额",
      amountYuan
    }));
  });
}

test("原卡牌换算保持不变", () => {
  assert.deepEqual(
    Array.from(core.pointsToCards(37), item => ({ key: item.key, count: item.count })),
    [
      { key: "world", count: 1 },
      { key: "national", count: 0 },
      { key: "shanghai", count: 0 },
      { key: "longemont", count: 1 },
      { key: "pants", count: 0 },
      { key: "photo", count: 1 }
    ]
  );
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node tests/card-app-core.test.js`

Expected: FAIL，错误指向版本仍为 1、缺少 `fine_wallet` 或 `core.addFineEntry is not a function`。

- [ ] **Step 3: 在核心区实现版本 2 和罚款纯函数**

在 `CARD_DEFS` 后增加：

```js
var ERROR_TYPES = ["陪伴问题", "沟通问题", "承诺未完成", "生活责任", "态度问题", "其他"];
```

实现：

```js
function normalizeFineWallet(input) {
  var source = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : { total_yuan: 0, history: [] };
  if (!Array.isArray(source.history) || source.history.length > 10000) {
    throw new Error("罚款历史格式不正确");
  }

  var runningTotal = 0;
  var chronological = source.history.map(normalizeFineRecord).sort(function (a, b) {
    return Date.parse(a.timestamp) - Date.parse(b.timestamp);
  });
  chronological.forEach(function (record) {
    if (!Number.isSafeInteger(runningTotal + record.amountYuan)) {
      throw new Error("累计罚款金额过大");
    }
    runningTotal += record.amountYuan;
    record.totalAfter = runningTotal;
  });
  chronological.reverse();
  return { total_yuan: runningTotal, history: chronological };
}

function addFineEntry(wallet, input) {
  var normalizedWallet = normalizeFineWallet(wallet);
  var record = normalizeFineRecord(input);
  return normalizeFineWallet({
    total_yuan: normalizedWallet.total_yuan + record.amountYuan,
    history: [record].concat(normalizedWallet.history)
  });
}
```

增加完整记录校验：

```js
function normalizeFineRecord(record, index) {
  var label = Number.isSafeInteger(index) ? "第 " + (index + 1) + " 条罚款记录" : "罚款记录";
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(label + "格式不正确");
  }
  var id = typeof record.id === "string" ? record.id.trim().slice(0, 100) : "";
  var parsedTime = Date.parse(record.timestamp);
  var errorType = typeof record.errorType === "string" ? record.errorType.trim() : "";
  var description = typeof record.description === "string"
    ? record.description.trim().slice(0, 500)
    : "";
  if (!id) throw new Error(label + "缺少编号");
  if (!Number.isFinite(parsedTime)) throw new Error(label + "时间不正确");
  if (ERROR_TYPES.indexOf(errorType) === -1) throw new Error(label + "错误类型不正确");
  if (!description) throw new Error(label + "缺少错误描述");
  if (!Number.isSafeInteger(record.amountYuan) || record.amountYuan < 1) {
    throw new Error(label + "金额必须是大于 0 的整数");
  }
  return {
    id: id,
    timestamp: new Date(parsedTime).toISOString(),
    errorType: errorType,
    description: description,
    amountYuan: record.amountYuan,
    totalAfter: 0
  };
}
```

修改 `normalizeBackup` 的版本入口：

```js
if (input.version !== 1 && input.version !== 2) {
  throw new Error("备份版本不受支持");
}
var fineWallet = input.version === 1
  ? { total_yuan: 0, history: [] }
  : normalizeFineWallet(input.fine_wallet);
```

保留现有卡片历史的全部校验，最终返回：

```js
return {
  version: 2,
  total_points: input.total_points,
  history: normalizedHistory,
  fine_wallet: fineWallet
};
```

在 `CardAppCore` 暴露：

```js
ERROR_TYPES: ERROR_TYPES,
normalizeFineWallet: normalizeFineWallet,
addFineEntry: addFineEntry
```

- [ ] **Step 4: 运行核心测试**

Run: `node tests/card-app-core.test.js`

Expected: 全部显示 `✓`，退出码 0。

- [ ] **Step 5: 提交核心迁移**

```bash
git add index.html tests/card-app-core.test.js
git commit -m "Add fine wallet data model"
```

---

### Task 2: 增加钱包页面、导航与移动端视觉

**Files:**
- Modify: `index.html:1-1120`

**Interfaces:**
- Consumes: `state.fine_wallet.total_yuan`
- Consumes: `state.fine_wallet.history`
- Produces DOM IDs: `view-wallet`, `fine-total`, `fine-count`, `fine-form`, `fine-time`, `fine-error-type`, `fine-description`, `fine-amount`, `fine-submit`, `fine-history-list`

- [ ] **Step 1: 添加静态结构检查**

在 `tests/card-app-core.test.js` 末尾增加：

```js
test("钱包页面关键元素存在", () => {
  for (const id of [
    "view-wallet", "fine-total", "fine-count", "fine-form", "fine-time",
    "fine-error-type", "fine-description", "fine-amount", "fine-submit",
    "fine-history-list"
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /data-route=["']wallet["']/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node tests/card-app-core.test.js`

Expected: FAIL，提示缺少 `view-wallet`。

- [ ] **Step 3: 增加钱包页面和第五个导航按钮**

在历史页面前插入 `data-view="wallet"` 页面，包含总览卡、表单和最近明细容器。表单字段与设计文档一致，金额使用：

```html
<input class="field" id="fine-amount" name="amountYuan"
       type="number" inputmode="numeric" min="1" step="1"
       placeholder="例如：100" required>
```

底部导航在“消耗”和“历史”之间增加：

```html
<button class="nav-button" type="button" data-route="wallet">
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round"
       stroke-linejoin="round">
    <path d="M4 7a3 3 0 0 1 3-3h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a3 3 0 0 1-3-3V7z"></path>
    <path d="M16 11h5v5h-5a2.5 2.5 0 0 1 0-5z"></path>
  </svg>
  <span>钱包</span>
</button>
```

- [ ] **Step 4: 增加视觉样式**

增加以下基础样式，再沿用现有 `.panel`、`.field` 和按钮样式完成表单：

```css
.wallet-hero {
  position: relative;
  overflow: hidden;
  padding: 22px;
  border: 1px solid rgba(164, 119, 60, .24);
  border-radius: 24px;
  color: #5e3540;
  background:
    radial-gradient(circle at 88% 12%, rgba(255,255,255,.72), transparent 28%),
    linear-gradient(135deg, #fff3cf 0%, #f8d9c8 48%, #f5bfd0 100%);
  box-shadow: 0 14px 34px rgba(126, 72, 77, .14);
}
.wallet-total {
  margin-top: 8px;
  font-size: clamp(38px, 12vw, 54px);
  font-weight: 850;
  line-height: 1;
  letter-spacing: -.04em;
  font-variant-numeric: tabular-nums;
}
.wallet-meta { margin-top: 10px; color: rgba(94, 53, 64, .72); font-size: 13px; }
.fine-history-list { display: grid; gap: 10px; margin-top: 12px; }
.fine-entry {
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: rgba(255,255,255,.86);
}
.money-value {
  color: #9a5b2b;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.nav-inner { grid-template-columns: repeat(5, minmax(0, 1fr)); }
@media (max-width: 370px) {
  .nav-button { min-height: 44px; padding-inline: 2px; font-size: 10px; }
}
```

钱包主卡不引入图片或外部字体。

- [ ] **Step 5: 运行静态结构测试**

Run: `node tests/card-app-core.test.js`

Expected: PASS。

- [ ] **Step 6: 提交页面骨架**

```bash
git add index.html tests/card-app-core.test.js
git commit -m "Add fine wallet interface"
```

---

### Task 3: 实现罚款表单、确认和钱包渲染

**Files:**
- Modify: `index.html:1260-1630`
- Test: `tests/card-app-core.test.js`

**Interfaces:**
- Consumes: `core.ERROR_TYPES`
- Consumes: `core.addFineEntry(wallet, entry)`
- Produces: `updateFinePreview()`, `handleFine(event)`, `commitFine(input)`, `renderWallet()`, `fineHistoryTemplate(record)`

- [ ] **Step 1: 增加事件接线静态测试**

```js
test("罚款表单接入确认和渲染流程", () => {
  assert.match(html, /function handleFine\s*\(/);
  assert.match(html, /function commitFine\s*\(/);
  assert.match(html, /function renderWallet\s*\(/);
  assert.match(html, /fineForm\.addEventListener\(["']submit["'],\s*handleFine\)/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node tests/card-app-core.test.js`

Expected: FAIL，提示缺少 `handleFine`。

- [ ] **Step 3: 接入 DOM 与事件**

将钱包元素加入 `elements`。`init()` 同时填充罚款错误类型并设置罚款默认时间。绑定金额输入和表单提交。

`updateFinePreview()` 必须：

```js
var amount = Number(elements.fineAmount.value);
var valid = Number.isSafeInteger(amount) && amount >= 1;
elements.fineSubmit.disabled = !valid;
elements.fineSubmit.textContent = valid ? "确认罚款 ¥" + amount : "确认罚款";
```

- [ ] **Step 4: 实现确认后保存**

`handleFine(event)` 只负责校验并打开已有 `openModal`。`commitFine(input)` 调用 `core.addFineEntry`，再通过 `saveState` 一次性保存：

```js
saveState({
  version: 2,
  total_points: state.total_points,
  history: state.history,
  fine_wallet: core.addFineEntry(state.fine_wallet, input)
});
```

提交期间禁用确认按钮，避免双击重复记录。保存失败时保留表单；成功后关闭弹窗、清空表单、恢复默认时间、刷新页面并提示。

- [ ] **Step 5: 实现钱包总览与明细**

`renderWallet()` 更新累计金额、记录次数和明细列表。空状态提供“还没有罚款记录”的温和文案。每条明细显示 `+¥amountYuan` 和 `累计 ¥totalAfter`，所有用户文本通过 `escapeHtml`。

在 `renderAll()` 增加 `renderWallet()`，在 `navigate("wallet")` 时更新金额预览。

- [ ] **Step 6: 运行核心和静态测试**

Run: `node tests/card-app-core.test.js`

Expected: PASS。

- [ ] **Step 7: 提交钱包交互**

```bash
git add index.html tests/card-app-core.test.js
git commit -m "Implement fine wallet entries"
```

---

### Task 4: 合并总历史并升级备份与清空

**Files:**
- Modify: `index.html:1575-1730`
- Test: `tests/card-app-core.test.js`

**Interfaces:**
- Produces: `combinedHistory(): Array<{type: "card"|"fine", timestamp: string, record: object}>`
- Consumes: `state.history`, `state.fine_wallet.history`

- [ ] **Step 1: 增加数据导出与总历史静态测试**

```js
test("总历史和备份包含罚款数据", () => {
  assert.match(html, /function combinedHistory\s*\(/);
  assert.match(html, /fine_wallet:\s*state\.fine_wallet/);
  assert.match(html, /现金罚款/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node tests/card-app-core.test.js`

Expected: FAIL，提示缺少 `combinedHistory`。

- [ ] **Step 3: 实现统一时间线**

`combinedHistory()` 将两类记录映射为带类型的包装对象，按照 `Date.parse(timestamp)` 倒序排序。`renderHistory()` 使用统一结果；卡片记录继续调用现有模板，罚款记录调用新的模板。罚款模板显示“现金罚款”、错误类型、描述、`+¥金额` 和累计金额，不显示积分或卡片变化。

- [ ] **Step 4: 升级导出、导入提示与清空文案**

导出 payload 改为版本 2，并包含：

```js
fine_wallet: state.fine_wallet
```

导入确认文案同时显示积分、卡片记录数、累计罚款和罚款记录数。清空文案明确包含罚款；`defaultState()` 返回版本 2 的空钱包。

- [ ] **Step 5: 运行完整测试**

Run: `node tests/card-app-core.test.js`

Expected: PASS。

- [ ] **Step 6: 提交历史与备份升级**

```bash
git add index.html tests/card-app-core.test.js
git commit -m "Integrate fine wallet history and backups"
```

---

### Task 5: 浏览器验收、回归与发布

**Files:**
- Modify if needed: `index.html`
- Modify: `docs/superpowers/plans/2026-07-28-fine-wallet.md`

**Interfaces:**
- Verification URL: local `file:///Users/changhe/Documents/老婆卡片管理系统/index.html`
- Production URL: `https://alucard0519.github.io/wife-card-system/`

- [ ] **Step 1: 运行自动化测试和静态检查**

Run:

```bash
node tests/card-app-core.test.js
git diff --check
```

Expected: 测试全部通过，`git diff --check` 无输出。

- [ ] **Step 2: 在浏览器验证旧数据迁移**

用一个版本 1 备份导入后确认：

- 原积分和卡片历史保留。
- 钱包显示 ¥0。
- 导出文件版本为 2。

- [ ] **Step 3: 验证罚款主流程**

依次检查：

- 输入 100 元，取消弹窗，记录数和累计金额不变，表单内容保留。
- 再次提交并确认，累计为 ¥100，钱包新增一条记录。
- 输入 80 元并确认，累计为 ¥180。
- 总历史按时间显示两笔现金罚款，卡片积分保持原值。

- [ ] **Step 4: 验证非法输入和重复提交**

确认 0、负数、小数、空值无法提交；快速双击确认只生成一条记录。

- [ ] **Step 5: 验证备份往返和清空**

导出版本 2 备份，清空全部数据，再导入；确认积分、卡片历史、累计罚款和罚款明细完全恢复。

- [ ] **Step 6: 验证移动端布局**

在 iPhone 16 目标视口 393×852 检查：

- 首页仍一屏显示。
- 五项导航无截断且可点击。
- 钱包表单可单手操作，数字键盘适配。
- 长描述不溢出。

- [ ] **Step 7: 最终提交**

```bash
git add index.html tests/card-app-core.test.js docs/superpowers/plans/2026-07-28-fine-wallet.md
git commit -m "Complete fine wallet feature"
```

- [ ] **Step 8: 推送并验证 GitHub Pages**

```bash
git push origin main
```

等待 Pages 构建完成，确认生产地址返回 HTTP 200，并比较线上 `index.html` 与本地文件 SHA-256 一致。
