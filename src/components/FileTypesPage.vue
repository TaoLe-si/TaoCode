<script setup lang="ts">
// 设置 › 编辑器 › 文件类型（IDEA `preferences.fileTypes`，`FileTypeConfigurable`）。
//
// 注册证据：platform/lang-impl/resources/intellij.platform.lang.impl.xml:992-994
//   `<applicationConfigurable groupId="editor" groupWeight="120"
//     instance="com.intellij.openapi.fileTypes.impl.FileTypeConfigurable"
//     id="preferences.fileTypes" key="filetype.settings.title" bundle="messages.FileTypesBundle"/>`
// —— groupId="editor"，所以它属于**编辑器**（此前这条设置没有页内编辑入口，只能在文件树/标签页右键改，
// 本批补上页内编辑）。
//
// IDEA 的 File Types 页是「已识别文件类型列表 + 每种类型的注册模式」，本仓现在**两块都有**：
//   · 上块 = `扩展名 → 语言`（`ProjectSettings.fileAssociations`，消费点是编辑器语法与语言服务器，
//     右键菜单「关联文件类型」写的是同一份数据）；
//   · 下块 = `src/fileTypeRegistry.ts` 那张运行时注册表（上游 `FileTypeManager` 的等价物）：
//     列每个类型当前真实持有的模式，能加能删。加/删直接改变编辑器判定
//     （`src/fileTypeDetection.ts` 的 `detectFileType` 查的就是这张表）。
//
// 「删掉一条模式」在上游不是从表里抹掉就完事：`RemovedMappingTracker` 会记下
// 「这条模式已从该类型摘走」，之后该类型重新注册也抢不回去
// （`FileTypeManagerImpl.java:1591-1603`）；未经用户点头的记录由启动活动整批批准
// （`ApproveRemovedMappingsActivity.kt:19-24`）。本仓的等价物在 `src/fileTypeRemovedMappings.ts`，
// 页面上就是那张「待确认的摘除记录」表 + 那个「整批批准」按钮。
//
// 「重新解析文件类型」是上游 `ReparseUtil.kt:11-17`（`FileContentUtilCore.reparseFiles`）的等价物：
// 清掉探测缓存并让已打开的标签页重算语言（`src/fileTypeDetection.ts` 的 `reparseFileTypes`）。
import { computed, ref, watch } from 'vue'
import { Pencil, Plus, Trash2, X } from 'lucide-vue-next'
import { EDITOR_LANGUAGES } from '../bridge'
import { associationsFromRows, rowsFromAssociations, validExtension, validateFileAssociations } from '../fileTypes'
import { fileTypeManager, parseFileNameMatcher, presentableMatcher, type FileNameMatcher, type FileTypeConflict, type HashBangConflict } from '../fileTypeRegistry.ts'
import { detectFileTypeCached, detectedSummary, reparseFileTypes, resolveEditorLanguage, fileTypeRevision } from '../fileTypeDetection.ts'
import { changeFileTypeOverride, overridableFileTypes, overrideFailureReason, fileTypeOverrideRows, revertFileType } from '../fileTypeOverrides.ts'
// 「忽略的文件与目录」那张清单（上游 IgnoredFilesAndFoldersPanel + FileTypeManagerImpl 的三个 API）。
import {
  IGNORED_TEXT,
  applyIgnoredPatterns,
  editIgnoredPattern,
  ignoredPatterns,
  isIgnoreListEqualToCurrent,
  loadIgnoredPatterns,
  removeIgnoredPattern,
  restoreDefaultIgnoredPatterns,
} from '../fileTypeIgnoredList.ts'
import { iconSize } from '../uiIcons'
import type { GeneralSettingsState } from '../settingsModel'

const props = defineProps<{ associations: Record<string, string> | null; busy: boolean }>()
const emit = defineEmits<{ save: [associations: Record<string, string>] }>()

type Row = { extension: string; language: string }

const LANGUAGE_LABELS: Record<string, string> = { java: 'Java', cpp: 'C++', typescript: 'TypeScript', other: '纯文本' }

const rows = ref<Row[]>([])
const snapshot = ref('')
const note = ref('')

const shape = () => JSON.stringify(rows.value)
const dirty = computed(() => shape() !== snapshot.value)

function fillFrom(source: Record<string, string> | null) {
  rows.value = rowsFromAssociations(source)
  snapshot.value = shape()
  note.value = ''
}
watch(() => props.associations, fillFrom, { immediate: true })

