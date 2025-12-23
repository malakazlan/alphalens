import os
import json
import re
from typing import Dict, Any, List

from vector_store import similarity_search
from llm_service import llm_service

try:
    import openai
except ImportError:
    openai = None

MAX_CONTEXT_CHARS = 8000
CITATION_PATTERN = re.compile(r"\[\[([^\]]+)\]\]")


def is_query_relevant_to_document(query: str, financial_data: Dict[str, Any] = None) -> bool:
    """Check if a query is relevant to the document or is a general question."""
    query_lower = query.lower().strip()
    
    # Check for math questions (simple arithmetic)
    math_patterns = [
        r'^\d+\s*[+\-*/]\s*\d+',  # "2+2", "5-3", "10*2", "8/4"
        r'what is \d+\s*[+\-*/]\s*\d+',  # "what is 2+2"
        r'calculate \d+\s*[+\-*/]\s*\d+',  # "calculate 2+2"
    ]
    for pattern in math_patterns:
        if re.search(pattern, query_lower):
            return False
    
    # Check for general knowledge questions unrelated to documents
    general_questions = [
        'what is the capital of',
        'who is the president of',
        'what is the weather',
        'tell me a joke',
        'what time is it',
        'what day is it',
    ]
    for gq in general_questions:
        if gq in query_lower:
            return False
    
    # Check if query contains document-related keywords
    doc_keywords = [
        'document', 'doc', 'file', 'statement', 'report', 'financial',
        'table', 'section', 'page', 'registrant', 'company', 'amount',
        'revenue', 'income', 'expense', 'asset', 'liability', 'metric',
        'data', 'submission', 'filing', 'commission', 'xbrl'
    ]
    
    # If query has document keywords, it's likely relevant
    if any(keyword in query_lower for keyword in doc_keywords):
        return True
    
    # Check if query asks about specific document content
    content_questions = [
        'what is', 'what are', 'how much', 'how many', 'when', 'where',
        'who', 'which', 'show me', 'find', 'list', 'explain'
    ]
    
    # If it's a question word but no document context, might be general
    if any(qw in query_lower for qw in content_questions):
        # Check similarity with document content
        if financial_data:
            # Check if query terms appear in document metadata or summary
            doc_text = ""
            if financial_data.get("summary"):
                doc_text += financial_data["summary"].lower()
            if financial_data.get("metadata"):
                doc_text += " " + json.dumps(financial_data["metadata"]).lower()
            
            # If query has terms matching document, it's relevant
            query_words = set(query_lower.split())
            doc_words = set(doc_text.split())
            if query_words.intersection(doc_words):
                return True
    
    # Default: assume relevant (let vector search decide)
    return True


