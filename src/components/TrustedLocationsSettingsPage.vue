<script setup lang="ts">
// 「受信任位置」设置页 —— 上游 `TrustedHostsConfigurable`（`intellij.platform.ide.impl.xml:783-786`：
// id `trusted.hosts`、groupId="appearance"、instance `com.intellij.ide.impl.TrustedHostsConfigurable`）。
// 上游是一张**清单**：新增走文件选择器（`TextFieldWithBrowseButton` + `FileChooserDescriptorFactory`），
// 删除/去重后按差集发信任事件（`applyMergedTrustedPaths`），清单本体是用户手管的 `TrustedPathsSettings`
// 与确认框勾「不再询问」写进 `TrustedPaths` 的并集。
//
// 本仓只有一个应用级清单 `generalSettings.trustedPaths`（`src/settingsModel.ts`），
// 它同时被打开流程（`src/workspaceLifecycle.ts`）、执行入口（`src/runActions.ts` 的 trustBlock）
// 与宿主硬边界（`native/trusted_paths.cpp`）读；这一页只编辑它。
//
// 与上游的差别（写进 pf/trusted 的判词）：上游清单是两个存储的并集 + Windows Defender 排除项
// 勾选，本仓只有一个存储、也没有 Defender 集成；文件级信任（`TrustedFiles`）不在这一页。
import { computed, ref } from 'vue'
import { request } from '../bridge'
import type { GeneralSettingsState } from '../settingsModel'
import {
  addTrustedLocation, applyMergedLocations, rememberSessionTrust, replaceSessionTrust,
  sessionTrustEntries, setTrustedLocationState, trustedLocationRows, type TrustedPathEntry,
} from '../trustedProjects'
import { chooseWithDescriptor, singleDirDescriptor, withTitle, type FileChooserHost } from '../fileChooserDescriptor'

const props = defineProps<{ general: GeneralSettingsState; busy?: boolean }>()
const input = ref('')
const note = ref('')
/** 会话级那一档的**本地响应式镜像**（模块里那份是数据本体，写两边才既可见又持久不到盘）。 */
const session = ref<TrustedPathEntry[]>(sessionTrustEntries())
function syncSession(next: TrustedPathEntry[]) { session.value = next; replaceSessionTrust(next) }
/** 一张表并两个存储（上游 `TrustedHostsConfigurable.kt:61-69` 的 `getMergedTrustedPaths`）。 */
const rows = computed(() => trustedLocationRows(props.general.trustedPaths, session.value))

/**
 * 「浏览…」走上游那条口径：`TextFieldWithBrowseButton` + 一个**目录描述件**
 * （`TrustedHostsConfigurable.kt:45-47` 的 `chooserDescriptor` / `:157-166` 的 `getPathFromUser`），
 * 选回来先过 `selectionProblem` 复核（不是目录就报原因，不静默收下）。
 */
const chooserHost: FileChooserHost = {
  pickFile: params => request<string | null>('dialog.pickFile', params),
  pickDirectory: params => request<string | null>('dialog.pickDirectory', params),
}
async function browse() {
  try {
    const picked = await chooseWithDescriptor(chooserHost, withTitle(singleDirDescriptor(), '选择要信任的文件夹'), input.value)
    if (picked) { input.value = picked; note.value = '' }
  } catch (caught) { note.value = caught instanceof Error ? caught.message : String(caught) }
}
/** 添加入口：重复/空路径给可见错误，成功则整表替换（草稿的脏标记靠新数组引用被看到）。 */
function add() {
  const result = addTrustedLocation(props.general.trustedPaths, input.value)
  if ('error' in result) { note.value = result.error; return }
  props.general.trustedPaths = result.entries
  input.value = ''
  note.value = ''
}
/**
 * 移除：按**差集回写到两个存储**（上游 `applyMergedTrustedPaths` `:80-89`）——
 * 删掉一条「本次会话答应过」的项，不会把用户手管的那条一起删掉，反之亦然。
 */
function remove(path: string) {
  const kept = rows.value.filter(row => row.path !== path).map(row => row.path)
  const merged = applyMergedLocations(props.general.trustedPaths, session.value, kept)
  props.general.trustedPaths = merged.entries
  syncSession(merged.session)
}
/**
 * 改信任状态：持久清单里的行改持久清单，只在会话里答应过的那一行改会话那一档
 * （`setTrustedLocationState` 对不在清单里的路径是原样返回，所以两档必须分开写）。
 */
function flip(row: { path: string; trusted: boolean; source: 'settings' | 'explicit' }) {
  if (row.source === 'explicit') {
    rememberSessionTrust(row.path, !row.trusted)
    session.value = sessionTrustEntries()
    return
  }
  props.general.trustedPaths = setTrustedLocationState(props.general.trustedPaths, row.path, !row.trusted)
}
</script>

<template>
  <h3>受信任位置</h3>
  <p class="section-description">位于这些文件夹（及其子文件夹）下的项目会被信任，其构建脚本与运行配置可以执行。对应 IDEA 的设置 › 外观与行为 › 受信任位置（TrustedHostsConfigurable，注册 id trusted.hosts）；打开未信任项目时勾选「以后不再询问」也会写进这张清单。</p>
  <fieldset class="settings-fields trusted-locations" :disabled="busy">
    <div class="trusted-add">
      <input
        v-model.trim="input" type="text" spellcheck="false" aria-label="要信任的文件夹路径"
        placeholder="例如 D:/work/projects" @keydown.enter.prevent="add"
      />
      <button type="button" class="subtle-button" :disabled="busy" title="用文件夹选择器挑一个位置" @click="browse">浏览…</button>
      <button type="button" class="subtle-button" :disabled="busy || !input" title="把输入的文件夹加入受信任清单" @click="add">添加</button>
    </div>
    <p v-if="note" class="field-hint validation-error" role="alert">{{ note }}</p>
    <p v-if="!rows.length" class="field-hint">清单为空：打开陌生目录时会先询问，只有选择「信任并打开」后才允许构建与运行。</p>
    <ul v-else class="trusted-list">
      <li v-for="row in rows" :key="row.path" class="trusted-row">
        <span class="trusted-path" :title="row.path">{{ row.path }}</span>
        <span class="trusted-state" :class="{ untrusted: !row.trusted }">{{ row.label }}</span>
        <span v-if="row.source === 'explicit'" class="trusted-source" title="这一条只在本次会话里答应过，没有写进设置">本次会话</span>
        <button
          type="button" class="subtle-button" :disabled="busy"
          :title="row.trusted ? '改为不信任（下次打开会先询问）' : '改为信任（不再询问）'"
          @click="flip(row)"
        >{{ row.trusted ? '改为不信任' : '改为信任' }}</button>
        <button
          type="button" class="subtle-button" :disabled="busy" :title="`从清单里移除 ${row.path}`"
          @click="remove(row.path)"
        >移除</button>
      </li>
    </ul>
  </fieldset>
</template>

<style scoped>
.trusted-add { display: flex; gap: var(--space-2); align-items: center; }
.trusted-add input { flex: 1; min-width: 0; }
.trusted-list { margin: var(--space-2) 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-1); }
.trusted-row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.trusted-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: 11px; color: var(--text); }
.trusted-state { flex-shrink: 0; padding: 0 var(--space-1); border: 1px solid var(--line-strong); border-radius: var(--radius-xs, 3px); font-size: 10px; color: var(--success); }
.trusted-state.untrusted { color: var(--muted); }
.trusted-source { flex-shrink: 0; font-size: 10px; color: var(--muted); }
</style>
