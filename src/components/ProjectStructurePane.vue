<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { Minus, Plus, X } from 'lucide-vue-next'
import { request, type JavaProjectSettings, type ProjectSettings } from '../bridge'
import { iconSize } from '../uiIcons'
import { detectSourceRoots, normalizeRootPath, SOURCE_ROOT_LABELS, validateSourceRoots, type SourceRootKind } from '../projectRoots'
// 根/SDK 的呈现模型（上游 `FileAppearanceServiceImpl`/`SdkAppearanceServiceImpl`/`SidePanelCountLabel`
// 的等价物，见 src/rootAppearance.ts）：SDK 行的说明与内容根行的计数/告警走同一份纯规则。
import { rootRowAppearance, sdkAppearance } from '../rootAppearance'
// 项目名/实例目录模型（上游 `ProjectNameProvider`/`P3PathsEx`/`PerProjectInstancePaths`，
// 见 src/projectDirectories.ts）：面板标题的默认项目名不再各处 `split('/').pop()`。
import { defaultProjectName } from '../projectDirectories'
// 模块根模型（上游 `ModuleRootModel`/`ContentEntry`/`SourceFolder`/`OrderEntry` 的等价物，
// 见 src/rootsModel.ts）：面板那棵树按「内容根 → 源根（按类型分组）→ 排除根 → 序根条目」呈现，
// 而不是过去的一行「内容根 .」加一张扁平列表 —— 一个根下面有多个源根/测试根这件事要说得出来。
import { buildRootModel, orderEntryKindLabel, rootModelRows, type RootModelRow } from '../rootsModel'
// 库实体（`src/libraryModel.ts`）与 SDK 实体（`src/rootsSdkTable.ts`）：序根条目那一段的输入。
import { libraryFromJars } from '../libraryModel'
import { createSdk, JAVA_SDK_TYPE } from '../rootsSdkTable'
import { matchedJars } from '../externalLibraries'
// 外部库的**档案条目**（上游 `JarFileSystem` 那一族「归档当一个目录」）：取数与通道判定在
// `src/jarEntriesSource.ts`，行模型在 `src/rootsJarEntries.ts`，画在 `JarEntriesPane.vue`。
import { archiveAbsolutePath, jarChannelStatus, loadJarListing, type JarChannelStatus } from '../jarEntriesSource.ts'
import JarEntriesPane from './JarEntriesPane.vue'
// 「附加目录时识别根」（lp/roots ② 的 `LibraryRootsDetectorImpl`/`DetectedRootsChooserDialog` 等价物）：
// 纯规则在 src/libraryRootDetection.ts，取文本与配额的外壳在 src/rootsAttachScan.ts。
import { attachRootsPrompt, chooseRootTypesText, detectedRootsChooserText, detectedRootsTree, SCANNING_ROOTS_PROGRESS } from '../libraryRootDetection'
import { attachablePaths, MAX_SCANNED_SOURCE_FILES, scanAttachRoots } from '../rootsAttachScan'
// 对话框文案里的产品名（上游那几句用的就是应用名，本仓唯一的来源是「关于」面板那一处常量）。
import { ABOUT_APP_NAME } from '../aboutInfo'

// Mirrors intellij-community's Project Structure dialog:
// java/idea-ui/src/com/intellij/openapi/roots/ui/configuration/
//   ProjectStructureConfigurable.kt  — SidePanel categories under two separators.
//   ProjectConfigurableUi.kt         — General rows: SDK (+Edit), Language level, Compiler output.
//   JavaContentEntriesEditor.java    — source roots with a type popup (Sources / Tests).
// TaoCode has one implicit module, so the Modules subtree collapses into this panel;
// Artifacts/Facets/SDKs-list have no backend here and are deliberately absent.
// `category` 对应 IDEA `ProjectStructureConfigurable` 的 SidePanel 分类（Project / Modules /
// Libraries / Facets / Artifacts / SDKs / Global Libraries / Problems）。TaoCode 只有前三类有真实内容，
// 所以只声明三类；缺省（不传）时全部显示，方便单独渲染整页。
const props = defineProps<{
  settings: ProjectSettings | null
  root: string | null
  busy: boolean
  category?: 'project' | 'modules' | 'libraries'
}>()
const shows = (section: 'project' | 'modules' | 'libraries') => !props.category || props.category === section
const emit = defineEmits<{
  saveJava: [settings: JavaProjectSettings]
  saveProject: [patch: { excludedDirs: string[] }]
  browse: [field: 'jdkHome' | 'outputPath']
}>()
const id = useId()