def get_answer_from_document(
    query: str,
    vector_store_path: str,
    financial_data: Dict[str, Any] = None
) -> Dict[str, Any]:
    """Return a finance-grounded answer plus citation metadata with visual references."""
    if not financial_data:
        financial_data_path = os.path.join(vector_store_path, "financial_data.json")
        if os.path.exists(financial_data_path):
            with open(financial_data_path, "r") as f:
                financial_data = json.load(f)
        else:
            financial_data = {}
    
    # Check if query is relevant to the document
    query_lower = query.lower().strip()
    
    # First, check if this is an irrelevant question (math, general knowledge, etc.)
    if not is_query_relevant_to_document(query, financial_data):
        # Handle irrelevant questions directly and briefly
        answer = handle_irrelevant_question(query)
        return {
            "answer": answer,
            "sources": [],
            "source": "general_knowledge"
        }
    
    # Check if user wants bullet points or list format
    list_format_keywords = [
        "in bullets", "in bullet points", "as bullets", "as bullet points",
        "in a list", "as a list", "list", "bullets", "bullet points",
        "in points", "as points", "point form", "bullet form"
    ]
    wants_list_format = any(keyword in query_lower for keyword in list_format_keywords)
    
    # Check if this is a summarization request (more comprehensive detection)
    summary_keywords = [
        "summarize", "summary", "overview", "what is this document", "tell me about this document",
        "give me a summary", "document summary", "brief overview", "explain the document",
        "explain this document", "what does this document", "describe the document",
        "document overview", "summarize and explain", "explain and summarize", "explain about",
        "explain doc", "what are", "what components", "what sections", "document components",
        "document sections", "file sections", "many section", "can you summarize"
    ]
    # Also check for very short queries or queries with typos that might be summary requests
    is_summary_request = any(keyword in query_lower for keyword in summary_keywords)
    
    # Additional check: if query is very short or seems like a general question about the document
    if not is_summary_request and len(query_lower.split()) <= 5:
        # Check for common summary request patterns even with typos
        if any(word in query_lower for word in ["summ", "expl", "doc", "file", "about", "what", "component", "section"]):
            is_summary_request = True
    
    if is_summary_request:
        # Ensure we have financial_data
        if not financial_data:
            financial_data = {}
        
        # Generate comprehensive summary using LLM with full document data
        summary = llm_service.generate_document_summary(financial_data)
        
        # Ensure we got a valid summary
        if not summary or len(summary.strip()) < 10:
            # Fallback: generate basic summary from available data
            summary = _generate_fallback_summary(financial_data)
        
        # Get citations from key sections
        citations = extract_summary_citations(financial_data)
        return {
            "answer": summary,
            "sources": citations,
            "source": "gpt-3.5-turbo"
        }
    
    # Check if this is a simple question (name, date, amount, what/where/when)
    simple_question_patterns = [
        r'what is (my|the) name',
        r'what is (my|the) (date|amount|value|number)',
        r'who (am i|is)',
        r'when (is|was)',
        r'where (is|was)',
        r'how much',
        r'what (did|do) i (ask|said)',
        r'what (was|did) (i|you) (ask|say)',
        r'what (did|do) (i|you) (ask|say) (above|before)',
    ]
    
    is_simple_question = any(re.search(pattern, query_lower) for pattern in simple_question_patterns)
    
    relevant_chunks = similarity_search(query, vector_store_path, top_k=8)
    context_blocks = build_context_blocks(relevant_chunks, financial_data)
    
    # Enhance context blocks with financial_data if context is sparse
    if len(context_blocks) < 3 and financial_data:
        # Add metadata, key metrics, and tables as context blocks
        if financial_data.get("metadata"):
            context_blocks.append({
                "id": "metadata",
                "title": "Document Metadata",
                "page": None,
                "source": "metadata",
                "text": json.dumps(financial_data.get("metadata", {}), indent=2)
            })
        if financial_data.get("key_metrics"):
            metrics_text = "\n".join([
                f"{m.get('name', '')}: {m.get('value', '')} {m.get('unit', '')}"
                for m in financial_data.get("key_metrics", [])[:5]
            ])
            context_blocks.append({
                "id": "key_metrics",
                "title": "Key Financial Metrics",
                "page": None,
                "source": "metrics",
                "text": metrics_text
            })
    
    # For simple questions, use a more direct approach
    if is_simple_question:
        # Use fewer context blocks for simple questions
        context_blocks = context_blocks[:3]
    
    answer_text = llm_service.generate_finance_response(
        query=query,
        metadata=financial_data.get("metadata", {}),
        key_metrics=financial_data.get("key_metrics", []),
        context_blocks=context_blocks,
        financial_data=financial_data,
        is_simple_question=is_simple_question,
        wants_list_format=wants_list_format
    )
    
    # Check if answer contains "I'm sorry" or similar - if so, use fallback
    if not answer_text or "I'm sorry" in answer_text or "does not contain" in answer_text.lower() or "not provided" in answer_text.lower():
        # Try fallback with full financial_data
        fallback_context = build_fallback_context(financial_data, relevant_chunks)
        fallback_answer = llm_service.generate_response(query, fallback_context, financial_data)
        
        # If still no good answer, generate from financial_data directly
        if not fallback_answer or "I'm sorry" in fallback_answer or "does not contain" in fallback_answer.lower():
            # Generate answer directly from financial_data
            fallback_answer = _generate_answer_from_financial_data(query, financial_data)
        
        return {
            "answer": fallback_answer,
            "sources": extract_summary_citations(financial_data)[:3],  # Provide some citations
            "source": "local_llm"
        }
    
    clean_answer, citations = extract_citations_with_visual_refs(
        answer_text, 
        context_blocks, 
        financial_data,
        query
    )
    return {
        "answer": clean_answer or answer_text,
        "sources": citations,
        "source": "gpt-3.5-turbo"
    }


