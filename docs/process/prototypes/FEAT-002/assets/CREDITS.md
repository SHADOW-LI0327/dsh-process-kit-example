# 商品主图取材样例 · 来源与许可登记

> **这是什么**：`docs/process/prototypes/FEAT-002/assets/P-00N.jpg` 的**来源登记**。这 8 张图是 **UI 原型用的取材样例**，用来让评审者看到「主图位放真实照片」的观感；**它们不是交付物**。
> **交付物是什么**：`web/assets/products/P-00N.jpg`（由 dev 落盘），同样需按 `FEAT-002-ui-spec.md` 的 `UI-67` 登记来源与许可 —— dev 可选择沿用本文件这批图，也可另选，但必须逐张登记。
> **规范依据**：`docs/process/prd/FEAT-002-ui-spec.md` §9（交付后变更：本仓自托管真实照片）· `UI-67`（锚 `AC-48` ⑤ / `AC-49`）· `UI-65`（运行时零第三方请求）· `RSK-01`（知识产权）。

## 许可

全部图片来自 **Unsplash**（<https://unsplash.com>），适用 **Unsplash License**（<https://unsplash.com/license>）：
可免费用于商业与非商业用途、**无需署名**（本文件仍逐张登记以示来源）、不得将图片原样作为竞品图库转售。
**运行时不自 Unsplash 拉图** —— 图片随仓库自托管，页面请求全部同源（`UI-65`）。

## 逐张登记

| 文件 | 对应商品（`DEFAULT_SEED`） | 来源 | 许可 | 取材性质 |
| --- | --- | --- | --- | --- |
| `P-001.jpg` | `P-001` 手冲咖啡壶 | `https://images.unsplash.com/photo-1495474472287-4d71bcdd2085` | Unsplash License | 咖啡冲煮场景（含手冲器具） |
| `P-002.jpg` | `P-002` 陶瓷滤杯 | `https://images.unsplash.com/photo-1544787219-7f47ccb76574` | Unsplash License | 咖啡器具特写 |
| `P-003.jpg` | `P-003` 单品豆 250g | `https://images.unsplash.com/photo-1447933601403-0c6688de566e` | Unsplash License | 咖啡豆 |
| `P-004.jpg` | `P-004` 手摇磨豆机 | `https://images.unsplash.com/photo-1524350876685-274059332603` | Unsplash License | 咖啡豆 / 研磨题材 |
| `P-005.jpg` | `P-005` 电子秤 | `https://images.unsplash.com/photo-1497935586351-b67a49e012bf` | Unsplash License | 咖啡冲煮题材 |
| `P-006.jpg` | `P-006` 滤纸 100 张 | `https://images.unsplash.com/photo-1509042239860-f550ce710b93` | Unsplash License | 咖啡冲煮题材 |
| `P-007.jpg` | `P-007` 保温杯 | `https://images.unsplash.com/photo-1511920170033-f8396924c348` | Unsplash License | 咖啡冲煮题材 |
| `P-008.jpg` | `P-008` 壶嘴清洁刷 | `https://images.unsplash.com/photo-1521302080334-4bebac2763a6` | Unsplash License | 咖啡器具清洁题材 |

## 本文件**不满足**收紧后的 `UI-67` 登记格式（如实声明，不补假字段）

`UI-67`（2026-10-16 收口后，见 `ui-spec.md` §9.5 的 `R-1`~`R-4`）要求每张图**各自一行**且该行含 **6 项**：本地文件名 · 商品名 · **作者** · **来源页 URL（照片页）** · 许可名 · 许可 URL。**本文件缺「作者」与「照片页 URL」两项**，原因是：
- 本批图是用**图片直链**（`images.unsplash.com/photo-<id>`）下载的，**下载时未抓取作者元数据**；
- Unsplash 的**照片页 URL 与作者**需要走它的 API / 照片页，实测**未授权**（`https://unsplash.com/napi/photos/photo-<id>` → `307 Authorization required`；`https://unsplash.com/photos/photo-<id>` → `401`）⇒ **ui-designer 拿不到**。
- **处理方式**：**不编造作者名、不拿许可 URL 冒充来源页**（那正是 `R-2` 要关掉的假绿通道，也是「用假字段换判绿」）。**本文件因此只作取材留痕，明确不作为 `UI-67` 的合规样本**。
- **`UI-67` 的对象是交付物** `web/assets/products/CREDITS.md`（由 **dev** 落盘）：dev 下载时可直接记录**作者**与**照片页 URL**，按 §9.5 的 `R-1`~`R-4` 写成 6 项齐全的逐行登记。

## 取样限制（**必须知道，别把它当已完成**）

- 本批图是**咖啡题材的通用图**，**未逐张核验「拍到的是不是该商品的准确形态」**。ui-designer 无图库检索权限，只能取到公开可直连的咖啡题材图。
- **主控已于 2026-10-16 逐张看图核验（拼版一次看完 8 张），确认 8 张里只有 `P-003`（咖啡豆）对货，其余 7 张均不对货**：`P-001` = 双手拿拿铁 · `P-002` = 杯子配饼干 · `P-004` = 麻袋装豆 · `P-005` = 冲煮手柄（不是电子秤）· `P-006` = 几杯卡布（不是滤纸）· `P-007` = 冲煮手柄（不是保温杯）· `P-008` = 一杯黑咖啡（不是清洁刷）。**此结论已定案，下一个人不必再猜、也不要去改这 8 张图**（它们是取材样例；交付物 `web/assets/products/P-00N.jpg` 由 dev 落题材对货的图）。
- 因此本批图**适合看版式**（主图位的尺寸、圆角、`aspect-ratio:1/1`、与标题/价格/角标的相对关系），**不适合当「图对货」的证据**。
- **交付物必须题材对货**：dev 落盘 `web/assets/products/P-00N.jpg` 时按 `ui-spec.md` §9.2 的**题材台账**选图（手冲壶 / 锥形滤杯 / 咖啡豆 / 手摇磨 / 电子秤 / 滤纸 / 保温杯 / 清洁刷），并**逐张**把真实来源写进 `web/assets/products/CREDITS.md`。
- 「题材对货」的口径已由主控裁定：**由人工看图留痕承担，不做机器断言**（见 `ui-spec.md` §七 `UQ-3`，已裁定）。
