@echo off
rem Island Chatter AE - double-click uninstaller. See Install.bat for why this
rem file stays ASCII.

setlocal
cd /d "%~dp0"

net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo Requesting administrator permission...
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "Start-Process -FilePath '%~f0' -ArgumentList 'elevated' -Verb RunAs"
    exit /b 0
)

echo ============================================
echo   Island Chatter AE - Uninstall
echo ============================================
echo.

tasklist /FI "IMAGENAME eq AfterFX.exe" 2>nul | find /I "AfterFX.exe" >nul
if "%errorlevel%"=="0" (
    echo   After Effects is still running.
    echo   Please close it completely, then run this again.
    echo.
    goto :finish
)

rem Ships at the top of the extracted folder with everything else tucked into
rem resources\. Older packages used installer\, and in the repository this file
rem sits next to the script, so all three are tried.
set "SCRIPT=%~dp0resources\Uninstall-IslandChatter.ps1"
if not exist "%SCRIPT%" set "SCRIPT=%~dp0installer\Uninstall-IslandChatter.ps1"
if not exist "%SCRIPT%" set "SCRIPT=%~dp0Uninstall-IslandChatter.ps1"
if not exist "%SCRIPT%" (
    echo   Cannot find Uninstall-IslandChatter.ps1 next to this file.
    goto :finish
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
set "RESULT=%errorlevel%"
echo.

if not "%RESULT%"=="0" (
    echo   Uninstall FAILED. See the message above.
    goto :finish
)

echo   Island Chatter has been removed.
echo.

:finish
echo Press any key to close this window.
pause >nul
endlocal
