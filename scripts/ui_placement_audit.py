# UI 放置位置审计：每个设置控件"应该在哪一页"，与 TaoCode 当前所在页对比。
#
# 判定链（每一步都可核）：
#   1) 键名 → 声明它的**状态文件**（决定属于哪个组件，如 GeneralSettings / UISettings / EditorSettings）
#   2) 状态字段 → **真实访问器名**：从状态文件里解析 `var <accessor> ... get() = …state.<字段>…`
#      （不能假设 getter 等于字段：`deleteToBin` 的 getter 是 `isDeletingToBin`）
#   3) 访问器 → **引用它的 Configurable**（Configurable 就是设置页；引用即归属）
#   4) Configurable 简单类名 → IDEA 设置树里的位置（由 `getDisplayName()`/Bundle 文案人工确认，
#      见 docs/ui-placement-audit.md 的对照表）
#
# 用法: python scripts/ui_placement_audit.py > docs/ui-placement-audit-raw.txt

import os
import re

SRC = r"D:\Backup\Downloads\intellij-community-master\intellij-community-master"

TAOCODE_PAGES = {
    "appearance（外观）": [
        "compactMode", "fullPathsInWindowHeader", "supportScreenReaders", "useContrastScrollbars",
        "colorBlindness", "backgroundImageFill", "backgroundImageKeepRatio", "presentationMode",
        "mainMenuDisplayMode", "showTreeIndentGuides", "compactTreeIndents", "smoothScrolling",
        "keepPopupsForToggles", "dndWithPressedAltOnly", "showIconsInMenus", "showToolWindowBars",
        "showToolWindowNames", "showToolWindowNumbers", "rememberSizeForEachToolWindow",
        "leftSideBySide", "rightSideBySide", "wideScreenSupport", "uiZoomPercent", "uiFontFamily", "uiFontSize",
    ],
    "editor（编辑器）": [
        "useTabCharacter", "showWhitespaces", "formatOnSave", "wordWrap", "lineNumbers",
        "showIndentGuides", "bracketMatching", "tabSize", "fontSize",
    ],
    "general（系统设置）": [
        "confirmExit", "processCloseConfirmation", "reopenLastProject", "defaultProjectDirectory",
        "deleteToBin", "autoSaveIfInactive", "autoSaveFiles", "isUseSafeWrite", "autoSyncFiles",
        "backgroundSyncFiles", "inactiveTimeout", "isShowWelcomeScreen", "confirmOpenNewProject2",
    ],
    "commit（提交）": [
        "subjectLimit", "bodyLimit", "subjectBodySeparation", "wrapOnTyping",
    ],
}

# 状态文件候选：文件名带 Settings / UiSettings / State
STATE_ROOTS = [
    "platform/ide-core", "platform/platform-impl/src/com/intellij/ide",
    "platform/editor-ui-api", "platform/platform-api/src/com/intellij/ide",
    "platform/lang-impl/src/com/intellij/ide", "platform/core-ui/src",
    "platform/vcs-impl/src/com/intellij/vcs", "platform/vcs-api/src/com/intellij/vcs",
]


def camel_to_snake(name: str) -> str:
    name = re.sub(r"^is(?=[A-Z])", "", name)
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).upper()


def walk_files(roots, name_filter=None, exts=(".kt", ".java")):
    for root in roots:
        base = os.path.join(SRC, root.replace("/", os.sep))
        if not os.path.isdir(base):
            continue
        for dirpath, _dirs, filenames in os.walk(base):
            for name in filenames:
                if not name.endswith(exts):
                    continue
                if name_filter and not re.search(name_filter, name):
                    continue
                yield os.path.join(dirpath, name)


def build_state_index():
    """状态字段 -> [(访问器名, 状态文件)]。"""
    index = {}
    for path in walk_files(STATE_ROOTS, r"Settings|UiSettings|UISettings|State"):
        try:
            text = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        rel = os.path.relpath(path, SRC).replace(os.sep, "/")
        for pattern in (
            r"var\s+(\w+)\s*:[^\n]*\n\s*get\(\)\s*=\s*state\.(\w+)",       # get() = state.x
            r"var\s+(\w+)\s*:[^\n]*\n\s*get\(\)\s*=[^\n]*?state\.(\w+)",   # get() = <expr> state.x
            r"get\(\)\s*=[^\n]*?state\.(\w+)",                             # 无 var 行（接口实现）
        ):
            for m in re.finditer(pattern, text):
                if len(m.groups()) == 2:
                    index.setdefault(m.group(2), []).append((m.group(1), rel))
                else:
                    index.setdefault(m.group(1), []).append(("?", rel))
    return index


def build_configurables():
    found = {}
    for path in walk_files(["platform", "plugins"], r"Configurable"):
        rel = os.path.relpath(path, SRC).replace(os.sep, "/")
        simple = os.path.basename(path).rsplit(".", 1)[0]
        if simple in found and rel.startswith("plugins/"):
            continue
        try:
            found[simple] = (rel, open(path, encoding="utf-8", errors="replace").read())
        except OSError:
            pass
    return found


def owners_for(key, accessors, configurables):
    names = {key} | {a for a, _ in accessors if a != "?"}
    snake = camel_to_snake(key)
    hits = {}
    for simple, (rel, text) in configurables.items():
        for name in sorted(names):
            if re.search(r"::" + re.escape(name) + r"\b", text) or re.search(r"\b" + re.escape(name) + r"\(\)", text):
                hits[simple] = rel
                break
        else:
            if re.search(r"\b" + re.escape(snake) + r"\b", text) or re.search(r'"' + re.escape(snake) + r'"', text):
                hits[simple] = rel
    return hits


def main() -> int:
    state = build_state_index()
    configurables = build_configurables()
    print(f"# 状态索引 {len(state)} 个字段 / Configurable {len(configurables)} 个\n")
    for page, keys in TAOCODE_PAGES.items():
        print(f"\n===== TaoCode 页：{page} =====")
        for key in keys:
            accessors = state.get(key, [])
            acc = ", ".join(sorted({a for a, _ in accessors if a != "?"})) or "（未找到访问器）"
            component = ", ".join(sorted({os.path.basename(p) for _, p in accessors})) or "（未在状态文件里找到）"
            hits = owners_for(key, accessors, configurables)
            own = ", ".join(sorted(hits)[:4]) or "（没有 Configurable 引用它）"
            print(f"  {key:<32} 组件: {component:<28} 访问器: {acc:<28} 归属页: {own}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