// 校验与原生 `validate_file_associations` 同规则（src/fileTypes.ts）。
const invalidExtension = (value: string) => !validExtension(value.trim())
const duplicates = computed(() => {
  const seen = new Map<string, number>()
  for (const row of rows.value) seen.set(row.extension, (seen.get(row.extension) ?? 0) + 1)
  return [...seen.entries()].filter(([, count]) => count > 1).map(([extension]) => extension)
})
const problem = computed(() => validateFileAssociations(associationsFromRows(rows.value)))

function add() { rows.value = [...rows.value, { extension: '', language: 'other' }] }
function drop(index: number) { rows.value = rows.value.filter((_, position) => position !== index) }
function save() {
  if (props.busy) return
  if (problem.value) { note.value = problem.value; return }
  emit('save', associationsFromRows(rows.value))
  snapshot.value = shape()
  note.value = ''
}

// ── 运行时注册表那两块（类型 + 模式 / 冲突与摘除记录）────────────────────────────────
//
// 注册表是进程内的，改动**不落项目设置**：本仓的设置存储（`native/settings_schema.cpp` 的
// `fileAssociations`）只有「扩展名 → 语言」两个字符串，模式行的形状（精确名 / 通配 / 扩展名）
// 与「该模式属于哪个类型」在那张表里放不下 ⇒ 见报告里的接线请求。页面顶部明说这一点，
// 免得用户以为关掉窗口还在。
const registry = ref(0)
const bumpRegistry = () => { registry.value += 1 }
// 类型/模式一变就重画（注册表自己的广播是上游 `FileTypeListener` 的等价物）。
watch(fileTypeRevision, bumpRegistry)

/** 每个类型当前真实持有的模式与 hashbang（`FileTypeManager.getAssociations` + `getHashBangPatterns`）。 */
const typeRows = computed(() => {
  void registry.value
  void fileTypeRevision.value
  return fileTypeManager.getRegisteredTypes()
    .map(type => ({
      type,
      matchers: fileTypeManager.getAssociations(type.id).map(matcher => presentableMatcher(matcher)),
      hashBangs: fileTypeManager.getHashBangPatterns(type.id),
    }))
    .sort((left, right) => left.type.name.toLowerCase() < right.type.name.toLowerCase() ? -1 : 1)
})

/** 新模式的输入框：每类型一行。 */
const patternDraft = ref<Record<string, string>>({})
const patternError = ref('')
/** 正在**改**的那条旧模式（null = 新增）；上游是同一条 `editPattern(item)` 路（`:363-429`）。 */
const patternEditing = ref<Record<string, string>>({})
/**
 * 等用户点头的改判（上游那个 `Messages.showOkCancelDialog(…, "Reassign Wildcard", Cancel)`，
 * `FileTypeConfigurable.java:403-411`）：只有用户点「改判」才真的把模式从原类型摘走。
 */
const pendingReassign = ref<{ typeId: string; pattern: string; holderId: string; holderName: string } | null>(null)

function addPattern(typeId: string) {
  if (props.busy) return
  const descriptor = fileTypeManager.getType(typeId)
  const text = (patternDraft.value[typeId] ?? '').trim()
  if (!descriptor || !text) { patternError.value = '要加的模式是空的。'; return }
  const matcher: FileNameMatcher = parseFileNameMatcher(text)
  const oldPattern = patternEditing.value[typeId] ?? null
  // 上游 `findExistingFileType`（`:433-443`）：先看这条模式现在归谁。
  const holder = fileTypeManager.findMatcherOwner(matcher)
  if (holder && holder.id !== typeId) {
    // `isReadOnly()` 那一档直接报错，不给确认（`:397-401` 的 `filetype.edit.add.pattern.exists.error`）。
    if (fileTypeManager.isReadOnlyType(holder)) {
      patternError.value = `模式 ${text} 是「${holder.name}」保留的，不能改判。`
      return
    }
    pendingReassign.value = { typeId, pattern: text, holderId: holder.id, holderName: holder.name }
    return
  }
  if (oldPattern && oldPattern !== text) {
    // 改一条已有模式：先把旧的从本类型摘掉（`:417-419` 的 `removeAssociation(item.first, ftd)`）。
    fileTypeManager.removeAssociation(typeId, parseFileNameMatcher(oldPattern), true)
  }
  const conflict = fileTypeManager.associate(typeId, matcher, true)
  patternError.value = conflict && !conflict.approved
    ? `${conflict.message || `模式 ${text} 仍归原类型`} —— 这次改判没有获准，保持原归属。`
    : conflict ? conflict.message || '' : ''
  patternDraft.value = { ...patternDraft.value, [typeId]: '' }
  patternEditing.value = { ...patternEditing.value, [typeId]: '' }
  bumpRegistry()
}

