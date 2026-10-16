#!/usr/bin/env node
/**
 * FEAT-002 电商 app Phase 2 · 视觉改版原型图生成器（唯一可复现来源）
 *
 * 这份脚本同时是三样东西：
 *   ① **出图**：逐屏调用 PhotoCraft CLI 建 PSD（每层一个命名图层）→ 合成 PNG（交付物）；
 *   ② **分层源**：布局以「命名图层清单」的形式写在代码里，并另存 `layers.<屏幕名>.json`（PSD 本身也是分层源）；
 *   ③ **几何来源**：`bounds` 不在这里写死 —— 跑完后由适配器
 *      `check-ui-geometry.mjs --from-photocraft <psd> --emit geometry.<屏幕名>.json`
 *      从 PSD 真实导出。本脚本只负责把图做出来，不负责宣布它长什么样。
 *
 * 视觉语言的来源（**不是本项目既有令牌** —— 本仓无 UI 项目令牌，见 PROJECT.md §4）：
 *   · 版式与配色取向 = 需求核对件 §2.1 展开② 的 T-1~T-10（浅底 / 橙红主色 / 双列商品流 /
 *     底部 Tab / 圆角卡 + 轻阴影 / 渐变胶囊 CTA / 顶部搜索框 / 角标 / 移动优先）；
 *   · 数值骨架 = `docs/process/ui/tokens.md`（间距阶梯 / 字号 + 中文 tracking 映射 / 两层语义色 /
 *     移动端 390×844 基准 / touch-target 44）与 `docs/process/ui/recipe.md`（移动端骨架）；
 *   · 字面值以 `docs/process/prd/FEAT-002-ui-spec.md` §8.2 为准，本文件是它的可执行副本。
 *
 * ⚠ 本包**不使用任何淘宝素材**（商标 / Logo / 图标 / 图片 / 独创文案）：商品主图是**本仓自制 SVG**
 *   （规范见 ui-spec §八 `P-01`~`P-08`），原型图里用同一套图形语义的矢量小图占位（见下方 art()）。
 *
 * 用法（仓库根执行）：
 *   node docs/process/prototypes/FEAT-002/build-prototypes.mjs
 *   node scripts/process/check-ui-geometry.mjs --from-photocraft <psd> --emit <geometry.json> --intent <intent.json>
 *   node scripts/process/check-ui-geometry.mjs --prototypes docs/process/prototypes --id FEAT-002 --verify
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)); // docs/process/prototypes/FEAT-002
const ID = "FEAT-002";
const CLI = process.env.PHOTOCRAFT_CLI ?? "photocraft-cli";

// ────────────────────────────────────────────────────────────────────────────
// 设计令牌（浅底橙红语言）：字面值 + 对比度全部在 ui-spec §8.2 有据可查
// 对比度按 WCAG 2.x 相对亮度算；数值已用独立脚本核过（ui-spec §8.2 ① 表内列明）
// ────────────────────────────────────────────────────────────────────────────
const T = {
  bg: "#F5F5F5", // 页面底（浅灰）
  surface: "#FFFFFF", // 内容卡（纯白）
  subtle: "#EDEFF2", // 次级底：输入框 / 步进器 / 禁用按钮 / 占位面
  border: "#E5E7EB", // 常规描边 / 分隔线
  borderStrong: "#8C8F94", // 强描边（3.19:1 on white）
  text: "#1F2329", // 主文字（15.78:1 on white / 14.48:1 on bg）
  textMuted: "#333940", // 次要文字 ≥13px（11.6:1 on white）—— 12–13px 中文实测掉 ~5.5：标称 ≥10 才有 4.5 的余量
  accent: "#7A2200", // 主色·文字档（价格 / 选中 Tab / 链接 / 角标字）（11.3:1 on white）
  accentFill: "#D93A00", // 主色·填充档（渐变胶囊亮端）（白字 4.61:1）
  accentFillDark: "#B33000", // 渐变胶囊暗端（白字 6.29:1）
  accentTint: "#FFE4D6", // 主色淡底（促销条 / 「秒杀」角标底）
  accentBadge: "#6E1E00", // 角标「秒杀」字（11.2:1 on #FFE4D6，为 12pt 抗锯齿留余量）
  success: "#083D19", // 「包邮」「已支付」（13.5:1 on white / 11.6:1 on #F0FDF4）
  successTint: "#F0FDF4",
  danger: "#8F1414", // 错误文字 / 删除（9.4:1 on white）
  dangerTint: "#FEF2F2",
  disabled: "#4A5057", // 禁用符号（8.4:1 on #EDEFF2）—— 禁用态**不靠低对比表达**
  artInk: "#7C2D12", // 商品主图插画墨色（与 accent 同色相）
  artInkSoft: "#FDBA74", // 商品主图插画铺色
  artBg: "#FFF7ED", // 商品主图底（浅橙）
  onAccent: "#FFFFFF", // 胶囊 CTA 上的字
};

const FONT = "Hiragino Sans GB"; // 本机可用；引擎按名字解析
const MOBILE = { width: 390, height: 1200, resolution: 72 }; // 390 宽（tokens §7）；高度取 960 = 内容 + Tab 栏 49 + 安全区 34 + 滚动留白
const MOBILE_VP = 844; // tokens §7 的 390×844 是**内容视口**；原型画布 1180 是为了让 8 张卡与底栏同时完整可见（引擎会裁掉越出画布的盒子）
const WIDE = { width: 1280, height: 800, resolution: 72 }; // 宽屏基准（桌面 1280×800）

// tracking 映射（tokens §3）：表内没有的字号取相邻更小档
const TRACK = { 11: 80, 12: 80, 13: 60, 14: 45, 15: 40, 16: 40, 17: 30, 20: 24, 22: 22, 24: 22, 26: 20, 30: 0, 34: 0 };
const track = (s) => TRACK[s] ?? 0;
const yuan = (cents) => `¥ ${(cents / 100).toFixed(2)}`;

// ────────────────────────────────────────────────────────────────────────────
// 极小布局 DSL：每个绘制动作登记为一个**命名图层**，并记录作者意图
// ────────────────────────────────────────────────────────────────────────────
class Page {
  constructor(screen, canvas, band, bg, viewport = false) {
    this.screen = screen;
    this.viewport = viewport; // true = 画布即**视口**（滚动内容按视口裁切是预期行为，不算越界）
    this.canvas = canvas;
    this.band = band; // 内容区横向带（intent.json）
    this.bg = bg;
    this.cmds = []; // [{cmd, params, layer}]
    this.layers = [];
    this.align = {};
    this.fixedNames = new Set(); // 固定定位图层名（视口版不随 scrollY 平移）
    this.scrollY = 0;
  }
  designRect(name) {
    const l = this.layers.find((x) => x.name === name && x.rect);
    return l?.rect ?? null;
  }
  shape({ name, x, y, w, h, r = 0, fill = null, stroke = null, kind = null, sides = null }) {
    const params = { kind: kind ?? (r > 0 ? "roundedRect" : "rect"), rect: [x, y, w, h], fill, name };
    if (r > 0) params.radii = r;
    if (sides) params.sides = sides;
    if (stroke) params.stroke = stroke;
    this.layers.push({ name, kind: "shape", rect: [x, y, w, h], render: { type: "shape", params } });
    return name;
  }
  gradient({ name, x, y, w, h, r = 0, from, to, angle = 180 }) {
    const params = {
      kind: r > 0 ? "roundedRect" : "rect",
      rect: [x, y, w, h],
      name,
      fill: { gradient: { stops: [[0, from], [1, to]], angle, style: "linear" } },
    };
    if (r > 0) params.radii = r;
    this.layers.push({ name, kind: "shape", rect: [x, y, w, h], render: { type: "shape", params } });
    return name;
  }
  /**
   * 文本图层。位置四选一：
   *  · `x`       左对齐到 x（点文本锚点）
   *  · `right`   右边缘对齐到 right（先摆、再量、用 layer.translate 补差）
   *  · `centerX` 水平中心对齐到 centerX
   *  · `container` 在容器内水平+垂直居中（同时写进 intent.json 的 align）
   */
  text({ name, text, size, color, x = null, right = null, centerX = null, container = null, baseline = null }) {
    let bx = x, by = baseline;
    if (container) {
      const r = this.designRect(container) ?? [0, 0, 0, 0];
      bx = r[0] + 8;
      by = r[1] + 8;
      // 容器整块在视口外（被视口裁切）⇒ 不登记 align：引擎读不到它，登记只会制造假失败。
      const offViewport = this.viewport && r[1] + r[3] > this.canvas.height;
      if (!offViewport) this.align[name] = "center";
    } else if (bx === null) {
      bx = right !== null ? right - 200 : centerX - 100;
    }
    if (by === null) throw new Error(`${name}: container 或 baseline 必须给一个`);
    const textParams = { x: Math.round(bx), y: Math.round(by), text, size, color, font: FONT, tracking: track(size), name };
    const intent = container
      ? { kind: "box", container, cx: bx + 100, cy: by }
      : right !== null
        ? { kind: "right", target: right }
        : centerX !== null
          ? { kind: "centerX", target: centerX }
          : null;
    this.layers.push({ name, kind: "text", text, sizePt: size, baseline: by, intent, render: { type: "text", params: textParams } });
    return name;
  }
  centered(opts) {
    return this.text({ ...opts, container: opts.container });
  }
  /** 把刚画的一批图层标记为**固定定位**（滚动时不动）：底栏 / 安全区条 / 页脚按钮条。 */
  fixed(...calls) {
    const add = (n) => {
      if (typeof n === "string") this.fixedNames.add(n);
      else if (Array.isArray(n)) n.forEach(add);
      else if (n && typeof n === "object") Object.values(n).forEach(add);
    };
    calls.forEach(add);
    return this;
  }
}

