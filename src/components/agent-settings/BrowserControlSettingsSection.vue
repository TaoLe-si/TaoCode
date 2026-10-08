<script setup lang="ts">
// 「浏览器控制」节（ZCode section id `browser`，`settingsPageConfig.ts:125-138`，图标 Globe2）的界面。
//
// 本节**没有设置面**：ZCode 那一节的总开关就是官方 `browser-use@zcode-plugins-official` 插件的
// 启用态（`BrowserSettingsSection.tsx:30, 153-157`），数据管理区靠内置浏览器 guest 的
// `importChromeBrowserData` / `clearEmbeddedBrowserData` 两条通道（`:107-110`）。本仓没有
// marketplace 装那个插件 ⇒ 这一节能说的只有「当前环境能不能用 + 缺什么」，判定与缺口清单
// 全部来自 `src/agentComputerUse.ts` 的 `browserControlAvailability`，组件不自己编一句结论。
//
// 因此这里**一个原生控件都没有**（判定不是设置，画成开关就是放假控件）。
// 「忽略证书校验 / 清除内置浏览器数据」这两个真实落点在本仓已有位置：设置 › 常规 › 浏览器
// （`src/components/SettingsDialog.vue`，同一对 RPC：`settings.general.update` / `browser.data.clear`），
// 本节不重复造第二份。
import { computed } from 'vue'
import AgentSettingsSectionShell from './AgentSettingsSectionShell.vue'
import { browserControlAvailability } from '../../agentComputerUse'
import { isDesktop } from '../../bridge'

const props = defineProps<{ workspacePath?: string | null }>()

/**
 * 平台探测：本仓既有写法（`src/targetPlatform.ts:45-53`：`navigator.platform` + `userAgent`）。
 * 判据不在这里兜底 —— 探测结果只是 `browserControlAvailability` 的输入，结论由模块给。
 */
function platformProbe(): { isDesktop: boolean; isMacDesktop: boolean; isWindowsDesktop: boolean } {
  const probe = typeof navigator === 'undefined'
    ? ''
    : `${(navigator as { platform?: string }).platform ?? ''} ${(navigator as { userAgent?: string }).userAgent ?? ''}`
  return { isDesktop, isMacDesktop: /mac/i.test(probe), isWindowsDesktop: /win/i.test(probe) }
}

const availability = computed(() => browserControlAvailability(platformProbe(), {
  // 本仓没有远端工作区；identity 按既有口径回落成工作区路径（`agentPluginRegistry.ts:847-849`），
  // 于是 `isRemoteWorkspaceIdentity` 只在真拿到 `remote:...` 形态时为真。
  workspaceIdentity: props.workspacePath ?? null,
}))

// 这一节**没有 description**：上游没有对应的节说明键（`settings.browser.*` 只有行/按钮/导入文案），
// 自己写一句就是自造。界面只显示模块算出来的「可用性」结论与缺口清单，不解释本仓缺什么通道。
</script>

<template>
  <AgentSettingsSectionShell title="浏览器控制">
    <section class="settings-box">
      <h3 class="settings-box-title">可用性</h3>
      <p class="settings-status" role="status">{{ availability.reason }}</p>
      <ul v-if="availability.missing.length" class="browser-missing">
        <li v-for="item in availability.missing" :key="item">{{ item }}</li>
      </ul>
    </section>
  </AgentSettingsSectionShell>
</template>

<style scoped>
.browser-missing { display: flex; flex-direction: column; gap: var(--space-1); margin: 0; padding-left: var(--space-4); color: var(--text); font-size: 12px; line-height: 1.6; }
</style>