/** 确认改判：从原持有方摘掉（**记一条用户点过头的摘除记录**）再认领给本类型。 */
function confirmReassign() {
  if (props.busy) return
  const pending = pendingReassign.value
  if (!pending) return
  const matcher = parseFileNameMatcher(pending.pattern)
  fileTypeManager.removeAssociation(pending.holderId, matcher, true)
  const conflict = fileTypeManager.associate(pending.typeId, matcher, true)
  patternError.value = conflict && !conflict.approved
    ? `模式 ${pending.pattern} 没能改判给「${fileTypeManager.getType(pending.typeId)?.name ?? pending.typeId}」。`
    : `模式 ${pending.pattern} 已改判给「${fileTypeManager.getType(pending.typeId)?.name ?? pending.typeId}」。`
  pendingReassign.value = null
  patternDraft.value = { ...patternDraft.value, [pending.typeId]: '' }
  bumpRegistry()
}

function cancelReassign() {
  const pending = pendingReassign.value
  if (!pending) return
  patternError.value = `没有改判：模式 ${pending.pattern} 仍归「${pending.holderName}」。`
  pendingReassign.value = null
  patternDraft.value = { ...patternDraft.value, [pending.typeId]: '' }
}

/** 把一条已有模式装进输入框改成（上游 `editPattern()` 选中项那条路，`:356-361`）。 */
function editPattern(typeId: string, pattern: string) {
  if (props.busy) return
  patternEditing.value = { ...patternEditing.value, [typeId]: pattern }
  patternDraft.value = { ...patternDraft.value, [typeId]: pattern }
  patternError.value = ''
}

function removePattern(typeId: string, pattern: string) {
  if (props.busy) return
  // 第三参 true = 这次摘除是**用户点头过的**（上游冲突通知里那条 `add(matcher, name, true)`）。
  const descriptor = fileTypeManager.getType(typeId)
  if (!descriptor) return
  fileTypeManager.removeAssociation(typeId, parseFileNameMatcher(pattern), true)
  bumpRegistry()
}

// ── HashBang patterns（`FileTypeConfigurable.java:695-807` 那张小表）───────────────────
const hashBangDraft = ref<Record<string, string>>({})
const hashBangError = ref('')
const pendingHashBang = ref<{ typeId: string; pattern: string; conflict: HashBangConflict } | null>(null)

/** 上游两条文案：exact 与 similar 各一条（`FileTypesBundle.properties:25-28`）。 */
function hashBangConflictText(conflict: HashBangConflict): string {
  return conflict.exact
    ? `这个 hashbang 模式已归「${conflict.typeName}」类型。`
    : `与之相似的 hashbang 模式「${conflict.pattern}」已归「${conflict.typeName}」类型。`
}

function addHashBang(typeId: string) {
  if (props.busy) return
  const text = (hashBangDraft.value[typeId] ?? '').trim()
  if (!text) { hashBangError.value = '要加的 hashbang 模式是空的。'; return }
  const conflict = fileTypeManager.addHashBangPattern(typeId, text)
  if (conflict && !conflict.writable) {
    // 上游这里是**错误框**（`:779-785`）：平台自带的模式与标准类型都不让抢。
    hashBangError.value = conflict.exact
      ? `这个 hashbang 模式是为「${conflict.typeName}」保留的，不能改判。`
      : `与之相似的 hashbang 模式「${conflict.pattern}」是为「${conflict.typeName}」保留的，不能改判。`
    return
  }
  if (conflict) {
    pendingHashBang.value = { typeId, pattern: text, conflict }
    return
  }
  hashBangError.value = ''
  hashBangDraft.value = { ...hashBangDraft.value, [typeId]: '' }
  bumpRegistry()
}

function confirmHashBangReassign() {
  if (props.busy) return
  const pending = pendingHashBang.value
  if (!pending) return
  fileTypeManager.addHashBangPattern(pending.typeId, pending.pattern, true)
  hashBangError.value = `${hashBangConflictText(pending.conflict)}已改判给「${fileTypeManager.getType(pending.typeId)?.name ?? pending.typeId}」。`
  pendingHashBang.value = null
  hashBangDraft.value = { ...hashBangDraft.value, [pending.typeId]: '' }
  bumpRegistry()
}