// ── 组件级绘制助手（每个都对应 ui-spec §二 组件判定表里的一条）──
/** 渐变胶囊 CTA：底 = accent 渐变（D93A00→B33000），字 = onAccent 白（两端均 ≥4.5:1）。 */
function cta(p, { name, label, x, y, w, h, r = null, size = 16 }) {
  p.gradient({ name, x, y, w, h, r: r ?? Math.round(h / 2), from: T.accentFill, to: T.accentFillDark, angle: 180 });
  p.centered({ name: `${name}文字`, container: name, text: label, size, color: T.onAccent });
}
/** 次按钮：底 = subtle，描边 = border，字 = 主文字档。 */
function secondary(p, { name, label, x, y, w, h, r = 12, size = 15 }) {
  p.shape({ name, x, y, w, h, r, fill: T.subtle, stroke: { width: 1, color: T.border, align: "inside" } });
  p.centered({ name: `${name}文字`, container: name, text: label, size, color: T.text });
}
/** 角标 / 标签胶囊：底 = 语义淡底，字 = 语义文字档。 */
function tag(p, { name, label, x, y, h = 18, size = 12, fill, color, padX = 8 }) {
  const w = Math.round(label.length * size * 1.06) + padX * 2;
  p.shape({ name, x: x - w, y, w, h, r: Math.round(h / 2), fill });
  p.centered({ name: `${name}文字`, container: name, text: label, size, color });
  return w;
}
/** 主图块：底 = artBg + 图形语义小图（Q-5：本仓自制矢量，**不外链任何第三方图片**）。 */
function artTile(p, { name, x, y, w, h, r, kit, bg = T.artBg }) {
  p.shape({ name, x, y, w, h, r, fill: bg });
  kit(p, name, x, y, w, h);
}
/** 步进器：底 = subtle + 边框，三格（－ 数字 ＋）。 */
function stepper(p, { name, x, y, w = 104, h = 36, qty, decOff, incOff }) {
  p.shape({ name, x, y, w, h, r: 10, fill: T.subtle, stroke: { width: 1, color: T.border, align: "inside" } });
  const cw = Math.round(w / 3);
  // 符号用 17px：15px 的单个数字 / 全角符号墨迹太稀，几何门禁 ⑧ 的稀疏采样会低估对比度
  p.text({ name: `${name}减`, text: "－", size: 17, color: decOff ? T.disabled : T.text, centerX: x + Math.round(cw / 2), baseline: y + 25 });
  p.text({ name: `${name}值`, text: String(qty), size: 17, color: T.text, centerX: x + cw + Math.round(cw / 2), baseline: y + 25 });
  p.text({ name: `${name}加`, text: "＋", size: 17, color: incOff ? T.disabled : T.text, centerX: x + cw * 2 + Math.round(cw / 2), baseline: y + 25 });
}

// ── 8 件商品主图的图形语义（与 server/src/seed.mjs:DEFAULT_SEED 的 8 个名字一一对应）──
// 每个 kit 只吃「图片区矩形」，用 2~4 个基础图元拼出**可辨认的日用器物轮廓**；
// 落到 `web/assets/products/P-00N.svg` 时是同一套语义的 SVG 版（规范见 ui-spec §八）。
const ink = T.artInk;
const soft = T.artInkSoft;
const KIT = {
  // P-001 手冲咖啡壶：壶身 + 细颈 + 壶嘴
  "手冲咖啡壶": (p, n, x, y, w, h) => {
    const u = w / 100;
    p.shape({ name: `${n}-壶身`, x: x + 32 * u, y: y + 42 * h / 100, w: 40 * u, h: 38 * h / 100, r: Math.round(6 * u), fill: soft, stroke: { width: 2, color: ink, align: "center" } });
    p.shape({ name: `${n}-壶颈`, x: x + 40 * u, y: y + 26 * h / 100, w: 10 * u, h: 18 * h / 100, r: Math.round(3 * u), fill: soft, stroke: { width: 2, color: ink, align: "center" } });
    p.shape({ name: `${n}-壶嘴`, x: x + 22 * u, y: y + 20 * h / 100, w: 20 * u, h: 8 * h / 100, r: Math.round(4 * u), fill: ink });
    p.shape({ name: `${n}-把手`, x: x + 68 * u, y: y + 48 * h / 100, w: 14 * u, h: 22 * h / 100, r: Math.round(7 * u), fill: ink });
  },
  // P-002 陶瓷滤杯：锥形杯 + 杯口 + 底座
  "陶瓷滤杯": (p, n, x, y, w, h) => {
    const u = w / 100;
    p.shape({ name: `${n}-锥体`, kind: "polygon", sides: 3, x: x + 28 * u, y: y + 32 * h / 100, w: 44 * u, h: 36 * h / 100, fill: soft, stroke: { width: 2, color: ink, align: "center" } });
    p.shape({ name: `${n}-杯口`, x: x + 24 * u, y: y + 26 * h / 100, w: 52 * u, h: 8 * h / 100, r: Math.round(4 * u), fill: ink });
    p.shape({ name: `${n}-底托`, x: x + 38 * u, y: y + 68 * h / 100, w: 24 * u, h: 7 * h / 100, r: Math.round(3 * u), fill: ink });
  },
  // P-003 单品豆 250g：包装袋 + 封口 + 三颗豆
  "单品豆 250g": (p, n, x, y, w, h) => {
    const u = w / 100;
    p.shape({ name: `${n}-袋身`, x: x + 30 * u, y: y + 30 * h / 100, w: 40 * u, h: 46 * h / 100, r: Math.round(5 * u), fill: soft, stroke: { width: 2, color: ink, align: "center" } });
    p.shape({ name: `${n}-封口`, x: x + 30 * u, y: y + 22 * h / 100, w: 40 * u, h: 8 * h / 100, r: Math.round(4 * u), fill: ink });
    p.shape({ name: `${n}-豆一`, kind: "ellipse", x: x + 38 * u, y: y + 52 * h / 100, w: 9 * u, h: 13 * h / 100, fill: ink });
    p.shape({ name: `${n}-豆二`, kind: "ellipse", x: x + 54 * u, y: y + 58 * h / 100, w: 9 * u, h: 13 * h / 100, fill: ink });
  },
  // P-004 手摇磨豆机：机身 + 摇柄 + 粉仓
  "手摇磨豆机": (p, n, x, y, w, h) => {
    const u = w / 100;
    p.shape({ name: `${n}-机身`, x: x + 36 * u, y: y + 34 * h / 100, w: 28 * u, h: 40 * h / 100, r: Math.round(8 * u), fill: soft, stroke: { width: 2, color: ink, align: "center" } });
    p.shape({ name: `${n}-摇柄`, x: x + 62 * u, y: y + 30 * h / 100, w: 18 * u, h: 6 * h / 100, r: 3, fill: ink });
    p.shape({ name: `${n}-摇臂`, kind: "ellipse", x: x + 76 * u, y: y + 24 * h / 100, w: 10 * u, h: 12 * h / 100, fill: ink });
    p.shape({ name: `${n}-粉仓`, x: x + 40 * u, y: y + 72 * h / 100, w: 20 * u, h: 8 * h / 100, r: 3, fill: ink });
  },
  // P-005 电子秤：秤盘 + 底座 + 显示屏
  "电子秤": (p, n, x, y, w, h) => {
    const u = w / 100;
    p.shape({ name: `${n}-秤盘`, x: x + 24 * u, y: y + 46 * h / 100, w: 52 * u, h: 12 * h / 100, r: 4, fill: soft, stroke: { width: 2, color: ink, align: "center" } });
    p.shape({ name: `${n}-底座`, x: x + 30 * u, y: y + 58 * h / 100, w: 40 * u, h: 14 * h / 100, r: 4, fill: ink });
    p.shape({ name: `${n}-屏`, x: x + 40 * u, y: y + 61 * h / 100, w: 20 * u, h: 8 * h / 100, r: 2, fill: T.artBg });
  },
  // P-006 滤纸 100 张：一叠锥形滤纸 + 折边
  "滤纸 100 张": (p, n, x, y, w, h) => {
    const u = w / 100;
    p.shape({ name: `${n}-纸一`, kind: "polygon", sides: 3, x: x + 26 * u, y: y + 38 * h / 100, w: 48 * u, h: 34 * h / 100, fill: soft, stroke: { width: 2, color: ink, align: "center" } });
    p.shape({ name: `${n}-折边`, kind: "polygon", sides: 3, x: x + 32 * u, y: y + 30 * h / 100, w: 36 * u, h: 26 * h / 100, fill: ink });
    p.shape({ name: `${n}-纸二`, kind: "polygon", sides: 3, x: x + 32 * u, y: y + 58 * h / 100, w: 36 * u, h: 22 * h / 100, fill: soft, stroke: { width: 2, color: ink, align: "center" } });
  },
  // P-007 保温杯：杯身 + 杯盖 + 提环
  "保温杯": (p, n, x, y, w, h) => {
    const u = w / 100;
    p.shape({ name: `${n}-杯身`, x: x + 36 * u, y: y + 34 * h / 100, w: 28 * u, h: 44 * h / 100, r: Math.round(10 * u), fill: soft, stroke: { width: 2, color: ink, align: "center" } });
    p.shape({ name: `${n}-杯盖`, x: x + 34 * u, y: y + 26 * h / 100, w: 32 * u, h: 10 * h / 100, r: 4, fill: ink });
    p.shape({ name: `${n}-提环`, x: x + 62 * u, y: y + 28 * h / 100, w: 12 * u, h: 14 * h / 100, r: Math.round(6 * u), fill: ink });
  },
  // P-008 壶嘴清洁刷：刷柄 + 刷毛 + 挂孔
  "壶嘴清洁刷": (p, n, x, y, w, h) => {
    const u = w / 100;
    p.shape({ name: `${n}-刷柄`, x: x + 24 * u, y: y + 44 * h / 100, w: 52 * u, h: 10 * h / 100, r: 5, fill: soft, stroke: { width: 2, color: ink, align: "center" } });
    p.shape({ name: `${n}-刷毛`, x: x + 30 * u, y: y + 36 * h / 100, w: 30 * u, h: 8 * h / 100, r: 3, fill: ink });
    p.shape({ name: `${n}-挂孔`, kind: "ellipse", x: x + 70 * u, y: y + 45 * h / 100, w: 8 * u, h: 8 * h / 100, fill: T.artBg });
  },
};
const kitOf = (name) => KIT[name] ?? ((p, n, x, y, w, h) => p.shape({ name: `${n}-占位`, x: x + w * 0.3, y: y + h * 0.3, w: w * 0.4, h: h * 0.4, r: 8, fill: soft }));