const java = ref<JavaProjectSettings>({ jdkHome: '', jdkName: 'JavaSE-17', sourcePaths: [], outputPath: '', referencedLibraries: ['lib/**/*.jar'] })
const excludedText = ref('')
// 本次会话里通过弹层显式选过的根类型（`sources`/`tests`）。存储里没有类型字段，重开项目后
// 由目录约定判定 —— 这个覆盖表只影响当前这棵树的标签，不假装是持久化的根类型。
const rootOverrides = ref<Record<string, SourceRootKind>>({})
// The project the form was filled from. A save is only ever issued for that root:
// if the workspace moved on while the dialog was open, the edit belongs to nothing
// that exists any more and is dropped instead of being written to the new project.
const formRoot = ref<string | null>(null)
const snapshot = ref('')
const stale = ref('')
const discarded = ref('')
const emptyJava = (): JavaProjectSettings => ({ jdkHome: '', jdkName: 'JavaSE-17', sourcePaths: [], outputPath: '', referencedLibraries: ['lib/**/*.jar'] })

// IDEA's content entries distinguish source from test roots; TaoCode keeps one flat
// list, so the choice is remembered per root for the row label. Stored roots fall back
// to the directory convention (src/main/java / src/test/java / …，见 src/projectRoots.ts)。
// 这个覆盖表作为 `kindOverrides` 喂给根模型（src/rootsModel.ts），树上的标签与移除操作都走那一份。

// 根核对所需的磁盘清单（`workspace.files`）：文件数 / 是否真的存在 / 是否踩在排除目录里。
// 浏览器预览同样有这条方法（内存示例），所以两个宿主都能核对。
const workspaceFiles = ref<string[]>([])
const filesTruncated = ref(false)
watch(() => [props.root, props.settings] as const, ([root, settings]) => {
  workspaceFiles.value = []
  filesTruncated.value = false
  if (!root || !settings) return
  void request<{ files: string[]; truncated: boolean }>('workspace.files')
    .then(result => { workspaceFiles.value = result.files ?? []; filesTruncated.value = Boolean(result.truncated) })
    .catch(() => { /* 清单拿不到就只少一层核对，不挡住表单 */ })
}, { immediate: true })
// 逐根核对（文件数 / 磁盘缺失 / 排除命中）在 `src/rootsModel.ts` 里做一次，面板只读它那棵树。
// SDK 行的呈现（`SdkAppearanceServiceImpl`）：未配路径 = SDK 默认；配了给路径 + 语言级别。
const sdkRow = computed(() => sdkAppearance(java.value.jdkHome, java.value.jdkName))
const sdkHint = computed(() => java.value.jdkHome.trim()
  ? `${sdkRow.value.comment}；此处只记录本机路径，不会下载或安装 JDK。`
  : '留空时使用语言服务器自动检测的 JDK；此处只记录本机路径，不会下载或安装 JDK。')
// 项目显示名的默认来源（`ProjectNameProvider`）：目录名；取不到退回路径。
const projectName = computed(() => props.root ? (defaultProjectName(props.root) || props.root) : '')
// 按 Maven/Gradle 约定发现、且现有根还没覆盖到的目录（点一下加进来）。
const suggestedRoots = computed(() => detectSourceRoots(workspaceFiles.value, java.value.sourcePaths))
function addSuggestedRoot(path: string) {
  if (!java.value.sourcePaths.includes(path)) java.value.sourcePaths.push(path)
}

