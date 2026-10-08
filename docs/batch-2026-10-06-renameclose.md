# batch 2026-10-06 renameclose

范围：判清 `tests/rename-file-conflict.test.mjs` 那 2 条红的归属并修对的一侧。
名下：`tests/rename-file-conflict.test.mjs`、`tests/rename*.test.mjs`、`src/renamePreview.ts`（条件见 §0）。

## 0. 接手实况

- `node --test tests/rename*.test.mjs`（刚返回的交接说这 2 条红）：
  ```
  ℹ tests 33
  ℹ pass 33
  ℹ fail 0
  ```
  ⇒ **当场全绿**，交接口径里"第 45 行 / 第 83 行两条红"在盘上不复现。
- `git status --porcelain`：工作区大面积 M（19 路并发），`src/renamePreview.ts` 未出现在起始快照的前 40 行内，见下 mtime。
- `stat src/renamePreview.ts`：`mtime=2026-10-06 16:55:13.784100100 +0800 size=14990`，采样时刻 `16:55:28` ⇒ **该文件在我第一次读之前 15 秒刚被人写过**，符合"`refactorclose` 正在收口 `src/renamePreview.ts`"的告警。
- 待第二次 stat 复核后才决定是否可写。

（逐条裁定见 §1，落盘见 §2。）

## 1. 逐条裁定

### 结论先说：那 2 条红**在本 lane 接手前已被 `refactorclose` 改掉并落在盘上**，且两侧都改对了方向

判据：`tests/rename-file-conflict.test.mjs` 是**未跟踪新文件**（`git status --porcelain` ⇒ `??`），里面带着两处
「订正留痕（2026-10-06 refactorclose）」注释（`:46-50`、`:90-98`）；`src/renamePreview.ts` 的
`renameTargetConflict` 整块是**未提交的 +60 行**（`git diff --stat` ⇒ `src/renamePreview.ts | 60 +`，diff 从
`:227` 之后全为新增）。⇒ 交接给的坐标（第 45 行、第 83 行）对的是**改之前**的形状。

### 1.1 第 45 行那条（上游锚点行号）= 过时形状，且**新的形状经我自己开参考树逐行核实为精确**

交接说「`rename[234]` 期望 `/iterator\.remove\(\)/`，实测在 233 ⇒ 0 基/1 基差 1」。我按 1 基逐行打印核对：

```
$ awk 'NR>=226 && NR<=240 {printf "%d|%s\n", NR, $0}' \
    $REF/platform/lang-impl/src/com/intellij/refactoring/rename/RenameProcessor.java
232|          if (CopyFilesOrDirectoriesHandler.checkFileExist(containingDirectory, choice, psiFile, entry.getValue(),
233|                                                           RefactoringBundle.message("command.name.rename"))) {
234|            iterator.remove();
235|            continue;
```

⇒ 0 基下标 233 = 第 234 行 = `iterator.remove();`。现判据 `tests/rename-file-conflict.test.mjs:51` 钉的正是
`rename[233]` ⇒ **对**；交接说的「233」是它自己把 0 基下标当成 1 基行号读了一遍（同一处歧义，反方向）。
其余锚点同样逐条开树核对，全对：

| 判据 | 断言 | 实测（1 基） | 结论 |
|---|---|---|---|
| `:37` `copy[542]` | `public static boolean checkFileExist(` | 543 ✓ | 对 |
| `:38` `copy[544]` | `targetDirectory.findFile(name)` | 545 ✓ | 对 |
| `:39` `copy[548]` | `SkipOverwriteChoice.askUser` | 549 ✓ | 对 |
| `:40` `copy[565]` | `return true;` | 566 ✓ | 对 |
| `:42` `skip[46]` | `dialog.message.file.already.exists.in.directory` | 47 ✓ | 对 |
| `:43` `skip[49]` | `if (selection < 0) return SKIP;` | 50 ✓ | 对 |
| `:45` `rename[231]` | `CopyFilesOrDirectoriesHandler.checkFileExist` | 232 ✓ | 对 |
| `:51` `rename[233]` | `iterator.remove()` | 234 ✓ | 对 |
| `:52` `rename[234]` | `continue;` | 235 ✓ | 对 |

⇒ 性质：**判据自己过时**（行号漂移），不是实现缺陷。且新形式没放松：`:232/:234/:235` 三行各自逐字符定位，
上游那一族上下挪一行都会红。见 §3 的反向验证。

