@ECHO OFF
SETLOCAL
SET EL=0

ECHO ~~~~~~~~~~~~~~~~~~~~~~~~~~~~ %~f0 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~

SET PATH=C:\Python27;%PATH%

SET APPVEYOR_REPO_COMMIT_MESSAGE=local build

IF EXIST lib\binding ECHO deleting lib/binding && RD /Q /S lib\binding
IF %ERRORLEVEL% NEQ 0 GOTO ERROR
IF EXIST node_modules ECHO deleting node_modules && RD /Q /S node_modules
IF %ERRORLEVEL% NEQ 0 GOTO ERROR

SET nodejs_version=0.12.7
SET platform=x64
SET msvs_toolset=14

CALL scripts\build-appveyor.bat
IF %ERRORLEVEL% NEQ 0 GOTO ERROR

GOTO DONE

:ERROR
ECHO ~~~~~~~~~~~~~~~~~~~~~~ ERROR %~f0 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~
ECHO ERRORLEVEL^: %ERRORLEVEL%
SET EL=%ERRORLEVEL%

:DONE
ECHO ~~~~~~~~~~~~~~~~~~~~~~ DONE %~f0 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~

EXIT /b %EL%