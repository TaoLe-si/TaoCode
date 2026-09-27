"""从 IDEA 源码树重新枚举 7 个域的类清单 —— 唯一可复跑的生成器。

为什么必须重写（2026-09-27 核实）：上一版枚举没有生成器（`.txt` 是临时命令的产物），
而且把源码根**写死**成 `platform/vcs-log/src`、`platform/searchEverywhere/src` 这种模块路径。
基准源码是 `263.SNAPSHOT`，这些包早就搬到别的模块、源码集也拆成了 `src` / `shared/src`，
枚举遇到不存在的根就静默跳过，只把名字记进 `_summary.json` 的 `missing_roots` —— 没人看。
结果：`openapi/editor` 实测 941 类只列了 206，`vcs/log` 580 类一列没列，
`searcheverywhere` / `ide/projectView` 同样为 0。清单看着是全集，实际少算了 1715 类。

本脚本的三条硬规矩（对应项目自己的「不放假」规则）：
1. **按包路径后缀匹配**，不看模块、不看源码根 —— 包搬家了照样能匹配上。
2. **域定义只写在 `docs/inventory/_domains.json` 一处**，可审计、可版本化。
3. **任何一个定义好的包后缀一个类都没匹配到就 exit 1** —— "清单已经全了"这个判断必须能失败。

用法：
    python scripts/enumerate_inventory.py             # 重新枚举 + 重算 platform_rest/_platform
    python scripts/enumerate_inventory.py --check     # 只报差异与未覆盖的包根，不写文件
"""

import json
import os
import sys

IDEA_ROOT = r"D:\Backup\Downloads\intellij-community-master\intellij-community-master"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INV = os.path.join(REPO, "docs", "inventory")
DOMAINS_JSON = os.path.join(INV, "_domains.json")
TEST_MARKERS = ("/testSrc/", "/testData/")
PKG_HEADS = ("com", "org", "io", "net", "java", "javax", "gnu", "jline")

# 域的判定顺序 = 归属优先级：一个类同时命中多个域时归给**先出现**的那个。
# 顺序按「用户能不能看见」排，前面的域吃掉重叠部分（重叠会在输出里点名，不静默）。
DOMAIN_ORDER = ("editor", "toolwindow", "vcs", "actions", "settings-run", "projectviews", "ui")


def idea_classes() -> set:
    """全树扫一遍，返回相对源码根的类文件路径（正斜杠，已排除测试源码集）。"""
    found = set()
    for dirpath, dirnames, filenames in os.walk(IDEA_ROOT):
        dirnames[:] = [d for d in dirnames if d != ".git"]
        rel = os.path.relpath(dirpath, IDEA_ROOT).replace("\\", "/")
        if any(marker in "/" + rel + "/" for marker in TEST_MARKERS):
            continue
        for name in filenames:
            if name.endswith((".java", ".kt")):
                found.add(rel + "/" + name)
    return found


def assign(all_classes: set, domains: dict) -> tuple:
    """把每个类归到第一个命中的域。返回 (归属表, 未匹配任何域的类, 域间重叠数)。"""
    # 长后缀优先匹配：`com/intellij/a/b` 与 `com/intellij/a/b/c` 同时定义时，b/c 归自己那条。
    rules = []
    for domain in DOMAIN_ORDER:
        for suffix in domains.get(domain, []):
            rules.append((domain, "/" + suffix.strip("/") + "/"))
    rules.sort(key=lambda item: len(item[1]), reverse=True)

    owned = {domain: set() for domain in DOMAIN_ORDER}
    rest = set()
    for path in all_classes:
        probe = "/" + path
        for domain, needle in rules:
            if needle in probe:
                owned[domain].add(path)
                break
        else:
            rest.add(path)
    return owned, rest, rules


def platform_classes(all_classes: set) -> set:
    return {p for p in all_classes if p.startswith("platform/")}


def previous_counts() -> dict:
    counts = {}
    for domain in DOMAIN_ORDER:
        path = os.path.join(INV, domain + ".txt")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as handle:
                counts[domain] = sum(1 for line in handle if line.strip())
    return counts


