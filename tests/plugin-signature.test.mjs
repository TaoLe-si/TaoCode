// 插件签名判定与 bundled 登记（`src/pluginSignature.ts`）的判据 ——
// 上游 `PluginSignatureVerifier.kt` / `SignatureVerificationResult.kt` / `PluginUiModel.isBundled` 的
// 可移植一半（判定与登记；密码学验签本仓没有，如实记）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CUSTOM_REPOSITORY_SIGNATURE_CHECK_KEY,
  EMPTY_BUNDLED_REGISTRY,
  MARKETPLACE_SIGNATURE_CHECK_KEY,
  SIGNATURE_RESULT_LABELS,
  SIGNATURE_VERIFIER_AVAILABLE,
  declaredSignatureOf,
  isBundledPlugin,
  isBundledUpdate,
  signatureBlocksInstall,
  signatureCheckEnabled,
  signatureCheckKey,
  verifyPluginSignature,
} from '../src/pluginSignature.ts'

test('枚举四个值与上游逐字对齐（SignatureVerificationResult.kt:6-11），本仓多一个 UNKNOWN', () => {
  assert.deepEqual(Object.keys(SIGNATURE_RESULT_LABELS).sort(),
    ['INVALID_SIGNATURE', 'MISSING_SIGNATURE', 'SUCCESSFUL', 'UNKNOWN', 'WRONG_SIGNATURE'])
  assert.equal(SIGNATURE_RESULT_LABELS.SUCCESSFUL, '已签名且可信')
  assert.equal(SIGNATURE_RESULT_LABELS.MISSING_SIGNATURE, '未签名')
})

test('两个开关 key 照上游（PluginSignatureVerifier.kt:31-32）', () => {
  assert.equal(MARKETPLACE_SIGNATURE_CHECK_KEY, 'marketplace.certificate.signature.check')
  assert.equal(CUSTOM_REPOSITORY_SIGNATURE_CHECK_KEY, 'custom-repository.certificate.signature.check')
  assert.equal(signatureCheckKey(true), MARKETPLACE_SIGNATURE_CHECK_KEY)
  assert.equal(signatureCheckKey(false), CUSTOM_REPOSITORY_SIGNATURE_CHECK_KEY)
})

test('开关默认开；关着就放行（required=false）', () => {
  assert.equal(signatureCheckEnabled(true), true)
  assert.equal(signatureCheckEnabled(false, { customRepository: false }), false)
  const verdict = verifyPluginSignature({ isMarketplace: true, settings: { marketplace: false } })
  assert.equal(verdict.required, false)
  assert.match(verdict.message, /开关关着/)
})

test('本仓没有验签通道：开关开着也判「未校验」，且如实说明（不假成功）', () => {
  assert.equal(SIGNATURE_VERIFIER_AVAILABLE, false)
  const verdict = verifyPluginSignature({ isMarketplace: true, declaredSignature: 'sig' })
  assert.equal(verdict.required, true)
  assert.equal(verdict.result, 'UNKNOWN')
  assert.match(verdict.message, /没有验签通道/)
})

test('注入了验签器：无声明 ⇒ MISSING_SIGNATURE；有声明 ⇒ 用注入器的判定', () => {
  const missing = verifyPluginSignature({ isMarketplace: true, verifier: () => 'SUCCESSFUL' })
  assert.equal(missing.result, 'MISSING_SIGNATURE')
  const ok = verifyPluginSignature({ isMarketplace: true, declaredSignature: 'sig', verifier: () => 'SUCCESSFUL' })
  assert.equal(ok.result, 'SUCCESSFUL')
  const bad = verifyPluginSignature({ isMarketplace: false, declaredSignature: 'sig', verifier: () => 'WRONG_SIGNATURE' })
  assert.equal(bad.result, 'WRONG_SIGNATURE')
})

test('只有无效/不符才阻断安装（上游后台校验失败即拒绝）', () => {
  assert.equal(signatureBlocksInstall('INVALID_SIGNATURE'), true)
  assert.equal(signatureBlocksInstall('WRONG_SIGNATURE'), true)
  assert.equal(signatureBlocksInstall('MISSING_SIGNATURE'), false)
  assert.equal(signatureBlocksInstall('SUCCESSFUL'), false)
  assert.equal(signatureBlocksInstall('UNKNOWN'), false)
})

test('declaredSignatureOf：signature 优先，否则认 64 位十六进制 sha256，形状不对当没声明', () => {
  assert.equal(declaredSignatureOf({ id: 'a', file: 'a.zip', signature: ' abc ' }), 'abc')
  const digest = 'A'.repeat(64)
  assert.equal(declaredSignatureOf({ id: 'a', file: 'a.zip', sha256: digest }), `sha256:${'a'.repeat(64)}`)
  assert.equal(declaredSignatureOf({ id: 'a', file: 'a.zip', sha256: 'nothex' }), undefined)
  assert.equal(declaredSignatureOf({ id: 'a', file: 'a.zip' }), undefined)
})

test('bundled 登记：本仓空集 ⇒ 两个判定都为假（界面据此不渲染那两个过滤）', () => {
  assert.deepEqual(EMPTY_BUNDLED_REGISTRY, { bundledPluginIds: [], updatedBundledIds: [] })
  assert.equal(isBundledPlugin('x'), false)
  assert.equal(isBundledUpdate('x'), false)
  // 注入登记表后规则生效（宿主将来真有了 bundled 目录，不改 UI 就能接）。
  const registry = { bundledPluginIds: ['a'], updatedBundledIds: ['a'] }
  assert.equal(isBundledPlugin('a', registry), true)
  assert.equal(isBundledUpdate('a', registry), true)
  assert.equal(isBundledUpdate('b', registry), false)
})