function cancelHashBangReassign() {
  const pending = pendingHashBang.value
  if (!pending) return
  hashBangError.value = `没有改判：${hashBangConflictText(pending.conflict)}`
  pendingHashBang.value = null
  hashBangDraft.value = { ...hashBangDraft.value, [pending.typeId]: '' }
}

function removeHashBang(typeId: string, pattern: string) {
  if (props.busy) return
  if (fileTypeManager.isStandardHashBang(pattern)) {
    // 上游 `editHashBang` 对标准类型走的是同一个错误框（`:812-813` 的 `writeable=false`）。
    hashBangError.value = `hashbang 模式 ${pattern} 是平台自带的，本仓不允许删。`
    return
  }
  fileTypeManager.removeHashBangPattern(typeId, pattern)
  hashBangError.value = ''
  bumpRegistry()
}

// ── 忽略的文件与目录（`IgnoredFilesAndFoldersPanel` 那张表）───────────────────────────
// 打开这页时先把存储里的清单灌进注册表（上游是应用启动时装 `filetypes` 组件，
// `FileTypeManagerImpl.java:165` + `:1363-1364`；本仓没有那个启动钩子的落点 ⇒ 见接线请求）。
const ignoreList = ref<string[]>(loadIgnoredPatterns())
const ignoreApplied = ref<string[]>([...ignoreList.value])
const ignoreEditing = ref<string | null>(null)
const ignoreOpen = ref(false)
const ignoreValue = ref('')
const ignoreIndex = ref(-1)
const ignoreProblem = ref('')
const ignoreNote = ref('')
const ignoreDirty = computed(() => !isIgnoreListEqualToCurrent(ignoreList.value.join(';'), ignoreApplied.value))

/** 输入框可见 = 正在新增或正在改（上游 `startEdit`/`stopEdit`，`:205-218`）。 */
const ignoreEditingOpen = computed(() => ignoreOpen.value)

function ignoreStartAdd() {
  ignoreEditing.value = null
  ignoreOpen.value = true
  ignoreValue.value = ''
  ignoreProblem.value = ''
}
function ignoreStartEdit(index: number) {
  ignoreEditing.value = ignoreList.value[index] ?? null
  ignoreOpen.value = true
  ignoreValue.value = ignoreList.value[index] ?? ''
  ignoreProblem.value = ''
}
function ignoreStopEdit() {
  ignoreOpen.value = false
  ignoreEditing.value = null
  ignoreValue.value = ''
  ignoreProblem.value = ''
}
/** Enter = 提交（`trySave`），成功才退出编辑；失败时输入框留着并报错（`:146-152`）。 */
function ignoreCommit() {
  const outcome = editIgnoredPattern(ignoreList.value, ignoreEditing.value, ignoreValue.value)
  if (!outcome.accepted) { ignoreProblem.value = outcome.problem; return }
  ignoreList.value = outcome.patterns
  ignoreIndex.value = outcome.index
  ignoreStopEdit()
}
function ignoreRemove() {
  if (ignoreIndex.value < 0) return
  const outcome = removeIgnoredPattern(ignoreList.value, ignoreIndex.value)
  ignoreList.value = outcome.patterns
  ignoreIndex.value = outcome.index
}
/** 页脚的「应用」：与生效清单按集合相同就不写（上游 `apply()` 的 `:200-202`）。 */
function ignoreApply() {
  if (props.busy) return
  const changed = applyIgnoredPatterns(ignoreList.value)
  // 回读**生效后**的清单：被遮蔽闸挡掉的那条（`*.pyc` 在场时加 `build.pyc`）在上游连清单都进不去，
  // 不该继续显示在表里 —— 与面板 `reset()` 从 `getIgnoredFilesList()` 回读同一口径。
  ignoreList.value = ignoredPatterns()
  ignoreApplied.value = [...ignoreList.value]
  ignoreNote.value = changed ? '已应用：忽略清单当场生效（文件选择、按名字判定的那几处）。' : '清单没有变化，不需要重新应用。'
}
/** 面板 `reset()`（`FileTypeConfigurable.java:229`）：从注册表回读，丢掉未应用的编辑。 */
function ignoreReset() {
  ignoreList.value = ignoredPatterns()
  ignoreApplied.value = [...ignoreList.value]
  ignoreStopEdit()
  ignoreNote.value = ''
}
function ignoreRestoreDefaults() {
  ignoreList.value = restoreDefaultIgnoredPatterns()
  ignoreApplied.value = [...ignoreList.value]
  ignoreStopEdit()
  ignoreNote.value = '已恢复默认清单（上游 DEFAULT_IGNORED 那 17 条）。'
}

