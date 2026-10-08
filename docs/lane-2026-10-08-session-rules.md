# lane session-rules · `tests/agent-session.test.mjs` 14 条红 → 绿

## 一、根因：判据形状过时（不是产品回归）

14 条失败消息**全是同一句** `TypeError: session.send is not a function`（`build/_baseline-fails.txt:8-23` 同批号），
没有一条是行为断言不符 —— 说明挂掉的是**驱动通道**，不是被钉的规则。核实：

1. **会话只剩一条真轮次管线**：`src/agentSession.ts:67` 的 `sendWithModel`（异步、要注入模型出口），
   由 `src/agentHost.ts:399` 调用；面板走 `src/components/AgentPanel.vue:416` 的 `host.send(...)` → 同一条。
   `AgentSession` 接口（`src/agentSession.ts:60-106`）里根本没有 `send`。
2. **无生产消费方**：`grep -rn "\.send(" src/*.ts src/components/AgentPanel.vue` 只命中 `AgentPanel.vue:416`（那是 host 的 `send`）；
   `workspaceFiles` 选项、同步假模型轮次，在 `src/` 里零引用 → 判据还在驱动「本地假模型面板」时代的 API。
3. **判据自身留下了过时痕迹**：注释里写「假模型给出的 id 是 2（`轮次 * 2`）」——那是假模型**自己发号**的口径；
   现行实现由会话发号（`nextToolCallId`，`src/agentSession.ts:166`、恢复时 `:365` 续号），`transcript()` 也已带
   `modelToolCall.agentCallId`（`:282-290`），所以「转写里不带调用 id」这句同样失效。
   `docs/batch-2026-10-07-zcode-port.md:99-104` 那三条口径（负数历史 id、假模型 `轮次*2`）也已过期，属文档漂移。
4. `tests/agent-host.test.mjs`（26 条，现全绿）已经用「假模型桥把 `fakeModelReply` 编成 provider 形状」的口径覆盖真管线 ——
   本文件照抄这一口径即可，不必给产品加一条没人用的同步假 `send`（那会是测试专用面，违反「不放假控件」的口径）。

结论：**订正判据的驱动通道**，规则一条不撤。

## 二、改动（只改 1 个文件；实现一字未动）

`tests/agent-session.test.mjs`
- `:6-10` 头注释写明驱动口径：`sendWithModel` + `agent.ts` 的 `fakeModelReply`，与 host 判据的假模型桥同源。
- `:14` import 增加 `fakeModelReply`；`:21-36` 新增 `fakeGenerate()`：轮次按请求里的用户消息数算
  （与 `tests/agent-host.test.mjs:50-51` 同一算法），把假模型的 toolCalls 编成 `{providerCallId,name,input,tool,params}`。
- 14 条判据的驱动：`createAgentSession({now, workspaceFiles})` → `createAgentSession({now})`（`:45,:56,:65,:81,:94,:104,:114,:128,:135,:151,:166,:172,:186,:205,:212,:223,:230`）；
  `session.send(x)` → `await session.sendWithModel(x, fakeGenerate())`（`:46,:57,:66,:68,:82,:84,:96,:98,:106,:108,:115,:123,:129,:136,:137,:152,:154,:173,:176,:187,:188,:199,:206,:207,:224,:225,:234`），测试体改 `async`。
- 两处**非机械**改动（其余断言逐字未动）：
  1. `:129` `assert.throws(() => session.send('   '), /空消息/)` → `await assert.rejects(() => session.sendWithModel('   ', fakeGenerate()), /空消息/)`
     —— 异步管线的等价形状；规则「空消息不发送、不推进轮次」连同 `:130-132` 两条断言原样保留。
  2. `:222-241`（restore id 不相撞）：存档前跑到第二轮并**在离开前批掉那条写**（`:227-228` 新增前置断言），
     恢复后发第三轮。理由：原驱动只有一行动史，「历史 id 撞上新调用 → 误报已批准」这条机制**根本触发不到**
     （改坏实现也不红，等于空判据，违反硬规则 7）。现驱动下该机制可达 —— 见第四节第 3 轮实测。

未动：`src/agentSession.ts`、`src/agent.ts`（`git diff` 对二者为空）、禁改清单里的任何文件。
判据总量：17 条 test（原 17，未删未合）/ 66 处 `assert.*`（原 65 + 1 条新前置断言），无放宽、无写死数字换绿。

## 三、门禁实测读数

```
$ node --test tests/agent-session.test.mjs
ℹ tests 17  ℹ pass 17  ℹ fail 0          （修前：pass 3 / fail 14）

$ npx vue-tsc --noEmit
（无输出）EXIT=0

$ node --test tests/module-size.test.mjs
ℹ tests 5  ℹ pass 5  ℹ fail 0            （未改任何 src/*.ts，尺寸未动）
```
`tests/verdict-generated.test.mjs` **没跑**：本 lane 无族键（`scripts/verdict_table.py` 里没有 `agentSession` 族），
且该文件正被并行 lane 改写，读数不归我。

## 四、反向验证（临时改坏 `src/agentSession.ts`，三轮回读）

1. **8 处同时改坏**（verdict 恒 `allow` / `turnCount += 1` 停用 / 计划不替换 / 空消息守卫停用 /
   `clear()` 不归零轮数 / transcript 的 approved 改读「待执行队列」 / 恢复不续号 / 恢复把历史塞回待执行队列）
   → `pass 5 / fail 12`：14 条改过的判据里 12 条红（含写要问、拒绝留痕、never、计划、空消息、transcript、
   `/清空`、restore 不重执行）。
2. **只留 2 处**（allow 档改判 `ask` + 恢复不续号）→ `pass 9 / fail 8`，补上第 1 轮没红的
   「读放行」「权限改成 allow」两条。
3. **只留 1 处**（删掉 `src/agentSession.ts:365` 的 `nextToolCallId = Math.max(...)`）→ `pass 16 / fail 1`，
   红的正是 `restore：历史调用的 id 与将来的轮次 id 不相撞`，断言消息
   `新一轮的写调用应仍挂着审批（没有 approved 那一位），实际有 0 行` —— 即新写调用被历史 id 误报成已批准，正是该判据要抓的回归。
4. 恢复后复核：`grep TEMP-BREAK src/agentSession.ts` 空、`git diff -- src/agentSession.ts` 空、判据 17/17 绿。

## 五、仍缺什么 / 需要协调代理接线（我禁改的文件）

1. **离线假模型演示面已不在产品里**：面板必须配好 provider+model 才走 `host.send`；`agent.ts:148` 的 `fakeModelReply`
   现在只有判据在用（`src/` 零引用）。若协调代理要把「无授权/无网络的本地假模型」当成交付面，应新开一条显式出口
   （如 `agentHost` 上加本地假桥或 `agentCommand` 入口），**不要**在 `agentSession` 里复活同步 `send`。
2. **`sessionStatusLine` 无生产消费方**（`src/agentSession.ts:385`）：面板顶部状态行不是它（host 侧另有只报「待批准/待决改动」的实现）。
   要接的话改 `src/components/AgentPanel.vue`（禁改），我未动。
3. **文档漂移**：`docs/batch-2026-10-07-zcode-port.md:99-104` 仍写「历史调用 id 取负数 / 假模型 id 是 `轮次*2`」，
   与现行实现（有 `modelToolCall.agentCallId` 的正数续号 + 旧转写才落负数空间，`src/agentSession.ts:346-349`）不一致；该文件不归我，未改。
4. 本 lane 无 `scripts/verdict_table.py` 族键，故无判决表回填；`docs/inventory/**` 未碰。
