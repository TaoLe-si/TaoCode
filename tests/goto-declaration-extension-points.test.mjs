// 判据 · **「转到声明」与目标呈现的扩展点**（`src/gotoDeclarationExtensionPoints.ts`，上游
// `GotoDeclarationHandler` / `GotoTargetPresentationProvider` 两条 EP）。
//
// 钉五件事：
//   ① 两条 EP 的 id 与上游 `ExtensionPointName` 逐字一致，且已在宿主里声明；
//   ② 处理器按 id 注册/注销，`accepts` 过滤生效；
//   ③ `collectDeclarationTargets` 收全表 + 并上宿主通道 + 去重，单条处理器抛错不影响其余；
//   ④ 异步处理器（语言服务那一档）也收；
//   ⑤ 呈现覆盖真的落到 `chooseTargetRows` 的行上，`differentNames` = 全表同名。
import test from 'node:test'
import assert from 'node:assert/strict'

import { APPLICATION_SCOPE, EXTENSIONS } from '../src/extensionPoints.ts'
import {
  GOTO_DECLARATION_HANDLER_EP, GOTO_TARGET_PRESENTATION_PROVIDER_EP,
  allTargetNamesEqual, applyTargetPresentation, collectDeclarationTargets, dedupeDeclarationTargets,
  gotoDeclarationHandlers, gotoTargetPresentation, registerGotoDeclarationHandler,
  registerGotoTargetPresentationProvider, unregisterGotoDeclarationHandler,
  unregisterGotoTargetPresentationProvider,
} from '../src/gotoDeclarationExtensionPoints.ts'
import { chooseTargetRows } from '../src/chooseTarget.ts'

const at = (path, line, character) => ({ path, line, character })

test('两条 EP 已声明，id 与上游 qualifiedName 逐字一致', () => {
  assert.equal(GOTO_DECLARATION_HANDLER_EP, 'com.intellij.gotoDeclarationHandler')
  assert.equal(GOTO_TARGET_PRESENTATION_PROVIDER_EP, 'com.intellij.gotoTargetPresentationProvider')
  for (const id of [GOTO_DECLARATION_HANDLER_EP, GOTO_TARGET_PRESENTATION_PROVIDER_EP]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(id), true, `${id} 未声明`)
  }
})

test('处理器按 id 注册/注销，accepts 过滤生效', async () => {
  const handle = registerGotoDeclarationHandler({
    id: 'demo.goto', accepts: request => request.path === 'src/yes.ts',
    getGotoDeclarationTargets: () => [at('src/yes.ts', 3, 4)],
  })
  try {
    assert.ok(gotoDeclarationHandlers().some(handler => handler.id === 'demo.goto'))
    const filtered = await collectDeclarationTargets(at('src/no.ts', 0, 0))
    assert.deepEqual(filtered, [], 'accepts 不通过就不该问到它')
    const hits = await collectDeclarationTargets(at('src/yes.ts', 0, 0))
    assert.deepEqual(hits, [at('src/yes.ts', 3, 4)])
  } finally { handle.dispose() }
  assert.equal(unregisterGotoDeclarationHandler('demo.goto'), false, '已注销再注销返回 false')
  assert.ok(!gotoDeclarationHandlers().some(handler => handler.id === 'demo.goto'))
})

test('收全表 + 并宿主通道 + 去重；单条处理器抛错不影响其余', async () => {
  const a = registerGotoDeclarationHandler({
    id: 'demo.a', getGotoDeclarationTargets: () => [at('src/a.ts', 1, 1), at('src/a.ts', 2, 2)],
  })
  const boom = registerGotoDeclarationHandler({
    id: 'demo.boom', getGotoDeclarationTargets: () => { throw new Error('handler 挂了') },
  })
  const b = registerGotoDeclarationHandler({
    id: 'demo.b', getGotoDeclarationTargets: async () => [at('src/a.ts', 2, 2), at('src/b.ts', 5, 0)],
  })
  try {
    const merged = await collectDeclarationTargets(at('src/x.ts', 9, 9), [at('src/a.ts', 1, 1), at('src/c.ts', 7, 7)])
    assert.deepEqual(merged, [at('src/a.ts', 1, 1), at('src/a.ts', 2, 2), at('src/b.ts', 5, 0), at('src/c.ts', 7, 7)],
      'EP 顺序在前、宿主通道在最后；重复位置只留第一条')
  } finally { a.dispose(); boom.dispose(); b.dispose() }
  assert.deepEqual(dedupeDeclarationTargets([at('p', 0, 0), at('p', 0, 0), at('p', 0, 1)]), [at('p', 0, 0), at('p', 0, 1)])
})

test('宿主通道失败（语言服务未就绪）时仍返回处理器结果', async () => {
  const handle = registerGotoDeclarationHandler({
    id: 'demo.only', getGotoDeclarationTargets: () => [at('src/only.ts', 1, 0)],
  })
  try {
    const merged = await collectDeclarationTargets(at('src/x.ts', 0, 0), Promise.reject(new Error('lsp down')))
    assert.deepEqual(merged, [at('src/only.ts', 1, 0)])
  } finally { handle.dispose() }
})

test('呈现覆盖落到行上，differentNames = 名字不全相同', () => {
  const handle = registerGotoTargetPresentationProvider({
    id: 'demo.present', accepts: target => target.path === 'src/a.ts',
    getTargetPresentation: (target, differentNames) => (differentNames ? { name: `容器:${target.path}` } : null),
  })
  try {
    // 两条同名目标 ⇒ differentNames = false（上游 GotoTargetHandler.java:386 是 myNames.size() > 1）
    const sameNames = chooseTargetRows([at('src/a.ts', 0, 0), at('src/b.ts', 0, 0)],
      new Map([['src/a.ts', 'alpha'], ['src/b.ts', 'alpha']]))
    assert.equal(allTargetNamesEqual(sameNames), true)
    assert.equal(sameNames[0].name, 'alpha', '同名时 provider 返回 null ⇒ 不覆盖')
    // 不同名 ⇒ provider 覆盖第一段
    const different = chooseTargetRows([at('src/a.ts', 0, 0), at('src/b.ts', 0, 0)],
      new Map([['src/a.ts', 'alpha'], ['src/b.ts', 'beta']]))
    assert.equal(different[0].name, '容器:src/a.ts')
    assert.equal(different[1].name, 'beta', 'accepts 不通过的行不动')
    assert.equal(applyTargetPresentation(different[1], at('src/b.ts', 9, 9), false).name, 'beta', 'accepts 不通过 ⇒ 原样返回这一行')
    assert.equal(gotoTargetPresentation(at('src/b.ts', 0, 0), true), null)
  } finally { handle.dispose() }
  assert.equal(unregisterGotoTargetPresentationProvider('demo.present'), false)
  assert.equal(APPLICATION_SCOPE, 'application')
})
