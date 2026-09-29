// 新建/克隆项目对话框的**路径校验** —— 纯函数，从 `src/components/ProjectDialog.vue` 抽出来。
//
// 为什么抽：这里刚出过一个真实 bug（2026-09-27）—— `ILLEGAL_PATH` 把 `:` 也当成非法字符，
// 于是**任何盘符路径**（`D:\Backup\Documents`）都被判非法，"创建项目"按钮永久灰着，
// 用户看到的就是"无法新建项目"。而 .vue 里的逻辑没法直接测，只能靠界面上肉眼发现。
// 抽成模块后每条规则都有单测（`tests/project-path.test.mjs`）。
//
// 规则来源：Windows 的文件名/路径限制（MSDN 的 "Naming Files, Paths, and Namespaces"）——
//   · 文件名里不能有 `< > : " / \ | ? *` 与控制字符；
//   · 名字不能以空格或句点结尾，不能是 `.` / `..`；
//   · 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）在任何目录下都不可用，带扩展名也不行；
//   · **路径里的 `:` 只允许出现在盘符**（`D:`）或 UNC 的备用数据流位置（本仓不支持后者）。

/** 保留设备名（带扩展名也算，故用 `(\.|$)` 而不是 `$`）。 */
export const RESERVED_DEVICE_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i

/** 文件（目录）名里真正非法的字符。 */
export const ILLEGAL_NAME_CHARACTER = /[\\/:*?"<>|\u0000-\u001f]/

/** 路径里非法的字符 —— `:` 由 `stripDrivePrefix` 单独处理（盘符是合法的）。 */
export const ILLEGAL_PATH_CHARACTER = /[<>:"|?*\u0000-\u001f]/

/**
 * 剥掉开头的盘符（`D:`）—— 校验非法字符时要跳过它，否则合法路径会被判非法。
 * 只认"字母 + 冒号"这一种形态（UNC 路径本来就没有冒号）。
 */
export function stripDrivePrefix(path: string): string {
  return /^[A-Za-z]:/.test(path) ? path.slice(2) : path
}

export function isReservedDeviceName(name: string): boolean {
  return RESERVED_DEVICE_NAME.test(name)
}

/** 项目**名称**（单段目录名）的校验；合法返回空串。 */
export function projectNameError(name: string): string {
  if (!name) return ''
  if (name !== name.trim() || ILLEGAL_NAME_CHARACTER.test(name) || name === '.' || name === '..' || name.endsWith('.'))
    return '名称不能含路径分隔符或特殊字符，不能以空白开头或以空白、句点结尾。'
  if (isReservedDeviceName(name)) return '名称使用了 Windows 保留名（CON、PRN、AUX、NUL、COM1-9、LPT1-9），请更换。'
  if (name.length > 80) return '名称过长：单个目录名请控制在 80 个字符以内。'
  return ''
}

/**
 * **父目录**的校验；合法返回空串。
 * 盘符冒号（`D:`）是合法的 —— 这条曾经写错，导致所有 `X:\…` 路径无法提交。
 */
export function projectParentError(parent: string): string {
  const text = parent.trim()
  if (!text) return ''
  if (ILLEGAL_PATH_CHARACTER.test(stripDrivePrefix(text)))
    return '路径不能包含 * ? " < > | 或控制字符（盘符后的冒号除外）。'
  // 只接受盘符路径或 UNC 共享；其余形态原生层解析不成真实目录。
  const normalized = text.replace(/\\/g, '/')
  if (!/^[A-Za-z]:\//.test(normalized) && !normalized.startsWith('//'))
    return '请填写绝对路径，例如 D:\\projects 或 \\\\server\\share。'
  const parts = normalized.replace(/^\/+/, '').split('/').filter(Boolean)
  if (parts.some(part => part === '.' || part === '..')) return '路径里的“.”或“..”段无法定位父目录，请直接填写完整路径。'
  if (parts.some(part => part.endsWith('.'))) return '路径的每一段都不能以句点结尾。'
  if (parts.some(isReservedDeviceName)) return '路径包含 Windows 保留名（CON、PRN、AUX、NUL、COM1-9、LPT1-9）。'
  return ''
}

/** 上级路径 + 名称拼成最终路径（保留原本的分隔符风格）。 */
export function projectDestination(parent: string, name: string): string {
  const base = parent.trim()
  const leaf = name.trim()
  if (!base || !leaf) return ''
  const separator = base.includes('\\') ? '\\' : '/'
  return `${base.replace(/[\\/]+$/, '')}${separator}${leaf}`
}

/** 最终路径是否长到 Windows 建不出子目录（MAX_PATH 留余量给生成的构建树）。 */
export function projectPathTooLong(parent: string, name: string): boolean {
  const destination = projectDestination(parent, name)
  return Boolean(destination) && destination.replace(/^\\\\\?\\/, '').length > 240
}
