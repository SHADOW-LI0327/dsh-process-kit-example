#!/usr/bin/env node
/**
 * FEAT-001 电商 app · Web 前端原型图生成器（唯一可复现来源）
 *
 * 这份脚本同时是三样东西：
 *   ① **出图**：逐屏调用 PhotoCraft CLI 建 PSD（每层一个命名图层）→ 合成 PNG（交付物）；
 *   ② **分层源**：布局以「命名图层清单」的形式写在代码里，并另存 `layers.<屏幕名>.json`（PSD 本身也是分层源）；
 *   ③ **几何来源**：`bounds` 不在这里写死 —— 跑完后由适配器
 *      `check-ui-geometry.mjs --from-photocraft <psd> --emit geometry.<屏幕名>.json`
 *      从 PSD 真实导出。本脚本只负责把图做出来，不负责宣布它长什么样。
 *
 * 视觉取值逐字照抄 `docs/process/ui/tokens.md`（通用默认层；项目未配 UI 项目令牌）；
 * 布局骨架照抄 `docs/process/ui/recipe.md`（1280×800 @72ppi 桌面骨架 + 页头基线）。
 *
 * 用法（仓库根执行）：
 *   node docs/process/prototypes/FEAT-001/build-prototypes.mjs
 *   node scripts/process/check-ui-geometry.mjs --from-photocraft <psd> --emit <geometry.json> --intent <intent.json>
 *   node scripts/process/check-ui-geometry.mjs --prototypes docs/process/prototypes --id FEAT-001 --verify
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)); // docs/process/prototypes/FEAT-001
const ID = "FEAT-001";
const CLI = process.env.PHOTOCRAFT_CLI ?? "photocraft-cli";

// ────────────────────────────────────────────────────────────────────────────
// 设计令牌：**逐字照抄** docs/process/ui/tokens.md（通用默认层）
// ────────────────────────────────────────────────────────────────────────────
const TOK = {
  bg: "#0d1117", // §4 页面底色
  base: "#161b22", // §4 常规面板 / 卡片
  elevated: "#1c2129", // §4 抬起表面
  overlay: "#22272e", // §4 最高层
  text: "#e6edf3", // §4 主文字（14.64:1 on base）
  muted: "#9ba7b4", // §4 次要文字（7.07:1 on base）；只用于 ≥14px
  accentFill: "#1f6feb",
  accentText: "#79c0ff", // 文字档：on 胶囊底 7.21:1
  successFill: "#3fb950",
  successText: "#7ee787", // 7.97:1
  warnFill: "#d29922",
  warnText: "#e3b341",
  dangerFill: "#f85149",
  dangerText: "#ff7b72", // 6.86:1 on base
  mutedFill: "#6e7681",
  // §4 填充档 α 对照表（本篇只用到这三档，值照抄，不自创 α）
  alpha: { 文字底: 0.18, 图形填充: 0.35, 轨道: 0.14 },
  // §5 圆角
  radius: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 },
  // §6 控件高度
  control: { sm: 32, md: 36, lg: 44, xl: 52 },
  // §3 中文 tracking 映射（1/1000 em）；表内没有的字号取**相邻更小档**
  tracking: { 11: 80, 12: 80, 13: 60, 14: 45, 15: 40, 16: 40, 17: 30, 20: 24, 24: 22, 26: 20, 30: 0, 34: 0 },
  size: { xs: 12, sm: 13, base: 14, body: 15, md: 16, lg: 17, xl: 20, "2xl": 24, "3xl": 30, "4xl": 34 },
};

const FONT = "Hiragino Sans GB"; // 本机可用；引擎按名字解析（bounds 随之变化，probe 已实测）
const CANVAS = { width: 1280, height: 800, resolution: 72 }; // ppi 必须 72（tokens 铁律 1）
const BAND = { left: 240, right: 1280 }; // 内容区横向带：侧栏右边缘 → 画布右边缘
const CX = 280; // 内容区左边界（240 + 40px 外边距）
const CR = 1240; // 内容区右边界（1280 − 40px 外边距）
const CARD_R = TOK.radius.lg; // 桌面卡片圆角 16

const px = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** 把令牌色按给定 α 叠在底色上 —— α 一律取自 tokens §4 对照表。 */
function comp(hex, alpha, bgHex) {
  const a = px(hex), b = px(bgHex);
  const hx = (v) => Math.round(v).toString(16).padStart(2, "0");
  return `#${[0, 1, 2].map((i) => hx(a[i] * alpha + b[i] * (1 - alpha))).join("")}`;
}
const track = (size) => TOK.tracking[size] ?? 0;
const yuan = (cents) => `¥ ${(cents / 100).toFixed(2)}`;

