@echo off
call "C:/Program Files/Microsoft Visual Studio/18/Enterprise/VC/Auxiliary/Build/vcvarsall.bat" x64
set SDK_ROOT=C:/Program Files (x86)\Windows Kits\10
set SDK_VER=10.0.26100.0
set INCLUDE=%INCLUDE%;%SDK_ROOT%\Include\%SDK_VER%\ucrt;%SDK_ROOT%\Include\%SDK_VER%\um;%SDK_ROOT%\Include\%SDK_VER%\shared;%SDK_ROOT%\Include\%SDK_VER%\winrt
set LIB=%LIB%;%SDK_ROOT%\Lib\%SDK_VER%\ucrt\x64;%SDK_ROOT%\Lib\%SDK_VER%\um\x64
"C:/Program Files/Microsoft Visual Studio/18/Enterprise/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe" --build D:/TaoCode/build --target %1
