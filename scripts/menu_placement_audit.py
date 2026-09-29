# 菜单归属审计：从 IDEA 的 action XML 里抽出**每个菜单组有哪些成员**。
#
# 为什么要它（桃 2026-09-27：「记得把全部 UI 查询一遍，修正错放的 UI」）：
# TaoCode 的菜单行是自有 id（`file.save` / `view.appearance`），与 IDEA 的 action id
# （`SaveAll` / `ToggleFullScreen`）**对不上**，所以不能靠 id 直接比对。
# 但 IDEA 的 XML 里每个 `<action>`/`<group>` 都带 `<add-to-group group-id="…" anchor=… weight=…>`，
# 把这些抽出来就是"这个动作在 IDEA 里属于哪个菜单、排在什么位置"的**权威清单** ——
# 拿它逐条核对 `src/menus/*.ts`，就能发现放错菜单的行。
#
# 用法：python scripts/menu_placement_audit.py > docs/menu-groups.txt
# 只扫 platform/ 与 plugins/ 下的 *Actions.xml 与 META-INF/*.xml（菜单注册都在这两类里）。

import os
import sys
import xml.etree.ElementTree as ElementTree

SRC = r"D:\Backup\Downloads\intellij-community-master\intellij-community-master"

# 主菜单与常见弹出菜单的组 id（其余组也会输出，只是这两类优先看）。
MAIN_MENUS = [
    "MainMenu", "FileMenu", "EditMenu", "ViewMenu", "NavigateMenu", "CodeMenu",
    "RefactorMenu", "BuildMenu", "RunMenu", "ToolsMenu", "VcsGroups", "WindowMenu", "HelpMenu",
]

# `reference` 也是成员（`<reference ref="SomeAction"/>`）—— 漏了它会让"只有引用"的组看起来是空的。
MEMBER_TAGS = ("action", "group", "reference")


def xml_files():
    for base_name in ("platform", "plugins"):
        base = os.path.join(SRC, base_name)
        if not os.path.isdir(base):
            continue
        for dirpath, _dirs, filenames in os.walk(base):
            for name in filenames:
                if not name.endswith(".xml"):
                    continue
                # 菜单注册只在 *Actions.xml 与 META-INF/*.xml 里（其余是插件描述、图标表等）
                if not (name.endswith("Actions.xml") or os.path.basename(dirpath) == "META-INF"):
                    continue
                yield os.path.join(dirpath, name)


def collect():
    """
    组 id -> [(成员 id, kind, weight, anchor, relative_to, file)]。

    必须用真正的 XML 解析：IDEA 的菜单是**嵌套**的
    （`<group id="FileMenu"><action .../><group .../></group>`），
    正则非贪婪匹配会在第一个 `</group>` 处收尾，把整棵子树当成一个成员 —— 这正是第一版
    只抽出 95 个组、主菜单只见到 2 项的原因。
    """
    groups: dict[str, list] = {}
    unparsed = 0
    for path in xml_files():
        try:
            root = ElementTree.parse(path).getroot()
        except (ElementTree.ParseError, OSError):
            unparsed += 1
            continue
        rel = os.path.relpath(path, SRC).replace(os.sep, "/")
        for element in root.iter():
            if element.tag not in MEMBER_TAGS:
                continue
            identifier = element.get("id")
            if not identifier:
                continue
            # ① **内联成员**：`<group id="FileMenu"> <action .../> <separator/> … </group>`
            #    —— 主菜单的成员就是这么定义的（不是 add-to-group）。
            for child in element:
                if child.tag not in MEMBER_TAGS:
                    continue
                child_id = child.get("id") or child.get("ref")
                if not child_id:
                    continue
                weight = child.get("weight", "")
                groups.setdefault(identifier, []).append((
                    child_id, child.tag,
                    int(weight) if weight.lstrip("-").isdigit() else None,
                    "", "", rel, "inline", child.get("text", ""),
                ))
            # ② **外部插入**：`<add-to-group group-id="FileMenu" anchor="last"/>`
            #    —— 插件与跨文件注册走这条（顺序由 anchor/weight 决定）。
            for add in element.findall("add-to-group"):
                group_id = add.get("group-id")
                if not group_id:
                    continue
                weight = add.get("weight", "")
                groups.setdefault(group_id, []).append((
                    identifier, element.tag,
                    int(weight) if weight.lstrip("-").isdigit() else None,
                    add.get("anchor", ""),
                    add.get("relative-to-action", ""),
                    rel, "inserted", element.get("text", ""),
                ))
    if unparsed:
        print(f"# 注意：{unparsed} 个 XML 无法解析（DTD/实体），已跳过\n")
    return groups