// ────────────────────────────────────────────────────────────────────────────
// 极小布局 DSL：每个绘制动作登记为一个**命名图层**，并记录作者意图
// ────────────────────────────────────────────────────────────────────────────
class Page {
  constructor(screen) {
    this.screen = screen;
    this.cmds = []; // [{cmd, params}] → 交给 photocraft-cli run
    this.layers = []; // 设计侧登记（分层源 + 意图）
    this.align = {}; // layerName -> "center"（写进 intent.json，供门禁 ⑤ 判定）
  }
  designRect(name) {
    const l = this.layers.find((x) => x.name === name && x.rect);
    return l?.rect ?? null;
  }
  shape({ name, x, y, w, h, r = 0, fill = null, stroke = null }) {
    const params = { kind: r > 0 ? "roundedRect" : "rect", rect: [x, y, w, h], fill, name };
    if (r > 0) params.radii = r;
    if (stroke) params.stroke = stroke;
    this.cmds.push({ cmd: "shape.create", params });
    this.layers.push({ name, kind: "shape", rect: [x, y, w, h] });
    return name;
  }
  /**
   * 文本图层。位置三选一：
   *  · `x`      左对齐到 x（点文本锚点）
   *  · `right`  右边缘对齐到 right（先摆、再量、用 layer.translate 补差）
   *  · `centerX` 水平中心对齐到 centerX
   *  · `container` 在容器内水平+垂直居中（同时写进 intent.json 的 align）
   */
  text({ name, text, size, color, x = null, right = null, centerX = null, container = null, baseline = null }) {
    let bx = x, by = baseline;
    if (container) {
      const r = this.designRect(container) ?? [0, 0, 0, 0];
      bx = r[0] + 8;
      by = r[1] + 8;
      this.align[name] = "center";
    } else if (bx === null) {
      bx = right !== null ? right - 200 : centerX - 100;
    }
    if (by === null) throw new Error(`${name}: container 或 baseline 必须给一个`);
    this.cmds.push({
      cmd: "type.create",
      params: { x: Math.round(bx), y: Math.round(by), text, size, color, font: FONT, tracking: track(size), name },
    });
    const intent = container ? { kind: "box", container } : right !== null ? { kind: "right", target: right } : centerX !== null ? { kind: "centerX", target: centerX } : null;
    this.layers.push({ name, kind: "text", text, sizePt: size, baseline: by, intent });
    return name;
  }
  centered(opts) {
    return this.text({ ...opts, container: opts.container });
  }
}

