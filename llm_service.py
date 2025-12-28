# import requests
# import json
# from typing import Dict, Any, List, Optional
# import os

# from config import settings

# class LLMService:
#     """Service to handle interactions with various LLM providers"""
    
#     def __init__(self):
#         self.llm_type = settings.active_llm
    
#     def generate_response(
#         self, 
#         query: str, 
#         context: str,
#         document_data: Dict[str, Any] = None
#     ) -> str:
#         """
#         Generate a response to a user query using the appropriate LLM
        
#         Args:
#             query: The user's question
#             context: Relevant document context for answering
#             document_data: Optional structured financial data
        
#         Returns:
#             Generated response from the LLM
#         """
#         if self.llm_type == "claude":
#             return self._generate_claude_response(query, context, document_data)
#         elif self.llm_type == "openai":
#             return self._generate_openai_response(query, context, document_data)
#         elif self.llm_type == "gemini":
#             return self._generate_gemini_response(query, context, document_data)
#         else:
#             # Fallback to simple response generation if no LLM is available
#             return self._generate_simple_response(query, context, document_data)
    
#     def _generate_claude_response(
#         self, 
#         query: str, 
#         context: str,
#         document_data: Optional[Dict[str, Any]] = None
#     ) -> str:
#         """Generate response using Anthropic Claude"""
#         try:
#             headers = {
#                 "x-api-key": settings.ANTHROPIC_API_KEY,
#                 "content-type": "application/json",
#                 "anthropic-version": "2023-06-01"
#             }
            
#             # Create the system prompt
#             system_prompt = """You are a financial document analysis assistant. 
# You help users understand financial documents and answer questions about them.
# Base your answers strictly on the provided document context. 
# If the context doesn't contain the information needed, say so clearly."""

#             # Prepare financial data summary if available
#             financial_summary = ""
#             if document_data:
#                 financial_summary = "Key financial metrics:\n"
#                 for metric in document_data.get("key_metrics", []):
#                     name = metric.get("name", "")
#                     value = metric.get("value", "")
#                     unit = metric.get("unit", "")
#                     financial_summary += f"- {name}: {value} {unit}\n"
            
#             # Build the message
#             messages = [
#                 {"role": "system", "content": system_prompt},
#                 {"role": "user", "content": f"""
# I have a financial document with the following information:

# {financial_summary}

# Relevant document context:
# {context}

# My question is: {query}

# Please answer based solely on the information provided above.
# """}
#             ]
            
#             # Make the API call
#             response = requests.post(
#                 "https://api.anthropic.com/v1/messages",
#                 headers=headers,
#                 json={
#                     "model": "claude-3-opus-20240229",
#                     "max_tokens": 1000,
#                     "messages": messages
#                 }
#             )
            
#             response_json = response.json()
            
#             # Extract the response content
#             if "content" in response_json:
#                 for content in response_json["content"]:
#                     if content["type"] == "text":
#                         return content["text"]
            
#             raise Exception("Failed to extract response from Claude API")
        
#         except Exception as e:
#             print(f"Error calling Claude API: {str(e)}")
#             # Fallback to simple response
#             return self._generate_simple_response(query, context, document_data)
    
#     def _generate_openai_response(
#         self, 
#         query: str, 
#         context: str,
#         document_data: Optional[Dict[str, Any]] = None
#     ) -> str:
#         """Generate response using OpenAI"""
#         try:
#             headers = {
#                 "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
#                 "Content-Type": "application/json"
#             }
            
#             # Create the system prompt
#             system_prompt = """You are a financial document analysis assistant. 
# You help users understand financial documents and answer questions about them.
# Base your answers strictly on the provided document context. 
# If the context doesn't contain the information needed, say so clearly."""

#             # Prepare financial data summary if available
#             financial_summary = ""
#             if document_data:
#                 financial_summary = "Key financial metrics:\n"
#                 for metric in document_data.get("key_metrics", []):
#                     name = metric.get("name", "")
#                     value = metric.get("value", "")
#                     unit = metric.get("unit", "")
#                     financial_summary += f"- {name}: {value} {unit}\n"
            
#             # Build the messages
#             messages = [
#                 {"role": "system", "content": system_prompt},
#                 {"role": "user", "content": f"""
# I have a financial document with the following information:

# {financial_summary}

# Relevant document context:
# {context}

# My question is: {query}

# Please answer based solely on the information provided above.
# """}
#             ]
            
#             # Make the API call
#             response = requests.post(
#                 "https://api.openai.com/v1/chat/completions",
#                 headers=headers,
#                 json={
#                     "model": "gpt-4",
#                     "messages": messages,
#                     "max_tokens": 500
#                 }
#             )
            
#             response_json = response.json()
            
#             # Extract the response content
#             if "choices" in response_json and len(response_json["choices"]) > 0:
#                 return response_json["choices"][0]["message"]["content"]
            
#             raise Exception("Failed to extract response from OpenAI API")
        