def sort_key(entry):
    _id, _kind, weight, anchor, relative_to, _rel, _how, _text = entry
    # IDEA 的排序规则：先按 anchor（first 在前、last 在后），带 relative-to-action 的插在目标旁边；
    # 同一锚点内按 weight 升序。没有 weight 的排最后（源 XML 里的相对顺序保留不了，如实标注）。
    anchor_rank = {"first": 0, "before": 1, "after": 2, "last": 3, "": 1.5}.get(anchor, 1.5)
    return (anchor_rank, relative_to, weight if weight is not None else 10_000, _id)


# 去掉这些后缀后同名的动作，是"同一个功能的两个变体"——最容易看错的地方。
# 本仓踩过的坑：`EditorIncreaseFontSize`（当前编辑器的临时字号，ViewMenu › EditorToggleActions）
# 与 `EditorIncreaseFontSizeGlobal`（全局字号，ViewMenu 直接层）是**两个不同的动作**，
# 只看名字会以为"已经有了"或"重复了"。
VARIANT_SUFFIXES = ("Global", "Local", "All")


def variant_families(groups):
    """
    基名 -> 该基名下出现过的全部 id（只保留真的多于一个的）。

    注意要把**基名本身**也算进来：`EditorIncreaseFontSizeGlobal` 的基名 `EditorIncreaseFontSize`
    也是真实存在的动作 id，只看"带后缀的那些"会得到只有 1 个成员的家族、被过滤掉 —— 这正是
    第一版输出"0 组"的原因。
    """
    all_ids = {identifier for members in groups.values() for identifier, *_rest in members}
    families: dict[str, set] = {}
    for identifier in all_ids:
        for suffix in VARIANT_SUFFIXES:
            if identifier.endswith(suffix) and len(identifier) > len(suffix):
                base = identifier[: -len(suffix)]
                bucket = families.setdefault(base, set())
                bucket.add(identifier)
                if base in all_ids:
                    bucket.add(base)
    return {base: ids for base, ids in families.items() if len(ids) > 1}


def main() -> int:
    groups = collect()
    print(f"# IDEA 菜单/动作组成员清单（{len(groups)} 个组，来自 platform + plugins 的 XML 注册）\n")
    print("# 排序：anchor（first → before/after → last）+ relative-to-action + weight。")
    print("# 用法：拿它核对 src/menus/*.ts —— 某个动作在 IDEA 里属于哪个菜单，以本表为准。\n")
    ordered = sorted(groups, key=lambda name: (name not in MAIN_MENUS, name))
    for group_id in ordered:
        members = sorted(groups[group_id], key=sort_key)
        marker = " ★主菜单" if group_id in MAIN_MENUS else ""
        print(f"\n===== {group_id}{marker} （{len(members)} 项）=====")
        for identifier, kind, weight, anchor, relative_to, rel, how, text in members:
            position = anchor or "-"
            if relative_to:
                position += f" {relative_to}"
            weight_text = "" if weight is None else f" w={weight}"
            label = f" 「{text}」" if text else ""
            print(f"  {identifier:<44} [{kind}]{label:<22}{weight_text:<9} {position:<24} {how:<9} {rel}")

    # 反向索引：同一基名的多个变体（`X` / `XGlobal` / `XLocal` / `XAll`）。
    # 移植时**必须**先分清它们是不是同一个东西 —— 名字像不等于语义相同。
    families = variant_families(groups)
    print(f"\n\n# ===== 同名变体（去掉 Global/Local/All 后缀后同名，{len(families)} 组）=====")
    print("# 移植前先确认这些变体的语义是否不同；只按名字对齐会漏做或多做。")
    for base, ids in sorted(families.items()):
        print(f"\n  {base}")
        for identifier in sorted(ids):
            where = sorted({group for group, members in groups.items() if any(m[0] == identifier for m in members)})
            print(f"    {identifier:<44} ← {'、'.join(where) if where else '(未挂到任何组)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
