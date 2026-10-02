# 逐类判决的**机械信号**收集器：把一个域里的每个类读一遍，输出可复核的信号表。
#
# 为什么要有它：判决（`docs/inventory/verdict-*.md`）里每一条都写"依据"，而"依据"如果只靠人读，
# 就没法核对、也没法重跑。这个脚本把**能从源码机械判定**的那部分固定下来：
#   · 行数、是不是测试源码集（`testSources` / `tests/`）；
#   · 是不是 Swing 组件（`JComponent` / `paintComponent` / `Graphics2D` / `JBPopup` / `JList`…）；
#   · 是不是平台专属（`x11` / `win32` / `darwin` / `Mac` / `CustomFrameDecoration`…）；
#   · 名字在 TaoCode 里的三种命中：**真实代码**（src 去注释）/ **只被注释引用** / **从未出现**。
# 判决仍然是人给的（行为有没有落地），但每一档的分布可以直接数出来，改不动。
#
# 用法：python scripts/verdict_signals.py <域> [...]
# 产出：docs/inventory/<域>_signals.md 与 .json
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INV = os.path.join(REPO, "docs", "inventory")
SOURCE = r"D:\Backup\Downloads\intellij-community-master\intellij-community-master"

SWING = ("JComponent", "paintComponent", "Graphics2D", "JBPopup", "JList", "JTree", "JTable", "JPanel",
         "JDialog", "JLabel", "JButton", "LayoutManager", "SwingUtilities", "JBColor", "JBUIScale",
         "SimpleColoredComponent", "ColoredListCellRenderer", "ActionButton")
PLATFORM = ("customFrameDecoration", "CustomFrameDecoration", "x11", "X11", "win32", "Win32", "darwin",
            "MacWindow", "Headless", "NativeWindow", "JBR", "WindowUtilities", "Dwmapi", "OSX")
TEST = ("testSources", "tests/", "Test.java", "Test.kt", "TestCase")


def strip_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"//[^\n]*", " ", text)
    return text


def load_code_text() -> tuple[str, str]:
    """(去掉注释的 src/，含注释的 src/)——两种命中口径分开算。"""
    raw, bare = [], []
    for dirpath, dirnames, filenames in os.walk(os.path.join(REPO, "src")):
        dirnames[:] = [d for d in dirnames if d != "node_modules"]
        for name in filenames:
            if not name.endswith((".ts", ".vue", ".css")):
                continue
            with open(os.path.join(dirpath, name), encoding="utf-8", errors="replace") as handle:
                text = handle.read()
            raw.append(text)
            bare.append(strip_comments(text))
    return "\n".join(bare), "\n".join(raw)


def read_source(path: str) -> str:
    try:
        with open(os.path.join(SOURCE, path.replace("/", os.sep)), encoding="utf-8", errors="replace") as handle:
            return handle.read()
    except OSError:
        return ""


def classify(entry: str, code: str, bare: str, raw: str) -> dict:
    name = os.path.basename(entry).rsplit(".", 1)[0]
    text = read_source(entry)
    lines = text.count("\n") + 1 if text else 0
    swing = [marker for marker in SWING if marker in text][:3]
    platform = [marker for marker in PLATFORM if marker in text][:3]
    is_test = any(marker in entry for marker in TEST)
    short = len(name) < 4
    in_code = short or re.search(rf"\b{re.escape(name)}\b", bare) is not None
    in_comment_only = (not in_code) and re.search(rf"\b{re.escape(name)}\b", raw) is not None
    return {
        "name": name, "path": entry, "lines": lines, "read": bool(text),
        "swing": swing, "platform": platform, "test": is_test,
        "in_code": in_code, "in_comment_only": in_comment_only,
    }


def main() -> int:
    domains = sys.argv[1:]
    if not domains:
        print("用法：python scripts/verdict_signals.py <域> [...]")
        return 2
    bare, raw = load_code_text()
    for domain in domains:
        listing = os.path.join(INV, domain + ".txt")
        if not os.path.isfile(listing):
            print(f"{domain}: 没有枚举文件")
            continue
        entries = [line.strip() for line in open(listing, encoding="utf-8") if line.strip()]
        rows = [classify(entry, bare, bare, raw) for entry in entries]
        counts = {
            "total": len(rows),
            "unreadable": sum(1 for row in rows if not row["read"]),
            "test": sum(1 for row in rows if row["test"]),
            "swing": sum(1 for row in rows if row["swing"]),
            "platform": sum(1 for row in rows if row["platform"]),
            "in_code": sum(1 for row in rows if row["in_code"]),
            "in_comment_only": sum(1 for row in rows if row["in_comment_only"]),
            "never": sum(1 for row in rows if not row["in_code"] and not row["in_comment_only"]),
        }
        with open(os.path.join(INV, domain + "_signals.json"), "w", encoding="utf-8") as handle:
            json.dump({"counts": counts, "rows": rows}, handle, ensure_ascii=False, indent=1)
        with open(os.path.join(INV, domain + "_signals.md"), "w", encoding="utf-8") as handle:
            handle.write(f"# {domain} 机械信号（`scripts/verdict_signals.py {domain}`）\n\n")
            handle.write("| 信号 | 类数 |\n|---|---:|\n")
            for key in ("total", "unreadable", "test", "swing", "platform", "in_code", "in_comment_only", "never"):
                handle.write(f"| {key} | {counts[key]} |\n")
            handle.write("\n| 类 | 行数 | 测试 | Swing | 平台专属 | TaoCode |\n|---|---:|---|---|---|---|\n")
            for row in rows:
                presence = "真实代码" if row["in_code"] else ("只被注释引用" if row["in_comment_only"] else "从未出现")
                handle.write(f"| `{row['name']}` | {row['lines']} | {'Y' if row['test'] else ''} | "
                             f"{'/'.join(row['swing'])} | {'/'.join(row['platform'])} | {presence} |\n")
        print(f"{domain}: " + " ".join(f"{k}={v}" for k, v in counts.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