#         except Exception as e:
#             print(f"Error calling OpenAI API: {str(e)}")
#             # Fallback to simple response
#             return self._generate_simple_response(query, context, document_data)
    
#     def _generate_gemini_response(
#         self, 
#         query: str, 
#         context: str,
#         document_data: Optional[Dict[str, Any]] = None
#     ) -> str:
#         """Generate response using Google Gemini"""
#         try:
#             url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key={settings.GOOGLE_API_KEY}"
            
#             headers = {
#                 "Content-Type": "application/json"
#             }
            
#             # Prepare financial data summary if available
#             financial_summary = ""
#             if document_data:
#                 financial_summary = "Key financial metrics:\n"
#                 for metric in document_data.get("key_metrics", []):
#                     name = metric.get("name", "")
#                     value = metric.get("value", "")
#                     unit = metric.get("unit", "")
#                     financial_summary += f"- {name}: {value} {unit}\n"
            
#             # Build the prompt
#             prompt = f"""
# You are a financial document analysis assistant. 
# You help users understand financial documents and answer questions about them.
# Base your answers strictly on the provided document context. 
# If the context doesn't contain the information needed, say so clearly.

# I have a financial document with the following information:

# {financial_summary}

# Relevant document context:
# {context}

# My question is: {query}

# Please answer based solely on the information provided above.
# """
            
#             # Make the API call
#             response = requests.post(
#                 url,
#                 headers=headers,
#                 json={
#                     "contents": [{"parts": [{"text": prompt}]}],
#                     "generationConfig": {"temperature": 0.2, "maxOutputTokens": 500}
#                 }
#             )
            
#             response_json = response.json()
            
#             # Extract the response text
#             if "candidates" in response_json and len(response_json["candidates"]) > 0:
#                 candidate = response_json["candidates"][0]
#                 if "content" in candidate and "parts" in candidate["content"]:
#                     parts = candidate["content"]["parts"]
#                     if parts and "text" in parts[0]:
#                         return parts[0]["text"]
            
#             raise Exception("Failed to extract response from Gemini API")
        
#         except Exception as e:
#             print(f"Error calling Gemini API: {str(e)}")
#             # Fallback to simple response
#             return self._generate_simple_response(query, context, document_data)
    
#     def _generate_simple_response(
#         self, 
#         query: str, 
#         context: str,
#         document_data: Optional[Dict[str, Any]] = None
#     ) -> str:
#         """
#         Generate a simple response without using an external LLM API
#         This is a fallback method when no LLM API is available
#         """
#         query_lower = query.lower()
        
#         # Check if this is a question about specific metrics
#         if document_data and any(keyword in query_lower for keyword in [
#             "revenue", "income", "profit", "assets", "liabilities"
#         ]):
#             metrics = document_data.get("key_metrics", [])
#             for metric in metrics:
#                 metric_name = metric.get("name", "").lower()
#                 if any(keyword in metric_name for keyword in query_lower.split()):
#                     value = metric.get("value", "")
#                     unit = metric.get("unit", "")
#                     return f"Based on the document, the {metric.get('name')} is {value} {unit}."
        
#         # Check for company name
#         if "company" in query_lower or "who" in query_lower:
#             company = document_data.get("metadata", {}).get("company_name", "")
#             if company:
#                 return f"This document is for {company}."
        
#         # Check for document type or date
#         if "what type" in query_lower or "document type" in query_lower:
#             doc_type = document_data.get("metadata", {}).get("document_type", "")
#             if doc_type:
#                 return f"This is a {doc_type}."
        
#         if "date" in query_lower or "when" in query_lower:
#             date = document_data.get("metadata", {}).get("document_date", "")
#             if date:
#                 return f"The document date is {date}."
        
#         # For general questions, extract relevant sentences from context
#         sentences = context.replace("\n", " ").split(". ")
#         relevant_sentences = []
        
#         query_terms = [term.lower() for term in query.split() if len(term) > 3]
#         for sentence in sentences:
#             sentence = sentence.strip()
#             if not sentence:
#                 continue
            
#             if any(term in sentence.lower() for term in query_terms):
#                 relevant_sentences.append(sentence)
        
#         if relevant_sentences:
#             return " ".join(relevant_sentences[:3]) + "."
        
#         # If no relevant sentences found
#         return f"Based on the available document context, I couldn't find specific information about your question: '{query}'. You may want to rephrase your question or ask about another aspect of the document."

# # Create singleton instance
# llm_service = LLMService()
import os
import openai
from typing import Dict, Any, Optional, List
from config import settings