// ── 示意数据：**名称/价格/库存逐字取自 server/src/seed.mjs:DEFAULT_SEED（8 条，stock 全 8）** ──
const PRODUCTS = [
  { id: "P-001", name: "手冲咖啡壶", price: 12900, desc: "玻璃壶身，300ml" },
  { id: "P-002", name: "陶瓷滤杯", price: 6800, desc: "V60 锥形，单人份" },
  { id: "P-003", name: "单品豆 250g", price: 8800, desc: "日晒处理，中浅烘" },
  { id: "P-004", name: "手摇磨豆机", price: 39900, desc: "不锈钢磨芯，可调档" },
  { id: "P-005", name: "电子秤", price: 15900, desc: "0.1g 精度，带计时" },
  { id: "P-006", name: "滤纸 100 张", price: 2900, desc: "无漂白，02 号" },
  { id: "P-007", name: "保温杯", price: 19900, desc: "316 内胆，350ml" },
  { id: "P-008", name: "壶嘴清洁刷", price: 1900, desc: "木质柄，细毛刷" },
];

// ── 共用件：顶部搜索框 / 底部 Tab 栏 / 商品卡 ──
/** 顶部搜索框：subtle 底 + 1px 边框 + 放大镜 + placeholder（T-7）。 */
function searchBox(p, { x, y, w, h = 40 }) {
  p.shape({ name: "搜索框", x, y, w, h, r: 20, fill: T.subtle, stroke: { width: 1, color: T.border, align: "inside" } });
  p.shape({ name: "搜索-镜圈", kind: "ellipse", x: x + 12, y: y + 11, w: 12, h: 12, fill: null, stroke: { width: 2, color: T.textMuted, align: "center" } });
  p.shape({ name: "搜索-镜柄", x: x + 22, y: y + 23, w: 7, h: 2, r: 1, fill: T.textMuted });
  p.text({ name: "搜索-占位文字", text: "搜索商品", size: 15, color: T.textMuted, x: x + 40, baseline: y + 26 });
}
/** 底部 Tab 栏（T-4）：整列可点区；当前项用主色文字档 + 主色图标。 */
function tabBar(p, { active, top = 1097 }) {
  const names = [];
  names.push(p.shape({ name: "底部栏", x: 0, y: top, w: 390, h: 49, fill: T.surface }));
  names.push(p.shape({ name: "底部栏上边线", x: 0, y: top, w: 390, h: 1, fill: T.border }));
  const items = [
    ["首页", "#/products"],
    ["购物车", "#/cart"],
    ["订单", "#/orders"],
    ["我的", "#/me"],
  ];
  items.forEach(([label], i) => {
    const x0 = i * 97 + 1;
    const on = label === active;
    const c = on ? T.accent : T.textMuted;
    names.push(p.shape({ name: `Tab-${label}-图标`, x: x0 + 38, y: top + 6, w: 20, h: 20, r: 6, fill: null, stroke: { width: 2, color: c, align: "center" } }));
    names.push(p.text({ name: `Tab-${label}-文字`, text: label, size: 12, color: c, centerX: x0 + 48, baseline: top + 42 }));
  });
  return names;
}
/**
 * 标题两行截断（规格口径 = `-webkit-line-clamp: 2` + 禁止 `break-all`）：
 *  ① 名字里有空格 ⇒ **只在空格处断行**（「单品豆 250g」⇒ 第 1 行「单品豆」、第 2 行「250g」），
 *     数字与单位永远留在同一行；
 *  ② 没有空格且单行超长 ⇒ 按每行上限断，超出部分用「…」收口；
 *  ③ 最多两行，第 3 行一律不出。
 * 返回数组长度恒为 2（第二行可能为空串）。
 */
function titleLines(name, perLine) {
  if (name.includes(" ")) {
    const [head, tail] = name.split(" ");
    return [head, tail.length > perLine ? `${tail.slice(0, perLine - 1)}…` : tail];
  }
  if (name.length <= perLine) return [name, ""];
  const first = name.slice(0, perLine);
  const rest = name.slice(perLine);
  return [first, rest.length > perLine ? `${rest.slice(0, perLine - 1)}…` : rest];
}

