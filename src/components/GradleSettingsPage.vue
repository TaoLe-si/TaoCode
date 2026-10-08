<script setup lang="ts">
// 设置 › 构建、执行、部署 › 构建工具 › Gradle（IDEA `reference.settingsdialog.project.gradle`）。
//
// 逐条对照：
//   plugins/gradle/plugin-resources/intellij.gradle.xml:177-179
//       `<projectConfigurable groupId="build.tools" groupWeight="110" id="reference.settingsdialog.project.gradle">`
//   `GradleProjectSettings.java:44 / :118-124`  myDistributionType + gradleHome（**用哪个 Gradle**）
//   `GradleSettings.java:113-115`               getServiceDirectoryPath() → GradleLocalSettings.getGradleUserHome()
//   `GradleSettings.java:118-131`               isOfflineWork() / setOfflineWork（≥2019.2 起明确是**项目级**）
//   三者的存储都是项目级的：`GradleSettings` 是 `@State(name="GradleSettings", storages=@Storage("gradle.xml"))`，
//   用户主目录存在 `GradleLocalSettings`（StoragePathMacros.CACHE_FILE，即 workspace.xml 那一侧）。
//
// 这一页**不自己读盘**：检测结果由 src/gradleHost.ts 检测后经 props 传进来（宿主 `workspace.list`
// + wrapper 文件内容 → `detectGradle`）。
import { computed, onMounted, ref } from 'vue'
import { GRADLE_DELEGATE_DEFAULT, GRADLE_RUN_DEFAULTS, GRADLE_USE_PROJECT_JDK, type BuildToolsGradleSettings, type GradleDetection } from '../gradle.ts'
import { availableJdks, type JdkInfo } from '../buildHost.ts'

const props = defineProps<{
  /** 项目级 Gradle 设置；没有项目时传 null（控件全部禁用）。 */
  gradle: BuildToolsGradleSettings | null
  /** 当前项目的检测结果（没有就显示"—"）。 */
  detection: GradleDetection | null
  busy: boolean
}>()
/** 发出的永远是**合并后的完整**三项 —— 这样调用方可以整块写回 `buildTools.gradle`。 */
const emit = defineEmits<{ save: [gradle: BuildToolsGradleSettings] }>()

const disabled = computed(() => !props.gradle || props.busy)
/** 页头那行"检测到了什么"（IDEA 也会显示 wrapper 解析出的 Gradle 版本）。 */
const detectedLine = computed(() => {
  const detected = props.detection
  if (!detected) return ''
  if (!detected.isGradle) return '这个目录里没有找到 Gradle 构建脚本。'
  const parts: string[] = []
  if (detected.buildFiles.length) parts.push(`构建脚本 ${detected.buildFiles.join('、')}`)
  if (detected.settingsFiles.length) parts.push(`settings ${detected.settingsFiles.join('、')}`)
  parts.push(detected.hasWrapper ? '有 Gradle wrapper' : '没有 wrapper，运行时退回本机的 gradle')
  if (detected.distributionVersion) parts.push(`wrapper 版本 ${detected.distributionVersion}`)
  return parts.join('；') + '。'
})
function patch(next: Partial<BuildToolsGradleSettings>) { emit('save', { ...(props.gradle ?? GRADLE_RUN_DEFAULTS), ...next }) }
// 「Gradle JVM」的可选项 = 机器上探测到的 JDK（`app.jdks`），加上"项目 JDK"这个默认档。
// 探测结果只取一次（扫盘一次就够，见 src/buildHost.ts 的 `availableJdks`）。
const jdks = ref<JdkInfo[]>([])
onMounted(() => { void availableJdks().then(list => { jdks.value = list }) })
function jdkLabel(entry: JdkInfo) { return `${entry.name || entry.version || 'JDK'} — ${entry.home}` }
</script>

