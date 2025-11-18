#!/bin/bash

echo "ALPHA LENS Setup Script"
echo "======================="
echo

# Create required directories
echo "Creating required directories..."
mkdir -p data/raw_docs data/extracted data/vector_stores data/final_outputs
echo "Directories created."
echo

# Check Python installation
if ! command -v python3 &> /dev/null
then
    echo "ERROR: Python 3 is not installed or not in PATH."
    echo "Please install Python 3.8 or newer and try again."
    exit 1
fi
echo "Python is installed."
echo

# Check for virtual environment
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to create virtual environment."
        echo "Please install venv package and try again."
        exit 1
    fi
    echo "Virtual environment created."
else
    echo "Virtual environment already exists."
fi
echo

# Activate virtual environment and install dependencies
echo "Installing dependencies..."
source venv/bin/activate
pip install -r requirements.txt
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install dependencies."
    exit 1
fi
echo "Dependencies installed."
echo

# Check .env file
if [ ! -f ".env" ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
    echo "IMPORTANT: Please edit the .env file to add your API keys."
else
    echo ".env file already exists."
fi
echo

# Check CORS settings in app.py
echo "Checking CORS settings in app.py..."
if grep -q "allow_origins=\[\"\*\"\]" app.py; then
    echo "CORS settings are already configured."
else
    echo "WARNING: You may need to update CORS settings in app.py to allow cross-origin requests."
    echo "Look for the CORSMiddleware section and ensure allow_origins includes your frontend URL."
fi
echo

echo "ALPHA LENS setup complete!"
echo
echo "To start the application:"
echo "1. Make sure your virtual environment is activated: source venv/bin/activate"
echo "2. Run the FastAPI server: python app.py"
echo "3. Open new_index.html in your browser"
echo
echo "Enjoy using ALPHA LENS!"