/** 商品卡（T-3/T-5/T-8/T-9）：主图 + 角标 + 两行截断标题 + 橙红加粗价格 + 库存 + 轻阴影。 */
function productCard(p, { i, prod, x, y, w, h, imgH, titleSize = 14, priceSize = 22, shadow = true }) {
  if (shadow) p.shape({ name: `卡阴影-${i + 1}`, x, y: y + 2, w, h, r: 18, fill: T.border });
  p.shape({ name: `商品卡-${i + 1}`, x, y, w, h, r: 16, fill: T.surface });
  artTile(p, { name: `主图-${i + 1}`, x, y, w, h: imgH, r: 16, kit: kitOf(prod.name) });
  // 角标压在主图右下（T-8）：包邮 = success，秒杀 = accent
  const hot = i % 4 === 3;
  tag(p, {
    name: `角标-${i + 1}`,
    label: hot ? "秒杀" : "包邮",
    x: x + w - 8,
    y: y + imgH - 30, // 角标底边 = 主图底边 − 12（下内边距 12px，与左右同为 8px 档）
    h: 18,
    size: 12,
    fill: hot ? T.accentTint : T.successTint,
    color: hot ? T.accentBadge : T.success,
  });
  // 标题两行截断：只按**空格**断（数字与单位之间不得断行），与 ui-spec `UI-13`/`UQ-1` 同口径
  const lines = titleLines(prod.name, titleSize === 14 ? 7 : 13);
  // 文字块**整体锚在主图下沿**：`ty = 主图底`，标题区固定两行（2 × 21 = 42px）——
  // 单行标题也占两行的位，价格 / 库存基线因此恒等（同一行四张卡对齐，UI-14）。
  // 窄屏主图 96 ⇒ ty = 96；宽屏主图 150 ⇒ ty = 150。两档卡高都由这条公式推出（窄 196 / 宽 196+…），见 ui-spec §8.2②。
  const ty = imgH;
  p.text({ name: `卡名一-${i + 1}`, text: lines[0], size: titleSize, color: T.text, x: x + 12, baseline: y + ty + 14 });
  if (lines[1]) p.text({ name: `卡名二-${i + 1}`, text: lines[1], size: titleSize, color: T.text, x: x + 12, baseline: y + ty + 38 });
  // 价格与库存同一基线：价格左对齐、库存右对齐（右边缘 = 卡右 − 12）
  p.text({ name: `卡价-${i + 1}`, text: `¥ ${(prod.price / 100).toFixed(2)}`, size: priceSize, color: T.accent, x: x + 12, baseline: y + ty + 74 });
  p.text({ name: `卡库存-${i + 1}`, text: "库存 8 件", size: 13, color: T.textMuted, right: x + w - 10, baseline: y + ty + 74 });
}

// ────────────────────────────────────────────────────────────────────────────
// 移动端 390×844（移动优先 = 本包主形态）
// 骨架：状态栏 0–44 · 导航栏 44–88 · 内容 88–760 · 底部 Tab 760–809 · 安全区 809–844
// 内容带 band = 16 … 374（左右外边距各 16px，tokens §7）
// ────────────────────────────────────────────────────────────────────────────
const M_BAND = { left: 16, right: 374 };
const W_BAND = { left: 60, right: 1220 };

function mBase(screen, canvas = MOBILE, viewport = false) {
  const p = new Page(screen, canvas, M_BAND, T.bg, viewport);
  p.shape({ name: "底色", x: 0, y: 0, w: 390, h: canvas.height, fill: T.bg });
  p.shape({ name: "Home 指示条", x: 128, y: canvas.height - 16, w: 134, h: 5, r: 3, fill: T.borderStrong });
  return p;
}
function mTopBar(p, { title, badge = null, back = false }) {
  p.shape({ name: "状态栏", x: 0, y: 0, w: 390, h: 44, fill: T.surface });
  p.shape({ name: "导航栏", x: 0, y: 44, w: 390, h: 44, fill: T.surface });
  p.shape({ name: "导航栏下边线", x: 0, y: 88, w: 390, h: 1, fill: T.border });
  if (back) {
    p.text({ name: "返回", text: "‹", size: 24, color: T.text, x: 16, baseline: 74 });
  }
  p.text({ name: "导航标题", text: title, size: 17, color: T.text, x: back ? 60 : 16, baseline: 74 });
  if (badge !== null) {
    p.text({ name: "购物车件数", text: `购物车 ${badge}`, size: 13, color: T.accent, right: 374, baseline: 74 });
  }
}
function mSection(p, { title, note, y }) {
  p.text({ name: "区块标题", text: title, size: 20, color: T.text, x: 16, baseline: y });
  p.text({ name: "区块副标题", text: note, size: 13, color: T.textMuted, x: 16, baseline: y + 20 });
}

// ── 移动 01：首页商品列表（双列商品流）──
function mHome() {
  return homeScreen("首页商品列表", 1140, 1074, 0);
}
/** 390×844 **视口**版：与整页版同一套栈，只是画布止于视口 —— 固定定位底栏的遮挡只有在这一版里看得见。 */
function mHomeViewport() {
  // 「已滚到底」的视口状态：scrollY = (内容底 1124 + 预留 65) − 视口 844 = 345（预留 = 栏高 49 + 余量 16，
  // 桌面/无刘海环境下 env(safe-area-inset-bottom) = 0）⇒ 整页布局上移 345 后裁到 390×844。
  // 于是底栏固定在视口底、最后一行卡片**完整落在底栏上沿之上**（这正是规格里的可断言判据）。
  return homeScreen("首页商品列表视口", MOBILE_VP, MOBILE_VP - 49, 345);
}
function homeScreen(screen, canvasH, tabTop, scrollY = 0) {
  const p = mBase(screen, { ...MOBILE, height: canvasH }, scrollY > 0);
  p.scrollY = scrollY;
  mTopBar(p, { title: "电商小铺", badge: "3" });
  searchBox(p, { x: 16, y: 94, w: 358 });
  p.shape({ name: "促销条", x: 16, y: 146, w: 358, h: 32, r: 8, fill: T.accentTint });
  p.text({ name: "促销条文字", text: "新客首单立减 5 元 · 满 99 元包邮", size: 13, color: T.accent, x: 28, baseline: 167 });
  mSection(p, { title: "商品列表", note: "共 8 件商品，价格以元显示", y: 202 });
  // 一屏装得下 8 张卡（T-3）：2 列 × 4 行，卡 179×222（主图 144 见方）
  // 行距 8 ⇒ 末行底 190 + 3×(222+8) + 222 = 864 < 底部栏顶边 876（不遮挡）
  const cw = 179, ch = 196, gapX = 16, gapY = 8, gx = 16, gy = 234;
  PRODUCTS.forEach((prod, i) => {
    const x = gx + (i % 2) * (cw + gapX);
    const y = gy + Math.floor(i / 2) * (ch + gapY);
    // 视口版：整卡滚出视口的卡不画（人看到的就是没有它）；否则几何门禁 ②/③ 会把
    // 「预期裁切」判成溢出画布与文字重叠，且产物里会留下看不见的 ghost 图层。
    if (scrollY > 0 && (y - scrollY + ch) > p.canvas.height) return;
    // 卡片本体在视口内、但**角标**压在主图下沿之外（已被顶栏裁掉）的那几张：相对角标框与它的
    // 文字会一个被裁、一个照画 ⇒ 几何门禁 ③ 会判「文字重叠 / 找不到容器」。故按设计坐标判定后连卡一起跳过。
    if (scrollY > 0 && y + 96 - 30 < scrollY) return;
    productCard(p, { i, prod, x, y, w: cw, h: ch, imgH: 96, titleSize: 14, priceSize: 20 });
  });
  p.fixed(tabBar(p, { active: "首页", top: tabTop }));
  return p;
}

// ── 移动 02：商品详情 ──
function mDetail() {
  const p = mBase("商品详情");
  const prod = PRODUCTS[0];
  mTopBar(p, { title: "商品详情", badge: "3", back: true });
  artTile(p, { name: "详情主图", x: 16, y: 104, w: 358, h: 260, r: 16, kit: kitOf(prod.name) });
  p.text({ name: "详情商品名", text: prod.name, size: 20, color: T.text, x: 16, baseline: 404 });
  p.text({ name: "详情价格", text: yuan(prod.price), size: 30, color: T.accent, x: 16, baseline: 452 });
  p.shape({ name: "详情服务标签", x: 16, y: 470, w: 72, h: 22, r: 6, fill: T.successTint });
  p.text({ name: "详情服务标签字", text: "包邮", size: 13, color: T.success, x: 32, baseline: 486 });
  p.text({ name: "详情库存", text: "库存 8 件", size: 13, color: T.textMuted, x: 104, baseline: 486 });
  p.shape({ name: "详情卡", x: 16, y: 512, w: 358, h: 148, r: 16, fill: T.surface });
  p.text({ name: "详情描述标签", text: "商品描述", size: 13, color: T.textMuted, x: 32, baseline: 544 });
  p.text({ name: "详情描述一", text: "玻璃壶身，300ml；手冲与冷萃两用，", size: 15, color: T.text, x: 32, baseline: 572 });
  p.text({ name: "详情描述二", text: "附滤纸 5 张。", size: 15, color: T.text, x: 32, baseline: 596 });
  p.text({ name: "详情配送说明", text: "现货 · 48 小时内发出 · 支持 7 天无理由", size: 13, color: T.textMuted, x: 32, baseline: 636 });
  p.shape({ name: "详情底栏", x: 0, y: 1043, w: 390, h: 100, fill: T.surface });
  p.shape({ name: "详情底栏上边线", x: 0, y: 1043, w: 390, h: 1, fill: T.border });
  secondary(p, { name: "次按钮-加入购物车", label: "加入购物车", x: 16, y: 1067, w: 170, h: 48, r: 24, size: 15 });
  cta(p, { name: "主按钮-立即购买", label: "立即购买", x: 198, y: 1067, w: 176, h: 48, size: 16 });
  return p;
}

