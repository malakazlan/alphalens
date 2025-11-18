import os
import json
import numpy as np
from typing import Dict, Any, List, Tuple, Optional
import re

# Default chunk size for text splitting
DEFAULT_CHUNK_SIZE = 1000
DEFAULT_CHUNK_OVERLAP = 200

def create_vector_store(
    financial_data: Dict[str, Any],
    pdf_text: str,
    vector_store_path: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP
) -> None:
    """
    Create a simple vector store from financial data and PDF text
    
    Args:
        financial_data: Extracted financial data
        pdf_text: Raw text from PDF
        vector_store_path: Path to store vectors
        chunk_size: Size of text chunks
        chunk_overlap: Overlap between chunks
    """
    try:
        # Create vector store directory if it doesn't exist
        os.makedirs(vector_store_path, exist_ok=True)
        
        # Save financial data for quick retrieval
        financial_data_path = os.path.join(vector_store_path, "financial_data.json")
        with open(financial_data_path, "w") as f:
            json.dump(financial_data, f)
        
        # Split PDF text into chunks
        # IMPORTANT: Rename the function call to split_text to avoid name collision
        pdf_chunks = split_text(pdf_text, chunk_size, chunk_overlap)
        
        # Create vectors from chunks (simplified for MVP)
        vectors = []
        for i, chunk in enumerate(pdf_chunks):
            # In a real implementation, we'd use a proper embedding model here
            # For MVP, we'll just store the raw text
            vector_entry = {
                "id": f"chunk-{i}",
                "text": chunk,
                "metadata": {
                    "source": "pdf",
                    "index": i,
                    "chunk_id": f"chunk-{i}",
                    "page": None
                }
            }
            vectors.append(vector_entry)
        
        # Add financial data as chunks too
        # Metadata
        metadata_text = json.dumps(financial_data.get("metadata", {}), indent=2)
        vector_entry = {
            "id": "metadata",
            "text": metadata_text,
            "metadata": {
                "source": "metadata",
                "chunk_id": "metadata",
                "page": None
            }
        }
        vectors.append(vector_entry)
        
        # Income statement
        if financial_data.get("income_statement"):
            income_text = json.dumps(financial_data.get("income_statement", {}), indent=2)
            vector_entry = {
                "id": "income_statement",
                "text": "Income Statement: " + income_text,
                "metadata": {
                    "source": "income_statement",
                    "chunk_id": "income_statement",
                    "page": None
                }
            }
            vectors.append(vector_entry)
        
        # Balance sheet
        if financial_data.get("balance_sheet"):
            balance_text = json.dumps(financial_data.get("balance_sheet", {}), indent=2)
            vector_entry = {
                "id": "balance_sheet",
                "text": "Balance Sheet: " + balance_text,
                "metadata": {
                    "source": "balance_sheet",
                    "chunk_id": "balance_sheet",
                    "page": None
                }
            }
            vectors.append(vector_entry)
        
        # Cash flow
        if financial_data.get("cash_flow"):
            cash_text = json.dumps(financial_data.get("cash_flow", {}), indent=2)
            vector_entry = {
                "id": "cash_flow",
                "text": "Cash Flow: " + cash_text,
                "metadata": {
                    "source": "cash_flow",
                    "chunk_id": "cash_flow",
                    "page": None
                }
            }
            vectors.append(vector_entry)
        
        # Key metrics
        if financial_data.get("key_metrics"):
            for i, metric in enumerate(financial_data.get("key_metrics", [])):
                metric_text = json.dumps(metric, indent=2)
                vector_entry = {
                    "id": f"metric-{i}",
                    "text": f"Key Metric: {metric.get('name', 'Unknown')}: {metric_text}",
                    "metadata": {
                        "source": "key_metrics",
                        "metric": metric.get("name", "Unknown"),
                        "chunk_id": f"metric-{i}",
                        "page": None
                    }
                }
                vectors.append(vector_entry)
        
        # Include summary if available
        if financial_data.get("summary"):
            vectors.append({
                "id": "summary",
                "text": f"Document Summary: {financial_data['summary']}",
                "metadata": {
                    "source": "summary",
                    "chunk_id": "summary",
                    "page": None
                }
            })
        
        # Include tables
        for idx, table in enumerate(financial_data.get("tables", [])):
            header = table.get("header") or []
            rows = table.get("rows") or []
            title = table.get("title") or f"Table {idx + 1}"
            page = table.get("page")
            table_id = table.get("id") or f"table-{idx}"
            
            table_text = f"{title} (Page {page + 1 if isinstance(page, int) else 'n/a'}):\n"
            if header:
                table_text += " | ".join(header) + "\n"
            for row in rows[:15]:
                row_values = []
                for col in header or row.keys():
                    row_values.append(str(row.get(col, "")).strip())
                table_text += " | ".join(row_values) + "\n"
            if len(rows) > 15:
                table_text += f"... (+{len(rows) - 15} more rows)\n"
            
            vectors.append({
                "id": table_id,
                "text": table_text,
                "metadata": {
                    "source": "table",
                    "chunk_id": table_id,
                    "page": page,
                    "title": title
                }
            })
        
        # Save vectors to file
        vectors_path = os.path.join(vector_store_path, "vectors.json")
        with open(vectors_path, "w") as f:
            json.dump(vectors, f)
    
    except Exception as e:
        print(f"Error creating vector store: {str(e)}")
        import traceback
        traceback.print_exc()
        # Create a basic store with just the financial data
        os.makedirs(vector_store_path, exist_ok=True)
        financial_data_path = os.path.join(vector_store_path, "financial_data.json")
        with open(financial_data_path, "w") as f:
            json.dump(financial_data, f)

