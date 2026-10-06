<script setup lang="ts">
// 「编辑器 › 常规 › 智能键」里回车与引号的那三格 —— 与本页已有的「粘贴时」同一族
// （都是 `platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java` 的字段）。
// 上游面板 `platform/lang-impl/src/com/intellij/application/options/editor/EditorSmartKeysConfigurable.kt`：
//   · :49-51 `cbInsertPairQuote` —— 文案键 `checkbox.insert.pair.quote`
//     （`platform/ide-core/resources/messages/ApplicationBundle.properties:409` "Insert pair quote"），
//     绑 `AUTOINSERT_PAIR_QUOTE`（`CodeInsightSettings.java:140`，默认 true）；
//     `QuoteHandler.java:10-20` 的类注释写明这个 handler 的开关就是它。
//   · :69-72 `cbInsertPairCurlyBraceOnEnter` —— `checkbox.insert.pair.curly.brace`
//     （ApplicationBundle.properties:413 "Insert pair '}'"），绑 `INSERT_BRACE_ON_ENTER`（:130，默认 true）。
//   · :74-76 `cbCloseBlockCommentOnEnter` —— `checkbox.close.block.comment`
//     （ApplicationBundle.properties:411 "Close block comment"），绑 `CLOSE_COMMENT_ON_ENTER`（:132，默认 true）。
// 文案是英文原文直译（本地化包不在本地树）。
//
// 执行体（不是这里新造的行为）：
//   · 引号 —— `src/editorTyping.ts:120` 的 `smartQuotes`，挂在 `src/components/CodeEditor.vue:968`；
//   · 块注释闭尾 —— `src/editorEnterBlockComment.ts:176-178` 的第 4 个参数 `closeOnEnter`（现按默认 true 走）；
//   · 补收尾大括号 —— `src/enterHandlers.ts:180` 的 `enterAfterUnmatchedBrace`（调用点 `:281`）。
// 三处「把设置值灌进调用点」的那一行分别要动 `CodeEditor.vue` 与 `enterHandlers.ts`（本批不改别人的文件），
// 逐字代码在 `docs/wiring-requests-2026-10-06-setkeys.md` K-2/K-3。
//
// `settings` 是对话框那份**同一个** editor 草稿对象，保存仍由对话框的「应用」统一做。
import type { EditorSettings } from '../settingsModel'

defineProps<{ settings: EditorSettings; busy?: boolean }>()
</script>

<template>
  <label class="checkbox-row"><input v-model="settings.autoInsertPairQuote" type="checkbox" aria-describedby="editor-pair-quote-hint" /><span>插入成对引号</span></label>
  <p id="editor-pair-quote-hint" class="field-hint restore-hint">上游 “Insert pair quote”（<code>EditorSmartKeysConfigurable.kt:49-51</code>），默认开 = <code>CodeInsightSettings.java:140</code>。关掉后键入引号只写那一个字符，不再自动补收尾的那个。</p>
  <label class="checkbox-row"><input v-model="settings.insertBraceOnEnter" type="checkbox" aria-describedby="editor-pair-brace-hint" /><span>插入成对的 `}`</span></label>
  <p id="editor-pair-brace-hint" class="field-hint restore-hint">上游 “Insert pair '}'”（<code>EditorSmartKeysConfigurable.kt:69-72</code>），默认开 = <code>CodeInsightSettings.java:130</code>：在未配对的 <code>{</code> 之后回车时补上收尾的大括号。</p>
  <label class="checkbox-row"><input v-model="settings.closeCommentOnEnter" type="checkbox" aria-describedby="editor-close-comment-hint" /><span>闭合块注释</span></label>
  <p id="editor-close-comment-hint" class="field-hint restore-hint">上游 “Close block comment”（<code>EditorSmartKeysConfigurable.kt:74-76</code>），默认开 = <code>CodeInsightSettings.java:132</code>：块注释没闭合时回车在行尾补收尾标记。</p>
</template>
