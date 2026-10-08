# batch-2026-10-06 ssmatch —— 速度搜索共享 matcher：分隔符感知 + 退格超时 + 桶9 replace 缺项

lane：`ssmatch`（TaoCode `D:\TaoCode`）。窄切片：只做「速度搜索共享 matcher 的两项扩展」与「桶9 剩余 SpeedSearch replace 缺项核对」。
本文档由本 lane 逐步落盘；所有数字为实测原始输出，未改写。

## §0 接手实况（本 lane 自己复核，不照抄派单）

- 域测试基线（接手时实跑）：
  - `node --test tests/speed-search.test.mjs` → `tests 28 / pass 28 / fail 0`
  - `node --test tests/speed-search-wiring.test.mjs` → `tests 9 / pass 9 / fail 0`（mtime 10-06 15:21，非本 lane 名下，别的批已加）
  - `node --test tests/navigation-symbol-filter.test.mjs` → `tests 4 / pass 4 / fail 0`
  - 三个文件合跑 `tests 41 / pass 41 / fail 0`。**接手时 41/41 全绿**（派单说的 `32/32` 对应 `speed-search` 28 + `navigation-symbol-filter` 4，与实跑一致；那 9 条 wiring 是后来别的批加的）。
- 「扩展没写」这一条**与实况不符，已复核**：`src/speedSearch.ts`（mtime 10-06 13:41，工作区相对 `HEAD` 有 `+271/-` 改动、**未提交**）里分隔符感知那一项**已经写完**：
  `speedSearchMatches(pattern, text, hardSeparators)`（`:47`）、`matchesFrom(...)` 的 hump 间隔符约束（`:61-84`）、
  `patternSeparatorProfile`（`:94-107` 两处豁免）、`SPEED_SEARCH_STRUCTURE_SEPARATORS = ' ()'`（`:128`）。
  对应 4 条判据在基线里是绿的（`硬分隔符集逐字照上游…` / `pattern 不带分隔符、又不混大小写时…` / `两处豁免按上游…` / `硬分隔符只查两个 hump 之间…`）。
  `src/symbolSearch.ts`（mtime 10-06 13:49，同样未提交，`+37/-`）已是它的消费方。
- 上一批留下的**加载期断链**：`src/lspSymbolBridge.ts` 曾从只 import 不导出的模块引常量。本 lane 只读核对该文件，不改（在禁写清单内）；自证方式见 §5 的 `import()` 实跑。
- 本 lane 剩余真正要做的：**退格超时/取消过滤那一档的上游核实**、**重复实现收成一份的复核**、**桶9 SpeedSearch replace 缺项核对**、以及这份报告。

## §1 上游核对

（待填）

## §2 落盘

（待填）

## §3 判据

（待填）

## §4 反向验证

（待填）

## §5 门禁原始数字

（待填）

## §6 无法核实

（待填）

## §7 接线请求

（待填）
