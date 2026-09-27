"""核实 docs/inventory/*.txt 相对 IDEA 源码树漏掉了多少类。

为什么需要这个脚本（2026-09-27）：枚举当初把源码根**写死**成
`platform/vcs-log/src`、`platform/searchEverywhere/src`、`platform/lang-impl/src/.../folding`
这种路径，而基准源码是 `263.SNAPSHOT` —— 这些包在 263 里已经搬到别的模块，
或者源码集被拆成 `src` / `shared/src` / `testSrc`。枚举遇到不存在的根就**静默跳过**，
只把名字记进 `_summary.json` 的 `missing_roots`，没人看 —— 于是"7 域 5051 类"听起来是全集，
实际少算了整片用户可见的功能区（vcs-log / Search Everywhere / projectView）。

本脚本按**包路径后缀**匹配（不看模块、不看源码根），所以搬家不影响它；
`testSrc` / `testData` 排除在外（对标的是产品行为，不是 IDEA 自己的测试）。

用法：
    python scripts/inventory_gaps.py                # 查 _summary.json 记过的 missing_roots
    python scripts/inventory_gaps.py com/intellij/ui/tabs com/intellij/openapi/editor
    python scripts/inventory_gaps.py --all          # 另查两个已知漏得最狠的整片区域

退出码：有洞 = 1。"以为清单已经全了"这个判断必须能失败。
"""

import json
import os
import sys

IDEA_ROOT = r"D:\Backup\Downloads\intellij-community-master\intellij-community-master"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INV = os.path.join(REPO, "docs", "inventory")
# 枚举里那 7 个域（platform_rest.txt 是"platform 里没被逐类枚举的剩余"，不参与归属判定）
DOMAINS = ("editor", "toolwindow", "vcs", "actions", "settings-run", "projectviews", "ui")
TEST_MARKERS = ("/testSrc/", "/testData/", "/tests/testSrc/")

# _summary.json 记过的 missing_roots（原始形态是模块路径，这里取包后缀）
RECORDED = (
    "com/intellij/codeInsight/folding",
    "com/intellij/vcs/log",
    "com/intellij/ide/actions/searcheverywhere",
    "com/intellij/ide/projectView",
)
EXTRA = ("com/intellij/ui/tabs", "com/intellij/openapi/editor", "com/intellij/ui/popup")


def idea_classes() -> set:
    """全树扫一遍，返回相对源码根的类文件路径集合（正斜杠）。"""
    found = set()
    for dirpath, dirnames, filenames in os.walk(IDEA_ROOT):
        dirnames[:] = [d for d in dirnames if d not in (".git", "out", "build")]
        rel = os.path.relpath(dirpath, IDEA_ROOT).replace("\\", "/")
        if any(marker in "/" + rel + "/" for marker in TEST_MARKERS):
            continue
        for name in filenames:
            if name.endswith((".java", ".kt")):
                found.add(rel + "/" + name)
    return found


def enumerated() -> set:
    """7 个域 .txt 里已经列出的类。"""
    listed = set()
    for domain in DOMAINS:
        path = os.path.join(INV, domain + ".txt")
        if not os.path.exists(path):
            print("缺枚举文件：%s" % path, file=sys.stderr)
            continue
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line:
                    listed.add(line)
    return listed


def in_platform_rest() -> set:
    path = os.path.join(INV, "platform_rest.txt")
    if not os.path.exists(path):
        return set()
    with open(path, encoding="utf-8") as handle:
        return {line.strip() for line in handle if line.strip()}


def report(suffixes, real_all, listed, rest) -> int:
    gaps = 0
    print("%-46s %7s %9s %9s" % ("包后缀", "真实类", "已枚举", "缺口"))
    print("-" * 76)
    for suffix in suffixes:
        needle = "/" + suffix.strip("/") + "/"
        real = {p for p in real_all if needle in "/" + p}
        if not real:
            print("%-46s %7d %9s %9s  ← 包在 263 里不存在" % (suffix, 0, "-", "-"))
            continue
        hit = real & listed
        missing = real - listed
        gaps += len(missing)
        tail = "（其中 %d 个只躺在 platform_rest）" % len(missing & rest) if missing & rest else ""
        print("%-46s %7d %9d %9d%s" % (suffix, len(real), len(hit), len(missing), tail))
    print("-" * 76)
    print("合计未枚举：%d 类" % gaps)
    return gaps


def main() -> int:
    args = sys.argv[1:]
    if "--all" in args:
        suffixes = RECORDED + EXTRA
    elif args:
        suffixes = tuple(args)
    else:
        summary = os.path.join(INV, "_summary.json")
        if not os.path.exists(summary):
            print("缺 %s" % summary, file=sys.stderr)
            return 2
        with open(summary, encoding="utf-8") as handle:
            # 记过的是模块路径；这里只取结尾的包路径，模块前缀交给后缀匹配忽略
            suffixes = tuple(
                sorted({"/".join(root.replace("\\", "/").split("/")[-6:]) for roots in data.get("missing_roots", []) for root in roots})
            )
    if not IDEA_ROOT or not os.path.isdir(IDEA_ROOT):
        print("IDEA 源码根不存在：%s" % IDEA_ROOT, file=sys.stderr)
        return 2
    print("基准源码：%s" % IDEA_ROOT)
    real_all = idea_classes()
    print("全树类文件：%d（已排除 testSrc/testData）\n" % len(real_all))
    gaps = report(suffixes, real_all, enumerated(), in_platform_rest())
    return 1 if gaps else 0


if __name__ == "__main__":
    sys.exit(main())