/** 主按钮：底 = accent 填充档 @0.20 + 描边 accent @0.45，字 = accent 文字档（7.21:1，tokens §4 配方）。 */
function primaryButton(p, { name, label, x, y, w, h = TOK.control.lg, bg = TOK.bg }) {
  p.shape({
    name, x, y, w, h, r: TOK.radius.md,
    fill: comp(TOK.accentFill, 0.2, bg),
    stroke: { width: 1, color: comp(TOK.accentFill, 0.45, bg), align: "inside" },
  });
  p.centered({ name: `${name}-文字`, container: name, text: label, size: TOK.size.body, color: TOK.accentText });
}
/** 次按钮：底 = elevated 表面（tokens §4），描边 = 低透明度白（轨道档 0.14），字 = 主文字档。 */
function secondaryButton(p, { name, label, x, y, w, h = TOK.control.lg, bg = TOK.bg }) {
  p.shape({
    name, x, y, w, h, r: TOK.radius.md,
    fill: TOK.elevated,
    stroke: { width: 1, color: comp("#ffffff", TOK.alpha.轨道, bg), align: "inside" },
  });
  p.centered({ name: `${name}-文字`, container: name, text: label, size: TOK.size.body, color: TOK.text });
}
/** 状态胶囊：底 = 语义填充档 @0.18，字 = 语义文字档（同色不同档，tokens §4 标准配方）。 */
function pill(p, { name, label, x, y, w = 96, h = 26, fillHex, textHex, bg = TOK.base }) {
  p.shape({ name, x, y, w, h, r: h / 2, fill: comp(fillHex, TOK.alpha.文字底, bg) });
  p.centered({ name: `${name}-文字`, container: name, text: label, size: TOK.size.sm, color: textHex });
}
/** 首字占位色块（核对件 N-6：纯 CSS 色块 + 商品名首字，无图片素材）。 */
function chip(p, { name, initial, x, y, size, r, fillHex, textHex, bg, font = 24 }) {
  p.shape({ name, x, y, w: size, h: size, r, fill: comp(fillHex, TOK.alpha.文字底, bg) });
  p.centered({ name: `${name}-首字`, container: name, text: initial, size: font, color: textHex });
}

// ── 通用骨架：侧栏 + 页头（recipe 桌面骨架）──
function chrome(p, { title, subtitle, action, active, badge }) {
  p.text({ name: "侧栏-logo", text: "电商小铺", size: TOK.size.lg, color: TOK.text, x: 32, baseline: 46 });
  p.shape({ name: "侧栏-分隔线", x: 16, y: 72, w: 208, h: 1, fill: comp("#ffffff", TOK.alpha.轨道, TOK.bg) });
  const navs = [
    ["商品列表", "首页商品列表"],
    ["购物车", "购物车管理页"],
    ["订单列表", "订单列表页面"],
  ];
  navs.forEach(([label, screen], i) => {
    const y = 88 + i * 56;
    const on = screen === active;
    if (on) {
      p.shape({
        name: `侧栏-选中背板-${label}`, x: 16, y, w: 208, h: 40, r: 10,
        fill: comp(TOK.accentFill, TOK.alpha.文字底, TOK.bg),
      });
    }
    p.text({
      name: `侧栏-导航-${label}`, text: label, size: TOK.size.body,
      color: on ? TOK.accentText : TOK.text, // 选中项用文字档：#1f6feb 当字只有 2.97:1
      x: 40, baseline: y + 26,
    });
  });
  p.text({ name: "标题", text: title, size: 26, color: TOK.text, x: CX, baseline: 76 });
  p.text({ name: "副标题", text: subtitle, size: TOK.size.sm, color: TOK.text, x: CX, baseline: 106 });
  p.text({ name: "页头件数徽标", text: badge, size: TOK.size.body, color: TOK.accentText, right: 1040, baseline: 106 });
  primaryButton(p, { name: "主按钮-页头", label: action, x: CR - 176, y: 56, w: 176 });
}

// ── 示意数据（**非种子定稿**：PRD/契约未定商品字样，见 ui-spec §七 UQ-3）──
const PRODUCTS = [
  { name: "手冲咖啡壶", price: 12900, stock: 8, desc: "玻璃壶身，300ml", tone: ["accentFill", "accentText"] },
  { name: "陶瓷滤杯", price: 6800, stock: 6, desc: "V60 锥形，单人份", tone: ["successFill", "successText"] },
  { name: "单品豆 250g", price: 8800, stock: 12, desc: "日晒处理，中浅烘", tone: ["warnFill", "warnText"] },
  { name: "手摇磨豆机", price: 39900, stock: 3, desc: "不锈钢磨芯，可调档", tone: ["dangerFill", "dangerText"] },
  { name: "电子秤", price: 15900, stock: 5, desc: "0.1g 精度，带计时", tone: ["accentFill", "accentText"] },
  { name: "滤纸 100 张", price: 2900, stock: 20, desc: "无漂白，02 号", tone: ["successFill", "successText"] },
  { name: "保温杯", price: 19900, stock: 4, desc: "316 内胆，350ml", tone: ["warnFill", "warnText"] },
  { name: "壶嘴清洁刷", price: 1900, stock: 15, desc: "木质柄，细毛刷", tone: ["dangerFill", "dangerText"] },
];

