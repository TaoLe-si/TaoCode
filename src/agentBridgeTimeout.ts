// Agent 宿主文件桥的**等待上限**（2026-10-07）。
//
// 为什么单独一个文件：它只有一件事——「一次宿主请求最多等多久，超时后如实收场」。
// 但这件事必须有判据钉住，而 `src/agentHostWire.ts` 直接 import `./bridge.ts`（真 exe 里才有
// 那条 WebView2 通道），判据在 Node 里加载它就会断在第一跳 —— 于是把这个纯函数抽出来，
// 超时口径本身就能被断言（`tests/agent-bridge-timeout.test.mjs`）。
//
// **起因是真实故障**：交接件 §四.1 记着「untitled 示例项目上发消息后 `busy` 卡 true、
// `messages: 0`」—— 一次 `await file.read` 永远不返回，于是审批门之后的每一段都在等它，
// 对话面板被永久锁死，用户看上去就是「Agent 一点反应都没有」。
// 加了上限之后，挂起变成一条**诚实的失败**（按「读不到」收场，工具结果里如实写着），
// 而不是把面板锁死 —— 这与本仓「失败要如实说出去，不许假装成功」是同一条纪律。
//
// 上限取 8 秒：本地读一个文件是毫秒级的，8 秒足够覆盖宿主一次冷启式的磁盘抖动；
// 再往上只会让「卡住」更难察觉（用户早就以为它死了）。

/** `file.read` / `file.write` 的等待上限（毫秒）。 */
export const AGENT_BRIDGE_TIMEOUT_MS = 8_000

/**
 * 给一个 Promise 加时限。
 *
 * 超时后**不抛**，而是走 `onTimeout()` 给的那个值 —— 调用方要的就是「读不到」这个结论，
 * 让它在同一条链上继续往前走（工具结果里会写明读不到），而不是把 `await` 悬在那里。
 *
 * 计时器在两条路（完成 / 超时）上都会被清掉：留着不清理的定时器会让 Node 的进程句柄一直挂着，
 * 判据跑完就退不出去了 —— 这一条有判据（`timer` 泄漏那条）。
 *
 * @param work 真正要等的那个 Promise。
 * @param onTimeout 超时后怎么收场（同步求值）。
 * @param ms 上限，默认 {@link AGENT_BRIDGE_TIMEOUT_MS}。
 */
export async function withBridgeTimeout<T>(
  work: Promise<T>,
  onTimeout: () => T,
  ms: number = AGENT_BRIDGE_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race<T>([
      work,
      new Promise<T>(resolve => { timer = setTimeout(() => resolve(onTimeout()), ms) }),
    ])
  } finally {
    // 两条路都走到这里：真值先到时清掉还没触发的计时器，超时后清掉已触发那个的句柄。
    if (timer !== undefined) clearTimeout(timer)
  }
}