### 1.2 第 83 行那条 = **判据写反**（实现是对的），我另补了一条比现判据更强的上游出处

原断言：`renameTargetConflict('src/a.ts', 'src/A.ts', ENTRIES)` 期望 `null`，而 `ENTRIES`（`:58-63`）里
**同时**有 `src/a.ts` 和 `src/A.ts` 两条 ⇒ 目标位站着**另一个**条目。

- 可能性 ①（实现缺校验）：不成立。上游 `CopyFilesOrDirectoriesHandler.java:545-546`（我逐行核实）
  ```
  545|    final PsiFile existing = targetDirectory.findFile(name);
  546|    if (existing != null && !existing.equals(file)) {
  ```
  + 调用方 `RenameProcessor.java:234` `iterator.remove()` ⇒ 目标被**别的**条目占着就是冲突、该条目什么都不做。
  「Windows 上 `a.ts`→`A.ts` 等于没改 / 会撞自己」这个前提在 `ENTRIES` 里不成立：命中的不是自己。
- 可能性 ②（上游允许纯改大小写以纠正显示名）：**成立**，判据正是把这一档和上一档混成了一条。
  上游最硬的一条出处不是 `checkFileExist`，而是落地改名那一层自己的守卫 ——
  `platform/platform-impl/src/com/intellij/openapi/vfs/impl/local/LocalFileSystemBase.java:528-543`：
  ```
  540|    var sameName = !file.isCaseSensitive() && newName.equalsIgnoreCase(file.getName());
  541|    if (!sameName && parent.findChild(newName) != null) {
  542|      throw new IOException(IdeCoreBundle.message("vfs.target.already.exists.error", parent.getPath() + '/' + newName));
  ```
  ⇒ 上游**显式**把「大小写不同的同名改名」（`sameName`）列为放行的一档，其余目标已存在则抛错。
  宿主档位：`LocalFileSystemBase.java:431-433` `isCaseSensitive() = SystemInfo.isFileSystemCaseSensitive`，
  而 `build/jvm-rules/jps-builders-6/src/org/jetbrains/jps/util/SystemInfo.java:11`
  `isFileSystemCaseSensitive = !isWindows && !isOS2 && !isMac` ⇒ **Windows 为假**；
  同口径见 `platform/core-api/src/com/intellij/openapi/vfs/VirtualFile.java:725-731`（NTFS 要
  `fsutil.exe file setCaseSensitiveInfo` 才大小写敏感）。
  消息键出处：`platform/ide-core/resources/messages/IdeCoreBundle.properties:60`
  `vfs.target.already.exists.error=''{0}'' already exists in VFS`。
- 现判据（`:99-106` 三条）逐条对上游复核：
  1. `src/a.ts`→`src/A.ts`、清单另有 `src/A.ts` ⇒ 期望**冲突** ✓ 对 `:545-546`（`existing != file`）。
  2. `src/a.ts`→`src/A.ts`、清单只有 `src/a.ts` ⇒ 期望 `null` ✓ **两种读法都放行**：
     大小写敏感 ⇒ `findFile` 返回 null；大小写不敏感 ⇒ 命中的就是自己、被 `!existing.equals(file)` 放行，
     且 `LocalFileSystemBase.java:540` 的 `sameName` 也放行。这条是整组里最稳的。
  3. `src/a.ts`→`src/B.ts`、清单只有小写 `src/b.ts` ⇒ 期望 `null`。⇒ **见 §5/§6：这条只在「清单比对」这一层成立**，
     在大小写不敏感的宿主上上游 `LocalFileSystemBase.java:541-542` 会抛 `already exists`；本仓要真拦得靠
     `native/main.cpp` 的 `file.rename`（本 lane 禁写）。已作为请求交主代理，不当场改别人的文件。
- 断言数 2 → 3，是**收紧**不是放松 ⇒ 不违反判据纪律。

### 1.3 `src/renamePreview.ts:248` 的「自相矛盾」注释：盘上已不自相矛盾，**不需要我改**

现文（`src/renamePreview.ts:248-251`）：
```
248| *   · `:545` `targetDirectory.findFile(name)` —— **按名字逐字比**（不做大小写归一，本仓同口径：
249| *     路径原样相等才算「同一个条目」）；
250| *   · `:546` 命中且不是它自己才算冲突（`existing != null && !existing.equals(file)`）
251| *     ⇒ 目标位站着**另一个**文件就是冲突；只有「改的就是自己那一份」（纯改大小写的改名）才放行；
```
⇒ 「逐字比」与「不做大小写归一」是同一件事的两种说法、不再互斥，`:251` 也已是说实话的那一句。
交接说的互斥表述对的是**改之前**的版本。残留问题只剩一个：`:248` 把上游说成"逐字比"，而上游其实是
**按宿主档位**（`isCaseSensitive()`）比，见 §1.2 ⇒ 记为请求（§6），不在别人的在飞文件上动刀。

