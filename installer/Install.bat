@echo off
rem Island Chatter AE - double-click installer.
rem
rem Wraps Install-IslandChatter.ps1 so nobody has to open PowerShell or know
rem about execution policy. It re-launches itself elevated when needed, because
rem the plug-in lives under Program Files.
rem
rem Kept ASCII on purpose: a .bat is read in the console code page, so Chinese
rem here would arrive as mojibake on some machines. The PowerShell script it
rem calls is UTF-8 with a BOM and prints the bilingual messages.

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
echo   Island Chatter AE - Install
echo ============================================
echo.

tasklist /FI "IMAGENAME eq AfterFX.exe" 2>nul | find /I "AfterFX.exe" >nul
if "%errorlevel%"=="0" (
    echo   After Effects is still running.
    echo   Please close it completely, then run this again.
    echo.
    goto :finish
)

rem Ships at the top of the extracted folder, but also has to work from the
rem repository where it sits next to the script.
set "SCRIPT=%~dp0installer\Install-IslandChatter.ps1"
if not exist "%SCRIPT%" set "SCRIPT=%~dp0Install-IslandChatter.ps1"
if not exist "%SCRIPT%" (
    echo   Cannot find Install-IslandChatter.ps1 next to this file.
    goto :finish
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
set "RESULT=%errorlevel%"
echo.

if not "%RESULT%"=="0" (
    echo   Installation FAILED. See the message above.
    goto :finish
)

echo   Done. Start After Effects and open:
echo     Window ^> IslandChatterNativePanel.jsx
echo.

:finish
echo Press any key to close this window.
pause >nul
endlocal
