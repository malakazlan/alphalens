@echo off
echo ALPHA LENS Setup Script
echo =======================
echo.

REM Create required directories
echo Creating required directories...
mkdir data\raw_docs 2>NUL
mkdir data\extracted 2>NUL
mkdir data\vector_stores 2>NUL
mkdir data\final_outputs 2>NUL
echo Directories created.
echo.

REM Check Python installation
python --version >NUL 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Python is not installed or not in PATH.
    echo Please install Python 3.8 or newer and try again.
    exit /b 1
)
echo Python is installed.
echo.

REM Check for virtual environment
if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Failed to create virtual environment.
        echo Please install venv package and try again.
        exit /b 1
    )
    echo Virtual environment created.
) else (
    echo Virtual environment already exists.
)
echo.

REM Activate virtual environment and install dependencies
echo Installing dependencies...
call venv\Scripts\activate.bat
pip install -r requirements.txt
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to install dependencies.
    exit /b 1
)
echo Dependencies installed.
echo.

REM Check .env file
if not exist .env (
    echo Creating .env file from .env.example...
    copy .env.example .env
    echo IMPORTANT: Please edit the .env file to add your API keys.
) else (
    echo .env file already exists.
)
echo.

echo ALPHA LENS setup complete!
echo.
echo To start the application:
echo 1. Make sure your virtual environment is activated: venv\Scripts\activate
echo 2. Run the FastAPI server: python app.py
echo 3. Open new_index.html in your browser
echo.
echo Enjoy using ALPHA LENS!

REM Keep the window open
pause
