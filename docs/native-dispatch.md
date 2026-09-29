# 原生桥接分派（native/main.cpp + Session）

> 本文只写**经源码确认**的内容，行号以写入时为准；未查证的写 `待核`。

## A. 为什么方法名要哈希成整数才能 switch

`method` 是 `std::string`，C++ 的 `switch` 只接受整型。`native/main.cpp:41-56` 用 FNV-1a
在**编译期**把 `case "app.state"_h` 变成 `std::uint64_t`，运行期对被分派的名字只算一次哈希：

```cpp
constexpr std::uint64_t fnv1a(std::string_view text);
constexpr std::uint64_t operator""_h(const char* text, std::size_t length);
```

分派本体（`native/main.cpp:1044` 起）：

```cpp
Json result;
if (auto it = routes.find(method); it != routes.end()) result = it->second(params);
else switch (fnv1a(method)) {
case "app.state"_h: { … break; }
…
default:
    throw taocode::WorkspaceError("UNKNOWN_METHOD", "该原生方法未开放");
}
```

**哈希碰撞不是静默风险**：两个不同的方法名若算出同一个哈希，就是两个相同的 `case` 值，
MSVC 直接报 `C2196: case 值已使用`。所以碰撞在编译期暴露，不会走错分支。

`routes` 是后注册的小表（`register_routes()`，`native/main.cpp:146-152`，当前 3 个方法名），
先查它；其余方法名走 switch。

## B. 硬约束：三张清单必须一致（机检）

三张手工维护的清单曾经各自漂移过，造出**只在运行时暴露的空功能**。现在由
`tests/routing-parity.test.mjs` 钉住：

| 清单 | 出处 | 检查 |
|---|---|---|
| 前端能发的方法名 | `src/bridge.ts` 的 `Method` union | 每个名字都能在原生找到分支（switch 的 case 或 `routes`） |
| 原生处理的方法名 | `native/main.cpp` 的 `case "…"_h:` + `routes.emplace("…")` | 没有前端从不发送的名字（拼写漂移） |
| git 工作线程白名单 | `native/main.cpp` 的 `is_git_method()` | 与 `git.*` 分支完全对齐，唯一例外是 `git.cancel`（只置取消标志，必须立刻执行，见 `:1489`） |
| LSP kind | `src/bridge.ts` 的 `LspRequestKind` union | 每个 kind 至少被 `Session::request` 或 `Session::semantic` 认识 |

## C. LSP kind 的两个分派函数是闭合环

`native/lsp_session.cpp` 里 `Session::request`（位置型：`hover` / `completion` / `definition`）
与 `Session::semantic`（其余全部）**互为兜底**：

- `Session::semantic` 遇到这三个位置型 kind → 转交 `request()`；
- `Session::request` 遇到不认识的 kind → 转交 `semantic()`（而不是直接回 `LSP_BAD_KIND`）；
- `semantic()` 的兜底是 `LSP_BAD_KIND`，且**不再转交**，所以不会互相递归。

`native/main.cpp` 的 `lsp.request` 路由**只有一条**：参数整体转发（只摘掉
`kind`/`path`/`line`/`character`），全部交给 `lsp->semantic(...)`。

### 这里踩过的两个坑（都有对应回归测试）

1. **参数白名单漏键**：`main.cpp` 曾手工维护「哪个 kind 读哪些键」的白名单，漏了
   `newPath`（`workspace/willRenameFiles`）、`command`/`arguments`（`workspace/executeCommand`）、
   `previousResultId`（pull 诊断）。表现是**功能全绿但界面全哑** —— 请求发出去了，参数是空的。
   现在改为整体转发；各分支只读自己认识的键，多传一个键无害。
2. **kind 清单漏项**：`main.cpp` 曾手工维护 kind → 入口的对应关系，漏了
   `completionItemResolve` / `diagnostic` / `prepareRename` / `foldingRange` 四个，
   它们被打到不认识的入口回 `LSP_BAD_KIND`，而前端各自的 `catch {}` 把错误吃掉了
   （`CodeEditor.vue` 的折叠与 pull 诊断、`App.vue` 的重命名预校验）。
   `lsp_semantics_test` / `lsp_coding_test` 直接调 `Session::semantic`，**绕过了 main.cpp**，
   所以原生测试全绿 —— 这就是 §B 那张表要机检的原因。

## D. 新增一个桥接方法的清单

1. `src/bridge.ts` 的 `Method` union 加名字；
2. `native/main.cpp` 的 switch 加 `case "xxx"_h:`（`break` / `return` / `throw` 三者必居其一；
   跨行语句要整条收进块里，不能只截首行）；
3. 若是 LSP：`LspRequestKind` 加名字，并在 `Session::semantic`（或 `request`）加分支；
4. 若会阻塞（git、搜索、构建…）：按 `git.cancel` 的反例决定是否进工作线程白名单；
5. 跑 `node --test tests/routing-parity.test.mjs`。

## E. 本文状态

| 项 | 状态 |
|---|---|
| 分派形态（`routes` + 哈希 switch） | `[x]` 2026-09-27，`main.cpp` 由 107 处 `else if (method == …)` 改为 `switch`（120 个 case 标签、1 个 `default`） |
| 三张清单机检 | `[x]` `tests/routing-parity.test.mjs`（4 条） |
| LSP 双入口闭合环 | `[x]` `lsp_session.cpp` 的两条转交分支 |
| 参数整体转发 | `[x]` `main.cpp` 的 `lsp.request` 路由 |
