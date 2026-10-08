<script setup lang="ts">
// 目标环境管理对话框（上游 `TargetEnvironmentsConfigurable` / `TargetEnvironmentsMasterDetails` /
// `TargetEnvironmentDetailsConfigurable` / `TargetEnvironmentLanguagesPanel`）。
//
// 上游出处（都在 platform/execution-impl/src/com/intellij/execution/target/）：
//   TargetEnvironmentsMasterDetails.kt:59-132   master-details 外壳：左边目标树 + 右侧详情 + 底部面板
//   TargetEnvironmentsMasterDetails.kt:176-180  工具条三个动作：CreateNewTargetGroup（Add 带下拉，
//                                              每种目标类型一项）/ MyDeleteAction / DuplicateAction
//   TargetEnvironmentsMasterDetails.kt:330-346  树节点渲染：显示名 + 灰色已配语言清单；
//                                              `validateConfiguration()` 抛异常时套 InvalidRunConfigurationIcon
//   TargetEnvironmentsMasterDetails.kt:76-108   底部「项目默认目标」下拉：`null` 项 = 本地机器
//   TargetEnvironmentsMasterDetails.kt:236-260  新建：wizard 或 `createDefaultConfig()`，空名取唯一名
//   TargetEnvironmentDetailsConfigurable.kt:28-49  详情面：标题即显示名，可改名
//   TargetEnvironmentLanguagesPanel.kt          详情面下半部分：语言运行时清单
//   TargetEnvironmentsConfigurable.kt:35/54-56  显示名「Run Targets」；`openForEditing()` 由
//                                              `RunOnTargetPanel.java:52-61` 的 ActionLink 调用，
//                                              返回 true = 用户点了应用，调用方刷新「运行于」下拉
// 中文文案取自上游 zh 语言包：运行目标 / 远程目标 / 添加目标于 / 复制 / 移除 /
// 未创建目标 / 添加新目标… / 项目默认目标: / 本地机器 / 未配置语言运行时 / 需要目标上的 JDK 主路径。
//
// 与上游的差异（如实登记）：
//   * 目标类型只有「本机」一档（`isLocalTarget()` = true，TargetEnvironmentType.kt:27）。上游的
//     Docker/SSH/WSL 类型要求宿主有远程通道，本仓没有（exec/wsl 判 `[-]`），所以「添加」没有下拉。
//   * 上游的 wizard（`TargetEnvironmentWizard`）与运行时探测（`createIntrospector`，在目标上执行
//     `java -version` 之类）本仓都没有：前者对本机目标没有可问的字段，后者需要「在目标上执行脚本」
//     这层宿主能力。运行时数据只能手填（上游也允许，TargetEnvironmentConfiguration.kt:16-17）。
import { computed, ref, watch } from 'vue'
import { AlertTriangle, Copy, FolderPlus, Minus, Plus, X } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import {
  LANGUAGE_RUNTIME_TYPES, emptyRuntimeEntry, languageRuntimeType, runtimeSummary,
  type LanguageRuntimeEntry,
} from '../languageRuntimes.ts'
import {
  LOCAL_TARGET_TYPE_ID, LOCAL_TARGET_TYPE_NAME, duplicateTargetEnvironment, newTargetEnvironment,
  uniqueTargetDisplayName, validateTargetEnvironment, type TargetEnvironment, type TargetEnvironmentsState,
} from '../targetEnvironments.ts'

const props = defineProps<{ state: TargetEnvironmentsState; projectRoot: string; busy?: boolean }>()
const emit = defineEmits<{
  (event: 'apply', state: TargetEnvironmentsState): void
  (event: 'close'): void
}>()

function uuid(): string {
  const value = globalThis.crypto?.randomUUID?.()
  return value ?? `target-${Math.abs(Date.now() ^ Math.floor(Math.random() * 0xffffff)).toString(36)}-${targets.value.length}`
}

const targets = ref<TargetEnvironment[]>(props.state.targets.map(target => ({ ...target, runtimes: target.runtimes.map(entry => ({ ...entry })) })))
const selectedUuid = ref<string>(props.state.defaultTargetUuid || targets.value[0]?.uuid || '')
const defaultUuid = ref<string>(props.state.defaultTargetUuid)
const hint = ref('')

