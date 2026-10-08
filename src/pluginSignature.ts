// 插件签名的**判定与登记层** —— 上游 `PluginSignatureVerifier` 一族里可移植的那一半。
//
// 上游依据（逐条核过本机上游树）：
//   · `platform/platform-impl/src/com/intellij/ide/plugins/marketplace/PluginSignatureVerifier.kt`
//     `:22` `verify(descriptor, pluginFile, showAcceptDialog): Boolean`；
//     `:27-40` `verifyIfRequired(descriptor, pluginFile, isMarketplace, showAcceptDialog)`：
//       取开关 key（`marketplace.certificate.signature.check` / `custom-repository.certificate.signature.check`），
//       开关**关着就直接放行**（`return true`），服务不可用也放行并记 error。
//   · `.../marketplace/statistics/enums/SignatureVerificationResult.kt:6-11` 四个枚举：
//     `INVALID_SIGNATURE` / `MISSING_SIGNATURE` / `WRONG_SIGNATURE` / `SUCCESSFUL`。
//   · `platform/platform-impl/plugin-signature-verifier/src/.../PluginSignatureVerifierImpl.kt`
//     `:46-51` `verify`：把 `PluginCertificateStore.customTrustManager.certificates +
//     managedTrustedCertificates` 作为可信集合，按 `showAcceptDialog` 走前台/后台两条；
//     `:54-64` 后台那条：没有内置 CA、或 CA 被吊销 ⇒ **直接 false**（不问用户）；
//     `:73-83` 前台那条：同样几种情况交给 `processSignatureCheckerVerdict`（弹框让用户决定）。
//
// 本仓没有 zip 签名库、没有证书链、没有吊销列表（也没有网络去取 CRL），所以**不做密码学验签**：
// 这里落的是那层「**判定与登记**」—— 清单声明的签名/摘要与安装源类型（市场/自定义仓库）如何
// 合成一个 `SignatureVerificationResult`、开关关着时的放行、以及"哪些插件是可信来源"的登记表。
// 真正的验签由调用方注入（本仓没有实现，`verifySignature` 一律返回 `MISSING_SIGNATURE` 之外的
// `unknown`，见下面的 `SIGNATURE_VERIFIER_AVAILABLE`）。这是**如实的能力边界**，不是假控件：
// 界面据此显示「签名：未校验（本仓没有验签通道）」而不是画一个点了没反应的「验证签名」按钮。
//
// 纯逻辑，不 import bridge，可单测（`tests/plugin-signature.test.mjs`）。
import type { MarketplacePlugin } from './pluginMarket.ts'

/**
 * `SignatureVerificationResult.kt:6-11` 的四个枚举 —— 逐字对齐（大小写与拼写）。
 * 本仓另加 `UNKNOWN`（没有验签通道时的档，上游不会出现这一档，所以单独列出并注明）。
 */
export type SignatureVerificationResult =
  | 'INVALID_SIGNATURE'
  | 'MISSING_SIGNATURE'
  | 'WRONG_SIGNATURE'
  | 'SUCCESSFUL'
  /** 本仓独有：没有验签通道，无法判定（**不是**上游的枚举值，如实单列）。 */
  | 'UNKNOWN'

/** 两个开关的 key（`PluginSignatureVerifier.kt:31-32`）。 */
export const MARKETPLACE_SIGNATURE_CHECK_KEY = 'marketplace.certificate.signature.check'
export const CUSTOM_REPOSITORY_SIGNATURE_CHECK_KEY = 'custom-repository.certificate.signature.check'

/** 本仓没有 `marketplace-zip-signer`（`PluginSignatureVerifierImpl` 依赖的库）⇒ 恒为 false。 */
export const SIGNATURE_VERIFIER_AVAILABLE = false

/** 检查是否要跑：按安装源选 key（`PluginSignatureVerifier.kt:30-33`），开关关着就放行。 */
export function signatureCheckEnabled(isMarketplace: boolean, settings: { marketplace?: boolean; customRepository?: boolean } = {}): boolean {
  return isMarketplace ? (settings.marketplace ?? true) : (settings.customRepository ?? true)
}

/** 某个 key 的开关名（界面/诊断里显示用）。 */
export function signatureCheckKey(isMarketplace: boolean): string {
  return isMarketplace ? MARKETPLACE_SIGNATURE_CHECK_KEY : CUSTOM_REPOSITORY_SIGNATURE_CHECK_KEY
}

/**
 * `verifyIfRequired` 的**判定形状**（`:27-40`）：开关关着 ⇒ 放行（返回 `SUCCESSFUL` 之外的
 * 「不需要校验」这一档由 `required: false` 表达）；开关开着但没有验签通道 ⇒ `UNKNOWN`
 * （上游此时 `LOG.error(...)` 并**放行**，本仓如实记为"未校验"，界面照实说）。
 */
export interface SignatureVerdict {
  /** 这次到底要不要校验（开关 + 安装源）。 */
  required: boolean
  /** 判定结果。`required === false` 时是 `UNKNOWN`（没校验过）。 */
  result: SignatureVerificationResult
  /** 界面/日志里的一句话（上游是 `LOG.error` 或弹框文案）。 */
  message: string
}