## 2. 落盘

### 2.1 写过的文件（只有一个，且在名下）

`tests/rename-file-conflict.test.mjs` —— 三处，**全部是注释/可见性，一条断言都没动、没加没删**：

1. **文件头补最硬的上游出处**（`:14` 之后插 11 行）：原头只引到 `checkFileExist` 那一层，缺
   `LocalFileSystemBase.java:528-543`（落地改名自己的守卫，`sameName` 放行档 + `already exists` 抛错档）、
   `SystemInfo.java:11`、`VirtualFile.java:725-731`、`IdeCoreBundle.properties:60`。
2. **`:34` 参考树不在本机时的静默空过改成留声**：`return done()` ⇒ 打 `t.diagnostic` 列出缺哪几个文件。
   保持本仓"不在本机就跳过"的既有惯例（`tests/format-post-ranges.test.mjs:32`、
   `tests/file-type-ignored-list.test.mjs:180` 等同口径），不改判绿改判红；但 9 条锚点全在这次 return
   之后，静默绿就是假绿 ⇒ 让它在输出里看得见。
3. **`:121` 死引用订正**：这条注释原先写「`renamePreview.ts` 模块头上**「不比大小写」**就是这一条」，
   而 `grep -rn "不比大小写" src/` = **0 命中**（盘上原文是 `src/renamePreview.ts:248` 的「不做大小写归一」）
   ⇒ 引了一句逐字不存在的话。改成引原文 + 行号，并把"放行只到清单这一层为止"说实话（§1.2 的第 3 条）。

未写：`src/renamePreview.ts`（§1.3 的理由 + §6 交逐字 old/new）、`native/main.cpp`（禁写）、
`src/semanticActions.ts`（refactorclose 在飞）。

### 2.2 `src/renamePreview.ts` 归属自查（三次 stat，全程未写）

```
16:55:28  mtime=2026-10-06 16:55:13.784100100  size=14990  sha1=b3dd07eb4be68288eaca38cf7d668a52eac3e89e
16:56:16  mtime=2026-10-06 16:55:13.784100100  size=14990
17:06:39  mtime=2026-10-06 16:55:13.784100100  size=14990  sha1=b3dd07eb4be68288eaca38cf7d668a52eac3e89e
```
⇒ 我两次读之间没变（写它是允许的），**但我仍选择不写**：判据给的动因（`:248` 自相矛盾）在盘上已经不成立
（§1.3），剩下的那一寸实话依赖"大小写那一档到底拦不拦"这个**尚未裁定**的设计决定 —— 它同时牵着
`native/main.cpp`（本 lane 禁写）与 refactorclose 的收口。把注释改成先替他们选边的"实话"，本身就是新的假话。
⇒ 连逐字 old/new 一起交出去（§6）。

## 3. 判据与反向验证（前缀 `RENAMECLOSE`，已全部还原并核过）

| # | 注入的变异 | 期望 | 实测 |
|---|---|---|---|
| V1a | `tests/…:67` 锚点下标 `rename[233]`→`rename[232]` | 红 | **fail 1**，`actual: '…RefactoringBundle.message("command.name.rename"))) {', expected: /iterator\.remove\(\)/` ⇒ 命中的是 `:233` 那行续行，锚点**活着**、且挪一行就红 |
| V1b | 还原 V1a | 逐字节一致 | `cmp` 无输出、sha1 回到 `b7c0c3fd…` |
| V2 | 把 `:34` 的守卫短路成 `if (true \|\| …)` | 诊断必须真的打印出来（否则新增的是死代码） | 输出 `ℹ SKIP 上游锚点（参考树不在本机）：` ⇒ 分支可达；随后 `cmp` 还原一致 |
| V3 | 整份 `renameTargetConflict` 三条断言各注入一次（在 `build/` 一次性副本里做，**不脏 live 文件**） | 每条各红 1 | `base 12/12 绿`；`mutA 11 pass / 1 fail`、`mutB 11/1`、`mutC 11/1` ⇒ **三条断言都吃得到实现，没有一条空过** |
| V4 | 实现侧变异：`entry.path === to` 改成 `…toLowerCase() === to.toLowerCase()`（= 忽略大小写那一读法），跑在临时副本上 | 看哪几条断言钉得住 | A `{"src/A.ts"}`→同（SAME）、B `null`→`null`（SAME）、**C `null`→`{"src/b.ts"}` FLIPPED** ⇒ §2.1 第 3 条注释里"改成 equalsIgnoreCase 就会红"这句**只对断言 C 成立**，注释也正是挂在 C 上，没夸大 |
| V5 | 实现侧变异：删掉 `src/renamePreview.ts:271` 的 `&& entry.path !== from` 整句 | 若无人红 = 该句不可达 | **12/12 仍全绿** ⇒ 该句确实不可达（只能与 `entry.path === to` 同时成立，那时 `to === from`，已被 `:270` 的 `from === to` 提前 return）。⇒ 交请求（§6.3），不在别人文件上动刀 |

