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
  assert.deepEqual(
    JSON.parse(JSON.stringify(normalized.fine_wallet)),
    { total_yuan: 0, history: [] }
  );
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

test("相同时间戳的新增罚款排在旧记录前且累计正确", () => {
  const timestamp = "2026-07-27T11:00:00.000Z";
  const after = core.addFineEntry({
    total_yuan: 100,
    history: [{
      id: "f1",
      timestamp,
      errorType: "沟通问题",
      description: "旧记录",
      amountYuan: 100,
      totalAfter: 100
    }]
  }, {
    id: "f2",
    timestamp,
    errorType: "态度问题",
    description: "新记录",
    amountYuan: 80
  });

  assert.equal(after.total_yuan, 180);
  assert.equal(after.history[0].id, "f2");
  assert.equal(after.history[0].totalAfter, 180);
  assert.equal(after.history[1].id, "f1");
  assert.equal(after.history[1].totalAfter, 100);
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

for (const amountYuan of [0, -1, 1.5]) {
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

test("累计金额仅由真实罚款明细决定，不信任过期缓存", () => {
  const after = core.addFineEntry({
    total_yuan: Number.MAX_SAFE_INTEGER,
    history: []
  }, {
    id: "fresh",
    timestamp: "2026-07-27T11:00:00.000Z",
    errorType: "态度问题",
    description: "真实明细为空",
    amountYuan: 1
  });

  assert.equal(after.total_yuan, 1);
  assert.equal(after.history[0].totalAfter, 1);
});

test("真实罚款明细累计达到安全整数上限后拒绝继续增加", () => {
  assert.throws(() => core.addFineEntry({
    total_yuan: 0,
    history: [{
      id: "limit",
      timestamp: "2026-07-27T10:00:00.000Z",
      errorType: "态度问题",
      description: "达到上限",
      amountYuan: Number.MAX_SAFE_INTEGER,
      totalAfter: Number.MAX_SAFE_INTEGER
    }]
  }, {
    id: "overflow",
    timestamp: "2026-07-27T11:00:00.000Z",
    errorType: "态度问题",
    description: "超过上限",
    amountYuan: 1
  }), /累计罚款金额过大/);
});

for (const [field, value] of [
  ["id", " " + "i".repeat(101) + " "],
  ["description", " " + "错".repeat(501) + " "]
]) {
  test(`拒绝去除首尾空格后过长的罚款字段 ${field}`, () => {
    const record = {
      id: "valid-id",
      timestamp: "2026-07-27T11:00:00.000Z",
      errorType: "态度问题",
      description: "有效描述",
      amountYuan: 1
    };
    record[field] = value;
    assert.throws(() => core.addFineEntry(
      { total_yuan: 0, history: [] },
      record
    ), /过长/);
  });
}

for (const [label, fine_wallet] of [
  ["缺失", undefined],
  ["null", null],
  ["数组", []]
]) {
  test(`版本 2 拒绝${label}的罚款钱包`, () => {
    const backup = { ...version1, version: 2 };
    if (fine_wallet !== undefined) backup.fine_wallet = fine_wallet;
    assert.throws(() => core.normalizeBackup(backup), /罚款钱包格式不正确/);
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

function appFunctionSource(name) {
  const match = html.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n      \\}"));
  assert.ok(match, `应能找到 ${name}`);
  return match[0];
}

test("卡牌操作保存版本 2 并保留罚款钱包", () => {
  for (const name of ["handleAdd", "handleConsume"]) {
    const source = appFunctionSource(name);
    assert.match(source, /saveState\(\{[\s\S]*?version: 2,/);
    assert.match(source, /fine_wallet: state\.fine_wallet/);
  }
});

test("默认状态与导出保留版本 2 罚款钱包", () => {
  assert.match(appFunctionSource("defaultState"), /version: 2,[\s\S]*fine_wallet: \{ total_yuan: 0, history: \[\] \}/);
  const exportSource = appFunctionSource("exportData");
  assert.match(exportSource, /version: 2,/);
  assert.match(exportSource, /fine_wallet: state\.fine_wallet/);
});

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

test("钱包明细不继承总历史时间线圆点", () => {
  assert.match(
    html,
    /\.fine-history-list\s+\.history-item::before\s*\{\s*display:\s*none;/
  );
});

test("罚款表单接入确认和渲染流程", () => {
  assert.match(html, /function handleFine\s*\(/);
  assert.match(html, /function commitFine\s*\(/);
  assert.match(html, /function renderWallet\s*\(/);
  assert.match(html, /fineForm\.addEventListener\(["']submit["'],\s*handleFine\)/);
});

test("罚款表单在打开确认框前校验累计金额上限并就地提示", () => {
  const source = appFunctionSource("handleFine");
  assert.match(source, /normalizeFineWallet\(state\.fine_wallet\)/);
  assert.match(source, /Number\.isSafeInteger\(normalizedWallet\.total_yuan \+ amountYuan\)/);
  assert.match(source, /fineAmount\.setCustomValidity\(/);
  assert.match(source, /fineAmount\.reportValidity\(\)/);
  assert.match(source, /fineAmount\.focus\(\)/);
  assert.ok(
    source.indexOf("normalizedWallet.total_yuan + amountYuan") < source.indexOf("openModal("),
    "累计金额上限校验必须发生在打开确认框之前"
  );
});

test("罚款确认文案明确记录后即视为已支付", () => {
  assert.match(
    appFunctionSource("handleFine"),
    /记录后视为已支付并计入累计罚款/
  );
});

test("总历史和备份包含罚款数据", () => {
  assert.match(html, /function combinedHistory\s*\(/);
  assert.match(html, /fine_wallet:\s*state\.fine_wallet/);
  assert.match(html, /现金罚款/);
});

test("清空入口明确提示会删除卡片历史和罚款记录", () => {
  assert.match(html, /删除积分、所有卡片历史记录和罚款记录/);
});
