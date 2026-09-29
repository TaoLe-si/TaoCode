// 桃 2026-09-27 起按「一类一文件」把 App.vue 的菜单与工具窗口逻辑拆进了 src/menus/*.ts
// 和若干顶层模块（toolWindowActions / toolTabs / toolWindowContentUi / editorCommands …）。
//
// 有一批测试断言的是「代码里存在这个行为」，它们当年按 `readFileSync('src/App.vue')` 写的。
// 行为没变、位置变了，所以它们要看的是**整个外壳**：App.vue 在前（保证对 App.vue 的行号/
// 切片查找仍然成立），随后按固定顺序拼接拆分出去的模块。
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = file => readFileSync(join(root, file), 'utf8')
const sortedTs = dir => readdirSync(join(root, dir)).filter(name => name.endsWith('.ts')).sort().map(name => `${dir}/${name}`)

let cached = null

/** App.vue 的全部行 + 其后拼接的菜单与顶层模块行。 */
export function shellSource() {
  if (cached !== null) return cached
  cached = [
    'src/App.vue',
    ...sortedTs('src/menus'),
    ...sortedTs('src'),
  ].map(read).join('\n')
  return cached
}

/** 只有菜单模块（不含 App.vue）。 */
export function menuSource() {
  return sortedTs('src/menus').map(read).join('\n')
}
