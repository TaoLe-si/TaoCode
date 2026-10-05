// 重命名弹窗的名字校验规则 —— App.vue 的 `javaKeywords` + `invalidRenameName` computed 主体
// （原 490-500 行）2026-10-06 逐字搬入本文件。
//
// 为什么能搬：`(输入的名字, 当前名, 是不是 .java) => 一句问题描述或空串` 是纯规则；
// 「当前输入了什么 / 当前名是什么 / 活动文件是不是 Java」由装配根的 computed 取值后传入。
// IDEA's RenameInputValidator rejects names that are not identifiers before the
// dialog accepts OK; JDT would refuse them anyway.

/** Java 的关键字集合：命中即「不能作为标识符」。`record`/`sealed`/`var` 是受限标识符，上游同样拒。 */
export const JAVA_KEYWORDS = new Set(['abstract','assert','boolean','break','byte','case','catch','char','class','const','continue','default','do','double','else','enum','extends','final','finally','float','for','goto','if','implements','import','instanceof','int','interface','long','native','new','package','private','protected','public','return','short','static','strictfp','super','switch','synchronized','this','throw','throws','transient','try','void','volatile','while','record','sealed','var'])

/** 无效标识符的判据（原来 if 链的顺序与文案逐字保持）；返回空串表示没有要提示的问题。 */
export function renameNameProblem(name: string, current: string | null, isJavaFile: boolean): string {
  if (!name || current === null) return ''
  if (name === current) return '新名称与当前名称相同。'
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return `“${name}”不是有效的标识符：只能包含字母、数字、下划线和 $，且不能以数字开头。`
  if (isJavaFile && JAVA_KEYWORDS.has(name)) return `“${name}”是 Java 关键字，不能作为标识符。`
  return ''
}
