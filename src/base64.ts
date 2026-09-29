// 二进制载荷在桥上走 base64（JSON 是文本）—— 终端输入、终端输出、运行输出、Gradle 同步输出都用它。
//
// 从 src/bridge.ts 拆出（2026-09-27：接 Gradle 同步时 bridge.ts 顶到机检上限）。
// 拆成独立模块还有一个实际好处：`gradleEvents.ts` 也要解码，而它不能再从 bridge.ts 取 ——
// 那会形成 bridge ⇄ gradleEvents 的循环导入。
//
// `btoa`/`atob` 只能吃 Latin-1，所以按 0x8000 分块喂，避免 `String.fromCharCode(...array)` 在
// 大缓冲上把调用栈撑爆（终端回显几十 KB 是常态）。
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; ++index) bytes[index] = binary.charCodeAt(index)
  return bytes
}