// ── 屏幕 1：首页商品列表（3 列 × 3 行：8 件商品 + 页头）──
function buildHomeList() {
  const p = new Page("首页商品列表");
  chrome(p, { title: "商品列表", subtitle: "共 8 件商品，价格以元显示", action: "去购物车", active: "首页商品列表", badge: "购物车 · 3 件" });
  const W = 304, H = 176;
  PRODUCTS.forEach((prod, i) => {
    const x = CX + (i % 3) * (W + 24);
    const y = 144 + Math.floor(i / 3) * (H + 24);
    p.shape({ name: `商品卡-${i + 1}`, x, y, w: W, h: H, r: CARD_R, fill: TOK.base });
    chip(p, { name: `占位色块-${i + 1}`, initial: prod.name[0], x: x + 24, y: y + 24, size: 56, r: TOK.radius.md, fillHex: TOK[prod.tone[0]], textHex: TOK[prod.tone[1]], bg: TOK.base });
    p.text({ name: `商品名-${i + 1}`, text: prod.name, size: TOK.size.md, color: TOK.text, x: x + 96, baseline: y + 48 });
    p.text({ name: `价格-${i + 1}`, text: yuan(prod.price), size: TOK.size.xl, color: TOK.text, x: x + 96, baseline: y + 80 });
    p.text({ name: `库存-${i + 1}`, text: `库存 ${prod.stock} 件`, size: TOK.size.sm, color: TOK.text, x: x + 96, baseline: y + 108 });
    p.text({ name: `描述-${i + 1}`, text: prod.desc, size: TOK.size.body, color: TOK.muted, x: x + 24, baseline: y + 148 });
  });
  return p;
}

// ── 屏幕 2：商品详情页面 ──
function buildDetail() {
  const p = new Page("商品详情页面");
  const prod = PRODUCTS[0];
  chrome(p, { title: "商品详情", subtitle: "价格以元显示，单次加购上限 8 件", action: "去购物车", active: "首页商品列表", badge: "购物车 · 3 件" });
  chip(p, { name: "详情占位色块", initial: prod.name[0], x: CX, y: 144, size: 176, r: CARD_R, fillHex: TOK.accentFill, textHex: TOK.accentText, bg: TOK.bg, font: TOK.size["3xl"] });
  p.shape({ name: "详情信息卡", x: 472, y: 144, w: 768, h: 344, r: CARD_R, fill: TOK.base });
  p.text({ name: "详情商品名", text: prod.name, size: TOK.size["2xl"], color: TOK.text, x: 496, baseline: 184 });
  p.text({ name: "详情价格", text: yuan(prod.price), size: TOK.size["3xl"], color: TOK.text, x: 496, baseline: 240 });
  p.text({ name: "详情库存", text: `库存 ${prod.stock} 件`, size: TOK.size.body, color: TOK.text, x: 496, baseline: 280 });
  p.shape({ name: "详情分隔线", x: 496, y: 312, w: 744, h: 1, fill: comp("#ffffff", TOK.alpha.轨道, TOK.base) });
  p.text({ name: "详情描述标签", text: "商品描述", size: TOK.size.sm, color: TOK.text, x: 496, baseline: 352 });
  p.text({ name: "详情描述", text: `${prod.desc}；手冲与冷萃两用，附滤纸 5 张。`, size: TOK.size.body, color: TOK.muted, x: 496, baseline: 384 });
  primaryButton(p, { name: "主按钮-加入购物车", label: "加入购物车", x: 496, y: 416, w: 200, bg: TOK.base });
  secondaryButton(p, { name: "次按钮-返回列表", label: "返回商品列表", x: 712, y: 416, w: 176, bg: TOK.base });
  return p;
}