/** 本进程判过的冲突（`getConflicts`）。 */
const conflicts = computed<FileTypeConflict[]>(() => { void registry.value; return [...fileTypeManager.getConflicts()] })
/** 还没被点头的摘除记录（`ApproveRemovedMappingsActivity` 那一轮要处理的）。 */
const pending = computed(() => {
  void registry.value
  return fileTypeManager.removedMappings().unapprovedMappings()
    .map(mapping => ({ text: `${presentableMatcher(mapping.matcher)} ← ${mapping.typeName}` }))
})
function approvePending() {
  if (props.busy) return
  const approved = fileTypeManager.removedMappings().approveUnapprovedMappings()
  patternError.value = `已批准 ${approved.length} 条摘除记录。`
  bumpRegistry()
}

// ── 按文件覆盖类型（`OverrideFileTypeManager`）──────────────────────────────────────
const overrideRows = computed(() => { void registry.value; return fileTypeOverrideRows() })
const overrideTargets = computed(() => overridableFileTypes())
const overrideError = ref('')
function applyOverride(path: string, value: string) {
  if (props.busy) return
  const reason = overrideFailureReason(path, value)
  if (reason) { overrideError.value = reason; return }
  overrideError.value = changeFileTypeOverride(path, value) ? '' : '这条覆盖已经不在清单里了。'
  bumpRegistry()
}
function revertOverride(path: string) {
  if (props.busy) return
  revertFileType(path)
  bumpRegistry()
}

// ── 重新解析（`ReparseUtil.kt`）─────────────────────────────────────────────────────
const reparseNote = ref('')
function reparse() {
  if (props.busy) return
  const { revision, dropped } = reparseFileTypes()
  reparseNote.value = `已重新解析：清掉 ${dropped} 条探测缓存（第 ${revision} 代），编辑器语言按当前规则重算。`
  bumpRegistry()
}

/** 一个类型 id 的展示名（确认框里那句要说「改判给谁」）。 */
const typeNameOf = (id: string) => fileTypeManager.getType(id)?.name ?? id

/** 试判：给定一个文件名，注册表 + 覆盖 + 关联表会把它判成什么。 */
const probePath = ref('Main.java')
const probeSummary = computed(() => {
  void fileTypeRevision.value
  void registry.value
  return detectedSummary(detectFileTypeCached(probePath.value, '', props.associations ?? {}))
})
/** 同一个输入喂给编辑器那条链，拿它真正会用的语言（证明这张表连着编辑器，不是摆设）。 */
const probeLanguage = computed(() => {
  void fileTypeRevision.value
  void registry.value
  const language = resolveEditorLanguage(probePath.value, '', props.associations ?? {})
  return language ? (LANGUAGE_LABELS[language] ?? language) : '按路径规则'
})
</script>

