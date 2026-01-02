import os
import json
import re
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime

from vector_store import similarity_search
from llm_service import llm_service

try:
    import openai
except ImportError:
    openai = None

MAX_CONTEXT_CHARS = 8000
CITATION_PATTERN = re.compile(r"\[\[([^\]]+)\]\]")

# In-memory conversation history (in production, use Redis or database)
# Format: {document_id: [{query: str, answer: str, timestamp: str}, ...]}
conversation_history: Dict[str, List[Dict[str, Any]]] = {}


def is_query_relevant_to_document(query: str, financial_data: Dict[str, Any] = None) -> bool:
    """Check if a query is relevant to the document or is a general question."""
    query_lower = query.lower().strip()
    
    # Check for math questions (simple arithmetic)
    math_patterns = [
        r'^\d+\s*[+\-*/]\s*\d+',  # "2+2", "5-3", "10*2", "8/4"
        r'what is \d+\s*[+\-*/]\s*\d+',  # "what is 2+2"
        r'calculate \d+\s*[+\-*/]\s*\d+',  # "calculate 2+2"
        r'^\d+\s*plus\s*\d+',  # "2 plus 2"
        r'^\d+\s*minus\s*\d+',  # "5 minus 3"
        r'^\d+\s*times\s*\d+',  # "2 times 3"
        r'^\d+\s*divided by\s*\d+',  # "10 divided by 2"
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
        'who invented',
        'when was',
        'where is',
        'what is the population of',
        'explain quantum physics',
        'what is gravity',
        'how does photosynthesis work',
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

def is_financial_term_question(query: str) -> bool:
    """Check if the query is asking for a financial term definition."""
    query_lower = query.lower().strip()
    
    financial_term_patterns = [
        r'what is (an? )?(.*?)(?:mean|meaning|definition|explain)',
        r'explain (.*?)(?:term|concept)',
        r'what does (.*?) mean',
        r'define (.*?)',
        r'what is (.*?)(?:in finance|financial)',
    ]
    
    financial_terms = [
        'revenue', 'income', 'profit', 'loss', 'asset', 'liability', 'equity',
        'cash flow', 'ebitda', 'eps', 'roe', 'roi', 'debt', 'leverage',
        'margin', 'depreciation', 'amortization', 'balance sheet', 'income statement',
        'cash flow statement', 'working capital', 'current ratio', 'quick ratio',
        'debt to equity', 'price to earnings', 'dividend', 'yield', 'volatility',
        'beta', 'alpha', 'hedge', 'derivative', 'option', 'futures', 'swap',
        'bond', 'stock', 'security', 'portfolio', 'diversification', 'risk',
        'return', 'yield', 'maturity', 'coupon', 'principal', 'interest',
        'inflation', 'deflation', 'recession', 'depression', 'gdp', 'cpi',
        'federal reserve', 'monetary policy', 'fiscal policy', 'tax',
        'deduction', 'credit', 'audit', 'compliance', 'gaap', 'ifrs',
        'accrual', 'cash basis', 'amortization', 'depreciation', 'goodwill',
        'intangible', 'tangible', 'liquidity', 'solvency', 'bankruptcy',
        'merger', 'acquisition', 'ipo', 'secondary offering', 'dividend',
        'stock split', 'reverse split', 'buyback', 'dilution', 'warrant',
        'convertible', 'preferred stock', 'common stock', 'treasury stock'
    ]
    
    # Check if query matches financial term patterns
    for pattern in financial_term_patterns:
        if re.search(pattern, query_lower):
            # Extract potential term
            match = re.search(pattern, query_lower)
            if match:
                potential_term = match.group(1) or match.group(2) or ""
                # Check if it's a known financial term
                if any(term in potential_term.lower() for term in financial_terms):
                    return True
    
    # Direct check for "what is [financial term]"
    for term in financial_terms:
        if f'what is {term}' in query_lower or f'explain {term}' in query_lower or f'define {term}' in query_lower:
            return True
    
    return False

def is_math_question(query: str) -> bool:
    """Check if the query is a math question."""
    query_lower = query.lower().strip()
    
    math_patterns = [
        r'^\d+\s*[+\-*/]\s*\d+',  # "2+2", "5-3"
        r'what is \d+\s*[+\-*/]\s*\d+',  # "what is 2+2"
        r'calculate \d+\s*[+\-*/]\s*\d+',  # "calculate 2+2"
        r'^\d+\s*(plus|minus|times|divided by|multiplied by)\s*\d+',  # "2 plus 2"
        r'solve \d+\s*[+\-*/]\s*\d+',  # "solve 2+2"
        r'\d+\s*[+\-*/]\s*\d+\s*=',  # "2+2="
    ]
    
    for pattern in math_patterns:
        if re.search(pattern, query_lower):
            return True
    
    return False


def classify_query_intent(query: str, financial_data: Dict[str, Any] = None) -> str:
    """Classify the intent of a query to determine how to handle it."""
    query_lower = query.lower().strip()
    
    # Check for trend analysis
    trend_keywords = ["trend", "change", "increase", "decrease", "growth", "decline", "over time", "period", "year over year", "yoy"]
    if any(keyword in query_lower for keyword in trend_keywords):
        return "trend"
    
    # Check for comparison
    comparison_keywords = ["compare", "difference", "vs", "versus", "between", "contrast", "similar", "different"]
    if any(keyword in query_lower for keyword in comparison_keywords):
        return "comparison"
    
    # Check for calculation
    calculation_keywords = ["calculate", "compute", "total", "sum", "average", "percentage", "ratio", "percent"]
    if any(keyword in query_lower for keyword in calculation_keywords):
        return "calculation"
    
    # Check for summary
    summary_keywords = ["summarize", "summary", "overview", "what is this document", "tell me about this document"]
    if any(keyword in query_lower for keyword in summary_keywords):
        return "summary"
    
    # Default intent
    return "financial_analysis"


def get_answer_from_document(
    query: str,
    vector_store_path: str,
    financial_data: Dict[str, Any] = None,
    document_id: Optional[str] = None,
    conversation_history_context: Optional[str] = None
) -> Dict[str, Any]:
    """Return a finance-grounded answer plus citation metadata with visual references."""
    if not financial_data:
        financial_data_path = os.path.join(vector_store_path, "financial_data.json")
        if os.path.exists(financial_data_path):
            with open(financial_data_path, "r") as f:
                financial_data = json.load(f)
        else:
            financial_data = {}
    
    query_lower = query.lower().strip()
    intent = classify_query_intent(query, financial_data)
    
    # Helper to create result dict
    def create_result(answer: str, source: str, sources: List[Dict] = None, follow_ups: List[str] = None) -> Dict[str, Any]:
        result = {
            "answer": answer,
            "sources": sources or [],
            "source": source,
            "intent": intent,
            "follow_up_suggestions": follow_ups or generate_follow_up_suggestions(query, answer, financial_data, intent)
        }
        if document_id:
            save_conversation(document_id, query, answer)
        return result
    
    # Handle special question types
    if is_math_question(query):
        return create_result(handle_math_question(query), "math_calculator", follow_ups=[])
    
    if is_financial_term_question(query):
        return create_result(handle_financial_term_question(query), "financial_glossary")
    
    if not is_query_relevant_to_document(query, financial_data):
        return create_result(handle_irrelevant_question(query), "general_knowledge", follow_ups=[])
    
    # Handle intent-based analysis
    if intent == 'trend':
        trend_analysis = analyze_financial_trends(financial_data, query)
        if trend_analysis:
            enhanced = llm_service.enhance_trend_analysis(query, trend_analysis, financial_data)
            answer = enhanced or trend_analysis
            return create_result(answer, "trend_analysis", sources=extract_summary_citations(financial_data)[:3])
    
    if intent == 'comparison':
        comparison_result = compare_financial_metrics(financial_data, query)
        if comparison_result:
            enhanced = llm_service.enhance_comparison(query, comparison_result, financial_data)
            answer = enhanced or comparison_result
            return create_result(answer, "comparison_analysis", sources=extract_summary_citations(financial_data)[:3])
    
    # Handle summary requests
    summary_keywords = ["summarize", "summary", "overview", "what is this document", "tell me about this document"]
    if any(kw in query_lower for kw in summary_keywords):
        summary = llm_service.generate_document_summary(financial_data)
        if not summary or len(summary.strip()) < 10:
            summary = _generate_fallback_summary(financial_data)
        return create_result(summary, "gpt-3.5-turbo", sources=extract_summary_citations(financial_data))
    
    # Check preferences
    wants_list_format = any(kw in query_lower for kw in ["in bullets", "in bullet points", "as bullets", "in a list", "list"])
    simple_patterns = [r'what is (my|the) (name|date|amount|value|number)', r'who (am i|is)', r'when (is|was)', r'where (is|was)', r'how much']
    is_simple_question = any(re.search(p, query_lower) for p in simple_patterns)
    
    # Search and build context
    relevant_chunks = similarity_search(query, vector_store_path, top_k=8)
    context_blocks = build_context_blocks(relevant_chunks, financial_data)
    
    # Enhance context if sparse
    if len(context_blocks) < 3 and financial_data:
        if financial_data.get("metadata"):
            context_blocks.append({
                "id": "metadata", "title": "Document Metadata", "page": None,
                "source": "metadata", "text": json.dumps(financial_data.get("metadata", {}), indent=2)
            })
        if financial_data.get("key_metrics"):
            metrics_text = "\n".join([f"{m.get('name', '')}: {m.get('value', '')} {m.get('unit', '')}" 
                                      for m in financial_data.get("key_metrics", [])[:5]])
            context_blocks.append({
                "id": "key_metrics", "title": "Key Financial Metrics", "page": None,
                "source": "metrics", "text": metrics_text
            })
    
    if is_simple_question:
        context_blocks = context_blocks[:3]
    
    # Generate answer
    answer_text = llm_service.generate_finance_response(
        query=query,
        metadata=financial_data.get("metadata", {}),
        key_metrics=financial_data.get("key_metrics", []),
        context_blocks=context_blocks,
        financial_data=financial_data,
        is_simple_question=is_simple_question,
        wants_list_format=wants_list_format
    )
    
    # Fallback if answer is poor
    if not answer_text or any(phrase in answer_text.lower() for phrase in ["i'm sorry", "does not contain", "not provided"]):
        fallback_context = build_fallback_context(financial_data, relevant_chunks)
        fallback_answer = llm_service.generate_response(query, fallback_context, financial_data)
        if not fallback_answer or any(phrase in fallback_answer.lower() for phrase in ["i'm sorry", "does not contain"]):
            fallback_answer = _generate_answer_from_financial_data(query, financial_data)
        return create_result(fallback_answer, "local_llm", sources=extract_summary_citations(financial_data)[:3])
    
    # Extract citations and return
    clean_answer, citations = extract_citations_with_visual_refs(answer_text, context_blocks, financial_data, query)
    return create_result(clean_answer or answer_text, "gpt-3.5-turbo", sources=citations)


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
            
            # Build visual reference string (matching Landing.AI format)
            page_label = f"Page {page + 1}" if isinstance(page, int) else "Page 1"
            type_label = "table, cell" if is_table else "text"
            value_label = f" | {value}" if value else " |"
            
            # Format: "Page 1. table, cell | 149,990" (matching Landing.AI)
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
    # Landing.AI shows multiple references even if they're the same
    if not citations and answer_value:
        # Search for ALL chunks containing the value (not just first one)
        matching_chunks = []
        for chunk in detected_chunks:
            chunk_text = chunk.get("text", "") or chunk.get("markdown", "")
            # Check if value appears in chunk (handle comma formatting)
            value_str = str(answer_value).replace(",", "")
            chunk_clean = chunk_text.replace(",", "")
            if value_str in chunk_clean or answer_value in chunk_text:
                matching_chunks.append(chunk)
        
        # Add all matching chunks (like Landing.AI shows multiple refs)
        for chunk in matching_chunks[:5]:  # Limit to 5 to avoid too many
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
                "text": (chunk.get("text", "") or chunk.get("markdown", ""))[:240],
                "type": chunk_type,
                "visual_ref": visual_ref,
                "value": answer_value
            })
    
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