// ── 屏幕 3：购物车管理页（三行覆盖 可用 / 已达上限 / 已达下限 三种步进器状态）──
function buildCart() {
  const p = new Page("购物车管理页");
  const rows = [
    { prod: PRODUCTS[0], qty: 3 },
    { prod: PRODUCTS[1], qty: 8 },
    { prod: PRODUCTS[5], qty: 1 },
  ];
  const count = rows.reduce((s, r) => s + r.qty, 0);
  const total = rows.reduce((s, r) => s + r.prod.price * r.qty, 0);
  chrome(p, { title: "购物车", subtitle: `共 ${count} 件商品，价格以元显示`, action: "继续购物", active: "购物车管理页", badge: `购物车 · ${count} 件` });
  p.shape({ name: "购物车表格卡", x: CX, y: 144, w: 960, h: 264, r: CARD_R, fill: TOK.base });
  p.text({ name: "表头-商品", text: "商品", size: TOK.size.sm, color: TOK.text, x: 304, baseline: 185 });
  p.text({ name: "表头-单价", text: "单价", size: TOK.size.sm, color: TOK.text, right: 700, baseline: 185 });
  p.text({ name: "表头-件数", text: "件数", size: TOK.size.sm, color: TOK.text, centerX: 860, baseline: 185 });
  p.text({ name: "表头-小计", text: "小计", size: TOK.size.sm, color: TOK.text, right: 1140, baseline: 185 });
  p.text({ name: "表头-操作", text: "操作", size: TOK.size.sm, color: TOK.text, centerX: 1190, baseline: 185 });
  p.shape({ name: "表头分隔线", x: 304, y: 212, w: 912, h: 1, fill: comp("#ffffff", TOK.alpha.轨道, TOK.base) });
  rows.forEach((r, i) => {
    const b = 253 + i * 52;
    chip(p, { name: `行占位-${i + 1}`, initial: r.prod.name[0], x: 304, y: b - 24, size: 32, r: TOK.radius.sm, fillHex: TOK[r.prod.tone[0]], textHex: TOK[r.prod.tone[1]], bg: TOK.base, font: TOK.size.body });
    p.text({ name: `行商品名-${i + 1}`, text: r.prod.name, size: TOK.size.body, color: TOK.text, x: 352, baseline: b });
    p.text({ name: `行单价-${i + 1}`, text: yuan(r.prod.price), size: TOK.size.body, color: TOK.text, right: 700, baseline: b });
    p.shape({ name: `步进器-${i + 1}`, x: 800, y: b - 18, w: 120, h: TOK.control.md, r: TOK.radius.md, fill: TOK.elevated });
    // 件数 1 ⇒「－」禁用；件数 8 ⇒「＋」禁用。
    // 禁用档用 muted 文字档（6.61:1），且字形取**全角**＋/－（笔画覆盖得住像素）——
    // 半角 +/- 的 1px 笔画在 15px 下实测只能到 4.20:1，会掉到 4.5 以下（门禁 ⑧ 实测抓到的）
    p.text({ name: `步进器减-${i + 1}`, text: "－", size: TOK.size.body, color: r.qty === 1 ? TOK.muted : TOK.text, centerX: 818, baseline: b + 6 });
    p.text({ name: `步进器值-${i + 1}`, text: String(r.qty), size: TOK.size.body, color: TOK.text, centerX: 860, baseline: b + 6 });
    p.text({ name: `步进器加-${i + 1}`, text: "＋", size: TOK.size.body, color: r.qty === 8 ? TOK.muted : TOK.text, centerX: 902, baseline: b + 6 });
    p.text({ name: `行小计-${i + 1}`, text: yuan(r.prod.price * r.qty), size: TOK.size.body, color: TOK.text, right: 1140, baseline: b });
    p.text({ name: `行删除-${i + 1}`, text: "删除", size: TOK.size.body, color: TOK.dangerText, centerX: 1190, baseline: b });
    p.shape({ name: `行分隔线-${i + 1}`, x: 304, y: b + 26, w: 912, h: 1, fill: comp("#ffffff", TOK.alpha.轨道, TOK.base) });
  });
  cartSummary(p, { total, count });
  return p;
}