watch(() => props.state, value => {
  targets.value = value.targets.map(target => ({ ...target, runtimes: target.runtimes.map(entry => ({ ...entry })) }))
  if (!value.targets.some(target => target.uuid === selectedUuid.value)) selectedUuid.value = value.targets[0]?.uuid ?? ''
  defaultUuid.value = value.defaultTargetUuid
}, { deep: true })

const selected = computed(() => targets.value.find(target => target.uuid === selectedUuid.value))
const selectedProblem = computed(() => (selected.value ? validateTargetEnvironment(selected.value) : null))

function addTarget() {
  const target = newTargetEnvironment(uuid(), uniqueTargetDisplayName(targets.value, LOCAL_TARGET_TYPE_NAME), props.projectRoot)
  targets.value = [...targets.value, target]
  selectedUuid.value = target.uuid
  hint.value = ''
}
function removeTarget() {
  const uuid = selectedUuid.value
  if (!uuid) return
  targets.value = targets.value.filter(target => target.uuid !== uuid)
  if (defaultUuid.value === uuid) defaultUuid.value = ''
  selectedUuid.value = targets.value[0]?.uuid ?? ''
  hint.value = ''
}
/** 复制（上游 `DuplicateAction`，MasterDetails:297-320：`getTargetType().duplicateConfig(it)`）。 */
function copyTarget() {
  const source = selected.value
  if (!source) return
  const copy = duplicateTargetEnvironment(source, uuid())
  copy.displayName = uniqueTargetDisplayName(targets.value, `${source.displayName} 副本`)
  targets.value = [...targets.value, copy]
  selectedUuid.value = copy.uuid
  hint.value = ''
}

const typeMenuOpen = ref(false)
const runtimeToAdd = ref(LANGUAGE_RUNTIME_TYPES[0]!.id)
const availableRuntimes = computed(() => {
  const used = new Set(selected.value?.runtimes.map(entry => entry.typeId) ?? [])
  return LANGUAGE_RUNTIME_TYPES.filter(type => !used.has(type.id))
})
function addRuntime() {
  const target = selected.value
  const typeId = runtimeToAdd.value
  if (!target || !availableRuntimes.value.some(type => type.id === typeId)) return
  target.runtimes = [...target.runtimes, emptyRuntimeEntry(typeId)]
}
function removeRuntime(index: number) {
  const target = selected.value
  if (!target) return
  target.runtimes = target.runtimes.filter((_, position) => position !== index)
}
function runtimeEntry(typeId: string): LanguageRuntimeEntry | undefined {
  return selected.value?.runtimes.find(entry => entry.typeId === typeId)
}
function setRuntimeField(typeId: string, key: 'homePath' | 'version', value: string) {
  const entry = runtimeEntry(typeId)
  if (!entry) return
  entry[key] = value
}