def handle_math_question(query: str) -> str:
    """Handle math questions - treat as document-unrelated like Landing.AI."""
    # Landing.AI treats math questions as "cannot find in document"
    # This makes sense for a document-focused system
    return "I cannot find the answer in the provided document."

def handle_financial_term_question(query: str) -> str:
    """Handle financial term definition questions with expert explanation."""
    try:
        if openai:
            from config import settings
            
            api_key = settings.OPENAI_API_KEY or os.environ.get("OPENAI_API_KEY")
            if api_key:
                client = openai.OpenAI(api_key=api_key)
                
                # Extract the term being asked about
                term_match = re.search(r'(?:what is|explain|define)\s+(?:an?|the)?\s*([^?]+)', query.lower())
                term = term_match.group(1).strip() if term_match else query
                
                prompt = f"""You are a financial expert and educator. Explain the financial term "{term}" in a clear, concise, and professional manner.

REQUIREMENTS:
1. **Definition**: Provide a clear, one-sentence definition
2. **Explanation**: Explain what it means in practical terms (2-3 sentences)
3. **Context**: Explain when/why it's used in finance (1-2 sentences)
4. **Example**: Provide a simple, concrete example if helpful (1 sentence)
5. **Format**: Use markdown formatting:
   - Use **bold** for the term name
   - Use bullet points if listing multiple aspects
   - Keep total response to 4-6 sentences maximum

Be professional, accurate, and educational. If the term is not a financial term, say so briefly.

Term to explain: {term}"""
                
                response = client.chat.completions.create(
                    model="gpt-4",
                    messages=[
                        {"role": "system", "content": "You are a financial expert and educator. Explain financial terms clearly, concisely, and professionally. Always provide practical context and examples."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.3,
                    max_tokens=300
                )
                answer = response.choices[0].message.content.strip()
                return f"{answer}\n\n*Note: This explanation is general financial knowledge, not specific to the document.*"
    except Exception as e:
        print(f"Error handling financial term question: {e}")
        pass
    
    return f"I can help explain financial terms, but I need more context. Please rephrase your question about the financial term you'd like explained.\n\n*Note: This question is not related to the document content.*"

def handle_irrelevant_question(query: str) -> str:
    """Handle general knowledge questions that are not related to the document."""
    # Use consistent message like Landing.AI
    return "I cannot find the answer in the provided document."


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


def analyze_financial_trends(financial_data: Dict[str, Any], query: str) -> Optional[str]:
    """Analyze financial trends from the document data."""
    # Basic trend analysis implementation
    # This can be enhanced later with more sophisticated analysis
    key_metrics = financial_data.get("key_metrics", [])
    if not key_metrics:
        return None
    
    # Simple trend detection based on query
    query_lower = query.lower()
    trend_info = []
    
    for metric in key_metrics:
        name = metric.get("name", "").lower()
        value = metric.get("value")
        if value and any(term in name for term in query_lower.split()):
            trend_info.append(f"{metric.get('name')}: {value} {metric.get('unit', '')}")
    
    if trend_info:
        return "Trend analysis: " + "; ".join(trend_info[:5])
    return None


def compare_financial_metrics(financial_data: Dict[str, Any], query: str) -> Optional[str]:
    """Compare financial metrics from the document."""
    # Basic comparison implementation
    key_metrics = financial_data.get("key_metrics", [])
    if len(key_metrics) < 2:
        return None
    
    # Simple comparison based on query
    query_lower = query.lower()
    metrics_to_compare = []
    
    for metric in key_metrics[:5]:  # Limit to 5 metrics
        name = metric.get("name", "")
        value = metric.get("value")
        if value is not None:
            metrics_to_compare.append(f"{name}: {value} {metric.get('unit', '')}")
    
    if metrics_to_compare:
        return "Comparison: " + " | ".join(metrics_to_compare)
    return None


def generate_follow_up_suggestions(query: str, answer: str, financial_data: Dict[str, Any], intent: str) -> List[str]:
    """Generate follow-up question suggestions based on the query and answer."""
    suggestions = []
    
    # Generate context-aware suggestions
    if intent == "trend":
        suggestions = [
            "What are the key trends in this document?",
            "Show me revenue trends",
            "What changed over time?"
        ]
    elif intent == "comparison":
        suggestions = [
            "Compare revenue and expenses",
            "What are the differences?",
            "Show me comparisons"
        ]
    elif "revenue" in query.lower() or "income" in query.lower():
        suggestions = [
            "What are the expenses?",
            "What is the net income?",
            "Show me the profit margin"
        ]
    elif "asset" in query.lower():
        suggestions = [
            "What are the liabilities?",
            "What is the equity?",
            "Show me the balance sheet"
        ]
    else:
        suggestions = [
            "What is the summary of this document?",
            "What are the key metrics?",
            "Explain the main findings"
        ]
    
    return suggestions[:3]  # Return max 3 suggestions


def get_conversation_context(document_id: str, max_turns: int = 3) -> str:
    """Get conversation history context for a document (last N turns)."""
    if document_id not in conversation_history:
        return ""
    
    history = conversation_history[document_id]
    if not history:
        return ""
    
    # Get last N turns (query-answer pairs)
    recent_turns = history[-max_turns:] if len(history) > max_turns else history
    
    # Format as context string for LLM
    context_parts = []
    for turn in recent_turns:
        context_parts.append(f"Q: {turn.get('query', '')}")
        context_parts.append(f"A: {turn.get('answer', '')[:200]}...")  # Truncate long answers
    
    return "\n".join(context_parts)


def save_conversation(document_id: str, query: str, answer: str) -> None:
    """Save conversation to history."""
    if document_id not in conversation_history:
        conversation_history[document_id] = []
    
    # Add new conversation turn
    conversation_history[document_id].append({
        "query": query,
        "answer": answer,
        "timestamp": datetime.now().isoformat()
    })
    
    # Limit history to last 20 turns per document (prevent memory bloat)
    if len(conversation_history[document_id]) > 20:
        conversation_history[document_id] = conversation_history[document_id][-20:]
    
    print(f"Conversation saved: {document_id} - Q: {query[:50]}...")