<template>
  <p v-if="detectedLine" class="field-hint" data-testid="gradle-detected">{{ detectedLine }}</p>

  <!-- 「构建并运行使用」＝ `GradleProjectSettings.getDelegatedBuild()`（默认 true，`GradleProjectSettings.java:40`）。
       源码里这一组在 Gradle 组**之前**（`IdeaGradleProjectSettingsControlBuilder.java:255-257` 的调用顺序
       是 import → delegation → gradle），文案 `GradleBundle.properties:46`（`gradle.settings.text.build.run`
       = "Build and run using:"），两档就是 Gradle 与 IDE 自己的名字（`:808-814` 的 `BuildRunItem{true,false}`）。
       选「TaoCode」= 不委托：构建走本仓的 javac（等价 IDEA 的 JPS），见 src/projectBuild.ts。 -->
  <label class="field-row"><span>构建并运行使用</span>
    <select :value="String(gradle?.delegatedBuild ?? GRADLE_DELEGATE_DEFAULT)" :disabled="disabled" @change="patch({ delegatedBuild: ($event.target as HTMLSelectElement).value === 'true' })">
      <option value="true">Gradle</option>
      <option value="false">TaoCode</option>
    </select>
  </label>

  <!-- 「Gradle JVM」＝ `GradleProjectSettings.getGradleJvm()`（默认 `#USE_PROJECT_JDK`，:60）。
       IDEA 打开 Gradle 项目时它就已经是「项目 JDK」，不需要用户先配。 -->
  <label class="field-row"><span>Gradle JVM</span>
    <select :value="gradle?.gradleJvm ?? GRADLE_USE_PROJECT_JDK" :disabled="disabled" @change="patch({ gradleJvm: ($event.target as HTMLSelectElement).value })">
      <option :value="GRADLE_USE_PROJECT_JDK">项目 JDK（默认）</option>
      <option v-for="entry in jdks" :key="entry.home" :value="entry.home">{{ jdkLabel(entry) }}</option>
      <option v-if="gradle?.gradleJvm && gradle.gradleJvm !== GRADLE_USE_PROJECT_JDK && !jdks.some(entry => entry.home === gradle!.gradleJvm)" :value="gradle.gradleJvm">{{ gradle.gradleJvm }}（已配置）</option>
    </select>
  </label>
  <p v-if="!jdks.length" class="field-hint">没有探测到本机的 JDK（<code>app.jdks</code>）；「项目 JDK」会退回用项目设置里的那个。</p>

  <!-- 「使用 Gradle 从」（DistributionType）+ 指定路径。 -->
  <label class="field-row"><span>使用 Gradle 从</span>
    <select :value="gradle?.useGradleFrom ?? 'wrapper'" :disabled="disabled" @change="patch({ useGradleFrom: ($event.target as HTMLSelectElement).value as BuildToolsGradleSettings['useGradleFrom'] })">
      <option value="wrapper">gradle-wrapper.properties 文件中的包装器</option>
      <option value="path">指定位置</option>
      <option value="local">本机安装（PATH / GRADLE_HOME 上的 gradle）</option>
    </select>
  </label>
  <label v-if="(gradle?.useGradleFrom ?? 'wrapper') === 'path'" class="field-row"><span>Gradle 位置</span>
    <input :value="gradle?.gradlePath ?? ''" :disabled="disabled" placeholder="例如 C:\\Gradle\\gradle-8.7\\bin\\gradle.bat" @change="patch({ gradlePath: ($event.target as HTMLInputElement).value })" />
  </label>

  <!-- 「Gradle 用户主目录」＝ service directory（GradleSettings.java:113-115）。空 = 用默认（GRADLE_USER_HOME）。 -->
  <label class="field-row"><span>Gradle 用户主目录</span>
    <input :value="gradle?.gradleUserHome ?? ''" :disabled="disabled" placeholder="留空表示使用默认的 GRADLE_USER_HOME" @change="patch({ gradleUserHome: ($event.target as HTMLInputElement).value })" />
  </label>

  <!-- 「Gradle 导入」开关：关掉时语言服务不跑 Buildship 导入，改由磁盘上的产物当类路径/源根
       （`java.import.gradle.enabled`）—— 没有可用导入的工程（依赖不在缓存里）靠它才有外部解析。 -->
  <label class="checkbox-row"><input type="checkbox" :checked="gradle?.enabled ?? true" :disabled="disabled" @change="patch({ enabled: ($event.target as HTMLInputElement).checked })" /><span>启用 Gradle 导入（关掉则用磁盘上的构建产物当类路径）</span></label>
  <!-- 关掉导入时语言服务的 workspace folder 会收窄成已链接的子工程（native/lsp_config.cpp 的
       workspace_folders）—— 那是 initialize 参数，改了要重开会话才生效，所以这里说清楚。 -->
  <!-- 「离线模式」＝ GradleSettings.isOfflineWork()（:118-131）→ 命令行加 --offline。 -->
  <label class="checkbox-row"><input type="checkbox" :checked="gradle?.offline ?? false" :disabled="disabled" @change="patch({ offline: ($event.target as HTMLInputElement).checked })" /><span>离线模式（<code>--offline</code>）</span></label>
</template>
