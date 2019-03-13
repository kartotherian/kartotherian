@ECHO OFF
SETLOCAL
SET EL=0

ECHO ~~~~~~~~~~~~~~~~~~~~~~~~~~~~ %~f0 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~

SET PATH=%CD%;%PATH%

ECHO APPVEYOR^: %APPVEYOR%
ECHO nodejs_version^: %nodejs_version%
ECHO platform^: %platform%

ECHO downloading/installing node
::always install (get npm matching node), but delete installed programfiles node.exe afterwards for VS2015 (using custom node.exe)
IF /I "%APPVEYOR%"=="True" powershell Install-Product node $env:nodejs_version $env:Platform
IF %ERRORLEVEL% NEQ 0 GOTO ERROR

::custom node for VS2015
SET ARCHPATH=
IF "%platform%"=="x64" (SET ARCHPATH=x64/)
SET NODE_URL=https://mapbox.s3.amazonaws.com/node-cpp11/v%nodejs_version%/%ARCHPATH%node.exe
ECHO downloading node^: %NODE_URL%
powershell Invoke-WebRequest "${env:NODE_URL}" -OutFile node.exe
IF %ERRORLEVEL% NEQ 0 GOTO ERROR

ECHO deleting node ...
SET NODE_EXE_PRG=%ProgramFiles%\nodejs\node.exe
IF EXIST "%NODE_EXE_PRG%" ECHO found %NODE_EXE_PRG%, deleting... && DEL /F "%NODE_EXE_PRG%"
IF %ERRORLEVEL% NEQ 0 GOTO ERROR
SET NODE_EXE_PRG=%ProgramFiles(x86)%\nodejs\node.exe
IF EXIST "%NODE_EXE_PRG%" ECHO found %NODE_EXE_PRG%, deleting... && DEL /F "%NODE_EXE_PRG%"
IF %ERRORLEVEL% NEQ 0 GOTO ERROR


ECHO available node.exe^:
where node
ECHO available npm^:
where npm

ECHO node^: && node -v
node -e "console.log(process.argv,process.execPath)"
IF %ERRORLEVEL% NEQ 0 GOTO ERROR

ECHO npm^: && CALL npm -v
IF %ERRORLEVEL% NEQ 0 GOTO ERROR

ECHO ===== where npm puts stuff START ============
ECHO npm root && CALL npm root
IF %ERRORLEVEL% NEQ 0 GOTO ERROR
ECHO npm root -g && CALL npm root -g
IF %ERRORLEVEL% NEQ 0 GOTO ERROR

ECHO npm bin && CALL npm bin
IF %ERRORLEVEL% NEQ 0 GOTO ERROR
ECHO npm bin -g && CALL npm bin -g
IF %ERRORLEVEL% NEQ 0 GOTO ERROR

SET NPM_BIN_DIR=
FOR /F "tokens=*" %%i in ('CALL npm bin -g') DO SET NPM_BIN_DIR=%%i
IF %ERRORLEVEL% NEQ 0 GOTO ERROR
IF /I "%NPM_BIN_DIR%"=="%CD%" ECHO ERROR npm bin -g equals local directory && SET ERRORLEVEL=1 && GOTO ERROR
ECHO ===== where npm puts stuff END ============


ECHO calling npm install && CALL npm install --fallback-to-build=false --toolset=v140 --loglevel=http
IF %ERRORLEVEL% NEQ 0 GOTO ERROR

ECHO calling npm test && CALL npm test
IF %ERRORLEVEL% NEQ 0 GOTO ERROR


GOTO DONE



:ERROR
ECHO ~~~~~~~~~~~~~~~~~~~~~~ ERROR %~f0 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~
ECHO ERRORLEVEL^: %ERRORLEVEL%
SET EL=%ERRORLEVEL%

:DONE
ECHO ~~~~~~~~~~~~~~~~~~~~~~ DONE %~f0 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~

EXIT /b %EL%