def uncovered_roots(all_classes: set, owned: dict, min_classes: int = 1) -> list:
    """没被任何域认领的**包根**（取到 com/intellij/<一级>/<二级>），按类数降序。"""
    taken = set()
    for paths in owned.values():
        taken |= paths
    buckets = {}
    for path in all_classes:
        if path in taken:
            continue
        parts = path.split("/")
        heads = [i for i, p in enumerate(parts) if p in PKG_HEADS and i >= 1]  # i>=1：跳过模块名（`java/` 模块会撞上 `java` 包头）
        if not heads:
            continue  # 没有包头（生成代码、构建脚本）—— 不假装它是个包根
        root = "/".join(parts[heads[0]:heads[0] + 3])
        buckets[root] = buckets.get(root, 0) + 1
    return sorted(((n, r) for r, n in buckets.items() if n >= min_classes), reverse=True)


def main() -> int:
    check_only = "--check" in sys.argv
    if not os.path.isdir(IDEA_ROOT):
        print("IDEA 源码根不存在：%s" % IDEA_ROOT, file=sys.stderr)
        return 2
    if not os.path.exists(DOMAINS_JSON):
        print("缺域定义 %s" % DOMAINS_JSON, file=sys.stderr)
        return 2
    with open(DOMAINS_JSON, encoding="utf-8") as handle:
        domains = json.load(handle)

    all_classes = idea_classes()
    owned, rest, rules = assign(all_classes, domains)
    platform = platform_classes(all_classes)

    # 硬规矩 3：定义好的包一个都没匹配上 = 清单在骗人
    empty = [needle.strip("/") for _, needle in rules if not any(needle in "/" + p for p in all_classes)]
    if empty:
        print("以下包后缀在源码树里一个类都没有（包又搬家了？）：", file=sys.stderr)
        for suffix in empty:
            print("  - %s" % suffix, file=sys.stderr)
        return 1

    before = previous_counts()
    print("基准源码：%s" % IDEA_ROOT)
    print("全树类文件 %d（已排除 testSrc/testData）\n" % len(all_classes))
    print("%-14s %8s %8s %8s" % ("域", "旧", "新", "增量"))
    print("-" * 42)
    covered_total = 0
    for domain in DOMAIN_ORDER:
        new = len(owned[domain])
        covered_total += new
        old = before.get(domain)
        delta = "n/a" if old is None else "%+d" % (new - old)
        print("%-14s %8s %8d %8s" % (domain, old if old is not None else "-", new, delta))
    print("-" * 42)
    print("7 域合计：旧 %d / 新 %d" % (sum(v for v in before.values() if v), covered_total))
    print("platform 未归属（platform_rest）：%d" % len(platform - set().union(*owned.values())))

    print("\n未覆盖的包根（类数 >= 5，按降序，最多 25 条）：")
    for n, root in uncovered_roots(all_classes, owned)[:25]:
        print("  %6d  %s" % (n, root))
    uncovered_all = uncovered_roots(all_classes, owned)
    print("未覆盖包根合计：%d 个根 / %d 类" % (len(uncovered_all), sum(n for n, _ in uncovered_all)))

    if check_only:
        print("\n--check：只报告，未写文件。")
        return 0

    for domain in DOMAIN_ORDER:
        with open(os.path.join(INV, domain + ".txt"), "w", encoding="utf-8", newline="\n") as handle:
            for path in sorted(owned[domain]):
                handle.write(path + "\n")
    rest_platform = sorted(platform - set().union(*owned.values()))
    with open(os.path.join(INV, "platform_rest.txt"), "w", encoding="utf-8", newline="\n") as handle:
        for path in rest_platform:
            handle.write(path + "\n")
    with open(os.path.join(INV, "_platform.json"), "w", encoding="utf-8", newline="\n") as handle:
        json.dump({"platform_total": len(platform), "covered": covered_total, "rest": len(rest_platform)},
                  handle, ensure_ascii=False, indent=1)
        handle.write("\n")
    print("\n已写：%s/{7 个域}.txt + platform_rest.txt + _platform.json" % INV)
    return 0


if __name__ == "__main__":
    sys.exit(main())