// ── 模块根模型（这棵树的真实数据源） ────────────────────────────────────────────────
// SDK / 库都取**设置里的值**（不读盘、不发请求），与上面 SDK 行、下面「依赖库」列表同源，
// 所以树上的序根条目和表单永远说同一件事。
const sdkEntity = computed(() => {
  const home = java.value.jdkHome.trim()
  if (!home) return null
  return createSdk(java.value.jdkName, JAVA_SDK_TYPE, home, jdkNameToLevel(java.value.jdkName))
})
const libraryEntities = computed(() => {
  const library = libraryFromJars(matchedJars(workspaceFiles.value, java.value.referencedLibraries))
  return library ? [library] : []
})
// ── 外部库的档案条目（点一个 jar 看它里面有什么） ─────────────────────────────────────
// 清单要问宿主：`file.archiveEntries`（实机 `bsdtar -tf`）。这条通道**可能不存在**（老宿主没登记），
// 所以先探一次：`live` 才画那排「档案条目」按钮，`absent` 就整段不渲染 —— 不放假按钮、
// 不把"读不到"画成"这个 jar 是空的"。上游 `ArchiveFileSystem.java:99-100`/`:114-115` 对归档的
// 写操作一律抛「不支持修改」，所以这一面只有读，行本身也不给点击。
const libraryJars = computed(() => matchedJars(workspaceFiles.value, java.value.referencedLibraries))
const jarChannel = ref<JarChannelStatus>(jarChannelStatus())
const openJar = ref<string | null>(null)
const jarAbsolutePath = (relative: string) => archiveAbsolutePath(props.root ?? '', relative)
const openJarPath = computed(() => (openJar.value === null ? '' : jarAbsolutePath(openJar.value)))
function toggleJarEntries(jar: string) {
  openJar.value = openJar.value === jar ? null : jar
}
watch(() => [libraryJars.value[0] ?? '', props.root] as const, async ([firstJar, root]) => {
  openJar.value = null
  jarChannel.value = jarChannelStatus()
  if (!shows('libraries') || !firstJar || !root || jarChannel.value !== 'unknown') return
  await loadJarListing(jarAbsolutePath(firstJar))
  jarChannel.value = jarChannelStatus()
})
const rootModel = computed(() => buildRootModel({
  moduleName: projectName.value || defaultProjectName(props.root ?? '') || 'unnamed',
  sourcePaths: java.value.sourcePaths,
  excludedDirs: listLines(excludedText.value.split(/\r?\n/)),
  outputPath: java.value.outputPath,
  libraries: libraryEntities.value,
  sdk: sdkEntity.value,
  files: workspaceFiles.value,
  // 本次会话里用户显式选过的根类型（存储没有类型字段，重开项目后回到目录约定 —— 面板不假装持久化）。
  kindOverrides: rootOverrides.value,
}))
// `known` = 磁盘清单到手。没到手时 `rootModelRows` 不给任何数字（不编计数），
// 面板因此不会出现「先显示 0 个文件、清单回来后改成 128」的那种假状态。
const rootRows = computed(() => rootModelRows(rootModel.value, workspaceFiles.value.length > 0))
const rowRemovable = (row: RootModelRow) => row.depth === 2 && row.key.startsWith('source:')
/** 行的 `:title`：源根行走 `rootRowAppearance`（`SidePanelCountLabel` + 告警态），其余行用注释。 */
function rowTitle(row: RootModelRow): string {
  if (row.kind && row.depth === 2) {
    return rootRowAppearance({
      path: row.text, kind: row.kind, fileCount: row.count ?? 0,
      missing: Boolean(row.missing), excludedBy: row.excludedBy ?? null,
    }).tooltip
  }
  return row.comment ?? row.text
}
/** 从树上摘掉一条源根（`ContentEntry.removeSourceFolder` 的等价动作，落到 `sourcePaths`）。 */
function dropRootPath(path: string) {
  const index = java.value.sourcePaths.indexOf(path)
  if (index >= 0) dropSourceRoot(index)
}
function closeSourcePopup() {
  sourcePopup.value = false
  scanState.value = 'idle'
  scanTree.value = null
  scanLines.value = []
  scanTitle.value = ''
}

// ── 「附加目录时识别根」（上游 `RootDetectionUtil` + `DetectedRootsChooserDialog` 的等价物） ──
const scanning = ref(false)
const scanState = ref<'idle' | 'choose' | 'ask'>('idle')
const scanTitle = ref('')
const scanLines = ref<string[]>([])
const scanTree = ref<ReturnType<typeof detectedRootsTree> | null>(null)
const productName = ABOUT_APP_NAME

/** 把检出结果里可以直接落的根加进源根表（`auto` 支：类型唯一且就是候选或其直接子目录）。 */
function addDetectedRoots(paths: readonly string[]): void {
  for (const path of paths) if (path && !java.value.sourcePaths.includes(path)) java.value.sourcePaths.push(path)
}

/**
 * 扫描输入框里那个目录：`scanAttachRoots` 读候选下的 `.java`（有上限）并按包名反推根。
 * 三条出口与上游一致 —— 直接收下 / 进对话框挑 / 什么都没检出时问一句。
 */
async function scanDraftRoots(): Promise<void> {
  const dir = normalizeRootPath(sourceDraft.value)
  if (!dir || scanning.value) return
  scanning.value = true
  scanState.value = 'idle'
  scanTree.value = null
  scanLines.value = [SCANNING_ROOTS_PROGRESS]
  scanTitle.value = ''
  try {
    const result = await scanAttachRoots({
      candidates: [dir],
      files: workspaceFiles.value,
      // 读文本走宿主（浏览器预览同样有这条方法），读不到就返回 null —— 检测器据此「不当根」，
      // 也不当成「没有包名」（`JavaVfsSourceRootDetectionUtil.java:74-101` 的保守口径）。
      read: async path => (await request<{ content?: string }>('file.read', { path })).content ?? null,
    })
    const truncated = result.truncated ? `（只读了前 ${MAX_SCANNED_SOURCE_FILES} 个 .java，结果可能不完整）` : ''
    if (result.outcome.kind === 'auto') {
      const paths = attachablePaths(result, { candidates: [dir], confirmed: true })
      addDetectedRoots(paths)
      scanLines.value = [`已识别并加入 ${paths.length} 个源码根${truncated}`, ...paths]
      sourceDraft.value = ''
      return
    }
    if (result.outcome.kind === 'choose') {
      scanState.value = 'choose'
      const text = detectedRootsChooserText(productName, result.outcome.suggestions.length)
      scanTitle.value = `${text.title} · ${text.section}`
      scanTree.value = detectedRootsTree(result.outcome.suggestions)
      scanLines.value = text.description.split('<br>').map(line => line.trim())
      return
    }
    scanState.value = 'ask'
    const prompt = result.outcome.kind === 'askSingleType'
      ? attachRootsPrompt(productName, result.outcome.typeName)
      : chooseRootTypesText(productName)
    const body = 'message' in prompt ? prompt.message : prompt.description
    scanTitle.value = prompt.title
    scanLines.value = [
      ...body.split('<br>').map(line => line.trim()),
      // 上游这一步可以给每条候选选「类别」（classes / sources / javadoc…）；本仓的项目设置里只有
      // 源码根这一张表能落（`JavaProjectSettings.sourcePaths`），所以只提供一个动作并说出来。
      '本仓只能把它附加为源码根；库根类别（classes / javadoc）需要库表的存储面，未接。',
    ]
  } finally {
    scanning.value = false
  }
}