# IMPORTANT: Rename chunk_text function to split_text to avoid name collision
def split_text(text: str, chunk_size: int = DEFAULT_CHUNK_SIZE, chunk_overlap: int = DEFAULT_CHUNK_OVERLAP) -> List[str]:
    """
    Split text into chunks of specified size with overlap
    
    Args:
        text: Text to split
        chunk_size: Size of each chunk
        chunk_overlap: Overlap between chunks
    
    Returns:
        List of text chunks
    """
    if not text:
        return []
    
    # Split by paragraphs first
    paragraphs = [p for p in text.split('\n\n') if p.strip()]
    
    chunks = []
    current_chunk = ""
    
    for paragraph in paragraphs:
        # If the paragraph itself is too big, split it by sentences
        if len(paragraph) > chunk_size:
            sentences = [s for s in re.split(r'(?<=[.!?])\s+', paragraph) if s.strip()]
            
            for sentence in sentences:
                # If adding this sentence exceeds the chunk size, start a new chunk
                if len(current_chunk) + len(sentence) > chunk_size and current_chunk:
                    chunks.append(current_chunk)
                    # Keep some overlap
                    current_chunk = current_chunk[-chunk_overlap:] if chunk_overlap > 0 else ""
                
                current_chunk += " " + sentence
        else:
            # If adding this paragraph exceeds the chunk size, start a new chunk
            if len(current_chunk) + len(paragraph) > chunk_size and current_chunk:
                chunks.append(current_chunk)
                # Keep some overlap
                current_chunk = current_chunk[-chunk_overlap:] if chunk_overlap > 0 else ""
            
            current_chunk += " " + paragraph
    
    # Add the last chunk if not empty
    if current_chunk:
        chunks.append(current_chunk)
    
    # Clean up the chunks
    chunks = [chunk.strip() for chunk in chunks]
    
    return chunks

def similarity_search(
    query: str,
    vector_store_path: str,
    top_k: int = 3
) -> List[Dict[str, Any]]:
    """
    Search for similar chunks in the vector store
    
    Args:
        query: User's query
        vector_store_path: Path to vector store
        top_k: Number of top results to return
    
    Returns:
        List of relevant chunks
    """
    try:
        # Load vectors from file
        vectors_path = os.path.join(vector_store_path, "vectors.json")
        
        if not os.path.exists(vectors_path):
            return []
        
        with open(vectors_path, "r") as f:
            vectors = json.load(f)
        
        # In a real implementation, we'd use proper vector similarity
        # For MVP, we'll use a simple keyword matching approach
        query_keywords = set(query.lower().split())
        
        scored_chunks = []
        for chunk in vectors:
            chunk_text = chunk.get("text", "").lower()
            
            # Count keyword matches
            score = 0
            for keyword in query_keywords:
                if keyword in chunk_text:
                    score += 1
            
            # Normalize score
            if query_keywords:
                score = score / len(query_keywords)
            
            scored_chunks.append((score, chunk))
        
        # Sort by score descending
        scored_chunks.sort(reverse=True, key=lambda x: x[0])
        
        # Take top-k results with score > 0
        top_chunks = [chunk for score, chunk in scored_chunks[:top_k] if score > 0]
        
        return top_chunks
    
    except Exception as e:
        print(f"Error in similarity search: {str(e)}")
        import traceback
        traceback.print_exc()
        return []