// ── 移动 03：购物车（含上限禁用态）──
function mCart() {
  const p = mBase("购物车");
  mTopBar(p, { title: "购物车", badge: "12" });
  p.text({ name: "购物车副标题", text: "共 12 件商品，价格以元显示", size: 13, color: T.textMuted, x: 16, baseline: 112 });
  p.shape({ name: "购物车卡", x: 16, y: 128, w: 358, h: 504, r: 16, fill: T.surface });
  const rows = [
    { prod: PRODUCTS[0], qty: 3, decOff: false, incOff: false },
    { prod: PRODUCTS[1], qty: 8, decOff: false, incOff: true },
    { prod: PRODUCTS[5], qty: 1, decOff: true, incOff: false },
  ];
  rows.forEach((r, i) => {
    const y = 128 + i * 168;
    if (i > 0) p.shape({ name: `行分隔线-${i + 1}`, x: 32, y, w: 326, h: 1, fill: T.border });
    artTile(p, { name: `行主图-${i + 1}`, x: 32, y: y + 20, w: 72, h: 72, r: 12, kit: kitOf(r.prod.name) });
    p.text({ name: `行名-${i + 1}`, text: r.prod.name, size: 15, color: T.text, x: 116, baseline: y + 40 });
    p.text({ name: `行删除-${i + 1}`, text: "删除", size: 13, color: T.danger, right: 358, baseline: y + 40 });
    p.text({ name: `行实付-${i + 1}`, text: `实付 ${yuan(r.prod.price * r.qty)}`, size: 13, color: T.textMuted, x: 116, baseline: y + 66 });
    p.text({ name: `行单价-${i + 1}`, text: `单价 ${yuan(r.prod.price)}`, size: 13, color: T.textMuted, x: 116, baseline: y + 90 });
    stepper(p, { name: `步进器-${i + 1}`, x: 32, y: y + 104, qty: r.qty, decOff: r.decOff, incOff: r.incOff });
  });
  p.shape({ name: "购物车结算条", x: 0, y: 990, w: 390, h: 107, fill: T.surface });
  p.shape({ name: "结算条上边线", x: 0, y: 990, w: 390, h: 1, fill: T.border });
  p.text({ name: "结算条合计标签", text: "合计", size: 13, color: T.textMuted, x: 16, baseline: 1024 });
  p.text({ name: "结算条金额", text: yuan(130800), size: 24, color: T.accent, x: 16, baseline: 1062 });
  cta(p, { name: "主按钮-去结算", label: "去结算(12)", x: 234, y: 1022, w: 140, h: 44, size: 16 });
  tabBar(p, { active: "购物车" });
  return p;
}

// ── 移动 04：结算下单 ──
function mCheckout() {
  const p = mBase("结算下单页面");
  const items = [
    { prod: PRODUCTS[0], qty: 2 },
    { prod: PRODUCTS[1], qty: 1 },
  ];
  const total = items.reduce((s, r) => s + r.prod.price * r.qty, 0);
  mTopBar(p, { title: "确认订单", back: true });
  p.shape({ name: "订单内容卡", x: 16, y: 104, w: 358, h: 192, r: 16, fill: T.surface });
  p.text({ name: "订单内容标题", text: "订单内容", size: 16, color: T.text, x: 32, baseline: 132 });
  items.forEach((r, i) => {
    const y = 164 + i * 56;
    artTile(p, { name: `结算主图-${i + 1}`, x: 32, y: y - 24, w: 48, h: 48, r: 10, kit: kitOf(r.prod.name) });
    p.text({ name: `结算行名-${i + 1}`, text: r.prod.name, size: 15, color: T.text, x: 92, baseline: y - 2 });
    p.text({ name: `结算行件数-${i + 1}`, text: `× ${r.qty} 件`, size: 13, color: T.textMuted, x: 92, baseline: y + 18 });
    p.text({ name: `结算行小计-${i + 1}`, text: yuan(r.prod.price * r.qty), size: 15, color: T.text, right: 358, baseline: y + 8 });
  });
  p.shape({ name: "订单内容分隔线", x: 32, y: 276, w: 326, h: 1, fill: T.border });
  p.text({ name: "配送方式", text: "配送方式：快递包邮 · 预计 3 天送达", size: 13, color: T.textMuted, x: 32, baseline: 296 });
  p.shape({ name: "支付演示提示", x: 16, y: 320, w: 358, h: 40, r: 10, fill: T.accentTint });
  p.text({ name: "支付演示文字", text: "演示环境：下单即视为已支付，不产生真实扣款", size: 13, color: T.accent, x: 32, baseline: 345 });
  p.shape({ name: "应付卡", x: 16, y: 376, w: 358, h: 100, r: 16, fill: T.surface });
  p.text({ name: "应付合计标签", text: "应付合计", size: 15, color: T.text, x: 32, baseline: 416 });
  p.text({ name: "应付合计金额", text: yuan(total), size: 30, color: T.accent, right: 358, baseline: 436 });
  p.shape({ name: "结算底栏", x: 0, y: 992, w: 390, h: 105, fill: T.surface });
  p.shape({ name: "结算底栏上边线", x: 0, y: 992, w: 390, h: 1, fill: T.border });
  cta(p, { name: "主按钮-提交订单", label: `提交订单 ${yuan(total)}`, x: 16, y: 1016, w: 358, h: 52, size: 17, r: 26 });
  p.text({ name: "提交说明", text: "提交后购物车将清空，可在「订单」查看", size: 13, color: T.textMuted, centerX: 195, baseline: 1084 });
  return p;
}

// ── 移动 05：订单列表 ──
function mOrders() {
  const p = mBase("订单列表页面");
  mTopBar(p, { title: "订单", badge: "0" });
  p.text({ name: "订单副标题", text: "按下单时间倒序，最近一单在最上面", size: 13, color: T.textMuted, x: 16, baseline: 112 });
  const orders = [
    { no: "SO-20261015-0002", time: "2026-10-15 10:24", lines: ["手冲咖啡壶 × 2 件", "陶瓷滤杯 × 1 件"], total: 32600 },
    { no: "SO-20261015-0001", time: "2026-10-15 10:02", lines: ["手摇磨豆机 × 1 件"], total: 39900 },
  ];
  orders.forEach((o, i) => {
    const y = 128 + i * 216;
    p.shape({ name: `订单卡-${i + 1}`, x: 16, y, w: 358, h: 200, r: 16, fill: T.surface });
    p.text({ name: `订单号-${i + 1}`, text: `订单号 ${o.no}`, size: 15, color: T.text, x: 32, baseline: y + 34 });
    tag(p, { name: `订单状态-${i + 1}`, label: "已支付", x: 358, y: y + 16, h: 22, size: 12, fill: T.successTint, color: T.success, padX: 10 });
    p.text({ name: `下单时间-${i + 1}`, text: `下单时间 ${o.time}`, size: 13, color: T.textMuted, x: 32, baseline: y + 60 });
    p.shape({ name: `订单分隔线-${i + 1}`, x: 32, y: y + 76, w: 326, h: 1, fill: T.border });
    o.lines.forEach((line, j) => {
      p.text({ name: `订单行-${i + 1}-${j + 1}`, text: line, size: 15, color: T.text, x: 32, baseline: y + 106 + j * 26 });
    });
    p.text({ name: `订单合计标签-${i + 1}`, text: "合计", size: 13, color: T.textMuted, right: 358, baseline: y + 108 });
    p.text({ name: `订单合计金额-${i + 1}`, text: yuan(o.total), size: 24, color: T.accent, right: 358, baseline: y + 142 });
  });
  secondary(p, { name: "次按钮-去逛商品", label: "去逛商品列表", x: 16, y: 620, w: 358, h: 48, r: 24, size: 15 });
  p.text({ name: "订单演示说明", text: "演示环境：订单为演示数据，清除浏览器数据后不再显示", size: 13, color: T.textMuted, x: 16, baseline: 700 });
  tabBar(p, { active: "订单" });
  return p;
}

