# ALPHA LENS: Financial Document Analyzer MVP

This is a Minimum Viable Product (MVP) for a financial document analyzer that allows users to upload financial documents, processes them using a simplified version of the Landing.AI ADE pipeline, and enables chat-based interaction with the documents.

## Features

- **Document Upload**: Upload financial PDF documents
- **Document Processing**: Extract text, tables, and financial metrics
- **Document Querying**: Chat with the documents using natural language
- **Financial Metrics**: Extract key financial metrics like revenue, net income, etc.

## Getting Started

### Prerequisites

- Python 3.8+
- pip

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/alpha-lens-mvp.git
cd alpha-lens-mvp
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Set up environment variables (optional for MVP):
```bash
# Set this if you have a Landing.AI API key
export LANDING_AI_API_KEY="your-api-key"
export ADE_ENDPOINT="https://api.landing.ai/v1/ade"
```

### Running the Application

Start the FastAPI server:
```bash
python app.py
```

The server will start on `http://localhost:8000`. You can access the interactive API documentation at `http://localhost:8000/docs`.

## Usage

### API Endpoints

#### Upload a Document

```
POST /documents/upload
```
- Upload a financial document (PDF)
- Returns a document ID and processing status

#### Check Processing Status

```
GET /documents/{document_id}/status
```
- Check the current processing status of a document

#### Get Document Results

```
GET /documents/{document_id}
```
- Get the processed document details and summary

#### Chat with Document

```
POST /documents/chat
```
- Send a query to chat with a processed document
- Request body: `{"document_id": "your-document-id", "query": "your question"}`

#### List Documents

```
GET /documents
```
- List all uploaded documents

## Example Queries

Once you've uploaded a document, you can ask questions like:
- "What is the company's revenue?"
- "What was the net income for the period?"
- "What company is this document for?"
- "What were the total assets reported?"
- "Summarize the cash flow statement"

## Notes About This MVP

This is a simplified implementation for demonstration purposes:

1. **ADE Mock**: The Landing.AI ADE API is mocked for the MVP. In production, it would make real API calls.
2. **Simple Embeddings**: The vector embeddings are simplified. In production, you would use a proper embedding model.
3. **Basic QA**: The question-answering system is basic. In production, you would integrate an LLM like Claude, GPT, or Gemini.
4. **In-Memory Storage**: The MVP uses in-memory storage. In production, you would use MongoDB, S3, etc.

## Future Enhancements

- Integration with the real Landing.AI ADE API
- More robust financial data extraction
- Advanced question answering with an LLM
- Persistent storage with MongoDB and S3
- User authentication and document management
- Support for more document formats
