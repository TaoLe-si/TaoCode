<script setup lang="ts">
// 删除确认对话框（IDEA `DeleteHandler` / `SafeDeleteProcessor` 的确认那一半）。
//
// 从 App.vue 的模板里整块搬出来（那个文件贴着机检行数上限，而这一块 34 行全是"列出引用位置 +
// 两个按钮"，属于"宿主只留一行调用"的那一类）。做法与 `ProjectGitDialogs.vue` / `TabContextMenu.vue`
// 一致：依赖经 `ctx` 注入，组件自己不持有任何状态。
//
// 上游形状（逐条核过）：
//   · 标题/正文 —— `universal.file.chooser.action.delete.confirm` 的 `Delete "X"?` /
//     `Delete "X" and all of its contents?`（目录那一支多后半句）；
//   · 按钮 —— `DeleteHandler.java:169-171` 的 `Messages.showOkCancelDialog(project, warningMessage,
//     IdeBundle.message("title.delete"), ApplicationBundle.message("button.delete"),
//     CommonBundle.getCancelButtonText(), Messages.getQuestionIcon())`
//     ⇒ 主按钮「删除 / 移到回收站」在前、「取消」在后（`MessageDialogBuilder.okCancel` 的 options 序）；
//   · 引用清单 —— Safe Delete 先把"还有谁引用它"摆出来，让人带着调用点做决定。
defineProps<{ ctx: any }>()
</script>

<template>
  <div v-if="ctx.deleteTarget" class="modal-backdrop" @click.self="ctx.closeDelete()">
    <section class="help-dialog leave-dialog" role="alertdialog" aria-modal="true" aria-label="删除确认" @keydown="ctx.trapFocus">
      <!-- universal.file.chooser.action.delete.confirm: Delete "X"? /
           Delete "X" and all of its contents? -->
      <h2>删除 “{{ ctx.deleteTarget.path }}”{{ ctx.deleteTarget.kind === 'directory' ? ' 及其全部内容？' : '？' }}</h2>
      <p>{{ ctx.deleteTarget.kind === 'directory' ? '目录及其所有子项都会从磁盘移除，无法在 TaoCode 内撤销。' : (ctx.deleteToBin ? '该文件会移到系统回收站；如需找回也可用「本地历史」回滚旧版本。' : '该文件将从磁盘直接删除且无法撤销；如需找回只能用「本地历史」回滚旧版本。') }}</p>
      <!-- Safe Delete: IDEA lists the places that still reference the file so the
           decision is made with the callers in view. -->
      <div v-if="ctx.deleteTarget.kind === 'file'" class="delete-usages">
        <p v-if="ctx.deleteUsagesError" class="delete-usages-error">用法扫描失败：{{ ctx.deleteUsagesError }}</p>
        <template v-else-if="ctx.deleteUsages">
          <!-- file.usages is a workspace-wide TEXT scan, not a language-level Find
               Usages: it has no PSI and no scope resolution. It is shown either way
               because an empty list does not mean "no references" (binary files and
               anything over the size cap are skipped) and a hit can be a namesake. -->
          <p class="delete-usages-scope">
            以下是「全工作区文本扫描」的结果，不是精确的引用分析：可能包含同名误报，也可能漏掉二进制文件与超大文件中的引用。
            <span v-if="ctx.deleteUsages.truncated" class="delete-usages-more">本次扫描已截断。</span>
          </p>
          <p v-if="!ctx.deleteUsages.hits.length" class="delete-usages-empty">已扫描 {{ ctx.deleteUsages.scanned }} 个文件，没有发现仍然引用「{{ ctx.deleteUsages.symbol }}」的位置——这不代表没有引用。</p>
          <template v-else>
            <p class="delete-usages-head">有 {{ ctx.deleteUsages.hits.length }} 处仍然引用「{{ ctx.deleteUsages.symbol }}」<span v-if="ctx.deleteUsages.truncated" class="delete-usages-more">（结果已截断）</span>：</p>
            <ul class="delete-usages-list">
              <li v-for="(hit, index) in ctx.deleteUsages.hits.slice(0, 12)" :key="`${hit.path}:${hit.line}:${hit.column}:${index}`">
                <button class="delete-usage-row" :title="hit.preview" @click="ctx.openUsage(hit.path)">{{ hit.path }}:{{ hit.line }}:{{ hit.column }}</button>
              </li>
            </ul>
          </template>
        </template>
        <p v-else class="delete-usages-empty">正在扫描引用…</p>
      </div>
      <div class="leave-actions"><button class="primary-button menu-danger-solid" @click="ctx.confirmDelete()">{{ ctx.deleteToBin ? '移到回收站' : '删除' }}</button><button class="subtle-button" @click="ctx.closeDelete()">取消</button></div>
    </section>
  </div>
</template>