残留核查：
```
$ rm -rf build/rc-scratch /tmp/rc
$ grep -rn "RENAMECLOSE" src/ tests/ native/ | wc -l
0
```

## 4. 门禁原始数字

```
$ node --test tests/rename*.test.mjs tests/refactor*.test.mjs tests/module-size.test.mjs
  ℹ tests 127   ℹ pass 126   ℹ fail 1
  ✖ 已登记的 native 大文件不许继续变大
    actual: ['native/workspace.cpp 现在 1482 行 > 上限 1385 …']   expected: []
  —— 这条红**不归本 lane**：同一命令在本 lane 接手时（约 16:58）是 127/127 全绿；
     `stat native/workspace.cpp` ⇒ mtime=17:02:47（在我两次门跑之间被并发写入），`wc -l` = 1481。
     报错文本里出现的文件只有 native/workspace.cpp 与 native/workspace_tree_ops.cpp，无 src/、无 tests/rename*。
     native/workspace.cpp 在黑名单上（linesep2），只记录不修。

$ node --test tests/rename*.test.mjs tests/refactor*.test.mjs     # 剥掉别人的那条门后的本 lane 范围
  ℹ tests 122   ℹ pass 122   ℹ fail 0
$ node --test tests/rename*.test.mjs
  ℹ tests 33    ℹ pass 33     ℹ fail 0

$ node .tools/find-orphan-modules.mjs --gate
  门禁：已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2 · 门禁绿：没有基线之外的新增零消费方模块。
$ node .tools/find-missing-ext.mjs
  扫描 1381 个文件（src + tests）… 干净：没有漏扩展名、且静态也解析不到的相对 import。
$ npx tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler \
        --allowImportingTsExtensions --skipLibCheck src/renamePreview.ts
  （0 行输出）tsc-exit=0        # 隔离 tsconfig 口径；未用全仓 vue-tsc -b（并发期它的 0 错不可作证据）
```
glob 已先 `ls` 核实：`tests/rename*.test.mjs` = 3 个、`tests/refactor*.test.mjs` = 9 个、`tests/module-size.test.mjs` 存在。
`.tools/find-missing-ext.mjs` 直接执行会被 shell 当 shell 脚本解释（`//: Is a directory` 一串噪声），加 `node` 才是本仓口径。

**收工复跑（17:12）**：同一条命令变 **127 / 127 绿 / 0 红** —— `native/workspace.cpp` 被 linesep2 在
17:07→17:12 之间又拆了一刀、落回上限以下，那条红自己消失了（再次印证它从头到尾不归本 lane）。
本 lane 名下最终口径：`node --test tests/rename*.test.mjs` = **33/33 绿**；
`rename* + refactor* + module-size` = **127/127 绿**。


## 5. 无法核实

- **中文措辞**：`renameTargetConflictMessage` 的提示文案（`src/renamePreview.ts:282-286`）与
  `docs/inventory` 那套「无法核实」口径一致 —— 上游 `dialog.message.file.already.exists.in.directory`
  （`RefactoringBundle.properties:492`，已逐字核实）与 `vfs.target.already.exists.error`
  （`IdeCoreBundle.properties:60`，已核实）**都没有 zh 语言包**（zh 包不在社区树里）⇒
  中文怎么说无法与上游核对，本仓自拟。本 lane 没有改任何用户可见文案，此项只登记。