// ── 移动 06：登录与注册（Q-3 裁定引入最小账号）──
function mLogin() {
  const p = mBase("登录与注册");
  mTopBar(p, { title: "登录 / 注册", back: true });
  p.shape({ name: "品牌标", x: 16, y: 112, w: 56, h: 56, r: 16, fill: T.accentTint });
  p.text({ name: "品牌标文字", text: "铺", size: 24, color: T.accent, centerX: 44, baseline: 148 });
  p.text({ name: "登录标题", text: "登录后同步购物车与订单", size: 20, color: T.text, x: 88, baseline: 136 });
  p.text({ name: "登录副标题", text: "未登录也可以逛商品，下单前需登录", size: 13, color: T.textMuted, x: 88, baseline: 160 });
  p.text({ name: "邮箱标签", text: "邮箱", size: 13, color: T.textMuted, x: 16, baseline: 220 });
  p.shape({ name: "邮箱输入框", x: 16, y: 232, w: 358, h: 48, r: 12, fill: T.subtle, stroke: { width: 1, color: T.border, align: "inside" } });
  p.text({ name: "邮箱占位", text: "you@example.com", size: 15, color: T.textMuted, x: 32, baseline: 262 });
  p.text({ name: "密码标签", text: "密码", size: 13, color: T.textMuted, x: 16, baseline: 312 });
  p.shape({ name: "密码输入框", x: 16, y: 324, w: 358, h: 48, r: 12, fill: T.surface, stroke: { width: 2, color: T.danger, align: "inside" } });
  p.text({ name: "密码占位", text: "••••••••", size: 15, color: T.text, x: 32, baseline: 354 });
  p.text({ name: "密码错误提示", text: "邮箱或密码不正确", size: 13, color: T.danger, x: 16, baseline: 398 });
  cta(p, { name: "主按钮-登录", label: "登录", x: 16, y: 418, w: 358, h: 52, size: 17, r: 26 });
  secondary(p, { name: "次按钮-注册", label: "注册新账号", x: 16, y: 482, w: 358, h: 52, r: 26, size: 15 });
  p.text({ name: "注册说明", text: "注册需邮箱 + 密码（至少 8 位）", size: 13, color: T.textMuted, centerX: 195, baseline: 566 });
  p.shape({ name: "登录提示块", x: 16, y: 592, w: 358, h: 92, r: 16, fill: T.surface });
  p.text({ name: "登录提示标题", text: "关于账号", size: 13, color: T.textMuted, x: 32, baseline: 622 });
  p.text({ name: "登录提示一", text: "登录时匿名购物车会并入账号购物车，", size: 13, color: T.text, x: 32, baseline: 646 });
  p.text({ name: "登录提示二", text: "件数上限仍为 8 件。", size: 13, color: T.text, x: 32, baseline: 668 });
  return p;
}

// ── 移动 07：我的（订单入口与登出）──
function mMe() {
  const p = mBase("我的");
  mTopBar(p, { title: "我的" });
  p.shape({ name: "账号卡", x: 16, y: 104, w: 358, h: 104, r: 16, fill: T.surface });
  p.shape({ name: "头像", kind: "ellipse", x: 32, y: 124, w: 64, h: 64, fill: T.accentTint });
  p.text({ name: "头像首字", text: "我", size: 24, color: T.accent, centerX: 64, baseline: 166 });
  p.text({ name: "账号名", text: "demo@example.com", size: 15, color: T.text, x: 112, baseline: 150 });
  p.text({ name: "账号状态", text: "已登录 · 购物车 3 件", size: 13, color: T.textMuted, x: 112, baseline: 174 });
  secondary(p, { name: "次按钮-登出", label: "退出登录", x: 262, y: 140, w: 96, h: 36, r: 18, size: 14 });
  p.shape({ name: "订单入口卡", x: 16, y: 224, w: 358, h: 56, r: 16, fill: T.surface });
  p.text({ name: "订单入口文字", text: "我的订单", size: 15, color: T.text, x: 32, baseline: 258 });
  p.text({ name: "订单入口计数", text: "2 单", size: 13, color: T.textMuted, right: 344, baseline: 258 });
  p.text({ name: "订单入口箭头", text: "›", size: 20, color: T.textMuted, right: 374, baseline: 258 });
  mSection(p, { title: "我的订单", note: "按状态查看（本期只读，全部为演示数据）", y: 312 });
  const chips = ["全部", "已支付", "已完成"];
  chips.forEach((c, i) => {
    const x = 16 + i * 96;
    const on = i === 0;
    p.shape({ name: `状态筛选-${c}`, x, y: 330, w: 88, h: 34, r: 17, fill: on ? T.accentTint : T.surface, stroke: { width: 1, color: on ? T.accent : T.border, align: "inside" } });
    p.text({ name: `状态筛选文字-${c}`, text: c, size: 13, color: on ? T.accent : T.textMuted, centerX: x + 44, baseline: 352 });
  });
  p.shape({ name: "订单卡-我的", x: 16, y: 380, w: 358, h: 168, r: 16, fill: T.surface });
  p.text({ name: "我的订单号", text: "订单号 SO-20261015-0002", size: 15, color: T.text, x: 32, baseline: 412 });
  tag(p, { name: "我的订单状态", label: "已支付", x: 358, y: 394, h: 22, size: 12, fill: T.successTint, color: T.success, padX: 10 });
  p.text({ name: "我的订单时间", text: "下单时间 2026-10-15 10:24", size: 13, color: T.textMuted, x: 32, baseline: 438 });
  p.shape({ name: "我的订单分隔线", x: 32, y: 456, w: 326, h: 1, fill: T.border });
  p.text({ name: "我的订单行一", text: "手冲咖啡壶 × 2 件", size: 15, color: T.text, x: 32, baseline: 486 });
  p.text({ name: "我的订单行二", text: "陶瓷滤杯 × 1 件", size: 15, color: T.text, x: 32, baseline: 512 });
  p.text({ name: "我的订单合计", text: yuan(32600), size: 24, color: T.accent, right: 358, baseline: 516 });
  secondary(p, { name: "次按钮-查看全部订单", label: "查看全部订单", x: 16, y: 580, w: 358, h: 48, r: 24, size: 15 });
  p.shape({ name: "演示声明卡", x: 16, y: 648, w: 358, h: 96, r: 16, fill: T.accentTint });
  p.text({ name: "演示声明标题", text: "演示环境", size: 13, color: T.accent, x: 32, baseline: 676 });
  p.text({ name: "演示声明一", text: "支付为演示行为（下单即已支付），", size: 13, color: T.text, x: 32, baseline: 702 });
  p.text({ name: "演示声明二", text: "不产生真实扣款，也不含收货与退款流程。", size: 13, color: T.text, x: 32, baseline: 726 });
  tabBar(p, { active: "我的" });
  return p;
}

