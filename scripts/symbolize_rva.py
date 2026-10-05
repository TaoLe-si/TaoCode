"""把 `TaoCode.exe+0xRVA` 列表符号化成 `函数  [文件:行]`。

用法：python scripts/symbolize_rva.py <exe 或 pdb 所在目录> 0x31A7FC 0x31B0DC ...
"""
import ctypes, sys, os
from ctypes import wintypes

DBGHELP = ctypes.WinDLL("dbghelp", use_last_error=True)


class SYMBOL_INFOW(ctypes.Structure):
    _fields_ = [("SizeOfStruct", wintypes.ULONG), ("TypeIndex", wintypes.ULONG), ("Reserved", ctypes.c_ulonglong * 2),
                ("Index", wintypes.ULONG), ("Size", wintypes.ULONG), ("ModBase", ctypes.c_ulonglong),
                ("Flags", wintypes.ULONG), ("Value", ctypes.c_ulonglong), ("Address", ctypes.c_ulonglong),
                ("Register", wintypes.ULONG), ("Scope", wintypes.ULONG), ("Tag", wintypes.ULONG),
                ("NameLen", wintypes.ULONG), ("MaxNameLen", wintypes.ULONG), ("Name", ctypes.c_wchar * 2000)]


class IMAGEHLP_LINEW64(ctypes.Structure):
    _fields_ = [("SizeOfStruct", wintypes.DWORD), ("Key", ctypes.c_void_p), ("LineNumber", wintypes.DWORD),
                ("FileName", wintypes.LPWSTR), ("Address", ctypes.c_ulonglong)]


def main():
    exe = sys.argv[1]
    rvas = [int(value, 16) for value in sys.argv[2:]]
    DBGHELP.SymSetOptions.argtypes = [wintypes.DWORD]
    DBGHELP.SymSetOptions(0x2 | 0x4 | 0x10)  # UNDNAME | DEFERRED_LOADS | LOAD_LINES
    DBGHELP.SymInitializeW.argtypes = [wintypes.HANDLE, wintypes.LPCWSTR, wintypes.BOOL]
    DBGHELP.SymInitializeW(0, os.path.dirname(exe), False)
    DBGHELP.SymLoadModuleExW.argtypes = [wintypes.HANDLE, wintypes.HANDLE, wintypes.LPCWSTR, wintypes.LPCWSTR,
                                         ctypes.c_ulonglong, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]
    DBGHELP.SymLoadModuleExW.restype = ctypes.c_ulonglong
    DBGHELP.SymFromAddrW.argtypes = [wintypes.HANDLE, ctypes.c_ulonglong, ctypes.POINTER(ctypes.c_ulonglong),
                                     ctypes.POINTER(SYMBOL_INFOW)]
    DBGHELP.SymGetLineFromAddrW64.argtypes = [wintypes.HANDLE, ctypes.c_ulonglong, ctypes.POINTER(wintypes.DWORD),
                                              ctypes.POINTER(IMAGEHLP_LINEW64)]
    loaded = DBGHELP.SymLoadModuleExW(0, None, exe, None, 0x10000000, 0x1000000, None, 0)
    if not loaded:
        print(f"SymLoadModuleExW failed err={ctypes.get_last_error()}")
    for rva in rvas:
        symbol = SYMBOL_INFOW(); symbol.SizeOfStruct = 88; symbol.MaxNameLen = 1999
        displacement = ctypes.c_ulonglong(0)
        if DBGHELP.SymFromAddrW(0, ctypes.c_ulonglong(0x10000000 + rva), ctypes.byref(displacement), ctypes.byref(symbol)):
            text = f"0x{rva:06X}  {symbol.Name}+0x{displacement.value:X}"
            line = IMAGEHLP_LINEW64(); line.SizeOfStruct = ctypes.sizeof(IMAGEHLP_LINEW64)
            if DBGHELP.SymGetLineFromAddrW64(0, ctypes.c_ulonglong(0x10000000 + rva), ctypes.byref(ctypes.c_ulong(0)), ctypes.byref(line)):
                text += f"  [{ctypes.c_wchar_p(line.FileName).value}:{line.LineNumber}]"
            print(text)
        else:
            print(f"0x{rva:06X}  <no symbol> err={ctypes.get_last_error()}")


if __name__ == "__main__":
    main()
