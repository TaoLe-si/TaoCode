// 文件改名/移动的**目标冲突**与引用编辑的账（上游 `RenameProcessor` + `Messages`/`SkipOverwriteChoice` 一族）。
//
// 上游逐条（参考树 `D:/Backup/Downloads/intellij-community-master/intellij-community-master`）：
//   · `platform/lang-impl/src/com/intellij/refactoring/copy/CopyFilesOrDirectoriesHandler.java:543-571`
//     —— `checkFileExist`：`:545` `targetDirectory.findFile(name)`（逐字比名字）、`:546` 命中且不是自己才算冲突、
//     `:549` 弹 `SkipOverwriteChoice.askUser(...)`、`:560-567` 选「覆盖」才删占位文件、否则返回 true；
//   · `platform/lang-impl/src/com/intellij/refactoring/SkipOverwriteChoice.java:42-52`
//     —— `:47` 消息键 `dialog.message.file.already.exists.in.directory`、`:49` 默认项 index 0（覆盖）、
//     `:50` **关闭对话框 = SKIP**；
//   · `platform/lang-impl/src/com/intellij/refactoring/rename/RenameProcessor.java:230-237`
//     —— 改名集合里的一个 `PsiFile` 撞上 `checkFileExist(...) == true`（`:232-233`）就
//     `iterator.remove()`（`:234`）+ `continue`（`:235`）
//     ⇒ 该条目**什么都不做**；
//   · `platform/refactoring/resources/messages/RefactoringBundle.properties:492`
//     `dialog.message.file.already.exists.in.directory=File ''{0}'' already exists in directory ''{1}''`；
//   · 落地改名那一层自己的守卫（比上面那条更硬的出处，`renameclose` 补）：
//     `platform/platform-impl/src/com/intellij/openapi/vfs/impl/local/LocalFileSystemBase.java:528-543`
//     —— `:540` `sameName = !file.isCaseSensitive() && newName.equalsIgnoreCase(file.getName())`
//     把「纯改自己名字的大小写」显式列为**放行**那一档；`:541-542` 不是纯改大小写、而
//     `parent.findChild(newName) != null` 时抛 `vfs.target.already.exists.error`
//     （`platform/ide-core/resources/messages/IdeCoreBundle.properties:60`）。
//     宿主档位：`LocalFileSystemBase.java:431-433` `isCaseSensitive() = SystemInfo.isFileSystemCaseSensitive`
//     `= !isWindows && !isOS2 && !isMac`（`SystemInfo.java:11`）⇒ **Windows 是大小写不敏感的**；
//     同口径注释见 `platform/core-api/src/com/intellij/openapi/vfs/VirtualFile.java:725-731`。
//     ⇒ 上游比名字**不是无条件的「逐字比」，而是按宿主的大小写档位比**；本仓清单那一层取的是「逐字」这一档。
//   · 引用编辑的账：`RenameProcessor.preprocessUsages`（`:166-188`）有冲突就 `return false`，
//     一次写入都不发生；本仓对位的纯函数是 `renamePreviewOf`（重复编辑并掉、互相覆盖的整批放弃）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renameConflictMessage, renamePreviewOf, renameTargetConflict, renameTargetConflictMessage, renameUsageSummary } from '../src/renamePreview.ts'

const here = dirname(fileURLToPath(import.meta.url))
const read = name => readFileSync(join(here, '..', 'src', name), 'utf8')
const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'

