@echo off
rem Builds the native host inside an environment where reg.exe is blocked, so
rem vcvarsall cannot discover the Windows SDK. The SDK directories are appended
rem by hand; everything else comes from vcvarsall.
call "C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvarsall.bat" x64
if errorlevel 1 echo VCVARS_FAILED && exit /b 1
set SDK_ROOT=C:\Program Files (x86)\Windows Kits\10
set SDK_VER=10.0.26100.0
set INCLUDE=%INCLUDE%;%SDK_ROOT%\Include\%SDK_VER%\ucrt;%SDK_ROOT%\Include\%SDK_VER%\um;%SDK_ROOT%\Include\%SDK_VER%\shared;%SDK_ROOT%\Include\%SDK_VER%\winrt
set LIB=%LIB%;%SDK_ROOT%\Lib\%SDK_VER%\ucrt\x64;%SDK_ROOT%\Lib\%SDK_VER%\um\x64
set CMAKE_BIN=C:\Program Files\Microsoft Visual Studio\18\Enterprise\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin
"%CMAKE_BIN%\cmake.exe" --build D:\TaoCode\build --parallel
if errorlevel 1 exit /b %ERRORLEVEL%
if "%1"=="--test" "%CMAKE_BIN%\ctest.exe" --test-dir D:\TaoCode\build --output-on-failure
exit /b %ERRORLEVEL%
