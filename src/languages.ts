// TaoCode 能高亮/索引的语言集合。
//
// 单独成一个**零依赖**模块，是因为它同时被 `bridge.ts`（编辑器设置的语言表）与
// `fileTypes.ts`（文件类型关联校验）使用，而 `fileTypes.ts` 要被 `node --test` 直接
// 以 .ts 载入 —— Node 的 ESM 解析不做扩展名推断，所以这里用 **带扩展名的相对导入**
// （tsconfig 已开 `allowImportingTsExtensions`）。放在 bridge.ts 里会让纯函数模块
// 依赖整个桥接层（含 vue），测试与打包都会变重。
export const EDITOR_LANGUAGES = ['java', 'cpp', 'typescript', 'other'] as const