/** 上游锚点：`checkFileExist` 与 `RenameProcessor` 那几行仍是判词说的样子。 */
test('上游锚点：目标占位的四选一与「跳过 ⇒ 从改名集合里 remove」仍在原行号', (t, done) => {
  const handler = join(REF, 'platform/lang-impl/src/com/intellij/refactoring/copy/CopyFilesOrDirectoriesHandler.java')
  const choice = join(REF, 'platform/lang-impl/src/com/intellij/refactoring/SkipOverwriteChoice.java')
  const processor = join(REF, 'platform/lang-impl/src/com/intellij/refactoring/rename/RenameProcessor.java')
  // 参考树不在本机 ⇒ 按本仓惯例跳过（与 `tests/source-citations.test.mjs` 同口径）。
  // 但下面 9 条锚点全在这次 return 之后：静默绿就是假绿 ⇒ 跳过得留声，让空过在输出里看得见。
  if (!existsSync(handler) || !existsSync(choice) || !existsSync(processor)) {
    const missing = [handler, choice, processor].filter(path => !existsSync(path))
    t.diagnostic(`SKIP 上游锚点（参考树不在本机）：${missing.join(' | ')}`)
    return done()
  }
  const at = path => readFileSync(path, 'utf8').split('\n')
  const copy = at(handler)
  assert.match(copy[542], /public static boolean checkFileExist\(/, ':543')
  assert.match(copy[544], /targetDirectory\.findFile\(name\)/, ':545')
  assert.match(copy[548], /SkipOverwriteChoice\.askUser/, ':549')
  assert.match(copy[565], /return true;/, ':566 非覆盖 ⇒ true（跳过）')
  const skip = at(choice)
  assert.match(skip[46], /dialog\.message\.file\.already\.exists\.in\.directory/, ':47')
  assert.match(skip[49], /if \(selection < 0\) return SKIP;/, ':50 取消 = SKIP')
  const rename = at(processor)
  assert.match(rename[231], /CopyFilesOrDirectoriesHandler\.checkFileExist/, ':232 只有 checkFileExist 返回 true 才拦')
  // 订正留痕（2026-10-06 refactorclose，坐标自己开的 `awk NR` 逐行核）：这一条原先断 `rename[234]`
  // （= 第 235 行）含 `iterator.remove()` —— 实测 `:234` 才是 `iterator.remove();`，`:235` 是它下面的
  // `continue;`（`:232-233` 是那个跨行的 `if (CopyFilesOrDirectoriesHandler.checkFileExist(...))`）。
  // 红的是**判据自己的行号**，上游源码没动 ⇒ 改成钉 `:234`，并把 `:235` 也钉住：两行都逐字符位置判定，
  // 上游那一族往上/往下挪一行都会红，没有放松成「文件里找得到」。
  assert.match(rename[233], /iterator\.remove\(\)/, ':234 跳过 = 这个条目不进改名集合')
  assert.match(rename[234], /continue;/, ':235 并且不再对它做后面的 checkRename')
  done()
})

// ---------------------------------------------------------------- renameTargetConflict

const ENTRIES = [
  { path: 'src/a.ts', kind: 'file' },
  { path: 'src/b.ts', kind: 'file' },
  { path: 'src/dir', kind: 'directory' },
  { path: 'src/A.ts', kind: 'file' },
]

test('renameTargetConflict：目标没人占位 ⇒ null（无冲突那条边界）', () => {
  assert.equal(renameTargetConflict('src/a.ts', 'src/c.ts', ENTRIES), null)
})

test('renameTargetConflict：改回自己的名字不算冲突（上游 :546 的 !existing.equals(file)）', () => {
  assert.equal(renameTargetConflict('src/a.ts', 'src/a.ts', ENTRIES), null)
  assert.equal(renameTargetConflict('src/a.ts', 'src/a.ts', [{ path: 'src/a.ts', kind: 'file' }]), null)
})

test('renameTargetConflict：同名文件占位 ⇒ 报出占位条目，不改名', () => {
  const conflict = renameTargetConflict('src/a.ts', 'src/b.ts', ENTRIES)
  assert.deepEqual(conflict, { path: 'src/b.ts', name: 'b.ts', kind: 'file' })
  const message = renameTargetConflictMessage(conflict, 'src/a.ts')
  assert.match(message, /重命名未执行/)
  assert.match(message, /同名文件「b\.ts」/)
  assert.match(message, /改名与引用更新都没有落盘/)
})

test('renameTargetConflict：目录占位时提示给的是「同名的文件夹」', () => {
  const conflict = renameTargetConflict('src/a.ts', 'src/dir', ENTRIES)
  assert.equal(conflict.kind, 'directory')
  assert.match(renameTargetConflictMessage(conflict, 'src/a.ts'), /同名的文件夹「dir」/)
})

test('renameTargetConflict：路径逐字比 —— 目标被**另一个**条目占着就是冲突，纯改大小写不是', () => {
  // 订正留痕（2026-10-06 refactorclose）：这一条原先写
  // `assert.equal(renameTargetConflict('src/a.ts', 'src/A.ts', ENTRIES), null)`，标题是
  // 「大小写不同不算冲突（上游 findFile 也是逐字）」—— 两个说法都对不上，是**判据写反**：
  //   · 「逐字比」在实现里就是 `entry.path === to`（`src/renamePreview.ts` 的 `renameTargetConflict`），
  //     而 `ENTRIES` 里 `src/A.ts` 是**另一条**条目 ⇒ 逐字比的结果是**相等**、不是「不同」；
  //   · 上游 `CopyFilesOrDirectoriesHandler.java:545-546` `existing = targetDirectory.findFile(name)`
  //     + `existing != null && !existing.equals(file)` ⇒ 目标位站着另一个文件就是冲突，
  //     `iterator.remove()`（`:234`）把它从改名集合里去掉，什么都不做。
  // ⇒ 按上游改回正确的一侧，并**加**两条真边界（ assertion 数量 2 → 3，没有放松）。
  assert.deepEqual(renameTargetConflict('src/a.ts', 'src/A.ts', ENTRIES),
    { path: 'src/A.ts', name: 'A.ts', kind: 'file' }, '清单里有另一个 src/A.ts ⇒ 目标已被占用')
  // 真「纯改大小写」：清单里只有源文件自己 ⇒ findFile 命中的就是它自己 ⇒ 上游 `!existing.equals(file)` 为假
  // ⇒ 不算冲突（改名照做）。这一条才是标题想表达的那件事。
  assert.equal(renameTargetConflict('src/a.ts', 'src/A.ts', [{ path: 'src/a.ts', kind: 'file' }]), null)
  // 逐字比的另一侧：清单里只有小写 `src/b.ts`，目标写成 `src/B.ts` ⇒ **清单这一层**不判冲突。
  // 引的是实现里那句原文（`src/renamePreview.ts:248` 「不做大小写归一」）—— 这条注释原先引的是
  // 「不比大小写」，那五个字在 `src/` 里逐字不存在 ⇒ 死引用，按盘上原文订正。
  // 说实话的一侧（`renameclose` 补，出处见文件头）：放行只到清单这一层为止，不等于"这台机器不会撞"。
  // Windows 是大小写不敏感的（`SystemInfo.java:11`），落地改名那一层
  // （`LocalFileSystemBase.java:540-542`）只在「纯改自己名字的大小写」时放行，其余 `findChild` 命中即抛
  // `vfs.target.already.exists.error` ⇒ 这一档要真拦得靠宿主那一层（`native/main.cpp` 的 `file.rename`，
  // 不在本 lane 名下），已作为请求写进 `docs/wiring-requests-2026-10-06-renameclose.md`。
  // 下面这条断言钉的是本仓这一层的既有契约（逐字比），**没有**替宿主那一档放行开口子：
  // 把实现改成 `equalsIgnoreCase` 就会红（见 wiring-requests 里的反向验证）。
  assert.equal(renameTargetConflict('src/a.ts', 'src/B.ts', ENTRIES), null)
})

test('renameTargetConflict：清单为空（没有工作区）时不拦 —— 不拿猜不到的东西当证据', () => {
  assert.equal(renameTargetConflict('src/a.ts', 'src/b.ts', []), null)
  assert.equal(renameTargetConflict('', 'src/b.ts', ENTRIES), null)
  assert.equal(renameTargetConflict('src/a.ts', '', ENTRIES), null)
})

// ---------------------------------------------------------------- 引用编辑的账（与符号重命名同一份）

test('renamePreviewOf：跨文件重复编辑并掉、账目按去重后的数', () => {
  const preview = renamePreviewOf([
    { path: 'src/x.ts', textEdits: [
      { text: 'beta', startLine: 0, startChar: 0, endLine: 0, endChar: 4 },
      { text: 'beta', startLine: 0, startChar: 0, endLine: 0, endChar: 4 },
      { text: 'beta', startLine: 5, startChar: 2, endLine: 5, endChar: 6 },
    ] },
    { path: 'src/y.ts', textEdits: [{ text: 'beta', startLine: 1, startChar: 0, endLine: 1, endChar: 4 }] },
  ])
  assert.equal(preview.usageCount, 3)
  assert.equal(preview.files, 2)
  assert.equal(preview.conflicts.length, 0)
  assert.equal(renameUsageSummary(preview), '共 3 处')
})

test('renamePreviewOf：跨文件的重叠编辑各自记在自己那个文件里（有冲突那条）', () => {
  const preview = renamePreviewOf([
    { path: 'src/x.ts', textEdits: [
      { text: 'a', startLine: 0, startChar: 0, endLine: 0, endChar: 6 },
      { text: 'b', startLine: 0, startChar: 3, endLine: 0, endChar: 9 },
    ] },
    { path: 'src/y.ts', textEdits: [
      { text: 'a', startLine: 2, startChar: 0, endLine: 2, endChar: 5 },
      { text: 'b', startLine: 2, startChar: 1, endLine: 2, endChar: 4 },
    ] },
  ])
  assert.equal(preview.conflicts.length, 2)
  assert.deepEqual(preview.conflicts.map(item => item.path), ['src/x.ts', 'src/y.ts'])
  assert.match(renameConflictMessage(preview), /src\/x\.ts 第 1 行有 2 处互相覆盖的编辑/)
})

// ---------------------------------------------------------------- 接线：两条拦下都在 file.rename 之前

test('接线：renameEntryWithReferences 先判目标占位、再判编辑冲突，才落到 file.rename', () => {
  const source = read('semanticActions.ts')
  const body = source.slice(source.indexOf('async function renameEntryWithReferences'))
  assert.ok(body.length > 0, '找不到 renameEntryWithReferences')
  const atConflict = body.indexOf('renameTargetConflict(from, to, workspace()?.entries ?? [])')
  const atPreview = body.indexOf('const preview = renamePreviewOf(referenceEdits)')
  const atRename = body.indexOf("await request('file.rename', { from, to })")
  assert.ok(atConflict >= 0 && atPreview > atConflict && atRename > atPreview,
    '拦下必须在改名之前：改名一旦落地就把旧路径吃掉了，回不去')
  assert.match(body, /if \(conflict\) \{ notify\(renameTargetConflictMessage\(conflict, from\), true\); return \}/)
  assert.match(body, /if \(preview\.conflicts\.length\) \{ notify\(renameConflictMessage\(preview\), true\); return \}/)
  // 落盘用的是**去过重**的那一份，并把账目写进提示
  assert.match(body, /applyEditsToFiles\(preview\.edits, `已更新 \$\{baseName\(from\)\} 的引用（\$\{renameUsageSummary\(preview\)\}）`\)/)
  assert.equal(body.includes('applyEditsToFiles(referenceEdits'), false, '不许再直接落服务器原样的那一份编辑')
})

test('接线：renamePreview.ts 的 import 里带着这两个新出口', () => {
  const source = read('semanticActions.ts')
  assert.match(source, /import \{ mergePreviewEdits,[\s\S]*?renameTargetConflict, renameTargetConflictMessage,[\s\S]*?\} from '\.\/renamePreview\.ts'/)
})

test('接线：树侧改名与剪切粘贴都走这一个入口（不出现第二个改名实现）', () => {
  assert.match(read('explorerActions.ts'), /await renameEntryWithReferences\(clip\.entry\.path, destination\)/)
  const dependency = read('bridge.ts')
  assert.ok(dependency.includes("'file.rename'"), 'file.rename 仍然是唯一的改名通道')
})
