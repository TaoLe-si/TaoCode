// 桥上的错误类型。**一个文件一个职责域**，所以它既不属于桥的封装（bridge.ts），也不属于
// 浏览器预览桩（bridgePreview.ts）—— 两侧都要用，就单独成文件。
// bridge.ts 原样转出，调用方（scratchFiles / DebugPanel / TerminalPanel）不用改 import 路径。
export class BridgeError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}
