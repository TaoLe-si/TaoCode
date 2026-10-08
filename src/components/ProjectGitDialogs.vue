<script setup lang="ts">
// 「文件历史 / Git 工作树 / Git 子模块」三个对话框。
//
// 从 App.vue 的模板里整块搬出来（那个文件贴着机检行数上限，而这一块 62 行全是列表渲染 +
// 一个输入行，属于"宿主只留一行调用"的那一类）。做法与 `TabContextMenu.vue` 一致：
// 依赖经 `ctx` 注入，组件自己**不持有任何状态** —— 状态都在 `src/projectExtras.ts` 里自持，
// 宿主把它的读写包成一组函数传进来（与 `tabMenuContext` 同一种形状，不用 ref 直传：
// 那是 `setup` 顶层之外的引用，模板里不会自动解包）。
//
// 上游对应物（三个都在 `git4idea` 里）：
//   · 文件历史 —— `GitFileHistoryDialog` / `ShowFileHistoryAction`；
//   · 工作树 —— `GitWorktreeListDialog`（list/add/remove）；
//   · 子模块 —— `GitSubmodulesDialog`（status + update）。
import { Trash2 } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import GitUpdateOptionsDialog from './GitUpdateOptionsDialog.vue'
import {
  acceptGitUpdateOptionsDialog, cancelGitUpdateOptionsDialog, gitUpdateOptionsDialog,
  setGitUpdateDialogMethod, setGitUpdateDialogShown,
} from '../gitUpdateOptionsHost.ts'

defineProps<{ ctx: any }>()
</script>

<template>
  <!-- 文件历史：左侧提交列表 + 右侧该次提交的补丁（主从详情面板）。 -->
  <div v-if="ctx.fileHistoryOpen" class="modal-backdrop" @click.self="ctx.closeFileHistory()">
    <section class="help-dialog file-history-dialog" role="dialog" aria-modal="true" aria-labelledby="file-history-title" @keydown="ctx.trapFocus">
      <h2 id="file-history-title">文件历史 · {{ ctx.fileHistory?.path }}</h2>
      <div class="file-history-body">
        <ul class="file-history-list" role="list">
          <li v-for="commit in ctx.fileHistory?.commits ?? []" :key="commit.hash">
            <button class="file-history-row" :class="{ selected: ctx.fileHistorySelected === commit.hash }" :aria-current="ctx.fileHistorySelected === commit.hash ? 'true' : undefined" :disabled="ctx.fileHistoryBusy" @click="ctx.showCommit(commit.hash)">
              <span class="fh-hash">{{ commit.shortHash }}</span>
              <span class="fh-subject" :title="commit.subject">{{ commit.subject }}</span>
              <span class="fh-meta">{{ commit.author }} · {{ commit.date.slice(0, 10) }}</span>
              <span v-if="commit.paths.some((item: string) => item.includes('(←'))" class="fh-rename">重命名</span>
            </button>
          </li>
          <li v-if="!ctx.fileHistory?.commits.length" class="plugin-empty">这个文件还没有提交历史。</li>
        </ul>
        <div class="file-history-detail">
          <p v-if="ctx.fileHistoryBusy" class="plugin-empty">读取中…</p>
          <template v-else-if="ctx.fileHistoryCommit">
            <p class="fh-detail-head">改动内容（{{ ctx.fileHistoryCommit.revision.slice(0, 8) }}）</p>
            <pre class="fh-patch">{{ ctx.fileHistoryCommit.patch || '（这次提交没有文件改动）' }}</pre>
          </template>
          <p v-else class="plugin-empty">选择一个提交查看它改了什么。</p>
        </div>
      </div>
      <div class="dialog-actions"><button class="subtle-button" @click="ctx.closeFileHistory()">关闭</button></div>
    </section>
  </div>
  <!-- Git 工作树：列表（每行一个「移除」）+ 底部的添加行（路径 / 分支 / 新建分支）。 -->
  <div v-if="ctx.worktreeOpen" class="modal-backdrop" @click.self="ctx.closeWorktrees()">
    <section class="help-dialog worktree-dialog" role="dialog" aria-modal="true" aria-labelledby="worktree-title" @keydown="ctx.trapFocus">
      <h2 id="worktree-title">Git 工作树</h2>
      <ul class="worktree-list">
        <li v-for="tree in ctx.worktrees" :key="tree.path" class="worktree-row">
          <span class="worktree-path" :title="tree.path">{{ tree.path }}</span>
          <span class="worktree-branch">{{ tree.branch }}</span>
          <span v-if="tree.locked" class="worktree-flag">已锁定</span>
          <span v-if="tree.prunable" class="worktree-flag">可清理</span>
          <button class="icon-button" :disabled="ctx.worktreeBusy || tree.bare" title="移除该工作树" aria-label="移除该工作树" @click="ctx.removeWorktree(tree.path)"><Trash2 :size="iconSize.control" /></button>
        </li>
      </ul>
      <div class="worktree-add">
        <input :value="ctx.worktreePath" placeholder="新工作树的绝对路径（必须在仓库之外）" aria-label="工作树路径" @input="ctx.setWorktreePath(($event.target as HTMLInputElement).value)" />
        <input :value="ctx.worktreeBranch" placeholder="分支名，留空则按路径名创建" aria-label="分支名" @input="ctx.setWorktreeBranch(($event.target as HTMLInputElement).value)" />
        <label class="worktree-new"><input :checked="ctx.worktreeNewBranch" type="checkbox" @change="ctx.setWorktreeNewBranch(!ctx.worktreeNewBranch)" />新建分支</label>
        <button class="subtle-button" :disabled="ctx.worktreeBusy || !ctx.worktreePath.trim()" @click="ctx.addWorktree()">添加</button>
      </div>
      <div class="dialog-actions"><button class="subtle-button" @click="ctx.closeWorktrees()">关闭</button></div>
    </section>
  </div>
  <!-- Git 子模块：状态 / 路径 / 提交三列 + 一个「更新子模块」。 -->
  <div v-if="ctx.submoduleOpen" class="modal-backdrop" @click.self="ctx.closeSubmodules()">
    <section class="help-dialog submodule-dialog" role="dialog" aria-modal="true" aria-labelledby="submodule-title" @keydown="ctx.trapFocus">
      <h2 id="submodule-title">Git 子模块</h2>
      <p v-if="!ctx.submodules.length" class="plugin-empty">这个仓库没有子模块。</p>
      <ul v-else class="submodule-list">
        <li v-for="module in ctx.submodules" :key="module.path" class="submodule-row">
          <span class="submodule-status" :class="{ dirty: module.status !== ' ' }">{{ module.status === ' ' ? '正常' : module.status.trim() || '有改动' }}</span>
          <span class="submodule-path" :title="module.path">{{ module.path }}</span>
          <span class="submodule-commit">{{ module.commit.slice(0, 8) }}</span>
        </li>
      </ul>
      <div class="dialog-actions"><button class="subtle-button" :disabled="ctx.submoduleBusy" @click="ctx.updateSubmodules()">{{ ctx.submoduleBusy ? '更新中…' : '更新子模块' }}</button><button class="subtle-button" @click="ctx.closeSubmodules()">关闭</button></div>
    </section>
  </div>
  <GitUpdateOptionsDialog v-if="gitUpdateOptionsDialog" :model="gitUpdateOptionsDialog.model"
                          :trap-focus="ctx.trapFocus"
                          @method="setGitUpdateDialogMethod" @show-dialog="setGitUpdateDialogShown"
                          @accept="acceptGitUpdateOptionsDialog" @cancel="cancelGitUpdateOptionsDialog" />
</template>