// ── 移动 08：首帧（禁用 JavaScript）——既有 AC-27 / V-02 的核心 ──
function mNoJs() {
  const p = mBase("首帧无脚本");
  mTopBar(p, { title: "电商小铺" });
  p.text({ name: "首帧计数", text: "共 8 件商品", size: 15, color: T.text, x: 16, baseline: 116 });
  p.text({ name: "首帧副标题", text: "服务端预渲染目录已经可读，页面不出现模板占位符", size: 13, color: T.textMuted, x: 16, baseline: 140 });
  p.shape({ name: "首帧目录卡", x: 16, y: 156, w: 358, h: 596, r: 16, fill: T.surface });
  const rows = [
    ["手冲咖啡壶", "12900"],
    ["陶瓷滤杯", "6800"],
    ["单品豆 250g", "8800"],
    ["手摇磨豆机", "39900"],
    ["电子秤", "15900"],
    ["滤纸 100 张", "2900"],
    ["保温杯", "19900"],
  ];
  rows.forEach(([name, cents], i) => {
    const y = 156 + i * 68;
    if (i > 0) p.shape({ name: `首帧分隔线-${i}`, x: 32, y, w: 326, h: 1, fill: T.border });
    artTile(p, { name: `首帧主图-${i + 1}`, x: 32, y: y + 10, w: 48, h: 48, r: 10, kit: kitOf(name) });
    p.text({ name: `首帧商品名-${i + 1}`, text: name, size: 15, color: T.text, x: 92, baseline: y + 34 });
    p.text({ name: `首帧价格-${i + 1}`, text: `¥ ${(Number(cents) / 100).toFixed(2)}`, size: 15, color: T.accent, right: 358, baseline: y + 34 });
  });
  p.shape({ name: "首帧余量渐隐", x: 16, y: 664, w: 358, h: 88, r: 16, fill: T.bg });
  p.text({ name: "首帧余量提示", text: "还有 1 件商品（壶嘴清洁刷）", size: 13, color: T.textMuted, x: 32, baseline: 716 });
  tabBar(p, { active: "首页" });
  return p;
}

// ────────────────────────────────────────────────────────────────────────────
// 宽屏 1280×800（同一套语言 + 同一套令牌；断点 ≥768px 时改「顶栏 + 居中容器」）
// ────────────────────────────────────────────────────────────────────────────
function wBase(screen) {
  const p = new Page(screen, WIDE, W_BAND, T.bg);
  p.shape({ name: "底色", x: 0, y: 0, w: 1280, h: 800, fill: T.bg });
  p.shape({ name: "顶栏", x: 0, y: 0, w: 1280, h: 64, fill: T.surface });
  p.shape({ name: "顶栏下边线", x: 0, y: 64, w: 1280, h: 1, fill: T.border });
  p.text({ name: "品牌名", text: "电商小铺", size: 20, color: T.accent, x: 60, baseline: 40 });
  ["首页", "购物车", "订单", "我的"].forEach((label, i) => {
    const on = i === 0;
    p.text({ name: `顶部导航-${label}`, text: label, size: 15, color: on ? T.accent : T.text, x: 230 + i * 80, baseline: 40 });
    if (on) p.shape({ name: `顶部导航下划线-${label}`, x: 230 + i * 80, y: 52, w: 32, h: 3, r: 2, fill: T.accent });
  });
  searchBox(p, { x: 680, y: 12, w: 420, h: 40 });
  p.text({ name: "顶栏购物车", text: "购物车 3", size: 15, color: T.text, x: 1136, baseline: 40 });
  p.text({ name: "宽屏演示声明", text: "演示环境：下单即已支付，不产生真实扣款", size: 13, color: T.textMuted, x: 956, baseline: 740 });
  return p;
}

// ── 宽屏 01：首页（8 件商品，2 列 × 4 行大字卡）──
function wHome() {
  const p = wBase("首页商品列表宽屏");
  p.text({ name: "首页大标题", text: "商品列表", size: 26, color: T.text, x: 60, baseline: 96 });
  p.shape({ name: "促销条", x: 200, y: 66, w: 344, h: 38, r: 10, fill: T.accentTint });
  p.text({ name: "促销条文字", text: "新客首单立减 5 元 · 满 99 元包邮", size: 13, color: T.accent, x: 216, baseline: 90 });
  p.text({ name: "首页副标题", text: "共 8 件商品，价格以元显示", size: 13, color: T.textMuted, x: 60, baseline: 120 });
  // 容器闭合式：4×272 + 3×24 = 1160 ⇒ 容器 1160 + 左右外边距 60 = 1280（对称，无横向溢出）
  // 卡高与移动端同构：主图 150 + 两行定高 42 + 价格行(20px 字号)24 = 196（宽屏不再留大片空白）
  const cw = 272, ch = 230, gap = 24, gx = 60, gy = 148;
  PRODUCTS.forEach((prod, i) => {
    const x = gx + (i % 4) * (cw + gap);
    const y = gy + Math.floor(i / 4) * (ch + gap);
    productCard(p, { i, prod, x, y, w: cw, h: ch, imgH: 150, titleSize: 15, priceSize: 24 });
  });
  p.text({ name: "首页底部说明", text: "商品来自服务端种子数据（只读，共 8 条）", size: 13, color: T.textMuted, x: 60, baseline: 660 });
  p.text({ name: "首页分页说明", text: "第 1 页 / 共 1 页 · 8 件", size: 13, color: T.textMuted, x: 60, baseline: 684 });
  return p;
}

// ── 宽屏 02：购物车（左侧行区 + 右侧固定结算卡）──
function wCart() {
  const p = wBase("购物车宽屏");
  p.text({ name: "购物车大标题", text: "购物车", size: 26, color: T.text, x: 60, baseline: 124 });
  p.text({ name: "购物车副标题", text: "共 12 件商品，价格以元显示", size: 13, color: T.textMuted, x: 60, baseline: 148 });
  p.shape({ name: "购物车卡", x: 60, y: 176, w: 700, h: 356, r: 16, fill: T.surface });
  const rows = [
    { prod: PRODUCTS[0], qty: 3, decOff: false, incOff: false },
    { prod: PRODUCTS[1], qty: 8, decOff: false, incOff: true },
    { prod: PRODUCTS[5], qty: 1, decOff: true, incOff: false },
  ];
  rows.forEach((r, i) => {
    const y = 176 + i * 118;
    if (i > 0) p.shape({ name: `行分隔线-${i + 1}`, x: 80, y, w: 660, h: 1, fill: T.border });
    artTile(p, { name: `行主图-${i + 1}`, x: 80, y: y + 24, w: 72, h: 72, r: 12, kit: kitOf(r.prod.name) });
    p.text({ name: `行名-${i + 1}`, text: r.prod.name, size: 16, color: T.text, x: 176, baseline: y + 46 });
    p.text({ name: `行单价-${i + 1}`, text: `单价 ${yuan(r.prod.price)}`, size: 13, color: T.textMuted, x: 176, baseline: y + 74 });
    p.text({ name: `行删除-${i + 1}`, text: "删除", size: 13, color: T.danger, x: 176, baseline: y + 98 });
    stepper(p, { name: `步进器-${i + 1}`, x: 500, y: y + 40, qty: r.qty, decOff: r.decOff, incOff: r.incOff });
    p.text({ name: `行小计-${i + 1}`, text: yuan(r.prod.price * r.qty), size: 16, color: T.text, right: 740, baseline: y + 62 });
  });
  p.shape({ name: "结算卡", x: 786, y: 176, w: 434, h: 220, r: 16, fill: T.surface });
  p.text({ name: "结算卡标题", text: "订单摘要", size: 16, color: T.text, x: 806, baseline: 212 });
  p.shape({ name: "结算卡分隔线", x: 806, y: 232, w: 394, h: 1, fill: T.border });
  p.text({ name: "结算卡件数", text: "商品件数", size: 13, color: T.textMuted, x: 806, baseline: 264 });
  p.text({ name: "结算卡件数值", text: "12 件", size: 15, color: T.text, right: 1200, baseline: 264 });
  p.text({ name: "结算卡合计标签", text: "应付合计", size: 13, color: T.textMuted, x: 806, baseline: 300 });
  p.text({ name: "结算卡金额", text: yuan(130800), size: 30, color: T.accent, right: 1200, baseline: 322 });
  cta(p, { name: "主按钮-去结算", label: "去结算", x: 806, y: 344, w: 394, h: 46, size: 16, r: 23 });
  p.text({ name: "结算卡提示", text: "下单即支付成功（演示，不产生真实扣款）", size: 13, color: T.textMuted, x: 806, baseline: 416 });
  return p;
}

// ────────────────────────────────────────────────────────────────────────────
// 出图：建 PSD → 量一次 → layer.translate 补差（居中 / 右对齐）→ 复量 → 合成 PNG
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

