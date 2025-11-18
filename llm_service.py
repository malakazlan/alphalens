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
            
            # Create a more conversational prompt
            prompt = f"""You are ALPHA LENS, a friendly and helpful financial document assistant. Your goal is to answer questions about financial documents in a conversational, helpful way.

Document Type: {financial_data.get("metadata", {}).get("document_type", "Financial Document")}
Document Context:
{context}

{metrics_context}

User Question: "{query}"

Instructions:
1. Answer in a friendly, conversational tone
2. If the answer is clearly in the document, provide it directly
3. If the exact answer isn't in the document, tell the user what you do know from the document that might be relevant
4. If the document doesn't contain ANY information related to the question, politely explain that the document doesn't contain that information
5. For greetings or casual questions, respond naturally while mentioning you're here to help with the document
6. Keep your answer concise (1-3 sentences) unless detailed information is needed

Your response:
"""
            
            # Call OpenAI API
            client = openai.OpenAI(api_key=self.openai_api_key)
            
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": "You are ALPHA LENS, a friendly and helpful financial document assistant."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,  # Slightly higher for more conversational tone
                max_tokens=500
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
            
            prompt = f"""
Document metadata:
{metadata_text}

Key metrics:
{metrics_text}

Context blocks (each block is labeled with an ID in brackets):
{context_text or 'N/A'}

Question: {query}

Instructions:
- Base your answer ONLY on the context blocks provided.
- If the answer is not present, state that politely.
- Cite the supporting context by appending [[chunk_id]] at the end of the relevant sentence.
- Keep the tone professional and concise (2-4 sentences).
"""
            
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": "You are ALPHA LENS, a senior financial analyst who cites the provided context."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2,
                max_tokens=450
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

# Create a singleton instance
llm_service = LLMService()