# 机械对照扫描：把 IDEA 的每个类名拿去 TaoCode 的代码/文档里查是否出现过。
#
# 这是**客观信号**，不是判断：命中只说明名字被提到过（可能只是文档里的"判定不做"记录），
# 未命中则说明这个类从未在任何形式下被对照过 —— 那才是真正的漏洞所在。
#
# 用法： python scripts/parity_scan.py [域 ...]
#   不传域名则扫描 docs/inventory/_summary.json 里的全部域。
# 产出： docs/inventory/<域>_scan.md   （逐类表格）
#        docs/inventory/_scan.json     （机器可读的汇总）

import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INV = os.path.join(REPO, "docs", "inventory")
TEXT_EXT = (".ts", ".vue", ".cpp", ".hpp", ".mjs", ".json", ".css", ".md", ".xml", ".properties")
SKIP_DIRS = {"node_modules", "build", "dist", ".git", "inventory", "third_party", ".workbuddy"}


def load_taocode_text() -> str:
    """TaoCode 的全部文本，用于按标识符查找。"""
    chunks = []
    for root in ("src", "native", "tests", "docs", "scripts", "package.json", "CMakeLists.txt"):
        path = os.path.join(REPO, root)
        if os.path.isfile(path):
            with open(path, encoding="utf-8", errors="replace") as handle:
                chunks.append(handle.read())
            continue
        for dirpath, dirnames, filenames in os.walk(path):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in filenames:
                if name.endswith(TEXT_EXT):
                    try:
                        with open(os.path.join(dirpath, name), encoding="utf-8", errors="replace") as handle:
                            chunks.append(handle.read())
                    except OSError:
                        pass
    return "\n".join(chunks)


def identifiers(text: str) -> set[str]:
    return set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", text))


def scan(domain: str, seen: set[str], blob: str) -> dict:
    listing = os.path.join(INV, domain + ".txt")
    if not os.path.isfile(listing):
        return {}
    entries = [line.strip() for line in open(listing, encoding="utf-8") if line.strip()]
    rows, mentioned, unmentioned = [], 0, []
    for entry in entries:
        base = os.path.basename(entry).rsplit(".", 1)[0]
        hit = base in seen if len(base) >= 4 else True   # 太短的名字不判（噪声太大）
        if hit:
            mentioned += 1
        else:
            unmentioned.append(entry)
        rows.append((base, entry, "提到过" if hit else "未出现"))
    with open(os.path.join(INV, domain + "_scan.md"), "w", encoding="utf-8") as handle:
        handle.write(f"# {domain} 机检结果\n\n")
        handle.write(f"枚举 {len(entries)} 个类；TaoCode 文本里出现过名字的 {mentioned} 个，"
                     f"**从未出现 {len(unmentioned)} 个**。\n\n")
        handle.write("> 「提到过」只说明名字在 TaoCode 里出现过（可能是文档里的判定记录），"
                     "不等于已移植；「未出现」= 该源码类从未被对照过。\n\n")
        handle.write("| 类 | 源码路径 | 机检 |\n|---|---|---|\n")
        for base, entry, status in rows:
            handle.write(f"| `{base}` | `{entry}` | {status} |\n")
    return {"total": len(entries), "mentioned": mentioned, "unmentioned": unmentioned}


def main() -> int:
    domains = sys.argv[1:]
    if not domains:
        summary_path = os.path.join(INV, "_summary.json")
        domains = list(json.load(open(summary_path, encoding="utf-8")).keys())
    blob = load_taocode_text()
    seen = identifiers(blob)
    print(f"TaoCode 文本 {len(blob)} 字符 / {len(seen)} 个标识符")
    result = {}
    for domain in domains:
        data = scan(domain, seen, blob)
        if not data:
            print(f"{domain}: 无枚举文件，跳过")
            continue
        result[domain] = {k: v for k, v in data.items() if k != "unmentioned"}
        result[domain]["unmentioned_sample"] = data["unmentioned"][:40]
        print(f"{domain:<14} 枚举 {data['total']:>5}  提到过 {data['mentioned']:>5}  未出现 {len(data['unmentioned']):>5}")
    with open(os.path.join(INV, "_scan.json"), "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=1)
    total = sum(v["total"] for v in result.values())
    gone = sum(v["total"] - v["mentioned"] for v in result.values())
    print(f"合计 {total}，未出现 {gone}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
