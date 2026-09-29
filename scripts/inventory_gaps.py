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
    python scripts/inventory_gaps.py                # 检查 _domains.json 定义的全部包
    python scripts/inventory_gaps.py com/intellij/ui/tabs com/intellij/openapi/editor
    python scripts/inventory_gaps.py --all          # 另查两个已知漏得最狠的整片区域

退出码：有洞 = 1。"以为清单已经全了"这个判断必须能失败。
"""

import json
import os
import sys

# 源码枚举、排除规则和域顺序以生成器为唯一来源。
if __package__:
    from .enumerate_inventory import DOMAINS_JSON, DOMAIN_ORDER, IDEA_ROOT, INV, idea_classes
else:
    from enumerate_inventory import DOMAINS_JSON, DOMAIN_ORDER, IDEA_ROOT, INV, idea_classes

DOMAINS = DOMAIN_ORDER
EXTRA = ("com/intellij/ui/tabs", "com/intellij/openapi/editor", "com/intellij/ui/popup")


def enumerated() -> set:
    """7 个域 .txt 里已经列出的类。"""
    listed = set()
    for domain in DOMAINS:
        path = os.path.join(INV, domain + ".txt")
        if not os.path.exists(path):
            raise FileNotFoundError("缺枚举文件：%s" % path)
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line:
                    listed.add(line)
    return listed


def in_platform_rest() -> set:
    path = os.path.join(INV, "platform_rest.txt")
    if not os.path.exists(path):
        raise FileNotFoundError("缺枚举文件：%s" % path)
    with open(path, encoding="utf-8") as handle:
        return {line.strip() for line in handle if line.strip()}


def report(suffixes, real_all, listed, rest) -> int:
    gaps = 0
    empty = 0
    print("%-46s %7s %9s %9s" % ("包后缀", "真实类", "已枚举", "缺口"))
    print("-" * 76)
    for suffix in suffixes:
        needle = "/" + suffix.strip("/") + "/"
        real = {p for p in real_all if needle in "/" + p}
        if not real:
            print("%-46s %7d %9s %9s  ← 包在基准源码中未匹配" % (suffix, 0, "-", "-"))
            empty += 1
            continue
        hit = real & listed
        missing = real - listed
        gaps += len(missing)
        tail = "（其中 %d 个只躺在 platform_rest）" % len(missing & rest) if missing & rest else ""
        print("%-46s %7d %9d %9d%s" % (suffix, len(real), len(hit), len(missing), tail))
    print("-" * 76)
    print("合计未枚举：%d 类；零匹配包：%d" % (gaps, empty))
    return gaps + empty


def main() -> int:
    args = sys.argv[1:]
    if args and "--all" not in args:
        suffixes = tuple(args)
    else:
        try:
            with open(DOMAINS_JSON, encoding="utf-8") as handle:
                domains = json.load(handle)
        except (OSError, ValueError) as error:
            print("无法读取域定义 %s：%s" % (DOMAINS_JSON, error), file=sys.stderr)
            return 2
        suffixes = tuple(sorted({suffix for roots in domains.values() for suffix in roots}))
        if "--all" in args:
            suffixes = tuple(dict.fromkeys(suffixes + EXTRA))
    if not suffixes:
        print("没有待检查的包后缀，检查失败", file=sys.stderr)
        return 1
    if not IDEA_ROOT or not os.path.isdir(IDEA_ROOT):
        print("IDEA 源码根不存在：%s" % IDEA_ROOT, file=sys.stderr)
        return 2
    print("基准源码：%s" % IDEA_ROOT)
    real_all = idea_classes()
    print("全树类文件：%d（已排除 testSrc/testData）\n" % len(real_all))
    try:
        gaps = report(suffixes, real_all, enumerated(), in_platform_rest())
    except OSError as error:
        print(str(error), file=sys.stderr)
        return 2
    return 1 if gaps else 0


if __name__ == "__main__":
    sys.exit(main())