/** 购物车底部结算区（合计 ¥ + 去结算）。 */
function cartSummary(p, { total, count }) {
  p.shape({ name: "结算卡", x: CX, y: 432, w: 960, h: 144, r: CARD_R, fill: TOK.base });
  p.text({ name: "结算件数", text: `共 ${count} 件商品`, size: TOK.size.sm, color: TOK.text, x: 304, baseline: 472 });
  p.text({ name: "结算合计标签", text: "合计", size: TOK.size.body, color: TOK.muted, x: 304, baseline: 508 });
  p.text({ name: "结算合计金额", text: yuan(total), size: TOK.size["3xl"], color: TOK.text, x: 304, baseline: 552 });
  primaryButton(p, { name: "主按钮-去结算", label: "去结算", x: 1024, y: 480, w: 192, bg: TOK.base });
  p.text({ name: "结算提示", text: "下单即支付成功（假支付）", size: TOK.size.sm, color: TOK.text, x: 1024, baseline: 556 });
}

// ── 屏幕 4：结算下单页面（下单入口）──
function buildCheckout() {
  const p = new Page("结算下单页面");
  const items = [
    { prod: PRODUCTS[0], qty: 2 },
    { prod: PRODUCTS[1], qty: 1 },
  ];
  const count = items.reduce((s, r) => s + r.qty, 0);
  const total = items.reduce((s, r) => s + r.prod.price * r.qty, 0);
  chrome(p, { title: "结算", subtitle: "确认订单内容后提交，下单即支付成功", action: "返回购物车", active: "购物车管理页", badge: `购物车 · ${count} 件` });
  p.shape({ name: "订单内容卡", x: CX, y: 144, w: 960, h: 288, r: CARD_R, fill: TOK.base });
  p.text({ name: "订单内容标题", text: "订单内容", size: TOK.size.xl, color: TOK.text, x: 304, baseline: 192 });
  p.shape({ name: "内容分隔线", x: 304, y: 216, w: 912, h: 1, fill: comp("#ffffff", TOK.alpha.轨道, TOK.base) });
  items.forEach((r, i) => {
    const b = 260 + i * 52;
    p.text({ name: `内容商品名-${i + 1}`, text: r.prod.name, size: TOK.size.body, color: TOK.text, x: 304, baseline: b });
    p.text({ name: `内容件数-${i + 1}`, text: `× ${r.qty} 件`, size: TOK.size.sm, color: TOK.text, right: 900, baseline: b });
    p.text({ name: `内容小计-${i + 1}`, text: yuan(r.prod.price * r.qty), size: TOK.size.body, color: TOK.text, right: 1216, baseline: b });
  });
  p.shape({ name: "合计分隔线", x: 304, y: 344, w: 912, h: 1, fill: comp("#ffffff", TOK.alpha.轨道, TOK.base) });
  p.text({ name: "应付合计标签", text: "应付合计", size: TOK.size.body, color: TOK.muted, x: 304, baseline: 396 });
  p.text({ name: "应付合计金额", text: yuan(total), size: TOK.size["3xl"], color: TOK.text, right: 1216, baseline: 396 });
  primaryButton(p, { name: "主按钮-提交订单", label: "提交订单", x: CR - 192, y: 480, w: 192 });
  secondaryButton(p, { name: "次按钮-返回购物车", label: "返回购物车", x: CR - 192 - 16 - 192, y: 480, w: 192 });
  p.text({ name: "下单提示", text: "下单即支付成功（假支付），无需填写收货信息", size: TOK.size.sm, color: TOK.text, x: CX, baseline: 508 });
  return p;
}

