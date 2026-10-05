<script setup lang="ts">
// 状态栏上的检查配置档切换器（上游 `InspectionProfileManager.setRootProfile` / `getCurrentProfile`，
// `platform/analysis-impl/src/com/intellij/profile/codeInspection/InspectionProfileManager.java:37/40`；
// 锁标记 `InspectionProfileImpl.java:87-88` 的 `@Attribute("is_locked")`）。
//
// 为什么是独立组件：App.vue 只剩几十行机检余量，而这一档要渲染「当前档 + 候选清单 + 锁标记 + 切换」四件事。
// 数据层不注入 —— `src/inspectionProfile.ts` 本身就是 reactive store（`inspectionProfileStore`），
// 上游也是从 `InspectionProjectProfileManager` 单例取（`:33-35`），不是从某个 ctx 注入。
//
// 切换的语义照抄上游：切根 profile 即刻生效，问题表（`src/problems.ts` 的 `applyInspectionProfile`）
// 与「运行检查」的严重度判定都跟着变（`workspaceInspection.ts:61` 读的就是 `currentProfileName()`）。
// 档不存在返回 false（`selectProfile`，`inspectionProfile.ts:211`）⇒ 选项里根本不会出现不存在的档。
import { computed } from 'vue'
import { Lock } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { currentProfileName, isProfileLocked, profileNames, selectProfile } from '../inspectionProfile.ts'

/** 只有一档时没有可切的东西，不渲染（上游单 profile 时那一栏也是空的）。 */
const names = computed(() => profileNames())
const locked = computed(() => isProfileLocked())

function onChange(event: Event) {
  const name = (event.target as HTMLSelectElement).value
  if (!selectProfile(name)) (event.target as HTMLSelectElement).value = currentProfileName()
}
</script>

<template>
  <label v-if="names.length > 1" class="status-chip status-inspection-profile" :title="`检查配置档（上游 InspectionProfileManager.setRootProfile）${locked ? ' · 已锁定' : ''}`">
    <span class="status-inspection-profile-label">配置档</span>
    <select class="status-inspection-profile-select" :value="currentProfileName()" aria-label="检查配置档" @change="onChange">
      <option v-for="name in names" :key="name" :value="name">{{ name }}</option>
    </select>
    <Lock v-if="locked" class="status-inspection-profile-lock" :size="iconSize.chip" title="该配置档已锁定" aria-label="已锁定" />
  </label>
</template>
