<script setup lang="ts">
// 「电脑控制」节（ZCode section id `computerUse`，`settingsPageConfig.ts:87-99`）的界面。
//
// 本节**没有设置面**：ZCode 那一节由官方 `zcode-cua@zcode-plugins-official` 插件与系统权限
// （macOS TCC 的 accessibility / screen_recording）决定，`ComputerUseSection.tsx:686-700`
// 在环境不支持时也只给一句 `unsupported.title` + 一句按环境分支的描述。本仓宿主是 WebView2、
// 没有 CUA Helper，所以这一节能说的只有「当前环境能不能用 + 缺什么」，判定与准备步骤全部来自
// `src/agentComputerUse.ts`（`computerUseAvailability` / `cuaPermissionPreparation`），
// 组件不自己编一句结论、也不画一个可点控件 —— 把判定画成开关就是放假控件。
//
// 权限态（辅助功能 / 屏幕录制）本仓**没有查询通道**（没有 Helper 可问），所以传 `null`：
// 模块按上游口径判「`unknown` 不算缺权限」（`cuaPermissionPreparation.ts:8-11` 的注释，
// 把 unknown 当缺权限会让用户去系统设置里找一个根本不存在的授权项）。这一步是**如实**的
// 缺省，不是"假装查过了"。
import { computed } from 'vue'
import AgentSettingsSectionShell from './AgentSettingsSectionShell.vue'
import { computerUseAvailability, cuaPermissionPreparation } from '../../agentComputerUse'
import { isDesktop } from '../../bridge'

const props = defineProps<{ workspacePath?: string | null }>()

/**
 * 平台探测：与「浏览器控制」节同一份写法（`src/targetPlatform.ts:45-53` 的口径：
 * `navigator.platform` + `userAgent`）。探测结果只是 `computerUseAvailability` 的输入，
 * 结论由模块给。
 */
function platformProbe(): { isDesktop: boolean; isMacDesktop: boolean; isWindowsDesktop: boolean } {
  const probe = typeof navigator === 'undefined'
    ? ''
    : `${(navigator as { platform?: string }).platform ?? ''} ${(navigator as { userAgent?: string }).userAgent ?? ''}`
  return { isDesktop, isMacDesktop: /mac/i.test(probe), isWindowsDesktop: /win/i.test(probe) }
}

const availability = computed(() => computerUseAvailability(platformProbe(), {
  // 本仓没有远端工作区；identity 按既有口径回落成工作区路径（`agentPluginRegistry.ts:847-849`）。
  workspaceIdentity: props.workspacePath ?? null,
}))

/** 准备步骤：ZCode 的 CUA Helper 授权链路（本仓没有 Helper，所以只是把上游规则如实登出来）。 */
const preparation = computed(() => cuaPermissionPreparation(null))

/** 这一节的说明：交给共用外壳渲染（`AgentSettingsSectionShell.vue` 的 `description`）。 */
const SECTION_DESCRIPTION = '由官方 CUA Helper 与系统权限决定；本仓宿主没有 CUA Helper，所以只登记判定与准备步骤。'
</script>

<template>
  <AgentSettingsSectionShell title="电脑控制" :description="SECTION_DESCRIPTION">
    <section class="settings-box">
      <h3 class="settings-box-title">可用性</h3>
      <p class="settings-status" role="status">{{ availability.reason }}</p>
      <ul v-if="availability.missing.length" class="computer-missing">
        <li v-for="item in availability.missing" :key="item">{{ item }}</li>
      </ul>
    </section>

    <section class="settings-box">
      <h3 class="settings-box-title">准备步骤</h3>
      <ol class="computer-steps">
        <li v-for="step in preparation.steps" :key="step.id" :class="{ 'is-satisfied': step.satisfied }">
          <span class="computer-step-title">{{ step.title }}</span>
          <span class="computer-step-detail">{{ step.detail }}</span>
        </li>
      </ol>
      <p class="field-hint">
        本节由 ZCode 的官方 CUA Helper 与系统权限决定；本仓宿主（WebView2 + 本机 Windows）没有 CUA Helper，
        所以这里只登记判定与准备步骤，不画开关 —— 纯文本指令不需要它，它能做的是"看屏幕、动鼠标"这一类。
      </p>
    </section>
  </AgentSettingsSectionShell>
</template>

<style scoped>
.computer-missing { display: flex; flex-direction: column; gap: var(--space-1); margin: 0; padding-left: var(--space-4); color: var(--text); font-size: 12px; line-height: 1.6; }
.computer-steps { display: flex; flex-direction: column; gap: var(--space-1); margin: 0; padding-left: var(--space-4); color: var(--text); font-size: 12px; line-height: 1.6; }
.computer-step-title { display: block; }
.computer-step-detail { display: block; color: var(--secondary); }
.is-satisfied .computer-step-title { color: var(--muted); }
</style>