// ── 屏幕 5：订单列表页面 ──
function buildOrders() {
  const p = new Page("订单列表页面");
  chrome(p, { title: "订单列表", subtitle: "按下单时间倒序，最近一单在最上面", action: "继续购物", active: "订单列表页面", badge: "购物车 · 0 件" });
  const orders = [
    { no: "SO-20261015-0002", time: "2026-10-15 10:24", items: ["手冲咖啡壶 × 2 件", "陶瓷滤杯 × 1 件"], total: 32600 },
    { no: "SO-20261015-0001", time: "2026-10-15 10:02", items: ["手摇磨豆机 × 1 件"], total: 39900 },
  ];
  orders.forEach((o, i) => {
    const y = 144 + i * 224;
    p.shape({ name: `订单卡-${i + 1}`, x: CX, y, w: 960, h: 200, r: CARD_R, fill: TOK.base });
    p.text({ name: `订单号-${i + 1}`, text: `订单号 ${o.no}`, size: TOK.size.body, color: TOK.text, x: 304, baseline: y + 40 });
    pill(p, { name: `订单状态-${i + 1}`, label: "已支付", x: 1120, y: y + 28, fillHex: TOK.successFill, textHex: TOK.successText });
    p.text({ name: `下单时间-${i + 1}`, text: `下单时间 ${o.time}`, size: TOK.size.sm, color: TOK.text, x: 304, baseline: y + 68 });
    p.shape({ name: `订单分隔线-${i + 1}`, x: 304, y: y + 84, w: 912, h: 1, fill: comp("#ffffff", TOK.alpha.轨道, TOK.base) });
    o.items.forEach((line, j) => {
      p.text({ name: `订单行-${i + 1}-${j + 1}`, text: line, size: TOK.size.body, color: TOK.muted, x: 304, baseline: y + 116 + j * 28 });
    });
    p.text({ name: `订单合计标签-${i + 1}`, text: "合计", size: TOK.size.sm, color: TOK.text, right: 1140, baseline: y + 116 });
    p.text({ name: `订单合计金额-${i + 1}`, text: yuan(o.total), size: TOK.size["2xl"], color: TOK.text, right: 1216, baseline: y + 156 });
  });
  p.text({ name: "订单页脚说明", text: "订单只保存在本次会话中，清除浏览器数据后不再显示", size: TOK.size.sm, color: TOK.text, x: CX, baseline: 620 });
  return p;
}

// ── 屏幕 6：购物车空态页（空车仍保留结算区，使「空车下单被拒」可观察）──
function buildCartEmpty() {
  const p = new Page("购物车空态页");
  chrome(p, { title: "购物车", subtitle: "共 0 件商品，价格以元显示", action: "继续购物", active: "购物车管理页", badge: "购物车 · 0 件" });
  p.shape({ name: "购物车表格卡", x: CX, y: 144, w: 960, h: 264, r: CARD_R, fill: TOK.base });
  p.shape({ name: "空态图标", x: 728, y: 200, w: 64, h: 64, r: CARD_R, fill: comp(TOK.mutedFill, TOK.alpha.图形填充, TOK.base) });
  p.centered({ name: "空态图标字", container: "空态图标", text: "空", size: TOK.size["2xl"], color: TOK.muted });
  p.centered({ name: "空态说明", container: "购物车表格卡", text: "购物车是空的", size: TOK.size.body, color: TOK.text });
  p.text({ name: "空态次级说明", text: "去商品列表挑一件，加入购物车后可在这里提交订单", size: TOK.size.sm, color: TOK.text, centerX: 760, baseline: 332 });
  cartSummary(p, { total: 0, count: 0 });
  return p;
}

