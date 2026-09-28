@echo off
setlocal
if not defined __RIG_RIG_TOOLS_RUNTIME_EXECUTABLE (
  echo Rig rig-tools runtime is unavailable. Restart Rig. 1>&2
  exit /b 1
)
"%__RIG_RIG_TOOLS_RUNTIME_EXECUTABLE%" "%~dp0..\rig-tools.js" %*
exit /b %errorlevel%