def build_context_blocks(relevant_chunks: List[Dict[str, Any]], financial_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Convert retrieved chunks into structured context blocks."""
    blocks: List[Dict[str, Any]] = []
    seen_ids = set()
    
    for chunk in relevant_chunks:
        metadata = chunk.get("metadata", {}) or {}
        chunk_id = metadata.get("chunk_id") or chunk.get("id")
        if not chunk_id or chunk_id in seen_ids:
            continue
        text = (chunk.get("text") or "").strip()
        if not text:
            continue
        seen_ids.add(chunk_id)
        blocks.append({
            "id": chunk_id,
            "title": metadata.get("title") or metadata.get("source") or "Context",
            "page": metadata.get("page"),
            "source": metadata.get("source"),
            "text": text[:2000]
        })
    
    if not blocks and financial_data.get("summary"):
        blocks.append({
            "id": "summary",
            "title": "Executive Summary",
            "page": None,
            "source": "summary",
            "text": financial_data["summary"][:2000]
        })
    
    return blocks[:8]


def extract_citations(answer_text: str, context_blocks: List[Dict[str, Any]]) -> (str, List[Dict[str, Any]]):
    """Strip citation markers from the answer and build citation metadata."""
    block_lookup = {block["id"]: block for block in context_blocks}
    citations = []
    seen = set()
    
    for match in CITATION_PATTERN.findall(answer_text or ""):
        if match in seen:
            continue
        block = block_lookup.get(match)
        if block:
            seen.add(match)
            citations.append({
                "chunk_id": match,
                "title": block.get("title"),
                "page": block.get("page"),
                "text": (block.get("text") or "")[:240]
            })
    
    clean_text = CITATION_PATTERN.sub('', answer_text or '').strip()
    clean_text = re.sub(r'\s+', ' ', clean_text)
    return clean_text, citations


def extract_citations_with_visual_refs(
    answer_text: str, 
    context_blocks: List[Dict[str, Any]],
    financial_data: Dict[str, Any],
    query: str
) -> tuple:
    """Extract citations with visual references (page, table/cell, value) in Landing.AI format."""
    block_lookup = {block["id"]: block for block in context_blocks}
    detected_chunks = financial_data.get("detected_chunks", [])
    tables = financial_data.get("tables", [])
    
    # Create lookup for detected chunks by ID
    chunk_lookup = {}
    for chunk in detected_chunks:
        chunk_id = chunk.get("id")
        if chunk_id:
            chunk_lookup[chunk_id] = chunk
    
    # Extract answer value (numeric values mentioned in answer)
    answer_value = extract_answer_value(answer_text, query)
    
    citations = []
    seen = set()
    
    for match in CITATION_PATTERN.findall(answer_text or ""):
        if match in seen:
            continue
        block = block_lookup.get(match)
        chunk = chunk_lookup.get(match)
        
        if block or chunk:
            seen.add(match)
            
            # Get page number
            page = None
            if chunk:
                page = chunk.get("page")
            elif block:
                page = block.get("page")
            
            # Get chunk type (table, text, etc.)
            chunk_type = "text"
            if chunk:
                chunk_type = chunk.get("type", "text")
            
            # Determine if it's a table
            is_table = chunk_type == "table"
            
            # Get the value from answer or extract from chunk
            value = answer_value
            if not value and chunk:
                # Try to extract value from chunk text
                chunk_text = chunk.get("text", "") or chunk.get("markdown", "")
                value = extract_numeric_value(chunk_text)
            
            # Build visual reference string
            page_label = f"Page {page + 1}" if isinstance(page, int) else "Page 1"
            type_label = "table, cell" if is_table else "text"
            value_label = f" | {value}" if value else ""
            
            visual_ref = f"{page_label}. {type_label}{value_label}"
            
            citations.append({
                "chunk_id": match,
                "title": block.get("title") if block else chunk.get("type", "Reference"),
                "page": page,
                "text": (block.get("text") or chunk.get("text", "") or "")[:240] if block or chunk else "",
                "type": chunk_type,
                "visual_ref": visual_ref,
                "value": value
            })
    
    # If no citations but we have an answer value, try to find matching chunks
    if not citations and answer_value:
        # Search for chunks containing the value
        for chunk in detected_chunks:
            chunk_text = chunk.get("text", "") or chunk.get("markdown", "")
            if answer_value in chunk_text or str(answer_value).replace(",", "") in chunk_text.replace(",", ""):
                page = chunk.get("page", 0)
                chunk_type = chunk.get("type", "text")
                is_table = chunk_type == "table"
                
                page_label = f"Page {page + 1}" if isinstance(page, int) else "Page 1"
                type_label = "table, cell" if is_table else "text"
                visual_ref = f"{page_label}. {type_label} | {answer_value}"
                
                citations.append({
                    "chunk_id": chunk.get("id", ""),
                    "title": chunk.get("type", "Reference"),
                    "page": page,
                    "text": chunk_text[:240],
                    "type": chunk_type,
                    "visual_ref": visual_ref,
                    "value": answer_value
                })
                break
    
    clean_text = CITATION_PATTERN.sub('', answer_text or '').strip()
    clean_text = re.sub(r'\s+', ' ', clean_text)
    return clean_text, citations


def extract_answer_value(answer_text: str, query: str) -> str:
    """Extract numeric value from answer text (e.g., "149,990")."""
    # Look for numbers with commas (formatted numbers)
    number_pattern = r'\d{1,3}(?:,\d{3})*(?:\.\d+)?'
    matches = re.findall(number_pattern, answer_text)
    
    if matches:
        # Return the first/largest number found
        return matches[0]
    
    # Look for currency amounts
    currency_pattern = r'[\$€£¥]\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)'
    currency_matches = re.findall(currency_pattern, answer_text)
    if currency_matches:
        return currency_matches[0]
    
    return None


def extract_numeric_value(text: str) -> str:
    """Extract the most prominent numeric value from text."""
    if not text:
        return None
    
    # Look for formatted numbers
    number_pattern = r'\d{1,3}(?:,\d{3})+(?:\.\d+)?'
    matches = re.findall(number_pattern, text)
    if matches:
        # Return the largest number
        return max(matches, key=lambda x: float(x.replace(",", "")))
    
    return None


def generate_document_summary(financial_data: Dict[str, Any]) -> str:
    """Generate a summary of the document - DEPRECATED: Use LLM service instead."""
    # This function is kept for backward compatibility but should use LLM service
    parts = []
    
    metadata = financial_data.get("metadata", {})
    if metadata.get("document_type"):
        parts.append(f"This is a {metadata.get('document_type')} document.")
    
    if metadata.get("company_name"):
        parts.append(f"Company: {metadata.get('company_name')}")
    
    if metadata.get("document_date"):
        parts.append(f"Date: {metadata.get('document_date')}")
    
    key_metrics = financial_data.get("key_metrics", [])
    if key_metrics:
        parts.append("Key metrics:")
        for metric in key_metrics[:5]:
            name = metric.get("name", "")
            value = metric.get("value", "")
            if name and value:
                parts.append(f"- {name}: {value}")
    
    tables = financial_data.get("tables", [])
    if tables:
        parts.append(f"The document contains {len(tables)} table(s) with financial data.")
    
    if not parts:
        return "This document has been processed, but no summary information is available yet."
    
    return " ".join(parts)


def extract_summary_citations(financial_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extract citations for summary from key document sections."""
    citations = []
    detected_chunks = financial_data.get("detected_chunks", [])
    
    # Get first few key chunks
    for chunk in detected_chunks[:3]:
        page = chunk.get("page", 0)
        chunk_type = chunk.get("type", "text")
        is_table = chunk_type == "table"
        
        page_label = f"Page {page + 1}" if isinstance(page, int) else "Page 1"
        type_label = "table" if is_table else "text"
        
        citations.append({
            "chunk_id": chunk.get("id", ""),
            "title": chunk.get("type", "Reference"),
            "page": page,
            "text": (chunk.get("text", "") or chunk.get("markdown", ""))[:240],
            "type": chunk_type,
            "visual_ref": f"{page_label}. {type_label}",
            "value": None
        })
    
    return citations


def _generate_answer_from_financial_data(query: str, financial_data: Dict[str, Any]) -> str:
    """Generate an answer directly from financial_data when LLM fails."""
    query_lower = query.lower()
    
    # Check what the user is asking about
    if any(word in query_lower for word in ["component", "section", "structure", "what are", "what is"]):
        # Document structure question
        parts = []
        detected_chunks = financial_data.get("detected_chunks", [])
        if detected_chunks:
            chunk_types = {}
            for chunk in detected_chunks:
                chunk_type = chunk.get("type", "text")
                chunk_types[chunk_type] = chunk_types.get(chunk_type, 0) + 1
            
            parts.append(f"This document contains {len(detected_chunks)} detected sections:")
            for chunk_type, count in chunk_types.items():
                parts.append(f"- {chunk_type.title()}: {count} section(s)")
        
        tables = financial_data.get("tables", [])
        if tables:
            parts.append(f"\nThe document includes {len(tables)} table(s):")
            for i, table in enumerate(tables[:5], 1):
                title = table.get("title", f"Table {i}")
                parts.append(f"- {title}")
        
        metadata = financial_data.get("metadata", {})
        if metadata:
            parts.append("\nDocument Information:")
            if metadata.get("document_type"):
                parts.append(f"- Type: {metadata.get('document_type')}")
            if metadata.get("company_name"):
                parts.append(f"- Company: {metadata.get('company_name')}")
            if metadata.get("document_date"):
                parts.append(f"- Date: {metadata.get('document_date')}")
        
        return "\n".join(parts) if parts else "This document has been processed and contains structured financial data."
    
    # Default: provide general document info
    return _generate_fallback_summary(financial_data)


def _generate_fallback_summary(financial_data: Dict[str, Any]) -> str:
    """Generate a basic summary from available data when LLM fails."""
    parts = []
    
    metadata = financial_data.get("metadata", {})
    if metadata:
        if metadata.get("document_type"):
            parts.append(f"This is a {metadata.get('document_type')} document.")
        if metadata.get("company_name"):
            parts.append(f"Company/Organization: {metadata.get('company_name')}")
        if metadata.get("document_date"):
            parts.append(f"Date: {metadata.get('document_date')}")
    
    key_metrics = financial_data.get("key_metrics", [])
    if key_metrics:
        parts.append("\nKey Financial Metrics:")
        for metric in key_metrics[:8]:
            name = metric.get("name", "")
            value = metric.get("value", "")
            unit = metric.get("unit", "")
            if name and value is not None:
                if isinstance(value, (int, float)):
                    formatted = f"${value:,.2f}" if unit == "USD" else f"{value:,}"
                else:
                    formatted = str(value)
                parts.append(f"- {name}: {formatted} {unit}")
    
    tables = financial_data.get("tables", [])
    if tables:
        parts.append(f"\nThe document contains {len(tables)} table(s) with structured financial data.")
        # Include table titles
        table_titles = [t.get("title", f"Table {i+1}") for i, t in enumerate(tables[:5])]
        if table_titles:
            parts.append(f"Tables include: {', '.join(table_titles)}")
    
    detected_chunks = financial_data.get("detected_chunks", [])
    if detected_chunks:
        chunk_types = {}
        for chunk in detected_chunks:
            chunk_type = chunk.get("type", "text")
            chunk_types[chunk_type] = chunk_types.get(chunk_type, 0) + 1
        if chunk_types:
            parts.append(f"\nDocument Structure: {len(detected_chunks)} detected sections")
            for chunk_type, count in chunk_types.items():
                parts.append(f"- {chunk_type.title()}: {count} section(s)")
    
    document_markdown = financial_data.get("document_markdown", "") or financial_data.get("markdown", "")
    if document_markdown and len(document_markdown) > 100:
        # Extract first few sentences from markdown
        sentences = document_markdown[:500].split('.')
        if len(sentences) > 1:
            preview = '. '.join(sentences[:3]) + '.'
            parts.append(f"\nDocument Content Preview:\n{preview}")
    
    if not parts:
        return "This document has been processed. The document contains financial data, but specific summary details are not available. Please ask specific questions about the document content."
    
    return "\n".join(parts)


def handle_irrelevant_question(query: str) -> str:
    """Handle questions that are not related to the document."""
    query_lower = query.lower().strip()
    
    # Handle math questions
    math_match = re.search(r'(\d+)\s*([+\-*/])\s*(\d+)', query_lower)
    if math_match:
        try:
            num1 = int(math_match.group(1))
            operator = math_match.group(2)
            num2 = int(math_match.group(3))
            
            if operator == '+':
                result = num1 + num2
            elif operator == '-':
                result = num1 - num2
            elif operator == '*':
                result = num1 * num2
            elif operator == '/':
                if num2 == 0:
                    return "Division by zero is undefined.\n\n*Note: This question is not related to the document content.*"
                result = num1 / num2
            else:
                return f"I can help with that, but this question is not related to the document. Please ask questions about the document content instead."
            
            # Format result (remove .0 for whole numbers)
            if isinstance(result, float) and result.is_integer():
                result = int(result)
            
            return f"{result}\n\n*Note: This question is not related to the document content.*"
        except:
            pass
    
    # Handle other general questions - use LLM for brief answer
    try:
        if openai:
            from config import settings
            
            api_key = settings.OPENAI_API_KEY or os.environ.get("OPENAI_API_KEY")
            if api_key:
                client = openai.OpenAI(api_key=api_key)
                response = client.chat.completions.create(
                    model="gpt-3.5-turbo",
                    messages=[
                        {"role": "system", "content": "You are a helpful assistant. Answer questions directly and concisely in 1-2 sentences maximum."},
                        {"role": "user", "content": query}
                    ],
                    temperature=0.3,
                    max_tokens=100
                )
                answer = response.choices[0].message.content.strip()
                return f"{answer}\n\n*Note: This question is not related to the document content.*"
    except Exception as e:
        print(f"Error handling irrelevant question: {e}")
        pass
    
    # Fallback for irrelevant questions
    return f"I can help with that, but this question is not related to the document. Please ask questions about the document content instead."


def build_fallback_context(financial_data: Dict[str, Any], relevant_chunks: List[Dict[str, Any]]) -> str:
    """Assemble a plain-text context string for legacy fallback responses."""
    parts = []
    
    if financial_data.get("summary"):
        parts.append("Summary:\n" + financial_data["summary"])
    
    key_metrics = financial_data.get("key_metrics") or []
    if key_metrics:
        metrics_lines = ["Key Metrics:"]
        for metric in key_metrics[:8]:
            name = metric.get("name")
            value = metric.get("value")
            unit = metric.get("unit") or ""
            if name and value is not None:
                metrics_lines.append(f"- {name}: {value} {unit}")
        parts.append("\n".join(metrics_lines))
    
    total_len = sum(len(p) for p in parts)
    for chunk in relevant_chunks:
        text = (chunk.get("text") or "").strip()
        if not text:
            continue
        parts.append(text)
        total_len += len(text)
        if total_len > MAX_CONTEXT_CHARS:
            break
    
    return "\n\n".join(parts)