/** 上游那句 error（`PluginSignatureVerifier.kt:37`）。 */
export const SIGNATURE_VERIFIER_MISSING = 'intellij.platform.ide.pluginSignatureVerifier is not loaded'

export function verifyPluginSignature(input: {
  isMarketplace: boolean
  /** 清单/包声明的签名信息（有签名文件才有值；本仓从清单读 `signature`/`sha256` 两个可选字段）。 */
  declaredSignature?: string
  /** 注入的验签器（本仓没有实现 ⇒ 不传即视为无通道）。 */
  verifier?: (declared: string) => SignatureVerificationResult
  settings?: { marketplace?: boolean; customRepository?: boolean }
}): SignatureVerdict {
  if (!signatureCheckEnabled(input.isMarketplace, input.settings))
    return { required: false, result: 'UNKNOWN', message: '签名校验开关关着，不校验（PluginSignatureVerifier.kt:30-33）。' }
  if (!input.verifier)
    return { required: true, result: 'UNKNOWN', message: `没有验签通道（${SIGNATURE_VERIFIER_MISSING}）；本仓不做密码学验签。` }
  if (!input.declaredSignature)
    return { required: true, result: 'MISSING_SIGNATURE', message: '插件包没有声明签名。' }
  return { required: true, result: input.verifier(input.declaredSignature), message: '已按注入的验签器判定。' }
}

/** 判定结果 → 用户可见的一句话（界面上的「签名」行）。 */
export const SIGNATURE_RESULT_LABELS: Record<SignatureVerificationResult, string> = {
  SUCCESSFUL: '已签名且可信',
  MISSING_SIGNATURE: '未签名',
  INVALID_SIGNATURE: '签名无效',
  WRONG_SIGNATURE: '签名与插件不符',
  UNKNOWN: '未校验',
}

/** 该结果是否阻断安装（上游：后台校验失败即拒绝；前台交给用户确认）。 */
export function signatureBlocksInstall(result: SignatureVerificationResult): boolean {
  return result === 'INVALID_SIGNATURE' || result === 'WRONG_SIGNATURE'
}

/* ── 「随应用一起发布」的那一层（bundled）──────────────────────────────────────── */

/**
 * 上游 `newui/PluginUiModel.kt:34` 的 `isBundled`（插件随 IDE 一起发布）与 `:146` 的
 * `isBundledUpdate`（内置插件被更新过）；界面消费点在
 * `platform/platform-impl/src/com/intellij/ide/plugins/InstalledPluginsTabSearchResultPanel.kt:133-145`
 * 的 `/bundled`、`/updatedBundled` 两个过滤。
 *
 * 本仓插件全部来自用户配置目录（`native/main.cpp` 的 `plugin.*` 只扫一个目录），**没有** IDE 自带
 * 那一层 —— 所以这里不给 `bundled` 造假数据，而是把「这批插件里哪些算 bundled」落成**可注入的
 * 登记表**：宿主将来真有了 bundled 目录，往 `bundledPluginIds` 里填 id 即可，界面按同一份规则
 * 过滤，不需要改 UI。当前调用方传空表 ⇒ 两个过滤都空（界面据此仍不渲染那两个按钮）。
 */
export interface BundledRegistry {
  /** 随应用一起发布的插件 id（本仓当前恒为空集）。 */
  bundledPluginIds: readonly string[]
  /** 被更新过的内置插件 id（上游 `isBundledUpdate`：内置但当前装的是市场版）。 */
  updatedBundledIds: readonly string[]
}

export const EMPTY_BUNDLED_REGISTRY: BundledRegistry = { bundledPluginIds: [], updatedBundledIds: [] }

export function isBundledPlugin(pluginId: string, registry: BundledRegistry = EMPTY_BUNDLED_REGISTRY): boolean {
  return registry.bundledPluginIds.includes(pluginId)
}

export function isBundledUpdate(pluginId: string, registry: BundledRegistry = EMPTY_BUNDLED_REGISTRY): boolean {
  return isBundledPlugin(pluginId, registry) && registry.updatedBundledIds.includes(pluginId)
}

/**
 * 清单里读签名/摘要：市场条目可带 `signature`（base64 签名）或 `sha256`（摘要十六进制）。
 * 两者都没有 ⇒ undefined（`verifyPluginSignature` 据此给 `MISSING_SIGNATURE`）。
 * 本仓的本地仓库清单是用户文件，这里只做**形状校验**（非空字符串），不做密码学校验。
 */
export function declaredSignatureOf(entry: Pick<MarketplacePlugin, 'id' | 'file'> & { signature?: string; sha256?: string }): string | undefined {
  const signature = (entry.signature ?? '').trim()
  if (signature) return signature
  const digest = (entry.sha256 ?? '').trim()
  // sha256 的十六进制形态（64 位）；不合形状就当没声明（不猜）。
  return /^[0-9a-fA-F]{64}$/.test(digest) ? `sha256:${digest.toLowerCase()}` : undefined
}