FROM python:3.10-slim

WORKDIR /app

# Copy requirements file
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY *.py .
COPY .env .

# Create necessary directories
RUN mkdir -p data/raw_docs data/vector_stores data/extracted data/final_outputs

# Expose the port
EXPOSE 8000

# Start the application
CMD ["python", "app.py"]