function apply() {
  if (props.busy) return
  const name = selected.value?.displayName.trim() ?? ''
  if (selected.value && !name) { hint.value = '目标名称不能为空。'; return }
  const problem = selected.value ? validateTargetEnvironment(selected.value) : null
  if (problem) { hint.value = `目标「${name}」${problem}（保存后仍会列在「运行于」里，运行时会回落到本机）。`; return }
  const next: TargetEnvironmentsState = { defaultTargetUuid: defaultUuid.value, targets: targets.value }
  emit('apply', next)
  emit('close')
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="help-dialog te-dialog" role="dialog" aria-modal="true" aria-label="运行目标">
      <header class="te-head">
        <h2>运行目标</h2>
        <button type="button" class="icon-button" aria-label="关闭" @click="emit('close')"><X :size="iconSize.action" aria-hidden="true" /></button>
      </header>
      <div class="te-body">
        <!-- 左：目标清单（上游 master 树）。行 = 显示名 + 灰色已配语言；校验不过的行挂告警图标
             （上游 TargetEnvironmentsMasterDetails.kt:336-346 的 InvalidRunConfigurationIcon）。 -->
        <div class="te-list">
          <p v-if="!targets.length" class="te-empty">未创建目标</p>
          <ul v-else role="listbox" aria-label="目标清单" class="te-rows">
            <li v-for="target in targets" :key="target.uuid">
              <button
                type="button"
                class="te-row"
                role="option"
                :aria-selected="selectedUuid === target.uuid"
                :class="{ 'is-selected': selectedUuid === target.uuid }"
                @click="selectedUuid = target.uuid"
              >
                <span class="te-name">{{ target.displayName || '（未命名）' }}</span>
                <span v-if="runtimeSummary(target.runtimes)" class="te-runtimes">{{ runtimeSummary(target.runtimes) }}</span>
                <AlertTriangle aria-hidden="true" v-if="validateTargetEnvironment(target)" :size="iconSize.dense" class="te-bad" :title="validateTargetEnvironment(target) ?? ''" aria-label="目标未配好运行时" />
              </button>
            </li>
          </ul>
          <!-- 工具条：新增 / 移除 / 复制（上游 MasterDetails.kt:176-180 的三个动作）。
               「添加」没有类型下拉：本仓只有本机一种目标类型。 -->
          <div class="te-toolbar" role="toolbar" aria-label="目标工具条">
            <button type="button" class="icon-button" aria-label="添加目标于 本机" :disabled="busy" @click="addTarget"><Plus :size="iconSize.control" aria-hidden="true" /></button>
            <button type="button" class="icon-button" aria-label="移除" :disabled="busy || !selected" @click="removeTarget"><Minus :size="iconSize.toolbar" aria-hidden="true" /></button>
            <button type="button" class="icon-button" aria-label="复制" :disabled="busy || !selected" @click="copyTarget"><Copy :size="iconSize.control" aria-hidden="true" /></button>
          </div>
        </div>

        <!-- 右：目标详情（上游 TargetEnvironmentDetailsConfigurable + TargetEnvironmentLanguagesPanel）。 -->
        <div class="te-detail">
          <p v-if="!selected" class="field-hint">选择目标以配置</p>
          <template v-else>
            <label class="field-row"><span>名称</span><input v-model="selected.displayName" aria-label="目标名称" :placeholder="LOCAL_TARGET_TYPE_NAME" /></label>
            <label class="field-row"><span>类型</span><input :value="LOCAL_TARGET_TYPE_NAME" readonly aria-label="目标类型" /></label>
            <label class="field-row"><span>目标上根</span><input v-model="selected.projectRootOnTarget" aria-label="目标上的项目根" :placeholder="projectRoot" /></label>

            <fieldset class="te-runtimes-block">
              <legend>语言运行时</legend>
              <p v-if="!selected.runtimes.length" class="field-hint">未配置语言运行时。</p>
              <div v-for="(entry, index) in selected.runtimes" :key="entry.typeId" class="te-runtime">
                <div class="te-runtime-head">
                  <span class="te-runtime-name">{{ languageRuntimeType(entry.typeId)?.displayName ?? entry.typeId }}</span>
                  <button type="button" class="icon-button" :aria-label="`移除运行时 ${languageRuntimeType(entry.typeId)?.displayName ?? entry.typeId}`" :disabled="busy" @click="removeRuntime(index)"><Minus :size="iconSize.dense" aria-hidden="true" /></button>
                </div>
                <label class="field-row"><span>{{ languageRuntimeType(entry.typeId)?.homeLabel ?? '主路径:' }}</span>
                  <input :value="entry.homePath" :aria-label="`${languageRuntimeType(entry.typeId)?.displayName ?? entry.typeId} 主路径`" :placeholder="entry.typeId === 'JavaLanguageRuntime' ? 'D:\\Java\\jbr' : 'C:\\Program Files\\…'" @input="setRuntimeField(entry.typeId, 'homePath', ($event.target as HTMLInputElement).value)" />
                </label>
                <p v-if="languageRuntimeType(entry.typeId)?.homeHint" class="field-hint">{{ languageRuntimeType(entry.typeId)?.homeHint }}</p>
                <label v-if="languageRuntimeType(entry.typeId)?.versionLabel" class="field-row"><span>{{ languageRuntimeType(entry.typeId)?.versionLabel ?? '版本:' }}</span>
                  <input :value="entry.version ?? ''" :aria-label="`${languageRuntimeType(entry.typeId)?.displayName ?? entry.typeId} 版本`" placeholder="17.0.9" @input="setRuntimeField(entry.typeId, 'version', ($event.target as HTMLInputElement).value)" />
                </label>
              </div>
              <div class="te-add-runtime">
                <select v-model="runtimeToAdd" aria-label="要添加的语言运行时">
                  <option v-for="type in availableRuntimes" :key="type.id" :value="type.id">{{ type.displayName }}</option>
                </select>
                <button type="button" class="subtle-button" :disabled="busy || !availableRuntimes.length" @click="addRuntime"><FolderPlus :size="iconSize.control" aria-hidden="true" />添加语言运行时</button>
              </div>
              <p v-if="!availableRuntimes.length" class="field-hint">这些运行时都加过了。</p>
            </fieldset>

            <p v-if="selectedProblem" class="te-problem" role="status">
              <AlertTriangle :size="iconSize.dense" aria-hidden="true" />{{ selectedProblem }}
            </p>
          </template>
        </div>
      </div>

      <!-- 底部：项目默认目标（上游 TargetEnvironmentsMasterDetails.kt:76-108）。空项 = 本地机器。 -->
      <div class="te-default">
        <label class="field-row"><span>项目默认目标:</span>
          <select :value="defaultUuid" aria-label="项目默认目标" @change="defaultUuid = ($event.target as HTMLSelectElement).value">
            <option value="">本地机器</option>
            <option v-for="target in targets" :key="target.uuid" :value="target.uuid">{{ target.displayName || '（未命名）' }}</option>
          </select>
        </label>
      </div>

      <footer class="te-footer">
        <p v-if="hint" class="field-hint" role="status">{{ hint }}</p>
        <div class="te-footer-actions">
          <button type="button" class="primary-button" :disabled="busy" @click="apply">应用</button>
          <button type="button" class="subtle-button" @click="emit('close')">取消</button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.te-dialog { width: min(760px, 94vw); }
.te-head { display: flex; align-items: center; gap: var(--space-2); }
.te-head h2 { flex: 1; margin: 0; }
.te-body { display: grid; grid-template-columns: minmax(0, 240px) minmax(0, 1fr); min-height: 300px; }
.te-list { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--line); }
.te-rows { flex: 1; min-height: 0; margin: 0; padding: var(--space-1); overflow: auto; list-style: none; }
.te-row { display: flex; align-items: center; gap: var(--space-1); width: 100%; border: 0; padding: 3px var(--space-1); border-radius: var(--radius-xs); background: transparent; color: var(--text); font: inherit; font-size: 12px; text-align: left; }
.te-row.is-selected { background: var(--selected); color: var(--bright); }
.te-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.te-runtimes { color: var(--muted); font-size: 11px; }
.te-bad { flex-shrink: 0; color: var(--error); }
.te-empty { margin: 0; padding: var(--space-3); color: var(--muted); font-size: 11px; }
.te-toolbar { display: flex; align-items: center; gap: 2px; padding: var(--space-1); border-top: 1px solid var(--line); }
.te-detail { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; padding: var(--space-2) 0 0 var(--space-3); overflow: auto; }
.field-row { display: flex; align-items: center; gap: var(--space-2); }
.field-row > span { flex-shrink: 0; width: 88px; color: var(--muted); font-size: 11px; }
.field-row input, .field-row select { flex: 1; min-width: 0; padding: var(--space-1) var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--bright); font: inherit; font-size: 12px; }
.field-hint { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
.te-runtimes-block { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-xs); }
.te-runtimes-block legend { padding: 0 var(--space-1); color: var(--muted); font-size: 11px; }
.te-runtime { display: flex; flex-direction: column; gap: var(--space-1); }
.te-runtime-head { display: flex; align-items: center; gap: var(--space-1); }
.te-runtime-name { flex: 1; font-size: 12px; }
.te-add-runtime { display: flex; align-items: center; gap: var(--space-2); }
.te-add-runtime select { flex: 1; padding: var(--space-1) var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--bright); font: inherit; font-size: 12px; }
.te-problem { display: flex; align-items: center; gap: var(--space-1); margin: 0; color: var(--error); font-size: 11px; }
.te-default { display: flex; flex-direction: column; gap: var(--space-1); margin-top: var(--space-2); padding-top: var(--space-2); border-top: 1px solid var(--line); }
.te-footer { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); }
.te-footer .field-hint { flex: 1; }
.te-footer-actions { display: flex; gap: var(--space-2); }
@media (max-width: 720px) { .te-body { grid-template-columns: minmax(0, 1fr); } .te-list { border-right: 0; border-bottom: 1px solid var(--line); } }
</style>
