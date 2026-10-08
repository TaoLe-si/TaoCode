# Batch 2026-10-06 — lane: completionins（插入时行为对齐）

范围：仅补全「插入时」行为对齐 —— 大小写匹配（MATCH_CASE）、已键入前缀的替换范围、点号/括号后缀（ADD_COMPLETION_DOT / INSERT_BRACKETS_AFTER_METHOD_COMPLETION），并落其中一条用户可见缺项。

状态：进行中。每做完一块立刻落盘。

## §0 接手实况
（待填：文件清单、测试红绿、git log 证据）

## §1 上游核对（含假坐标留痕）
（待填：BaseCompletionProposal / CompletionUtil / CodeCompletionSettings / CompletionClientProperties / LookupImpl，实读行号）

## §2 落盘（文件 + 净行数）
（待填）

## §3 判据与反向验证
（待填：COMPLETIONINS 前缀注入→红→还原→cmp/sha1→grep=0）

## §4 门禁原始数字
（待填）

## §5 无法核实
（待填）

## §6 接线请求
（待填：docs/wiring-requests-2026-10-06-completionins.md）