/** `askSingleType` / `askTypes` 那一步的确认：用户选的类型套到全部候选（`RootDetectionUtil.java:121-126`）。 */
function acceptAskedRoots() {
  addDetectedRoots([normalizeRootPath(sourceDraft.value)])
  sourceDraft.value = ''
  scanState.value = 'idle'
  scanLines.value = []
  scanTitle.value = ''
}

/**
 * 对话框那一格里用户点「附加」的叶子：把这一条检出根落进源根表，并从树上摘掉
 * （`DetectedRootsChooserDialog.java:95-98`：勾中的才附加，全勾完就直接收）。
 */
function attachDetectedLeaf(path?: string) {
  if (!path) return
  addDetectedRoots([path])
  const tree = scanTree.value
  if (!tree) return
  const children = tree.children
    .map(node => ({ ...node, children: node.children.filter(leaf => leaf.path !== path) }))
    .filter(node => node.children.length)
  scanTree.value = children.length ? { ...tree, children } : null
  if (!scanTree.value) { scanState.value = 'idle'; scanLines.value = []; scanTitle.value = '' }
}

function fillFrom(source: ProjectSettings | null, root: string | null) {
  java.value = structuredClone(source?.java ?? emptyJava())
  excludedText.value = source?.excludedDirs.join('\n') ?? ''
  rootOverrides.value = {}
  formRoot.value = root
  snapshot.value = currentShape()
  stale.value = ''
}
// IDEA's Reset button restores the values that are actually persisted.
function resetForm() {
  fillFrom(props.settings, props.root)
  discarded.value = ''
}
function currentShape() {
  return JSON.stringify([java.value, excludedText.value.split(/\r?\n/)])
}
const dirty = computed(() => currentShape() !== snapshot.value)
// Not `deep`: reloading on any nested write to `props.settings` would throw away
// what the user is typing whenever another panel refreshes the same object.
watch(() => [props.root, props.settings] as const, ([root, settings]) => {
  // Whatever was typed belongs to the previous root; say so instead of silently
  // carrying it into the next project.
  discarded.value = dirty.value ? '已切换到另一个项目，之前未保存的改动已丢弃。' : ''
  fillFrom(settings, root)
}, { immediate: true })