class LLMService:
    """Service for generating text using LLMs"""
    
    def __init__(self):
        """Initialize the LLM service"""
        self.openai_api_key = settings.OPENAI_API_KEY
        # Fallback to environment variable if not in settings
        if not self.openai_api_key:
            self.openai_api_key = os.environ.get("OPENAI_API_KEY")
        
    def generate_response(self, query: str, context: str, financial_data: Dict[str, Any] = None) -> str:
        """
        Generate a response to a query using OpenAI's GPT-3.5 Turbo
        
        Args:
            query: User's question
            context: Context from the document
            financial_data: Financial data extracted from the document
        
        Returns:
            Generated response
        """
        try:
            # Check if we have an API key
            if not self.openai_api_key:
                print("OpenAI API key not found. Please set OPENAI_API_KEY in your .env file.")
                return self.generate_fallback_response(query, financial_data)
            
            # Format the key metrics for better context
            metrics_context = ""
            if financial_data and "key_metrics" in financial_data and financial_data["key_metrics"]:
                metrics_context = "Key Financial Metrics:\n"
                for metric in financial_data["key_metrics"]:
                    name = metric.get("name", "")
                    value = metric.get("value", "")
                    unit = metric.get("unit", "")
                    
                    if name and value:
                        if isinstance(value, (int, float)):
                            formatted_value = f"${value:,.2f}" if unit == "USD" else f"{value:,}"
                        else:
                            formatted_value = value
                        
                        metrics_context += f"- {name}: {formatted_value}\n"
            
            # Create a concise prompt
            prompt = f"""You are ALPHA LENS, a document assistant. Answer questions directly and concisely.

Document Type: {financial_data.get("metadata", {}).get("document_type", "Document")}
Document Context:
{context}

{metrics_context}

User Question: "{query}"

CRITICAL - BE EXTREMELY BRIEF:
1. **Simple Questions** (names, dates, amounts, what/where/when):
   - Answer in 1 sentence: "Your name is [name]" or "The amount is [amount]" or "The date is [date]"
   - NO explanations, NO summaries

2. **General Questions**:
   - Maximum 2 sentences
   - Use **bold** only for key numbers/names
   - Use bullet points (-) only if listing 3+ items

3. **Follow-up Questions** (like "what did I ask"):
   - Answer what was asked previously in 1-2 sentences
   - Don't repeat document summaries

4. **NEVER**:
   - Write more than 2-3 sentences
   - Give full document summaries for simple questions
   - Be verbose

Your response (BE BRIEF):
"""
            
            # Call OpenAI API
            client = openai.OpenAI(api_key=self.openai_api_key)
            
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": "You are ALPHA LENS, a document assistant. Answer questions directly and concisely. For simple questions, answer in 1 sentence. Never be verbose."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2,
                max_tokens=150
            )
            
            # Extract the answer from the response
            answer = response.choices[0].message.content
            
            return answer
        
        except Exception as e:
            print(f"Error calling OpenAI API: {str(e)}")
            return self.generate_fallback_response(query, financial_data)

    def generate_finance_response(
        self,
        query: str,
        metadata: Dict[str, Any],
        key_metrics: List[Dict[str, Any]],
        context_blocks: List[Dict[str, Any]],
        financial_data: Dict[str, Any] = None,
        is_simple_question: bool = False,
        wants_list_format: bool = False,
    ) -> str:
        """Generate a finance-grounded response with explicit citation instructions."""
        try:
            if not self.openai_api_key:
                print("OpenAI API key not found. Please set OPENAI_API_KEY.")
                return ""
            
            client = openai.OpenAI(api_key=self.openai_api_key)
            
            metadata_lines = []
            for key, value in (metadata or {}).items():
                if value:
                    metadata_lines.append(f"- {key.replace('_', ' ').title()}: {value}")
            metadata_text = "\n".join(metadata_lines) if metadata_lines else "N/A"
            
            metrics_lines = []
            for metric in (key_metrics or [])[:8]:
                name = metric.get("name")
                value = metric.get("value")
                unit = metric.get("unit")
                if name and value is not None:
                    if isinstance(value, (int, float)):
                        formatted = f"${value:,.2f}" if unit == "USD" else f"{value:,}"
                    else:
                        formatted = str(value)
                    metrics_lines.append(f"- {name}: {formatted}")
            metrics_text = "\n".join(metrics_lines) if metrics_lines else "N/A"
            
            context_text = ""
            for block in context_blocks:
                block_id = block.get("id", "chunk")
                title = block.get("title") or block.get("source") or "Context"
                page = block.get("page")
                page_label = f"Page {page + 1}" if isinstance(page, int) else "Page n/a"
                text = block.get("text", "")
                if text:
                    context_text += f"[{block_id}] {title} ({page_label})\n{text}\n\n"
            
            # Add tables context if available
            tables_context = ""
            if financial_data and financial_data.get("tables"):
                tables = financial_data.get("tables", [])[:3]  # Limit to 3 tables
                tables_context = "\n\nTables in document:\n"
                for table in tables:
                    table_title = table.get("title", "Table")
                    table_rows = table.get("rows", [])[:5]  # Limit rows
                    tables_context += f"\n{table_title}:\n"
                    if table.get("header"):
                        tables_context += f"Headers: {', '.join(table['header'])}\n"
                    for row in table_rows:
                        tables_context += f"{row}\n"
            
            # Adjust prompt based on question type
            if is_simple_question:
                prompt = f"""Answer this question in 1 sentence maximum. NO explanations, NO summaries.

Context:
{context_text or 'N/A'}

Question: {query}

Answer format:
- For names: "Your name is [name]" or "The name is [name]"
- For dates: "The date is [date]"
- For amounts: "The amount is [amount]"
- For "what did I ask": Answer what was asked previously in 1 sentence
- If not found: "I cannot find the answer in the provided document."

Your answer (1 sentence only):
"""
            elif wants_list_format:
                prompt = f"""You are ALPHA LENS, a document analysis assistant. Format your answer as bullet points.

Document metadata:
{metadata_text}

Key metrics:
{metrics_text}
{tables_context}

Context blocks (each block is labeled with an ID in brackets):
{context_text or 'N/A'}

Question: {query}

CRITICAL - USE BULLET POINTS:
1. **Format**: Answer MUST be in bullet point format using markdown:
   - Start each point with "- " (dash and space)
   - Each bullet should be on a new line
   - Use 3-8 bullet points maximum
   - Each point should be 1 sentence or short phrase
   - Example:
     - Point 1 about the document
     - Point 2 about the document
     - Point 3 about the document

2. **Content**:
   - Extract key information from the document
   - Each bullet should cover a different aspect/topic
   - Be specific and concise
   - Use **bold** for important numbers or names within bullets

3. **Citations**: Add [[chunk_id]] at the end of relevant bullets

4. **NEVER**: 
   - Write in paragraph form
   - Use more than 8 bullets
   - Be verbose

Your response (bullet points only, markdown format):
"""
            else:
                prompt = f"""You are ALPHA LENS, an expert financial document analysis assistant. Answer questions with precision, context, and clarity.

Document metadata:
{metadata_text}

Key metrics:
{metrics_text}
{tables_context}

Context blocks (each block is labeled with an ID in brackets):
{context_text or 'N/A'}

Question: {query}

EXPERT-LEVEL RESPONSE GUIDELINES:

1. **Answer Structure** (2-4 sentences):
   - **First sentence**: Direct, factual answer to the question
   - **Second sentence**: Context or explanation from the document
   - **Third sentence** (if needed): Additional detail or implication
   - **Fourth sentence** (if needed): Related information or clarification

2. **Financial Terminology**:
   - If the question involves financial terms (revenue, EBITDA, leverage, etc.), briefly explain what the term means in context
   - Example: "Revenue of $5M represents total income from sales [explain briefly if term is complex]"
   - Use **bold** for key numbers, names, and important terms

3. **Mathematical Context**:
   - If the answer involves calculations or numbers, explain the calculation method briefly
   - Show relationships between numbers when relevant
   - Example: "Net income of $2M is calculated as Revenue ($5M) minus Expenses ($3M)"

4. **Content Accuracy**:
   - Answer ONLY from the document context provided
   - If information is not in the document: "I cannot find the answer in the provided document." (exact phrase)
   - Never guess or assume - be explicit about data availability

5. **Citations**: 
   - Add [[chunk_id]] at the end of sentences that reference specific document sections
   - Cite sources for all numbers and facts

6. **Formatting**:
   - Use **bold** for important numbers, names, dates, and key terms
   - Use bullet points (-) only when listing 3+ items
   - Use markdown for better readability

7. **NEVER**: 
   - Write more than 4 sentences
   - Give full document summaries
   - Be verbose or repetitive
   - Hallucinate numbers or facts not in the document

Your response (2-4 sentences, expert-level analysis):
"""
            
            # Adjust max_tokens based on question type
            max_tokens = 50 if is_simple_question else 250  # Increased for expert-level explanations
            
            system_message = "You are ALPHA LENS, a document assistant. Answer questions directly and concisely. For simple questions, answer in 1 sentence. Never be verbose."
            if is_simple_question:
                system_message = "You are ALPHA LENS. Answer in exactly 1 sentence. NO explanations, NO summaries, just the answer."
            
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": system_message},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.1,
                max_tokens=max_tokens
            )
            
            return response.choices[0].message.content
        except Exception as exc:
            print(f"Error calling OpenAI API: {exc}")
            return ""
    
    def generate_fallback_response(self, query: str, financial_data: Dict[str, Any] = None) -> str:
        """Generate a fallback response when API calls fail"""
        
        # Check if it's a greeting
        query_lower = query.lower()
        if any(greeting in query_lower for greeting in ["hi", "hello", "hey", "greetings"]):
            return "Hello! I'm ALPHA LENS, your financial document assistant. How can I help you with this document today?"
        
        # Check if we have key metrics to share
        if financial_data and "key_metrics" in financial_data and financial_data["key_metrics"]:
            metrics = financial_data["key_metrics"]
            if metrics:
                # Summarize key metrics
                response = "I found these key metrics in the document:\n"
                for metric in metrics[:3]:  # Show top 3 metrics
                    name = metric.get("name", "")
                    value = metric.get("value", "")
                    unit = metric.get("unit", "")
                    
                    if name and value:
                        if isinstance(value, (int, float)):
                            formatted_value = f"${value:,.2f}" if unit == "USD" else f"{value:,}"
                        else:
                            formatted_value = value
                        
                        response += f"- {name}: {formatted_value}\n"
                
                return response
        
        # Check if it's asking about fees
        if any(keyword in query_lower for keyword in ["fee", "amount", "payment", "cost"]):
            return "This document appears to be fee-related, but I couldn't find specific fee amounts. You might want to check if there's a total or itemized section in the document."
        
        # Generic fallback for document questions
        document_type = financial_data.get("metadata", {}).get("document_type", "document")
        return f"I can see this is a {document_type}, but I couldn't find specific information about your question. Could you try asking about a different aspect of the document?"

    def generate_document_summary(self, financial_data: Dict[str, Any]) -> str:
        """Generate a comprehensive document summary using LLM with full document data."""
        try:
            # Validate financial_data
            if not financial_data:
                print("Warning: financial_data is empty, using fallback summary")
                return self._generate_basic_summary(financial_data)
            
            if not self.openai_api_key:
                print("OpenAI API key not found. Please set OPENAI_API_KEY.")
                return self._generate_basic_summary(financial_data)
            
            client = openai.OpenAI(api_key=self.openai_api_key)
            
            # Build comprehensive context from all available data
            context_parts = []
            
            # Check if we have any data at all
            has_data = False
            
            # 1. Metadata
            metadata = financial_data.get("metadata", {})
            if metadata:
                metadata_text = "Document Metadata:\n"
                for key, value in metadata.items():
                    if value:
                        metadata_text += f"- {key.replace('_', ' ').title()}: {value}\n"
                        has_data = True
                if has_data:
                    context_parts.append(metadata_text)
            
            # 2. Key Metrics
            key_metrics = financial_data.get("key_metrics", [])
            if key_metrics:
                metrics_text = "Key Financial Metrics:\n"
                metric_count = 0
                for metric in key_metrics[:10]:  # Top 10 metrics
                    name = metric.get("name", "")
                    value = metric.get("value", "")
                    unit = metric.get("unit", "")
                    if name and value is not None:
                        if isinstance(value, (int, float)):
                            formatted = f"${value:,.2f}" if unit == "USD" else f"{value:,}"
                        else:
                            formatted = str(value)
                        metrics_text += f"- {name}: {formatted} {unit}\n"
                        metric_count += 1
                        has_data = True
                if metric_count > 0:
                    context_parts.append(metrics_text)
            
            # 3. Tables Summary
            tables = financial_data.get("tables", [])
            if tables:
                tables_text = f"Document contains {len(tables)} table(s):\n"
                for i, table in enumerate(tables[:5], 1):  # Limit to 5 tables
                    table_title = table.get("title", f"Table {i}")
                    headers = table.get("header", [])
                    rows = table.get("rows", [])
                    tables_text += f"\n{table_title}:\n"
                    if headers:
                        tables_text += f"  Headers: {', '.join(str(h) for h in headers[:5])}\n"
                    if rows:
                        # Show first few rows as sample
                        for row_idx, row in enumerate(rows[:3], 1):
                            if isinstance(row, list):
                                row_str = " | ".join(str(cell) for cell in row[:5])
                            else:
                                row_str = str(row)
                            tables_text += f"  Row {row_idx}: {row_str}\n"
                        if len(rows) > 3:
                            tables_text += f"  ... and {len(rows) - 3} more rows\n"
                context_parts.append(tables_text)
                has_data = True
            
            # 4. Detected Chunks Summary
            detected_chunks = financial_data.get("detected_chunks", [])
            if detected_chunks:
                chunks_text = f"Document structure: {len(detected_chunks)} detected sections\n"
                chunk_types = {}
                for chunk in detected_chunks:
                    chunk_type = chunk.get("type", "text")
                    chunk_types[chunk_type] = chunk_types.get(chunk_type, 0) + 1
                
                for chunk_type, count in chunk_types.items():
                    chunks_text += f"- {chunk_type.title()}: {count} section(s)\n"
                context_parts.append(chunks_text)
                has_data = True
            
            # 5. Document Markdown (first 3000 chars for context)
            document_markdown = financial_data.get("document_markdown", "") or financial_data.get("markdown", "")
            if document_markdown and len(document_markdown.strip()) > 50:
                markdown_preview = document_markdown[:3000]
                context_parts.append(f"Document Content Preview:\n{markdown_preview}\n...")
                has_data = True
            
            # If no data found, use fallback
            if not has_data or not context_parts:
                print("Warning: No document data found for summary, using fallback")
                return self._generate_basic_summary(financial_data)
            
            # Combine all context
            full_context = "\n\n".join(context_parts)
            
            prompt = f"""You are ALPHA LENS, a senior financial analyst. Analyze the document data and provide a comprehensive, well-formatted summary like ChatGPT would.

DOCUMENT DATA:
{full_context}

INSTRUCTIONS (RESPOND LIKE CHATGPT):
1. **Formatting**: Use markdown for better readability:
   - **Bold** for important numbers, company names, dates
   - Bullet points (-) for lists of metrics or sections
   - Headers (##) for major sections if needed
   - Paragraphs for detailed explanations
2. **Content**:
   - Start with a direct summary statement (never apologize)
   - Use ALL available data: metadata, metrics, tables, chunks, markdown
   - Be specific: mention exact numbers, dates, company names, table counts
   - Write 3-5 well-structured paragraphs
   - If data is limited, summarize what IS present
3. **Tone**: Be professional, confident, and helpful - like ChatGPT
4. **Structure**: 
   - First paragraph: Overview (document type, company, date, key purpose)
   - Middle paragraphs: Detailed analysis (metrics, tables, sections)
   - Final paragraph: Summary of key findings

Your response (use markdown formatting):
"""
            
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": "You are ALPHA LENS, a senior financial analyst specializing in document analysis and summarization."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=800
            )
            
            summary = response.choices[0].message.content.strip()
            return summary if summary else self._generate_basic_summary(financial_data)
            
        except Exception as e:
            print(f"Error generating document summary with LLM: {str(e)}")
            return self._generate_basic_summary(financial_data)
    
    def _generate_basic_summary(self, financial_data: Dict[str, Any]) -> str:
        """Generate a basic summary without LLM (fallback)."""
        parts = []
        
        metadata = financial_data.get("metadata", {})
        if metadata.get("document_type"):
            parts.append(f"This is a {metadata.get('document_type')} document.")
        
        if metadata.get("company_name"):
            parts.append(f"Company/Organization: {metadata.get('company_name')}")
        
        if metadata.get("document_date"):
            parts.append(f"Date: {metadata.get('document_date')}")
        
        key_metrics = financial_data.get("key_metrics", [])
        if key_metrics:
            parts.append("\nKey metrics found:")
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
            parts.append(f"\nThe document contains {len(tables)} table(s) with structured data.")
        
        detected_chunks = financial_data.get("detected_chunks", [])
        if detected_chunks:
            parts.append(f"The document has {len(detected_chunks)} detected sections (tables, text, charts, etc.).")
        
        if not parts:
            return "This document has been processed. However, no structured summary information is available. You can ask specific questions about the document content."
        
        return "\n".join(parts)

    def generate_professional_financial_report(self, financial_data: Dict[str, Any]) -> str:
        """
        Generate a professional, compliance-grade Financial Analysis Report
        following institutional standards (Bloomberg/Reuters style)
        """
        try:
            if not self.openai_api_key:
                print("OpenAI API key not found. Please set OPENAI_API_KEY.")
                return self._generate_basic_summary(financial_data)
            
            client = openai.OpenAI(api_key=self.openai_api_key)
            
            # Extract all available data
            metadata = financial_data.get("metadata", {})
            key_metrics = financial_data.get("key_metrics", [])
            tables = financial_data.get("tables", [])
            detected_chunks = financial_data.get("detected_chunks", [])
            document_markdown = financial_data.get("document_markdown", "") or financial_data.get("markdown", "")
            
            # Build comprehensive data context
            data_context = []
            
            # Metadata
            if metadata:
                metadata_text = "DOCUMENT METADATA:\n"
                for key, value in metadata.items():
                    if value:
                        metadata_text += f"- {key.replace('_', ' ').title()}: {value}\n"
                data_context.append(metadata_text)
            
            # Key Metrics
            if key_metrics:
                metrics_text = "KEY FINANCIAL METRICS:\n"
                for metric in key_metrics:
                    name = metric.get("name", "")
                    value = metric.get("value", "")
                    unit = metric.get("unit", "")
                    if name and value is not None:
                        if isinstance(value, (int, float)):
                            formatted = f"${value:,.2f}" if unit == "USD" else f"{value:,}"
                        else:
                            formatted = str(value)
                        metrics_text += f"- {name}: {formatted} {unit}\n"
                data_context.append(metrics_text)
            
            # Tables with page references
            if tables:
                tables_text = "EXTRACTED TABLES:\n"
                for idx, table in enumerate(tables, 1):
                    table_title = table.get("title", f"Table {idx}")
                    page = table.get("page", table.get("page_number", "N/A"))
                    headers = table.get("header", [])
                    rows = table.get("rows", []) or table.get("data", [])
                    
                    tables_text += f"\n[Table-{idx} Page {page}]\n"
                    tables_text += f"Title: {table_title}\n"
                    if headers:
                        tables_text += f"Headers: {', '.join(str(h) for h in headers)}\n"
                    if rows:
                        # Show first 3 rows as sample
                        for row_idx, row in enumerate(rows[:3], 1):
                            if isinstance(row, list):
                                row_str = " | ".join(str(cell) for cell in row)
                            else:
                                row_str = str(row)
                            tables_text += f"Row {row_idx}: {row_str}\n"
                        if len(rows) > 3:
                            tables_text += f"... ({len(rows) - 3} more rows)\n"
                data_context.append(tables_text)
            
            # Detected chunks with references
            if detected_chunks:
                chunks_text = "DOCUMENT SECTIONS:\n"
                for idx, chunk in enumerate(detected_chunks[:10], 1):
                    chunk_type = chunk.get("type", "text")
                    page = chunk.get("page", chunk.get("page_number", "N/A"))
                    content = chunk.get("markdown", chunk.get("text", chunk.get("content", "")))
                    if content:
                        preview = content[:150].replace("\n", " ")
                        chunks_text += f"[Section-{idx} Page {page}] Type: {chunk_type}\n"
                        chunks_text += f"Preview: {preview}...\n\n"
                data_context.append(chunks_text)
            
            # Document content (first 5000 chars)
            if document_markdown:
                content_preview = document_markdown[:5000]
                data_context.append(f"DOCUMENT CONTENT PREVIEW:\n{content_preview}\n...")
            
            full_context = "\n\n".join(data_context)
            
            # Generate report date
            from datetime import datetime
            report_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            
            # Company/Document name
            company_name = metadata.get("company_name") or metadata.get("document_name") or "Unknown Company"
            doc_type = metadata.get("document_type", "Financial Document")
            
            prompt = f"""You are an expert financial analyst and compliance-grade report writer for ALPHA LENS.

Generate a comprehensive, detailed, and highly explanatory Financial Analysis Report strictly based on the structured financial data provided below.

MANDATORY RULES:
- DO NOT hallucinate or create numbers.
- ONLY use values present in structured data, extracted tables, or verified sources.
- Link every key statement to its source using [Ref: Section/Page/X] or [Ref: Table-X Page Y].
- Maintain professional, factual, analytical tone.
- Avoid conversational language.
- Use precise financial terminology.
- If data is missing, explicitly state "Data Not Available".
- If uncertainty exists, state it clearly.
- No speculation, no opinions.
- **CRITICAL: Be EXTREMELY DETAILED and EXPLANATORY** - Each heading and subheading must have comprehensive explanations, context, and analysis. Do not just list facts - explain what they mean, why they matter, and their implications.

STRUCTURED DATA PROVIDED:
{full_context}

REPORT STRUCTURE (Follow EXACTLY with DETAILED EXPLANATIONS):

1. Report Header
Provide a comprehensive header section with:
- System Name: ALPHA LENS
- Company / Document Name: {company_name}
- Report Type: {doc_type}
- Date Generated: {report_date}
- Source Document Reference: {metadata.get('filename', 'N/A')}
- **Explanation**: Provide 2-3 sentences explaining what this report covers, its purpose, and the scope of analysis.

2. Executive Summary
Provide a detailed executive summary (8-12 sentences) that includes:
- Overall financial health assessment with detailed explanation
- Key financial direction (growth/decline/stability) with supporting context
- Major findings and their significance
- Key risks and opportunities identified
- Confidence summary with explanation of data quality
- **Each point must be explained in detail, not just stated**

3. Key Financial Metrics (Table with Detailed Explanations)
Create a comprehensive section that includes:
- A detailed table with:
  * Revenue (with explanation of what this represents)
  * Net Income (with explanation of profitability context)
  * EPS (with explanation of shareholder value)
  * Operating Cash Flow (with explanation of liquidity)
  * Assets (with explanation of resource base)
  * Liabilities (with explanation of obligations)
  * Debt Ratio (with explanation of leverage)
  * YoY Growth (with explanation of trends)
- **After the table, provide 3-4 paragraphs explaining:**
  * What each metric means in the context of this document
  * How these metrics relate to each other
  * What the metrics indicate about the entity's financial position
  * Industry context or benchmarks if applicable
- If missing, mark "Not Available" and explain why it might be missing

4. Performance Analysis
Provide extremely detailed analytical explanations (minimum 6-8 paragraphs):
- **Revenue Analysis**: Detailed explanation of revenue behavior, trends, sources, seasonality, growth patterns, and what drives revenue changes. Include comparisons and context.
- **Profitability Analysis**: Comprehensive explanation of profitability movement, margins, cost efficiency, profit drivers, and sustainability of earnings.
- **Cost Structure Analysis**: Detailed breakdown of cost behavior, cost drivers, fixed vs variable costs, cost trends, and efficiency indicators.
- **Cash Flow Analysis**: In-depth explanation of cash flow health, operating cash flow patterns, investing activities, financing activities, and liquidity position.
- **Financial Stability Indicators**: Comprehensive analysis of solvency, liquidity ratios, working capital, debt capacity, and financial flexibility.
- **Every statement MUST include: [Ref: Source Table / Section / Page]**
- **Each subsection must have 2-3 paragraphs of detailed explanation**

5. Table Insights
Provide comprehensive analysis for each extracted table:
- **For each table, provide:**
  * Detailed explanation of what the table represents and its purpose
  * What insights each table reveals about the financial position
  * Numerical highlights with context and interpretation
  * Comparative analysis (if multiple periods or entities)
  * Relationships between table data and overall financial picture
  * Implications of the data presented
- **Minimum 3-4 paragraphs per table**
- Mandatory references: [Ref: Table-X Page Y]

6. Chart Interpretation (if applicable)
If charts or visual data are present, provide detailed explanations:
- **For each chart:**
  * What the chart represents and its purpose
  * Detailed trend direction analysis with context
  * Variance behavior explanation and significance
  * Growth/decline patterns with historical context
  * Anomalies or outliers and their implications
  * Projections or forecasts if evident
- Include deviation confidence: [Ref: Chart Extracted Values | Error < X%]
- **Minimum 2-3 paragraphs per chart**

7. Risk Assessment (Formal + Evidence-Based with Detailed Explanations)
Provide comprehensive risk analysis for each identified risk:
- **For each risk category (Liquidity, Debt, Earnings Volatility, Market, Compliance):**
  * Detailed explanation of what the risk is
  * Why this risk is relevant to this document/entity
  * Evidence from the document supporting the risk assessment
  * Magnitude and probability assessment
  * Potential impact on financial position
  * Mitigation factors or existing controls
  * Comparison to industry standards or benchmarks
- **Each risk must have 2-3 paragraphs of detailed explanation**
- Each risk MUST contain justification and data reference: [Ref: Section/Page/X]

8. Validation & Reliability Statement
Provide a detailed validation section explaining:
- **Data Quality Assessment:**
  * Number of inconsistencies detected and their nature
  * Number corrected and methods used
  * Remaining uncertainties and their impact
- **Validation Sources:**
  * APIs / Validation sources used
  * Cross-referencing methods applied
  * External data verification if any
- **Reliability Assessment:**
  * Final confidence score (High / Moderate / Low) with detailed explanation
  * Factors supporting the confidence level
  * Limitations of the analysis
  * Recommendations for additional data if needed
- **Minimum 4-5 paragraphs explaining the validation process**

9. Conclusion
Provide a comprehensive conclusion (4-6 paragraphs) that includes:
- Summary of key findings with detailed context
- Overall assessment of financial health
- Major strengths and weaknesses identified
- Strategic implications
- Recommendations for stakeholders
- Forward-looking perspective
- Final assessment statement

STYLE REQUIREMENTS:
- Formal institutional tone (similar to Bloomberg/Reuters)
- No emojis, no casual language
- No storytelling style
- Use bullet points where appropriate for lists
- Structured & auditable
- **CRITICAL: Be EXTREMELY DETAILED - Every section must have comprehensive explanations, context, and analysis. Do not just state facts - explain what they mean, why they matter, and their implications. Each heading and subheading must be thoroughly explained.**

Generate the complete, detailed, and highly explanatory report now:"""

            response = client.chat.completions.create(
                model="gpt-4",
                messages=[
                    {"role": "system", "content": "You are an expert financial analyst and compliance-grade report writer. You generate formal, detailed, reference-linked financial analysis reports with comprehensive explanations for every section. You NEVER hallucinate numbers or create data that doesn't exist in the source material. You provide extensive explanations, context, and analysis for every heading and subheading."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2,
                max_tokens=8000
            )
            
            report = response.choices[0].message.content
            return report
            
        except Exception as e:
            print(f"Error generating professional report: {str(e)}")
            import traceback
            traceback.print_exc()
            # Fallback to basic summary
            return self._generate_basic_summary(financial_data)
    
    def enhance_trend_analysis(self, query: str, trend_data: str, financial_data: Dict[str, Any]) -> Optional[str]:
        """Enhance trend analysis with LLM explanation."""
        try:
            if not self.openai_api_key:
                return None
            
            client = openai.OpenAI(api_key=self.openai_api_key)
            
            prompt = f"""You are a financial analyst. Analyze these financial trends and provide a clear, concise explanation.

Trend Data:
{trend_data}

User Query: {query}

Provide a 2-3 sentence explanation of the trends, focusing on what they mean and their significance. Be specific and reference the data provided."""
            
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": "You are a financial analyst. Explain financial trends clearly and concisely."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=200
            )
            
            return response.choices[0].message.content.strip()
        except Exception as e:
            print(f"Error enhancing trend analysis: {e}")
            return None
    
    def enhance_comparison(self, query: str, comparison_data: str, financial_data: Dict[str, Any]) -> Optional[str]:
        """Enhance comparison analysis with LLM explanation."""
        try:
            if not self.openai_api_key:
                return None
            
            client = openai.OpenAI(api_key=self.openai_api_key)
            
            prompt = f"""You are a financial analyst. Analyze this financial comparison and provide a clear, concise explanation.

Comparison Data:
{comparison_data}

User Query: {query}

Provide a 2-3 sentence explanation of the comparison, highlighting key differences and their significance. Be specific and reference the data provided."""
            
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": "You are a financial analyst. Explain financial comparisons clearly and concisely."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=200
            )
            
            return response.choices[0].message.content.strip()
        except Exception as e:
            print(f"Error enhancing comparison: {e}")
            return None

# Create a singleton instance
llm_service = LLMService()