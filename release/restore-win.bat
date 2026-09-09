@echo off
echo ================================================================================
echo    Assembling Antigravity SMT MES Simulator Windows Executable...
echo ================================================================================
copy /b mes-simulator-win.exe.part* mes-simulator-win.exe
if %ERRORLEVEL% equ 0 (
    echo.
    echo  [SUCCESS] mes-simulator-win.exe assembled successfully!
    echo.
    echo  To start the simulator, double-click "mes-simulator-win.exe" or run:
    echo     mes-simulator-win.exe
    echo.
) else (
    echo.
    echo  [ERROR] Failed to assemble mes-simulator-win.exe. Please verify all parts exist.
    echo.
)
pause