- 上游 `LocalFileSystemBase.java` 的 `findChild` 在 Windows 上"忽略大小写命中"这一条，我用的是
  该文件自身的两处成文证据（`:431-433` 的 `isCaseSensitive()` 与 `:540-541` 把 `sameName` 单列放行档、
  `SystemInfo.java:11`），**没有实跑 IntelliJ**（参考树是源码快照、不可运行）。⇒ 逻辑闭包成立，运行时未证。

## 6. 请求（交主代理；逐字 old/new 已备好，本 lane 未写别人的文件）

1. **`src/renamePreview.ts:248` 的"逐字比"要说清是按宿主档位的**（注释，不改行为）。
   old（`:248-249`）：
   ```
    *   · `:545` `targetDirectory.findFile(name)` —— **按名字逐字比**（不做大小写归一，本仓同口径：
    *     路径原样相等才算「同一个条目」）；
   ```
   new：
   ```
    *   · `:545` `targetDirectory.findFile(name)` —— 按名字比，**比法随宿主大小写档位**
    *     （`LocalFileSystemBase.java:431-433` `isCaseSensitive() = SystemInfo.isFileSystemCaseSensitive`，
    *     Windows 为假）；本仓清单那一层取其中"逐字"这一档：路径原样相等才算「同一个条目」；
   ```
   另建议在 `:251` 后补一句上游落地改名的放行档：`LocalFileSystemBase.java:540`
   `sameName = !file.isCaseSensitive() && newName.equalsIgnoreCase(file.getName())` ⇒ 纯改自己名字的大小写放行。
2. **要不要在 `renameTargetConflict` 里补"宿主大小写档位"这一道**（**行为决定**，牵着 `native/main.cpp`）。
   现状：`renameTargetConflict('src/a.ts','src/B.ts',[{path:'src/b.ts'}])` ⇒ `null`（放行），
   而 Windows 上这一下会在 OS/宿主层撞 `src/b.ts`；上游 `LocalFileSystemBase.java:541-542` 直接抛
   `vfs.target.already.exists.error`。要做就给函数加一个 `caseSensitive` 入参（宿主档位从 bridge/native 取），
   并**新增**一条断言钉住"大小写不敏感宿主上 `b.ts` 占 `B.ts` 位 ⇒ 冲突"；`tests/…:120-127` 那条
   `= null` 的断言在决定前**保持原样**（它是当前契约的证人，V4 已证明它能抓住这一变异）。
   —— 不在本 lane 做的原因：`native/main.cpp` 禁写、`renamePreview.ts` 归 refactorclose 收口。

3. **`src/renamePreview.ts:271` 的 `&& entry.path !== from` 不可达**（V5 实测：删掉后 12/12 仍全绿）。
   它照抄上游 `:546` 的 `!existing.equals(file)`，但在"清单逐字比"这一档下永远进不去
   （`entry.path === to && entry.path === from ⇒ to === from`，已被 `:270` 挡在前面）。
   它**恰好**是请求 2 的落点：一旦按宿主档位比，这一句才第一次真正干活。⇒ 建议与请求 2 一起处理，
   别单独删（删了就是把上游那一档的对应物弄丢）。

## 7. 收尾核查（自己写的话逐条回查，防止"修死引用的人自己留一个死引用"）

```
$ node --check tests/rename-file-conflict.test.mjs            → syntax-ok
$ awk 'NR>=44 && NR<=73 && /assert\.match/' … | wc -l         → 9      （注释里写的"9 条锚点"核对过）
$ grep -rn "RENAMECLOSE" src/ tests/ native/ | wc -l          → 0
$ ls tests/source-citations.test.mjs                          → 存在，且 :16 用同一个 REF 常量
                                                                 （新注释引它作同口径先例，不是死引用）
$ grep -rn "不比大小写" src/                                   → 0 命中（订正前的死引用；现已无一处再引）
$ sha1sum src/renamePreview.ts                                → b3dd07eb…（与接手时同一个值，全程未写）
$ stat -c '%y' src/renamePreview.ts                           → 2026-10-06 16:55:13（三次采样同值）
$ rm -rf build/rc-scratch /tmp/rc                             → 一次性副本已清，未在仓库里留探针
```

本 lane 名下净结果：`tests/rename-file-conflict.test.mjs` 三处注释/可见性改动，**断言 0 增 0 删 0 改**；
`src/renamePreview.ts` 0 字。门禁：rename 全族 33/33、rename+refactor+module-size 最终 **127/127 全绿**
（中途那条 `native/workspace.cpp` 超限的红是 linesep2 在飞造成的，19 分钟内自己消失了，见 §4 复跑记录）。



