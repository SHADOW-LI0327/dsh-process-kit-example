# 商品主图来源与许可登记（CREDITS）

本目录下 8 张商品主图为**本仓自托管**的真实照片（CC 系许可，允许商用），**不在运行期请求任何第三方 host**。
逐张的取材与看图对货结论见 `reports/orchestrator/FEAT-002-主图取材台账.md`。**改图请同名覆盖**，无需改代码。

预处理口径（对**每一张**都做过）：按短边**居中裁剪为正方形**；短边 ≥ 800 的缩放到 **800×800**，
短边 400–799 的保留裁剪后原生尺寸，短边不足 400 的**最小放大到 400×400**（规格下限）。
`P-001`（源图 600×394、裁剪后 394×394）属最后一种情况。

## 逐张登记（每行含：本地文件 · 商品 · 作者 · 来源页 · 许可）

| 本地文件 | 商品 | 作者 | 来源页 | 许可名 | 许可 URL |
| --- | --- | --- | --- | --- | --- |
| P-001.jpg | 手冲咖啡壶 | markolaz | https://www.flickr.com/photos/195403219@N08/52135390054 | CC BY 2.0 | https://creativecommons.org/licenses/by/2.0/ |
| P-002.jpg | 陶瓷滤杯 | Olgierd Pstrykotwórca | https://www.flickr.com/photos/12896810@N00/29971510452 | CC BY 2.0 | https://creativecommons.org/licenses/by/2.0/ |
| P-003.jpg | 单品豆 250g | FreeWine | https://www.flickr.com/photos/96332550@N00/307110116 | CC BY 2.0 | https://creativecommons.org/licenses/by/2.0/ |
| P-004.jpg | 手摇磨豆机 | markolaz | https://www.flickr.com/photos/195403219@N08/52221830427 | CC BY 2.0 | https://creativecommons.org/licenses/by/2.0/ |
| P-005.jpg | 电子秤 | Jacek Halicki | https://commons.wikimedia.org/wiki/File:2023_Elektroniczna_waga_kuchenna.jpg | CC BY-SA 4.0（衍生图同许可） | https://creativecommons.org/licenses/by-sa/4.0/ |
| P-006.jpg | 滤纸 100 张 | jonolist | https://www.flickr.com/photos/46635911@N00/5579386154 | CC BY-SA 2.0（衍生图同许可） | https://creativecommons.org/licenses/by-sa/2.0/ |
| P-007.jpg | 保温杯 | Schekinov Alexey Victorovich | https://commons.wikimedia.org/w/index.php?curid=81735876 | CC BY-SA 3.0（衍生图同许可） | https://creativecommons.org/licenses/by-sa/3.0/ |
| P-008.jpg | 壶嘴清洁刷 | jill570641 | https://www.flickr.com/photos/44362794@N02/6067756723 | CC BY-SA 2.0（衍生图同许可） | https://creativecommons.org/licenses/by-sa/2.0/ |

## 许可义务说明

- **署名（BY）**：8 张全部要求署名 —— 作者与来源页已逐张登记在上表，界面以本文件履行署名义务。
- **相同方式共享（BY-SA，`P-005` / `P-006` / `P-007` / `P-008`）**：这 4 张经过**裁剪与缩放**，属**衍生作品**，
  因此本目录下对应的衍生图**仍按同一 `by-sa` 许可**分发（许可名与许可 URL 见上表对应行）。
- **换图留痕（2026-10-16，同名覆盖）**：`P-005` 原图画面经 UAT 逐张看图判定为「AEROPRESS 压滤壶」（**不是电子秤**），
  且画面含第三方商标文字 ⇒ 换为 `File:2023_Elektroniczna_waga_kuchenna.jpg`（作者 **Jacek Halicki**，`CC BY-SA 4.0`；
  源图 3550×4028，**居中裁剪 + 缩放**到 800×800）。新图**一眼是电子秤**（圆形秤盘 + 液晶读数 `314 g`），
  面板仅见量程与按键功能字样（`B05` / `5Kg x 1g` / `UNIT` / `T` / `g`），**无第三方商标 wordmark**。**换图不改代码**。
- **无 NoDerivatives（`by-nd`）素材**：裁剪/缩放本身即构成衍生，取材时刻意避开了禁止演绎的许可。
- 原图下载字节暂存于 `reports/orchestrator/FEAT-002-主图源图/`（过程产物，不入库），
  同目录 `SOURCES.json` 含机器可读的同一批元数据（含原始下载 URL）。