function deltaFor(layer, byName, scrollY = 0) {
  const it = layer.intent;
  if (!it) return null;
  const m = byName.get(layer.name);
  if (!m) return null;
  if (it.kind === "right") return { dx: Math.round(it.target - (m.bounds[0] + m.bounds[2])), dy: 0 };
  if (it.kind === "centerX") return { dx: Math.round(it.target - centerOf(m.bounds).x), dy: 0 };
  if (it.kind === "box") {
    const box = byName.get(it.container);
    if (!box) return null;
    const dyShift = scrollY; // 视口版：目标与现位都随 scrollY 平移，差值里要减掉
    const c = centerOf(box.bounds);
    const cur = centerOf(m.bounds);
    return { dx: Math.round(c.x - cur.x), dy: Math.round(c.y - dyShift - cur.y) };
  }
  return null;
}
/**
 * 某图层**应当**落在画布上的位置（矩形）。
 * 这是「设计意图 → 画布坐标」的唯一换算处，不是手写 bounds：
 *  · 设计坐标来自页面 DSL（字体 / 字号 / 间距都是 §8.2 的字面值）；
 *  · 视口页要整体上移 scrollY（固定层除外）；
 *  · 文本的 `baseline` 在本引擎里表现为「字面盒顶 − 7px」（实测多屏一致），故取 `baseline − 21 + 7`。
 * 已实测的引擎基线偏差**不在这里补偿** —— 补偿量来自 `after` 的实测值，见 emit 阶段 C。
 */
function wantRect(l, dy, page) {
  const shift = dy && !page.fixedNames.has(l.name) ? dy : 0;
  if (l.kind === "shape") return [l.rect[0], l.rect[1] - shift, l.rect[2], l.rect[3]];
  // 文本：只对「起点已知」的两类（左对齐 / 盒内居中）给目标 y；右侧与居中另由 dx 处理
  const y = l.baseline - 21 + 7 - shift;
  if (l.intent && l.intent.kind === "box") {
    const r = page.designRect(l.intent.container);
    if (!r) return null;
    return [r[0] + 8, y, 0, 0];
  }
  if (l.intent && l.intent.kind === "right") return null; // x 由 fix 阶段的 dx 决定
  return [l.render.params.x, y, 0, 0];
}

const deviation = (layer, byName, scrollY = 0) => {
  const d = deltaFor(layer, byName, scrollY);
  return d ? Math.max(Math.abs(d.dx), Math.abs(d.dy)) : 0;
};

/** 文本溢出检测（内容带 / 画布）：报告用，不改图。 */
/** 设计期检查：任何图元的 rect 都必须完整落在画布内（引擎对越界盒子会裁剪 bounds ⇒ 必须避免）。 */
function designOverflow(page) {
  const bad = [];
  for (const l of page.layers) {
    const r = l.rect ?? (Array.isArray(l.bounds) ? l.bounds : null);
    if (!r) continue;
    const yy = r[1] - (page.scrollY ?? 0);
    const horiz = r[0] < 0 || r[0] + r[2] > page.canvas.width;
    const below = yy + r[3] > page.canvas.height;
    const above = yy < 0;
    const outsideViewport = page.viewport && (below || above); // 视口版：跨过视口上下沿属预期裁切
    if (outsideViewport) continue;
    if (above || horiz || below) {
      bad.push(`${l.name}设计框[${r.map((v) => Math.round(v * 100) / 100).join(",")}]越出 ${page.canvas.width}×${page.canvas.height}`);
    }
  }
  return bad;
}

function overflowReport(page, byName) {
  const bad = [];
  let clipped = 0;
  for (const l of page.layers) {
    const m = byName.get(l.name);
    if (!m) continue;
    const [x, y, w, h] = m.bounds;
    if (w <= 0 || h <= 0 || x < 0 || y < 0) continue; // 越界 / 退化层（引擎给 [0,0,0,0] 或负坐标）不参与判定
    const horiz = x < 0 || x + w > page.canvas.width;
    const above = y < 0;
    const below = y + h > page.canvas.height;
    // 视口版画布 = 视口：滚动内容被视口**裁切**是预期行为，不计越界；横向溢出在任何版本都算越界。
    if (page.viewport && y >= page.canvas.height - 12) { clipped += 1; continue; }
    if (above || horiz || below) bad.push(`${l.name}[${x},${y},${w},${h}]`);
  }
  if (page.viewport && clipped) bad.push(`（视口外按预期裁切 ${clipped} 层）`);
  return bad;
}

function emit(page) {
  const psd = join(HERE, `${page.screen}-${ID}.psd`);
  const dy = page.scrollY ?? 0;
  const def = (l) => {
    const q = JSON.parse(JSON.stringify(l.render.params));
    if (dy && !page.fixedNames.has(l.name)) {
      if (l.render.type === "text") q.y = Math.round(q.y - dy);
      else q.rect[1] = Math.round(q.rect[1] - dy);
    }
    return q;
  };

  // ── 阶段 A：按定义创建图层（引擎的 shape.create 走的是引擎默认基线，位置普遍不准）
  const a1 = ["run", "--new", JSON.stringify({ ...page.canvas, background: page.bg, name: page.screen })];
  for (const l of page.layers) {
    a1.push("--cmd", l.render.type === "text" ? "type.create" : "shape.create", "--params", JSON.stringify(def(l)));
  }
  a1.push("--out", psd, "--format", "psd");
  run(a1);

  let before = flatLayers(psd);
  const fixes = [];
  const skipped = [];
  for (const l of page.layers) {
    if (l.kind !== "text") continue;
    const m = before.get(l.name);
    // **只对测量有效的文字层补差**：引擎对越界 / 退化的层返回 [0,0,0,0]，
    // 拿它算补差会得出一个巨大的位移（实测 -166/-984），把整行带偏 ⇒ 跳过并登记为失败。
    if (!m || m.bounds[2] === 0 || m.bounds[3] === 0) { skipped.push(l.name); continue; }
    const d = deltaFor(l, before, page.scrollY ?? 0);
    if (!d) continue;
    // 补差量只来自 `deltaFor` 的实测差值 —— **不再叠加 scrollY 平移**：
    // 视口页的平移已经在阶段 A 写进每个图层的创建参数里，叠加第二次会让位移正好放大一倍。
    if (d.dx || d.dy) fixes.push({ dx: d.dx, dy: d.dy, layer: m.id, name: l.name });
  }
  let after = flatLayers(psd);
  before = after;

  // 阶段 B：先试 `layer.translate`（对文本有效）。
  if (fixes.length) {
    const a2 = ["run", psd];
    for (const f of fixes) a2.push("--cmd", "layer.translate", "--params", JSON.stringify({ layer: f.layer, dx: f.dx, dy: f.dy }));
    a2.push("--out", psd, "--format", "psd");
    run(a2);
    after = flatLayers(psd);
    before = after;
  }

  after = flatLayers(psd);
  const residual = page.layers
    .filter((l) => l.kind === "text")
    .map((l) => ({ name: l.name, dev: deviation(l, after, page.scrollY ?? 0) }))
    .filter((r) => r.dev > 1);
  const overflow = [...designOverflow(page), ...overflowReport(page, after)];
  if (skipped.length) overflow.push(...skipped.map((n) => `${n}[跳过补差]`));
  run(["convert", psd, join(HERE, `${page.screen}-${ID}.png`)]);

  writeFileSync(
    join(HERE, `layers.${page.screen}.json`),
    `${JSON.stringify({
      screen: page.screen,
      id: ID,
      canvas: `${page.canvas.width}×${page.canvas.height} @ ${page.canvas.resolution} ppi`,
      generatedBy: "docs/process/prototypes/FEAT-002/build-prototypes.mjs",
      tokens: "docs/process/prd/FEAT-002-ui-spec.md §8.2（本仓无 UI 项目令牌；数值骨架取 docs/process/ui/tokens.md）",
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
      band: page.band,
      align: page.align,
    }, null, 2)}\n`,
  );
  console.log(
    `✓ ${page.screen}：图层 ${page.layers.length}｜补差 ${fixes.length} 处｜残余偏差 ${residual.length ? residual.map((r) => `${r.name} ${r.dev.toFixed(1)}px`).join("；") : "0"}｜越界图层 ${overflow.length ? overflow.join(" ") : 0}`,
  );
}

const builders = [
  ["首页商品列表", mHome],
  ["商品详情", mDetail],
  ["购物车", mCart],
  ["结算下单页面", mCheckout],
  ["订单列表页面", mOrders],
  ["登录与注册", mLogin],
  ["我的", mMe],
  ["首帧无脚本", mNoJs],
  ["首页商品列表视口", mHomeViewport],
  ["首页商品列表宽屏", wHome],
  ["购物车宽屏", wCart],
];
mkdirSync(HERE, { recursive: true });
for (const [, fn] of builders) emit(fn());
console.log(`\n完成：${builders.length} 屏 → ${HERE}`);
