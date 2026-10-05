<script setup lang="ts">
// 内存 / 反汇编视图（DAP `readMemory` / `disassemble`，两个能力位规范默认 false）。
// 从 `DebugPanel.vue` 拆出（那个文件贴着机检上限，而这块的请求/状态自成一体）：
// 共用地址与长度输入；结果分别是 hex+ASCII 表与指令清单；没声明能力的按钮不渲染。
import { computed, ref } from 'vue'
import { dapCapability, dapDisassemble, dapReadMemory, type DapInstruction } from '../bridge'
import { capabilityReason, memoryRows, type MemoryRow } from '../debugSources'

const props = defineProps<{ stopped: boolean }>()
void props

const memAddress = ref('0x1000'); const memLength = ref(16)
const memNote = ref(''); const memRows = ref<MemoryRow[]>([]); const memInstructions = ref<DapInstruction[]>([]); const memBusy = ref(false)

const canRead = computed(() => dapCapability('supportsReadMemoryRequest'))
const canDisassemble = computed(() => dapCapability('supportsDisassembleRequest'))

// 内存/反汇编共用地址与长度：read 显示 hex+ASCII 表，code 显示指令表。
async function memoryRequest(kind: 'read' | 'code') {
  if (memBusy.value) return
  memBusy.value = true; memNote.value = ''
  const reference = memAddress.value.trim()
  const count = Math.max(1, Math.min(4096, Math.trunc(memLength.value) || 16))
  try {
    if (kind === 'read') {
      const result = await dapReadMemory(reference, count)
      memRows.value = memoryRows(result.dataB64, result.address); memInstructions.value = []
      memNote.value = result.unreadableBytes ? `${result.unreadableBytes} 字节不可读。` : memRows.value.length ? '' : '这段内存没有可显示的数据。'
    } else {
      const result = await dapDisassemble(reference, Math.min(count, 256), { resolveSymbols: true })
      memInstructions.value = result.instructions; memRows.value = []
      memNote.value = result.instructions.length ? '' : '这段地址没有可反汇编的指令。'
    }
  } catch (caught) { memRows.value = []; memInstructions.value = []; memNote.value = caught instanceof Error ? caught.message : String(caught) }
  finally { memBusy.value = false }
}
</script>

<template>
  <div class="debug-memory">
    <div class="debug-section-title">内存 / 反汇编</div>
    <div class="debug-breaks">
      <label class="debug-field"><span>地址</span><input v-model="memAddress" class="debug-input" aria-label="内存地址（memoryReference）" placeholder="0x1000 或 &var" spellcheck="false" /></label>
      <label class="debug-field"><span>长度</span><input v-model.number="memLength" type="number" min="1" class="debug-input debug-input-narrow" aria-label="字节数 / 指令数" /></label>
      <button v-if="canRead" class="debug-btn" :disabled="memBusy" :title="canRead ? '读取内存（supportsReadMemoryRequest）' : capabilityReason('supportsReadMemoryRequest')" @click="memoryRequest('read')">读内存</button>
      <button v-if="canDisassemble" class="debug-btn" :disabled="memBusy" :title="canDisassemble ? '反汇编（supportsDisassembleRequest）' : capabilityReason('supportsDisassembleRequest')" @click="memoryRequest('code')">反汇编</button>
    </div>
    <p v-if="memNote" class="debug-empty-inline">{{ memNote }}</p>
    <div v-if="memRows.length || memInstructions.length" class="debug-list debug-memory-rows" role="list" aria-label="内存 / 反汇编结果">
      <div v-for="row in memRows" :key="`h${row.address}|${row.hex}`" class="debug-list-row" role="listitem">
        <span class="debug-memory-address">{{ row.address || '（符号地址）' }}</span><span class="debug-value">{{ row.hex }}</span><span class="debug-list-path">{{ row.ascii }}</span>
      </div>
      <div v-for="(item, index) in memInstructions" :key="`i${item.address}|${index}`" class="debug-list-row" role="listitem">
        <span class="debug-memory-address">{{ item.address }}</span><span class="debug-value">{{ item.instruction }}</span><span class="debug-list-path">{{ item.symbol ?? '' }}{{ item.path ? ` ${item.path}:${item.line ?? ''}` : '' }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 与 DebugPanel 的调试样式同源（类名沿用，父组件那份 scoped 样式够不到子组件，
   所以这里把用到的几条抄一份 —— 拆模块时按最小集抄，不复制整块）。 */
.debug-section-title { margin: var(--space-3) var(--space-3) var(--space-1); color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-size: 10px; }
.debug-breaks { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); padding: 0 var(--space-3); }
.debug-field { display: flex; align-items: center; gap: var(--space-1); min-width: 0; font-size: 11px; color: var(--muted); }
.debug-field > span { flex-shrink: 0; width: 48px; }
.debug-input { flex: 1; min-width: 0; min-height: var(--ctrl-height-sm); padding: 2px var(--space-1); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 11px/1.4 var(--font-mono); }
.debug-input-narrow { flex: 0 0 60px; }
.debug-btn { display: inline-flex; align-items: center; gap: var(--space-1); padding: 3px var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--elevated); color: var(--text); font-size: 11px; }
.debug-btn:disabled { color: var(--muted); opacity: .5; }
.debug-empty-inline { color: var(--muted); font-size: 11px; margin: 0; padding: 0 var(--space-3); }
.debug-list { max-height: 160px; overflow: auto; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.debug-list-row { display: flex; align-items: baseline; gap: var(--space-2); padding: 1px var(--space-3); font: 11px/1.6 var(--font-mono); }
.debug-list-path { margin-left: auto; color: var(--muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.debug-value { color: var(--syntax-string); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.debug-memory-address { flex-shrink: 0; min-width: 68px; color: var(--muted); }
.debug-memory-rows { max-height: 220px; }
.debug-memory-rows .debug-value { white-space: pre; }
</style>
