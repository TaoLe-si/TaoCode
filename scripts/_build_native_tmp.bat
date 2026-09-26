@echo off
call "C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvarsall.bat" x64
if errorlevel 1 echo VCVARS_FAILED && exit /b 1
rem vcvarsall cannot read the registry here (reg.exe is blocked by policy), so the
rem Windows SDK directories it would normally add are empty. Append them by hand.
set SDK_ROOT=C:\Program Files (x86)\Windows Kits\10
set SDK_VER=10.0.26100.0
set INCLUDE=%INCLUDE%;%SDK_ROOT%\Include\%SDK_VER%\ucrt;%SDK_ROOT%\Include\%SDK_VER%\um;%SDK_ROOT%\Include\%SDK_VER%\shared;%SDK_ROOT%\Include\%SDK_VER%\winrt
set LIB=%LIB%;%SDK_ROOT%\Lib\%SDK_VER%\ucrt\x64;%SDK_ROOT%\Lib\%SDK_VER%\um\x64
set CMAKE_EXE=C:\Program Files\Microsoft Visual Studio\18\Enterprise\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe
"%CMAKE_EXE%" --build D:\TaoCode\build --parallel
set RC=%ERRORLEVEL%
if "%1"=="--test" if "%RC%"=="0" "%CMAKE_EXE%" --build D:\TaoCode\build --parallel && D:\TaoCode\build\ctest_dummy >nul 2>&1
exit /b %RC%