// IDEA's LanguageLevelCombo: "SDK default" plus every level the platform knows.
const languageLevels = ['_DEFAULT_', '8', '9', '11', '13', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25']
const jdkNameToLevel = (name: string) => name.replace('JavaSE-', '') === '1.8' ? '8' : name.replace('JavaSE-', '')
const levelToJdkName = (level: string) => level === '8' ? 'JavaSE-1.8' : `JavaSE-${level}`
const languageLevel = computed({
  get: () => jdkNameToLevel(java.value.jdkName),
  set: level => { java.value.jdkName = levelToJdkName(level) },
})

const invalidJdkHome = computed(() => !!java.value.jdkHome && !/^([A-Za-z]:[\\/]|\\\\)/.test(java.value.jdkHome))
const listLines = (value: string[]) => [...new Set(value.map(line => line.trim()).filter(Boolean))]
const invalidRelative = (paths: string[], glob = false) => paths.length > 64 || paths.some(path => path.startsWith('/') || /[\\:<>"\u0000-\u001f]/.test(path) || (!glob && /[*?]/.test(path)) || path.split('/').some(part => !part || part === '..'))
const invalidExclusion = computed(() => listLines(excludedText.value.split(/\r?\n/)).some(name => name === '.' || name === '..' || /[\\/:*?"<>|\u0000-\u001f]/.test(name)))
const invalidJava = computed(() => invalidJdkHome.value
  || invalidRelative(java.value.sourcePaths) || (!!java.value.outputPath && invalidRelative([java.value.outputPath]))
  || invalidRelative(java.value.referencedLibraries, true))
const invalidAll = computed(() => invalidJava.value || invalidExclusion.value)

function addSourceRoot() { sourceDraft.value = ''; sourcePopup.value = true; void nextTick(() => sourceInput.value?.focus()) }
function applySourceRoot(kind: 'sources' | 'tests') {
  const path = sourceDraft.value.trim().replace(/\/$/, '')
  if (!path) return
  // IDEA marks test roots distinctly; TaoCode's storage has no root-type field, so the
  // choice is kept as a row-label override for this form session (see rootOverrides).
  if (!java.value.sourcePaths.includes(path)) java.value.sourcePaths.push(path)
  rootOverrides.value = { ...rootOverrides.value, [path.replace(/\\/g, '/')]: kind }
  sourcePopup.value = false
}
function dropSourceRoot(index: number) {
  const [removed] = java.value.sourcePaths.splice(index, 1)
  if (removed !== undefined) {
    const next = { ...rootOverrides.value }
    delete next[removed.trim().replace(/\\/g, '/')]
    rootOverrides.value = next
  }
}
function addLibrary() { libraryDraft.value = ''; libraryPopup.value = true; void nextTick(() => libraryInput.value?.select()) }
function applyLibrary() {
  const pattern = libraryDraft.value.trim()
  if (pattern && !java.value.referencedLibraries.includes(pattern)) java.value.referencedLibraries.push(pattern)
  libraryPopup.value = false
}
function dropLibrary(index: number) { java.value.referencedLibraries.splice(index, 1) }

const sourcePopup = ref(false)
const sourceDraft = ref('')
const sourceInput = ref<HTMLInputElement>()
const libraryPopup = ref(false)
const libraryDraft = ref('')
const libraryInput = ref<HTMLInputElement>()

// 宿主（对话框/设置页）通过 ref 调这两个方法 —— 内容与按钮分离后，保存时机由宿主决定。
defineExpose({ save, resetForm, isDirty: () => dirty.value })

function save() {
  stale.value = ''
  if (props.busy || !props.settings) return
  // Dropping a save whose root is no longer the one the form was filled from is what
  // keeps a stale edit from landing in the freshly opened project.
  if (formRoot.value !== props.root) {
    stale.value = '项目已切换，改动没有保存。请确认后重新保存。'
    return
  }
  if (invalidAll.value) return
  emit('saveJava', { ...java.value, sourcePaths: listLines(java.value.sourcePaths), referencedLibraries: listLines(java.value.referencedLibraries) })
  emit('saveProject', { excludedDirs: listLines(excludedText.value.split(/\r?\n/)) })
}
</script>

<template>
  <div class="ps-panel">
    <p v-if="!settings" class="section-description">尚未打开项目。项目结构（SDK、内容根、输出目录与排除目录）随项目保存，请先打开一个项目。</p>
    <form v-else :id="`${id}-form`" class="ps-form" :aria-busy="busy" @submit.prevent="save">
      <!-- Category header, like SidePanel's selected place in ProjectStructureConfigurable -->
      <h3 class="ps-title">项目：{{ projectName || root }}</h3>
      <p v-if="stale" class="ps-error ps-banner" role="alert">{{ stale }}</p>
      <p v-else-if="discarded" class="ps-notice" role="status">{{ discarded }}</p>

      <fieldset v-if="shows('project')" class="ps-group" :disabled="busy">
        <legend class="ps-group-label">项目设置</legend>

        <div class="ps-row">
          <label class="ps-label" :for="`${id}-sdk`">SDK：</label>
          <div class="ps-cell">
            <div class="ps-inline">
              <input :id="`${id}-sdk`" v-model.trim="java.jdkHome" class="ps-grow" :class="{ 'ps-invalid': invalidJdkHome }" placeholder="D:\Program Files\Java\jdk-21" spellcheck="false" :aria-describedby="`${id}-sdk-hint`" />
              <button type="button" class="subtle-button" @click="emit('browse', 'jdkHome')">编辑…</button>
            </div>
            <p :id="`${id}-sdk-hint`" class="ps-comment">{{ sdkHint }}</p>
            <p v-if="invalidJdkHome" class="ps-error" role="alert">请输入绝对路径（如 D:\jdk-21）或留空。</p>
          </div>
        </div>

        <div class="ps-row">
          <label class="ps-label" :for="`${id}-level`">JDK / 语言级别：</label>
          <div class="ps-cell">
            <select :id="`${id}-level`" v-model="languageLevel" class="ps-level">
              <option value="_DEFAULT_">SDK 默认</option>
              <option v-for="level in languageLevels" :key="level" :value="level">{{ level }}</option>
            </select>
          </div>
        </div>

        <div class="ps-row">
          <label class="ps-label" :for="`${id}-output`">编译器输出：</label>
          <div class="ps-cell">
            <div class="ps-inline">
              <input :id="`${id}-output`" v-model.trim="java.outputPath" class="ps-grow" placeholder="out" spellcheck="false" :aria-describedby="`${id}-output-hint`" />
              <button type="button" class="subtle-button" @click="emit('browse', 'outputPath')">浏览…</button>
            </div>
            <p :id="`${id}-output-hint`" class="ps-comment">用于模块子目录；对应各源码类型的 Production 与 Test 目录。</p>
          </div>
        </div>
      </fieldset>

      <fieldset v-if="shows('modules')" class="ps-group" :disabled="busy">
        <legend class="ps-group-label">模块「{{ rootModel.moduleName }}」· 根模型</legend>
        <!-- 这棵树是 `src/rootsModel.ts` 的 `rootModelRows`：内容根 → 源根（按类型分组）→ 排除根 →
             序根条目。上游那一层是 `ModuleRootModel.getContentEntries()` / `getOrderEntries()`
             （ModuleRootModel.java:51/:58），过去这里只有一行「内容根 .」加一张扁平列表，
             一个根下面有多个源根/测试根这件事在界面上读不出来。 -->
        <div class="ps-tree" role="tree" aria-label="模块根模型">
          <div v-for="row in rootRows" :key="row.key" class="ps-tree-node"
               :class="{ 'ps-content': row.depth === 0, 'ps-group-row': row.depth === 1 && !row.orderEntryKind && !row.comment }"
               role="treeitem" :aria-level="row.depth + 1"
               :style="{ paddingLeft: `calc(var(--space-2) + var(--space-3) * ${row.depth})` }" :title="rowTitle(row)">
            <span v-if="row.kind" class="ps-root-icon" :class="`ps-root-${row.kind}`" aria-hidden="true" />
            <span>{{ row.text }}</span>
            <span v-if="row.kind && row.depth === 2" class="ps-root-type">{{ SOURCE_ROOT_LABELS[row.kind] }}</span>
            <span v-else-if="row.orderEntryKind" class="ps-root-type" :class="{ 'ps-order-invalid': row.valid === false }">{{ orderEntryKindLabel(row.orderEntryKind, row.valid !== false) }}</span>
            <span v-if="row.comment && row.depth !== 2" class="ps-root-type">{{ row.comment }}</span>
            <span v-if="row.count !== null" class="ps-root-count">{{ row.count }}</span>
            <span v-if="row.missing" class="ps-error" role="alert">磁盘上不存在</span>
            <span v-else-if="row.excludedBy" class="ps-warn" role="alert">目录「{{ row.excludedBy }}」已被排除</span>
            <button v-if="rowRemovable(row)" type="button" class="icon-button" title="移除源根" :aria-label="`移除 ${row.text}`" @click="dropRootPath(row.text)"><Minus :size="iconSize.menu" /></button>
          </div>
        </div>
        <div v-if="suggestedRoots.length" class="ps-tree" role="group" aria-label="按目录约定检测到的源码根">
          <p class="ps-comment">按 Maven/Gradle 目录约定检测到（点“添加”加入上面的列表）：</p>
          <div v-for="item in suggestedRoots" :key="item.path" class="ps-tree-node" role="listitem">
            <span class="ps-root-icon" :class="`ps-root-${item.kind}`" aria-hidden="true" />
            <span>{{ item.path }}</span>
            <span class="ps-root-type">{{ SOURCE_ROOT_LABELS[item.kind] }}</span>
            <button type="button" class="subtle-button" @click="addSuggestedRoot(item.path)">添加</button>
          </div>
        </div>
        <p v-if="filesTruncated" class="ps-comment">文件清单被截断，上面只核对了清单里的文件。</p>
        <div class="ps-toolbar">
          <button type="button" class="subtle-button" @click="addSourceRoot"><Plus :size="iconSize.menu" /> 添加内容根…</button>
        </div>
        <div v-if="sourcePopup" class="ps-popup" role="dialog" aria-label="新目录类型">
          <input ref="sourceInput" v-model="sourceDraft" class="ps-grow" placeholder="项目内路径，例如 src/main/java" spellcheck="false" aria-label="新目录路径" @keydown.enter.prevent="applySourceRoot('sources')" @keydown.esc.prevent="closeSourcePopup()" />
          <button type="button" class="subtle-button" @click="applySourceRoot('sources')">源代码根</button>
          <button type="button" class="subtle-button" @click="applySourceRoot('tests')">测试根</button>
          <!-- 上游的「附加目录时扫描并识别根」（RootDetectionUtil.java:53-149 + DetectedRootsChooserDialog） -->
          <button type="button" class="subtle-button" :disabled="busy || scanning || !workspaceFiles.length" title="扫描这个目录下的 .java，按包名识别真正的源码根" @click="scanDraftRoots">{{ scanning ? SCANNING_ROOTS_PROGRESS : '识别根…' }}</button>
          <button type="button" class="icon-button" title="取消" aria-label="取消" @click="closeSourcePopup()"><X :size="iconSize.control" /></button>
        </div>
        <div v-if="scanState !== 'idle' || scanLines.length" class="ps-scan" role="group" aria-label="检测到的根">
          <p v-if="scanTitle" class="ps-scan-title">{{ scanTitle }}</p>
          <p v-for="(line, index) in scanLines" :id="`${id}-scan-${index}`" :key="`scan-line-${index}`" class="ps-comment">{{ line }}</p>
          <div v-if="scanTree" class="ps-tree" role="tree" aria-label="检出根列表">
            <div v-for="node in scanTree.children" :key="`scan-c-${node.path}`" class="ps-tree-node ps-content" role="treeitem" :aria-level="1">{{ node.file }}</div>
            <template v-for="node in scanTree.children" :key="`scan-g-${node.path}`">
              <div v-for="leaf in node.children" :key="`scan-l-${leaf.path}`" class="ps-tree-node" role="treeitem" :aria-level="2" :style="{ paddingLeft: 'calc(var(--space-2) + var(--space-3) * 2)' }">
                <span>{{ leaf.file }}</span>
                <span v-if="leaf.typeName" class="ps-root-type">{{ leaf.typeName }}</span>
                <span v-if="leaf.invalid" class="ps-error" role="alert">[无效]</span>
                <button type="button" class="subtle-button" :disabled="busy" @click="attachDetectedLeaf(leaf.path)">附加</button>
              </div>
            </template>
          </div>
          <div v-if="scanState === 'ask'" class="ps-toolbar">
            <button type="button" class="subtle-button" :disabled="busy" @click="acceptAskedRoots()">附加为源码根</button>
            <button type="button" class="subtle-button" @click="closeSourcePopup()">取消</button>
          </div>
        </div>
      </fieldset>

      <fieldset v-if="shows('libraries')" class="ps-group" :disabled="busy">
        <legend class="ps-group-label">依赖库</legend>
        <div class="ps-tree" role="list" aria-label="依赖 JAR">
          <div v-for="(library, index) in java.referencedLibraries" :key="library" class="ps-tree-node" role="listitem">
            <span>{{ library }}</span>
            <button type="button" class="icon-button" title="移除库" :aria-label="`移除 ${library}`" @click="dropLibrary(index)"><Minus :size="iconSize.menu" /></button>
          </div>
          <p v-if="!java.referencedLibraries.length" class="ps-empty-line">没有依赖条目。</p>
        </div>
        <div class="ps-toolbar">
          <button type="button" class="subtle-button" @click="addLibrary"><Plus :size="iconSize.menu" /> 添加路径或通配符…</button>
        </div>
        <div v-if="libraryPopup" class="ps-popup" role="dialog" aria-label="添加依赖">
          <input ref="libraryInput" v-model="libraryDraft" class="ps-grow" placeholder="lib/**/*.jar" spellcheck="false" aria-label="依赖路径或通配符" @keydown.enter.prevent="applyLibrary" @keydown.esc.prevent="libraryPopup = false" />
          <button type="button" class="subtle-button" @click="applyLibrary">确定</button>
          <button type="button" class="icon-button" title="取消" aria-label="取消" @click="libraryPopup = false"><X :size="iconSize.control" /></button>
        </div>
        <!-- glob 命中的**真 jar**（`libraryEntities` 的根）与它的档案条目。`jarChannel !== 'live'`
             时整段不渲染：没有宿主通道就不给按了没反应的按钮。 -->
        <div v-if="jarChannel === 'live' && libraryJars.length" class="ps-tree" role="list" aria-label="命中的 JAR">
          <div v-for="jar in libraryJars" :key="jar" class="ps-tree-node" role="listitem">
            <span>{{ jar }}</span>
            <button type="button" class="subtle-button ps-jar-toggle" :disabled="busy" :aria-expanded="openJar === jar"
                    :aria-label="`列出 ${jar} 的档案条目`" @click="toggleJarEntries(jar)">档案条目</button>
          </div>
          <JarEntriesPane v-if="openJar" :key="openJar" :archive="openJarPath" />
        </div>
      </fieldset>

      <fieldset v-if="shows('modules')" class="ps-group" :disabled="busy">
        <legend class="ps-group-label">排除的目录</legend>
        <textarea v-model="excludedText" rows="4" spellcheck="false" class="ps-textarea" aria-label="排除的目录名，每行一个" :aria-invalid="invalidExclusion" placeholder="每行一个目录名，例如 build" />
        <p v-if="invalidExclusion" class="ps-error" role="alert">请输入目录名，不要使用路径、通配符、“.”或“..”。</p>
      </fieldset>

      <!-- 动作按钮由宿主提供（项目结构对话框的 确定/应用/取消，或设置对话框的 应用）——
           IDEA 的 Configurable 自己不带确定按钮。这个隐藏的 submit 只是让回车能提交表单。 -->
      <button type="submit" class="ps-submit" tabindex="-1" aria-hidden="true" />
    </form>
  </div>
</template>

<style scoped>
.ps-panel { min-width: 0; }
.ps-form { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; margin: 0; padding: 0; border: 0; }
.ps-title { margin: 0; font-size: 15px; color: var(--bright); font-weight: 600; }
.ps-group { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; margin: 0; padding: 0; border: 0; }
.ps-group-label { padding: 0 0 var(--space-1); color: var(--muted); font-size: 11px; font-weight: 500; letter-spacing: .03em; text-transform: uppercase; }
/* IDEA FormLayout: right-aligned label column, fields fill the rest at one shared width. */
.ps-row { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: var(--space-3); align-items: baseline; }
.ps-label { color: var(--text); font-weight: 500; text-align: right; }
.ps-cell { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.ps-inline { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.ps-grow { flex: 1; min-width: 0; }
.ps-inline input, .ps-textarea, .ps-popup input { min-height: var(--ctrl-height); padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: inherit; }
.ps-inline input { font-family: var(--font-mono); font-size: 12px; }
.ps-level { min-height: var(--ctrl-height); max-width: 100%; padding: var(--space-1) var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: inherit; }
.ps-comment { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.ps-error { margin: 0; color: var(--error); font-size: 11px; }
.ps-banner { padding: var(--space-1) var(--space-2); border: 1px solid var(--error); border-radius: var(--radius-xs); background: var(--panel); }
.ps-notice { margin: 0; padding: var(--space-1) var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); color: var(--muted); background: var(--panel); font-size: 11px; }
.ps-invalid { border-color: var(--error); }
.ps-tree { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--editor); overflow: hidden; }
.ps-tree-node { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--line); font: 12px/1.6 var(--font-mono); color: var(--text); }
.ps-tree-node:last-child { border-bottom: 0; }
.ps-tree-node:hover .icon-button { visibility: visible; }
.ps-tree-node .icon-button { visibility: hidden; margin-left: auto; }
.ps-content { color: var(--secondary); font-weight: 600; background: var(--panel); }
/* 分组行（「源代码根（3）」/「排除根（1）」）：比内容根轻一档，比叶子行重一档。 */
.ps-group-row { color: var(--secondary); font-weight: 500; }
.ps-order-invalid { color: var(--error); }
.ps-root-icon { width: 10px; height: 10px; flex-shrink: 0; border-radius: 2px; background: var(--success); }
/* 上游源根图标色：源根 #40B6E0、测试根 #62B543、资源/生成各一档（生成根叠灰 #9AA7B0）。 */
.ps-root-sources { background: #40B6E0; }
.ps-root-tests, .ps-root-test-resources { background: #62B543; }
.ps-root-resources { background: #D9A343; }
.ps-root-generated { background: #9AA7B0; }
.ps-warn { color: var(--warning); font: 11px var(--font-ui); }
.ps-root-type { color: var(--muted); font: 11px var(--font-ui); }
/* `SidePanelCountLabel` 的计数：等宽数字，跟在类型标签后面（右侧的移除按钮仍靠 margin-left:auto 靠边）。 */
.ps-root-count { color: var(--muted); font: 11px var(--font-mono); font-variant-numeric: tabular-nums; }
.ps-empty-line { margin: 0; padding: var(--space-2); color: var(--muted); font-size: 11px; }
.ps-toolbar { display: flex; gap: var(--space-2); }
/* 「档案条目」按钮靠右（与 .ps-tree-node 里那个 .icon-button 同一位置，但它是常驻的）。 */
.ps-jar-toggle { margin-left: auto; flex-shrink: 0; }
.ps-popup { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--elevated); box-shadow: var(--shadow-2); }
/* 识别根的结果区（上游 `DetectedRootsChooserDialog` 那一步的落点）：紧跟在弹层下面。 */
.ps-scan { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--panel); }
.ps-scan-title { margin: 0; color: var(--bright); font-size: 12px; font-weight: 600; }
.ps-textarea { display: block; width: 100%; min-width: 0; max-width: 100%; resize: vertical; padding: var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 12px/1.7 var(--font-mono); }
.ps-textarea[aria-invalid='true'], .ps-popup input:focus-visible { border-color: var(--error); }
.ps-submit { position: absolute; width: 1px; height: 1px; padding: 0; border: 0; opacity: 0; }
@media (max-width: 560px) {
  .ps-row { grid-template-columns: minmax(0, 1fr); }
  .ps-label { text-align: left; }
}
</style>