<template>
  <div class="ft-panel">
    <p v-if="!associations" class="section-description">尚未打开项目。</p>
    <template v-else>
      <div class="ft-table" role="table" aria-label="文件类型关联">
        <div class="ft-head" role="row"><span role="columnheader">扩展名</span><span role="columnheader">语言</span><span role="columnheader" class="ft-center">删除</span></div>
        <div v-for="(row, index) in rows" :key="index" class="ft-row" role="row">
          <label class="ft-ext"><span class="ft-dot">*.</span><input v-model="row.extension" spellcheck="false" :aria-label="`第 ${index + 1} 个扩展名`" :aria-invalid="invalidExtension(row.extension)" placeholder="conf" /></label>
          <select v-model="row.language" :aria-label="`第 ${index + 1} 个扩展名的语言`">
            <option v-for="language in EDITOR_LANGUAGES" :key="language" :value="language">{{ LANGUAGE_LABELS[language] }}</option>
          </select>
          <button type="button" class="icon-button ft-center" title="删除此关联" :aria-label="`删除第 ${index + 1} 条关联`" @click="drop(index)"><Trash2 :size="iconSize.menu" /></button>
        </div>
        <p v-if="!rows.length" class="ft-empty">没有关联，全部按扩展名与内容自动识别。</p>
      </div>
      <div class="ft-actions">
        <button type="button" class="subtle-button" :disabled="busy" @click="add"><Plus aria-hidden="true" :size="iconSize.menu" /> 添加关联</button>
        <button type="button" class="primary-button" :disabled="busy || !dirty" @click="save">保存关联</button>
        <button type="button" class="subtle-button" :disabled="busy || !dirty" @click="fillFrom(props.associations)">还原</button>
        <span class="ft-note">{{ note || (dirty ? '有未保存的改动' : '已与项目同步') }}</span>
      </div>
      <p v-if="duplicates.length" class="ft-error" role="alert">扩展名重复：{{ duplicates.join('、') }}</p>

      <h4 class="ft-title">已注册的类型与它们的模式</h4>
      <div class="ft-table" role="table" aria-label="已注册的文件类型">
        <div class="ft-head ft-head-type" role="row"><span role="columnheader">类型</span><span role="columnheader">文件名称模式</span><span role="columnheader">HashBang 模式</span></div>
        <div v-for="entry in typeRows" :key="entry.type.id" class="ft-type" role="row">
          <span class="ft-type-name">{{ entry.type.name }}<span class="ft-lang">（{{ LANGUAGE_LABELS[entry.type.language] ?? entry.type.language }}）</span></span>
          <span class="ft-patterns">
            <span v-for="pattern in entry.matchers" :key="pattern" class="ft-pattern">
              {{ pattern }}
              <button type="button" class="ft-unlink" :disabled="busy" :title="`改成别的样子`" :aria-label="`编辑 ${pattern} 这条模式`" @click="editPattern(entry.type.id, pattern)"><Pencil :size="iconSize.dense" /></button>
              <!-- `@click` 必须挂在 `<button>` 上：挂在 `<X>` 上时只有图标那 12px 命中，
                   按钮自身的盒（`.ft-unlink` 的 padding 与盒模型）点了什么都不发生 ——
                   与旁边那条「编辑」按钮的形状不一致。 -->
              <button type="button" class="ft-unlink" :disabled="busy" :title="`把 ${pattern} 从 ${entry.type.name} 摘掉`" :aria-label="`把 ${pattern} 从 ${entry.type.name} 摘掉`" @click="removePattern(entry.type.id, pattern)"><X :size="iconSize.dense" /></button>
            </span>
            <span v-if="!entry.matchers.length" class="ft-empty-inline">没有认领任何模式</span>
            <label class="ft-add-pattern">
              <input v-model="patternDraft[entry.type.id]" spellcheck="false" :aria-label="`给 ${entry.type.name} 加一条模式`" :placeholder="patternEditing[entry.type.id] ? '改成新的样子' : '*.conf 或 Makefile'" @keyup.enter="addPattern(entry.type.id)" />
              <button type="button" class="subtle-button" :disabled="busy" @click="addPattern(entry.type.id)">{{ patternEditing[entry.type.id] ? '改' : '添加' }}</button>
            </label>
          </span>
          <span class="ft-patterns">
            <span v-for="pattern in entry.hashBangs" :key="pattern" class="ft-pattern">
              #!{{ pattern }}
              <button type="button" class="ft-unlink" :disabled="busy" :title="`把 hashbang ${pattern} 从 ${entry.type.name} 摘掉`" :aria-label="`把 hashbang ${pattern} 从 ${entry.type.name} 摘掉`" @click="removeHashBang(entry.type.id, pattern)"><X :size="iconSize.dense" /></button>
            </span>
            <span v-if="!entry.hashBangs.length" class="ft-empty-inline">没有</span>
            <label class="ft-add-pattern">
              <input v-model="hashBangDraft[entry.type.id]" spellcheck="false" :aria-label="`给 ${entry.type.name} 加一条 hashbang 模式`" placeholder="python3" @keyup.enter="addHashBang(entry.type.id)" />
              <button type="button" class="subtle-button" :disabled="busy" @click="addHashBang(entry.type.id)">添加</button>
            </label>
          </span>
        </div>
      </div>
      <p v-if="patternError" class="ft-warn" role="status">{{ patternError }}</p>
      <p v-if="hashBangError" class="ft-warn" role="status">{{ hashBangError }}</p>
      <!-- 改判确认：上游那个 OK/Cancel 框（`FileTypeConfigurable.java:403-411` / `:786-795`），
           本仓在页内做同样的一步「不点头就不动」。 -->
      <div v-if="pendingReassign" class="ft-confirm" role="alertdialog" aria-label="确认改判文件模式">
        <span>模式 <code>{{ pendingReassign.pattern }}</code> 已经在「{{ pendingReassign.holderName }}」名下。要改判给「{{ typeNameOf(pendingReassign.typeId) }}」吗？</span>
        <button type="button" class="primary-button" :disabled="busy" @click="confirmReassign">改判模式</button>
        <button type="button" class="subtle-button" :disabled="busy" @click="cancelReassign">取消</button>
      </div>
      <div v-if="pendingHashBang" class="ft-confirm" role="alertdialog" aria-label="确认改判 hashbang 模式">
        <span>{{ hashBangConflictText(pendingHashBang.conflict) }}要改判给「{{ typeNameOf(pendingHashBang.typeId) }}」吗？</span>
        <button type="button" class="primary-button" :disabled="busy" @click="confirmHashBangReassign">改判 hashbang</button>
        <button type="button" class="subtle-button" :disabled="busy" @click="cancelHashBangReassign">取消</button>
      </div>

      <div class="ft-actions">
        <button type="button" class="subtle-button" :disabled="busy" @click="reparse">重新解析文件类型</button>
        <span v-if="reparseNote" class="ft-note" role="status">{{ reparseNote }}</span>
      </div>

      <h4 class="ft-title">按文件覆盖类型（Override File Type）</h4>
      <div v-for="entry in overrideRows" :key="entry.path" class="ft-override">
        <span class="ft-override-path" :title="entry.path">{{ entry.path }}</span>
        <select :value="entry.value" :aria-label="`覆盖 ${entry.path} 成的类型`" :disabled="busy" @change="applyOverride(entry.path, ($event.target as HTMLSelectElement).value)">
          <option v-for="target in overrideTargets" :key="target.id" :value="target.id">{{ target.label }}</option>
        </select>
        <span class="ft-hint">{{ entry.resolved ? (entry.effective ? '已生效' : '该类型本仓没有词法层，按纯文本') : '目标类型已注销，这条覆盖不生效' }}</span>
        <button type="button" class="icon-button" :disabled="busy" title="撤销这条覆盖" :aria-label="`撤销 ${entry.path} 的类型覆盖`" @click="revertOverride(entry.path)"><Trash2 :size="iconSize.menu" /></button>
      </div>
      <p v-if="!overrideRows.length" class="ft-empty">还没有被覆盖的文件。</p>
      <p v-if="overrideError" class="ft-error" role="alert">{{ overrideError }}</p>

      <template v-if="conflicts.length">
        <h4 class="ft-title">关联冲突判定</h4>
        <ul class="ft-list">
          <li v-for="(conflict, index) in conflicts" :key="index">
            {{ conflict.message || `模式 ${presentableMatcher(conflict.matcher)} 的归属没变` }}
            <span class="ft-hint">（{{ conflict.approved ? '已获准' : '未获准，保持原归属' }}）</span>
          </li>
        </ul>
      </template>

      <template v-if="pending.length">
        <h4 class="ft-title">待确认的摘除记录</h4>
        <ul class="ft-list">
          <li v-for="mapping in pending" :key="mapping.text">{{ mapping.text }}</li>
        </ul>
        <div class="ft-actions">
          <button type="button" class="subtle-button" :disabled="busy" @click="approvePending">整批批准</button>
          <span class="ft-note">对应上游启动活动 <code>ApproveRemovedMappingsActivity</code>（项目进入可分析状态后整批批准）。</span>
        </div>
      </template>

      <h4 class="ft-title">忽略的文件与目录</h4>
      <p class="field-hint">{{ IGNORED_TEXT }}</p>
      <div class="ft-actions">
        <button type="button" class="subtle-button" :disabled="busy" @click="ignoreStartAdd"><Plus aria-hidden="true" :size="iconSize.menu" /> 添加模式</button>
        <button type="button" class="subtle-button" :disabled="busy || ignoreIndex < 0" @click="ignoreStartEdit(ignoreIndex)"><Pencil aria-hidden="true" :size="iconSize.menu" /> 编辑选中</button>
        <button type="button" class="subtle-button" :disabled="busy || ignoreIndex < 0" @click="ignoreRemove"><Trash2 aria-hidden="true" :size="iconSize.menu" /> 删除选中</button>
        <button type="button" class="primary-button" :disabled="busy || !ignoreDirty" @click="ignoreApply">应用</button>
        <button type="button" class="subtle-button" :disabled="busy" @click="ignoreReset">还原</button>
        <button type="button" class="subtle-button" :disabled="busy" @click="ignoreRestoreDefaults">恢复默认</button>
      </div>
      <div v-if="ignoreEditingOpen" class="ft-add-pattern">
        <input
          v-model="ignoreValue"
          autofocus
          spellcheck="false"
          aria-label="忽略模式"
          placeholder="node_modules 或 *.log"
          @keyup.enter="ignoreCommit"
          @keyup.esc="ignoreStopEdit"
        />
        <button type="button" class="subtle-button" :disabled="busy" @click="ignoreCommit">确定</button>
        <button type="button" class="subtle-button" :disabled="busy" @click="ignoreStopEdit">放弃</button>
      </div>
      <p v-if="ignoreProblem" class="ft-error" role="alert">{{ ignoreProblem }}</p>
      <ul class="ft-ignore-list" aria-label="忽略的模式清单">
        <li
          v-for="(pattern, index) in ignoreList"
          :key="pattern"
          :class="{ 'ft-ignore-picked': index === ignoreIndex }"
          role="button"
          tabindex="0"
          :aria-label="`选中忽略模式 ${pattern}`"
          @click="ignoreIndex = index"
          @keyup.enter="ignoreIndex = index"
        >{{ pattern }}</li>
        <li v-if="!ignoreList.length" class="ft-empty">清单是空的：什么都不会忽略。</li>
      </ul>
      <p class="ft-note">{{ ignoreNote || (ignoreDirty ? '有未应用的改动' : '已与注册表同步') }}</p>

      <div class="ft-probe">
        <label class="ft-add-pattern">
          <input v-model="probePath" spellcheck="false" aria-label="用来试判的文件名" placeholder="某个文件名" />
        </label>
        <span class="ft-hint">{{ probeSummary }} · 编辑器语言：{{ probeLanguage }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ft-panel { display: flex; flex-direction: column; gap: var(--space-3); }
.ft-title { margin: 0; color: var(--text); font-size: 12px; font-weight: 600; }
.ft-table { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--editor); overflow: hidden; }
.ft-head, .ft-row, .ft-type { display: grid; grid-template-columns: 1.2fr 1fr 48px; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); }
.ft-type { grid-template-columns: 1.2fr 2fr 1.6fr; border-bottom: 1px solid var(--line); }
.ft-head-type { grid-template-columns: 1.2fr 2fr 1.6fr; }
.ft-type:last-child { border-bottom: 0; }
.ft-head { color: var(--muted); font-size: 11px; border-bottom: 1px solid var(--line); background: var(--panel); }
.ft-row { border-bottom: 1px solid var(--line); }
.ft-row:last-child { border-bottom: 0; }
.ft-ext { display: flex; align-items: center; gap: 2px; min-width: 0; }
.ft-dot { color: var(--muted); font: 12px var(--font-mono); }
.ft-ext input, .ft-add-pattern input { min-width: 0; min-height: var(--ctrl-height-sm); padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 12px/1.5 var(--font-mono); }
.ft-ext input[aria-invalid='true'] { border-color: var(--error); }
.ft-center { display: flex; justify-content: center; }
.ft-empty { margin: 0; padding: var(--space-2); color: var(--muted); font-size: 11px; }
.ft-actions { display: flex; align-items: center; gap: var(--space-2); }
.ft-note { color: var(--muted); font-size: 11px; }
.ft-error { margin: 0; color: var(--error); font-size: 11px; }
.ft-warn { margin: 0; color: var(--muted); font-size: 11px; }
.ft-type-name { font-size: 12px; }
.ft-lang { color: var(--muted); font-size: 11px; }
.ft-patterns { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); }
.ft-pattern { display: inline-flex; align-items: center; gap: 2px; padding: 1px var(--space-1); border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--elevated); font: 11px var(--font-mono); }
.ft-unlink { display: inline-flex; align-items: center; padding: 0; border: 0; background: none; color: var(--muted); cursor: pointer; }
.ft-unlink svg { flex-shrink: 0; }
.ft-unlink:hover:not([disabled]) { color: var(--error); }
.ft-empty-inline { color: var(--muted); font-size: 11px; }
.ft-add-pattern { display: inline-flex; align-items: center; gap: var(--space-1); }
.ft-hint { color: var(--muted); font-size: 11px; }
.ft-override { display: grid; grid-template-columns: 1.4fr 1fr 1.4fr auto; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--editor); }
.ft-override-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 11px var(--font-mono); }
.ft-override select { min-height: var(--ctrl-height-sm); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font-size: 12px; }
.ft-list { margin: 0; padding-left: var(--space-4); color: var(--muted); font-size: 11px; line-height: 1.7; }
.ft-list code, .ft-hint code, .field-hint code { font: 11px var(--font-mono); }
.ft-probe { display: flex; align-items: center; gap: var(--space-2); }
</style>