// ────────────────────────────────────────────────────────────────────────────
// 出图：建 PSD → 量一次 → layer.translate 补差（居中 / 右对齐）→ 复量确认 → 合成 PNG
// ────────────────────────────────────────────────────────────────────────────
const run = (args) => execFileSync(CLI, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const info = (psd) => JSON.parse(run(["info", psd, "--compact"]));

function flatLayers(psd) {
  const doc = info(psd);
  const out = [];
  const walk = (ls) => (ls ?? []).forEach((l) => { out.push(l); walk(l.children); });
  walk(doc.layers);
  return new Map(out.filter((l) => Array.isArray(l.bounds)).map((l) => [l.name, l]));
}
const centerOf = (b) => ({ x: b[0] + b[2] / 2, y: b[1] + b[3] / 2 });

function deltaFor(layer, byName) {
  const it = layer.intent;
  if (!it) return null;
  const m = byName.get(layer.name);
  if (!m) return null;
  if (it.kind === "right") return { dx: Math.round(it.target - (m.bounds[0] + m.bounds[2])), dy: 0 };
  if (it.kind === "centerX") return { dx: Math.round(it.target - centerOf(m.bounds).x), dy: 0 };
  if (it.kind === "box") {
    const box = byName.get(it.container);
    if (!box) return null;
    const c = centerOf(box.bounds);
    const cur = centerOf(m.bounds);
    return { dx: Math.round(c.x - cur.x), dy: Math.round(c.y - cur.y) };
  }
  return null;
}
const deviation = (layer, byName) => {
  const d = deltaFor(layer, byName);
  return d ? Math.max(Math.abs(d.dx), Math.abs(d.dy)) : 0;
};

function emit(page) {
  const psd = join(HERE, `${page.screen}-${ID}.psd`);
  const args = ["run", "--new", JSON.stringify({ ...CANVAS, background: TOK.bg, name: page.screen })];
  for (const { cmd, params } of page.cmds) args.push("--cmd", cmd, "--params", JSON.stringify(params));
  args.push("--out", psd, "--format", "psd");
  run(args);

  // 第一遍度量 → 补差（recipe：先摆、再量、用 layer.translate 补差）
  const before = flatLayers(psd);
  const fixes = [];
  for (const l of page.layers) {
    if (l.kind !== "text") continue;
    const d = deltaFor(l, before);
    if (d && (d.dx || d.dy)) fixes.push({ ...d, layer: before.get(l.name).id, name: l.name });
  }
  if (fixes.length) {
    const a2 = ["run", psd];
    for (const f of fixes) a2.push("--cmd", "layer.translate", "--params", JSON.stringify({ layer: f.layer, dx: f.dx, dy: f.dy }));
    a2.push("--out", psd, "--format", "psd");
    run(a2);
  }

  // 复量：补差后偏差必须 ≤1px（作为原始证据打印出来）
  const after = flatLayers(psd);
  const residual = page.layers
    .filter((l) => l.kind === "text")
    .map((l) => ({ name: l.name, dev: deviation(l, after) }))
    .filter((r) => r.dev > 1);
  run(["convert", psd, join(HERE, `${page.screen}-${ID}.png`)]);

  writeFileSync(
    join(HERE, `layers.${page.screen}.json`),
    `${JSON.stringify({
      screen: page.screen,
      id: ID,
      canvas: `${CANVAS.width}×${CANVAS.height} @ ${CANVAS.resolution} ppi`,
      generatedBy: "docs/process/prototypes/FEAT-001/build-prototypes.mjs",
      tokens: "docs/process/ui/tokens.md（通用默认层；项目未配 UI 项目令牌）",
      note: "分层源（脚本侧图层清单）。PSD 本身即原生分层源；此处 bounds 为引擎 info 导出值，仅供人工比读，几何判据用 geometry.<屏幕名>.json。",
      layers: page.layers.map((l) => {
        const m = after.get(l.name);
        return { name: l.name, kind: l.kind, ...(l.text ? { text: l.text, sizePt: l.sizePt } : {}), bounds: m?.bounds ?? l.rect };
      }),
    }, null, 2)}\n`,
  );
  writeFileSync(
    join(HERE, `intent.${page.screen}.json`),
    `${JSON.stringify({
      screen: page.screen,
      note: "作者意图：band = 内容区横向带；align = 声明应当居中的元素。bounds 一律来自 PSD 导出，绝不出现在本文件",
      band: BAND,
      align: page.align,
    }, null, 2)}\n`,
  );
  console.log(`✓ ${page.screen}：图层 ${page.layers.length}｜补差 ${fixes.length} 处｜残余偏差 ${residual.length ? residual.map((r) => `${r.name} ${r.dev.toFixed(1)}px`).join("；") : "0"}`);
}

const builders = [
  ["首页商品列表", buildHomeList],
  ["商品详情页面", buildDetail],
  ["购物车管理页", buildCart],
  ["结算下单页面", buildCheckout],
  ["订单列表页面", buildOrders],
  ["购物车空态页", buildCartEmpty],
];
mkdirSync(HERE, { recursive: true });
for (const [, fn] of builders) emit(fn());
console.log(`\n完成：${builders.length} 屏 → ${HERE}`);
