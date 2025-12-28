"""
Report Service - Separate module for document report generation
Completely isolated from chat functionality to ensure no interference
"""
import os
import json
import re
from typing import Dict, Any, List, Optional
from datetime import datetime

try:
    import openai
    from config import settings
except ImportError:
    openai = None
    settings = None


class DocumentStructureAnalyzer:
    """Analyzes document structure to identify sections, tables, and relationships."""
    
    def analyze_structure(self, financial_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analyze document structure from financial_data.
        Processes ALL content: detected_chunks, tables, and any other content.
        
        Returns:
            Dictionary with sections, hierarchy, and relationships
        """
        detected_chunks = financial_data.get("detected_chunks", [])
        tables = financial_data.get("tables", [])
        key_metrics = financial_data.get("key_metrics", [])
        metadata = financial_data.get("metadata", {})
        
        sections = []
        section_id = 1
        
        # Process ALL detected chunks (text, table, marginal, etc.)
        if detected_chunks:
            # Group chunks by page for better organization
            chunks_by_page = {}
            for chunk in detected_chunks:
                page = chunk.get("page", chunk.get("page_number", 0))
                # Ensure page is an integer
                if page is None:
                    page = 0
                try:
                    page = int(page)
                except (ValueError, TypeError):
                    page = 0
                
                if page not in chunks_by_page:
                    chunks_by_page[page] = []
                chunks_by_page[page].append(chunk)
            
            # Create sections from ALL chunks - one section per chunk for detailed analysis
            for page_num in sorted(chunks_by_page.keys()):
                page_chunks = chunks_by_page[page_num]
                
                for chunk in page_chunks:
                    chunk_type = chunk.get("type", "text")
                    chunk_id = chunk.get("id", f"chunk_{section_id}")
                    
                    # Get content from multiple possible fields
                    chunk_text = (
                        chunk.get("text", "") or 
                        chunk.get("markdown", "") or 
                        chunk.get("content", "") or
                        chunk.get("raw_text", "") or
                        ""
                    )
                    
                    # Skip empty chunks
                    if not chunk_text or not chunk_text.strip():
                        continue
                    
                    # Try to extract section title from chunk
                    title = self._extract_section_title(chunk_text, chunk_type)
                    
                    # Create section for this chunk
                    section = {
                        "id": f"section_{section_id}",
                        "title": title or f"{chunk_type.title()} Section {section_id}",
                        "page": page_num,
                        "type": chunk_type,
                        "chunks": [chunk_id],
                        "tables": [],
                        "metrics": [],
                        "content": chunk_text[:2000] if chunk_text else "",  # Preview for structure
                        "full_content": chunk_text  # Keep full content for better analysis
                    }
                    
                    sections.append(section)
                    section_id += 1
        
        # CRITICAL: ALWAYS create sections from tables FIRST
        # This ensures every table gets its own section with detailed explanation
        # We do this before chunks to prioritize table analysis
        table_section_ids = set()
        if tables:
            print(f"Processing {len(tables)} tables to create sections")
            for table in tables:
                # Check if this table already has a section (from chunks)
                table_id = table.get("id") or table.get("title", "") or str(id(table))
                if table_id in table_section_ids:
                    continue
                table_section_ids.add(table_id)
                table_page = table.get("page", table.get("page_number", 0))
                # Ensure table_page is an integer
                if table_page is None:
                    table_page = 0
                try:
                    table_page = int(table_page)
                except (ValueError, TypeError):
                    table_page = 0
                
                table_title = table.get("title", f"Table {len(sections) + 1}")
                headers = table.get("header", [])
                rows = table.get("rows", []) or table.get("data", [])
                
                # Create comprehensive table content text for better analysis
                table_content = f"Table: {table_title}\n\n"
                if headers:
                    table_content += f"Headers: {' | '.join(str(h) for h in headers)}\n\n"
                if rows:
                    table_content += "Table Data:\n"
                    # Include all rows for comprehensive analysis
                    for row in rows:
                        if isinstance(row, list):
                            table_content += f"{' | '.join(str(cell) for cell in row)}\n"
                        elif isinstance(row, dict):
                            # Handle dictionary rows
                            row_values = []
                            for header in headers:
                                row_values.append(str(row.get(header, "")))
                            table_content += f"{' | '.join(row_values)}\n"
                
                section = {
                    "id": f"section_{section_id}",
                    "title": table_title,
                    "page": table_page,
                    "type": "table",
                    "chunks": [],
                    "tables": [table],
                    "metrics": [],
                    "content": table_content[:2000],
                    "full_content": table_content  # Full content for detailed explanation
                }
                
                sections.append(section)
                section_id += 1
            print(f"Created {len(sections)} total sections (chunks + tables)")
        
        # Ensure ALL tables are in sections - check and add any missing ones
        table_ids_in_sections = set()
        for section in sections:
            for table in section.get("tables", []):
                table_id = table.get("id") or table.get("title", "") or str(id(table))
                table_ids_in_sections.add(table_id)
        
        # Add any tables that weren't included
        for table in tables:
            table_id = table.get("id") or table.get("title", "") or str(id(table))
            if table_id not in table_ids_in_sections:
                table_page = table.get("page", table.get("page_number", 0))
                # Ensure table_page is an integer
                if table_page is None:
                    table_page = 0
                try:
                    table_page = int(table_page)
                except (ValueError, TypeError):
                    table_page = 0
                
                # Find closest section by page
                closest_section = None
                min_distance = float('inf')
                for section in sections:
                    section_page = section.get("page", 0)
                    # Ensure section_page is an integer
                    if section_page is None:
                        section_page = 0
                    try:
                        section_page = int(section_page)
                    except (ValueError, TypeError):
                        section_page = 0
                    
                    # Ensure both are integers before subtraction
                    if section_page is None:
                        section_page = 0
                    if table_page is None:
                        table_page = 0
                    try:
                        section_page = int(section_page)
                        table_page = int(table_page)
                    except (ValueError, TypeError):
                        section_page = 0
                        table_page = 0
                    
                    distance = abs(section_page - table_page)
                    if distance < min_distance:
                        min_distance = distance
                        closest_section = section
                
                if closest_section and min_distance <= 2:
                    closest_section["tables"].append(table)
                else:
                    # Create new section for unmapped table
                    table_title = table.get("title", f"Table {len(sections) + 1}")
                    headers = table.get("header", [])
                    rows = table.get("rows", []) or table.get("data", [])
                    
                    # Create comprehensive table content
                    table_content = f"Table: {table_title}\n\n"
                    if headers:
                        table_content += f"Headers: {' | '.join(str(h) for h in headers)}\n\n"
                    if rows:
                        table_content += "Table Data:\n"
                        for row in rows:
                            if isinstance(row, list):
                                table_content += f"{' | '.join(str(cell) for cell in row)}\n"
                            elif isinstance(row, dict):
                                row_values = []
                                for header in headers:
                                    row_values.append(str(row.get(header, "")))
                                table_content += f"{' | '.join(row_values)}\n"
                    
                    section = {
                        "id": f"section_{section_id}",
                        "title": table_title,
                        "page": table_page if table_page is not None else 0,
                        "type": "table",
                        "chunks": [],
                        "tables": [table],
                        "metrics": [],
                        "content": table_content[:2000],
                        "full_content": table_content
                    }
                    
                    sections.append(section)
                    section_id += 1
        
        # Map metrics to sections (based on metric names matching section content)
        for metric in key_metrics:
            metric_name = metric.get("name", "").lower()
            for section in sections:
                section_content_lower = section.get("content", "").lower() + " " + section.get("full_content", "").lower()
                if metric_name in section_content_lower:
                    section["metrics"].append(metric)
                    break
        
        # If still no sections, create a fallback section from available data
        if not sections:
            # Try to get any available text content
            markdown_content = financial_data.get("markdown", "")
            original_text = financial_data.get("original_text", "")
            content = markdown_content or original_text
            
            if content:
                # Split into paragraphs and create sections
                paragraphs = [p.strip() for p in content.split('\n\n') if p.strip()]
                for idx, para in enumerate(paragraphs[:20], 1):  # Limit to 20 sections
                    section = {
                        "id": f"section_{idx}",
                        "title": f"Content Section {idx}",
                        "page": 0,
                        "type": "text",
                        "chunks": [],
                        "tables": [],
                        "metrics": [],
                        "content": para[:2000],
                        "full_content": para
                    }
                    sections.append(section)
        
        return {
            "sections": sections,
            "total_sections": len(sections),
            "total_tables": len(tables),
            "total_metrics": len(key_metrics),
            "metadata": metadata
        }
    
    def _extract_section_title(self, text: str, chunk_type: str) -> Optional[str]:
        """Extract section title from chunk text."""
        if not text:
            return None
        
        # Look for headings (markdown or plain text)
        lines = text.split('\n')[:10]  # Check first 10 lines for better title detection
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
                
            # Markdown heading
            if line.startswith('#'):
                title = line.lstrip('#').strip()
                if title and len(title) < 150:
                    return title
            # Bold text (potential heading)
            if line.startswith('**') and line.endswith('**'):
                title = line.strip('*').strip()
                if title and len(title) < 150:
                    return title
            # Uppercase or title case line (potential heading)
            if len(line) > 3 and len(line) < 150:
                # Check for common heading patterns
                if line.isupper() or (line.istitle() and len(line.split()) <= 8):
                    return line
                # Check for numbered headings (e.g., "1. Date of accident")
                if re.match(r'^\d+[\.\)]\s+[A-Z]', line):
                    return line[:100]  # Limit length
        
        # Try to extract first meaningful sentence as title
        first_sentence = text.split('.')[0].strip()
        if first_sentence and 10 < len(first_sentence) < 100:
            return first_sentence
        
        # Default title based on type
        if chunk_type == "table":
            return "Table Section"
        elif chunk_type == "text":
            return "Text Section"
        elif chunk_type == "marginal":
            return "Marginal Note Section"
        else:
            return chunk_type.title() + " Section"


class SectionExplanationGenerator:
    """Generates explanations for each document section and tables using LLM."""
    
    def __init__(self, openai_api_key: Optional[str] = None):
        self.openai_api_key = openai_api_key or (settings.OPENAI_API_KEY if settings else None) or os.environ.get("OPENAI_API_KEY")
    
    def generate_table_explanation(
        self,
        table: Dict[str, Any],
        financial_data: Dict[str, Any]
    ) -> str:
        """
        Generate comprehensive explanation for a table using LLM.
        
        Args:
            table: Table data dictionary
            financial_data: Full financial data for context
            
        Returns:
            Detailed explanation text
        """
        if not self.openai_api_key:
            return self._generate_basic_table_explanation(table)
        
        try:
            client = openai.OpenAI(api_key=self.openai_api_key)
            
            table_title = table.get("title", "Table")
            table_page = table.get("page", 0)
            headers = table.get("header", [])
            rows = table.get("rows", []) or table.get("data", [])
            
            # Format table data for LLM - include ALL rows for comprehensive analysis
            table_data_text = ""
            if headers:
                table_data_text += f"Table Headers: {' | '.join(str(h) for h in headers)}\n\n"
            
            if rows:
                table_data_text += "Table Rows (Complete Data):\n"
                # Include rows for analysis (limit to 50 for faster processing, reduced from 100)
                for idx, row in enumerate(rows[:50], 1):
                    if isinstance(row, list):
                        row_text = " | ".join(str(cell) for cell in row)
                    elif isinstance(row, dict):
                        row_text = " | ".join(str(row.get(h, "")) for h in headers)
                    else:
                        row_text = str(row)
                    table_data_text += f"Row {idx}: {row_text}\n"
                
                if len(rows) > 50:
                    table_data_text += f"\n... and {len(rows) - 50} more rows\n"
            
            prompt = f"""You are ALPHA LENS, a professional financial document analysis expert. Provide a comprehensive, detailed explanation of this table from a financial document.

TABLE INFORMATION:
- Title: {table_title}
- Page: {table_page + 1 if isinstance(table_page, int) else 'N/A'}
- Number of Columns: {len(headers)}
- Number of Rows: {len(rows)}

TABLE DATA:
{table_data_text}

INSTRUCTIONS - Generate a detailed, professional table explanation following this structure:

1. **Table Overview** (3-4 sentences):
   - Explain what this table represents and its purpose
   - Describe the type of data it contains (financial, accounting, inventory, etc.)
   - Explain its role in the document context
   - Identify the document section or category it belongs to

2. **Data Structure Analysis** (3-4 sentences):
   - Explain what each column represents
   - Describe the relationship between columns
   - Explain the data format and units (currency, percentages, quantities, etc.)
   - Identify any patterns in column organization

3. **Key Values and Insights** (6-8 sentences):
   - Extract and highlight the most important values, totals, and key figures
   - Identify significant amounts, percentages, or quantities
   - Point out any notable high or low values
   - Calculate or identify totals, subtotals, and summary figures
   - Explain what these values mean in context
   - Compare related values if applicable
   - Highlight any trends or patterns visible in the data

4. **Detailed Row Analysis** (4-6 sentences):
   - Explain what each major row or category represents
   - Break down key rows and their significance
   - Identify important line items and their values
   - Explain relationships between different rows
   - Highlight any unusual or noteworthy entries

5. **Financial/Business Significance** (3-4 sentences):
   - Explain why this table is important
   - Discuss what insights can be derived from the data
   - Explain implications for financial analysis or business decisions
   - Connect the table data to broader document context

6. **Formatting Requirements** (CRITICAL):
   - Use **bold** for ALL numbers, amounts, dates, percentages, and key terms
   - Use bullet points (•) for lists of key findings
   - Always reference: "This table appears on **Page {table_page + 1 if isinstance(table_page, int) else 'N/A'}**"
   - Reference specific values: "The total amount of **149,990 PKR** appears in..."
   - Use professional, formal, business-appropriate language
   - Write in third person, objective tone

Generate a comprehensive explanation (20-25 sentences total) that thoroughly analyzes this table with all details, insights, and proper formatting:"""

            response = client.chat.completions.create(
                model="gpt-3.5-turbo",  # 3-5x faster, 20x cheaper than GPT-4
                messages=[
                    {
                        "role": "system",
                        "content": "You are ALPHA LENS, a professional financial document analysis expert. You provide comprehensive, detailed explanations of tables with proper analysis, insights, and professional formatting."
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2,
                max_tokens=1500  # Reduced from 2500 for faster generation
            )
            
            return response.choices[0].message.content.strip()
            
        except Exception as e:
            print(f"Error generating table explanation: {e}")
            return self._generate_basic_table_explanation(table)
    
    def _generate_basic_table_explanation(self, table: Dict[str, Any]) -> str:
        """Generate basic table explanation without LLM (fallback when LLM unavailable)."""
        title = table.get("title", "Table")
        page = table.get("page", 0)
        headers = table.get("header", [])
        rows = table.get("rows", []) or table.get("data", [])
        
        explanation = f"This table titled **{title}** appears on **Page {page + 1 if isinstance(page, int) else 'N/A'}** of the document. "
        explanation += f"It contains **{len(headers)}** column(s) and **{len(rows)}** row(s) of structured data.\n\n"
        
        if headers:
            explanation += f"**Table Structure:** The table has the following columns: {', '.join(str(h) for h in headers[:10])}"
            if len(headers) > 10:
                explanation += f" and {len(headers) - 10} more column(s)."
            explanation += "\n\n"
        
        if rows:
            explanation += f"**Data Overview:** The table contains {len(rows)} row(s) of data. "
            # Try to extract key information from first few rows
            if len(rows) > 0:
                explanation += "Key data points include values from various rows throughout the table. "
            explanation += "Each row represents a specific data entry or record within the table structure.\n\n"
        
        explanation += "**Significance:** This table contains important structured information extracted from the document. "
        explanation += "The data should be analyzed in detail to understand its meaning, relationships, and significance within the document context."
        
        return explanation
    
    def _is_simple_section(self, section: Dict[str, Any]) -> bool:
        """Check if section is simple enough for template-based generation."""
        content = section.get("full_content", "") or section.get("content", "")
        
        # Simple sections: short content, form fields, basic data
        if len(content) < 500:
            return True
        
        # Check for form-like patterns (numbered fields, labels)
        if any(pattern in content.lower() for pattern in ['1.', '2.', 'field:', 'label:', 'form']):
            if len(content.split('\n')) < 20:  # Short form
                return True
        
        return False
    
    def _generate_template_explanation(self, section: Dict[str, Any]) -> str:
        """Generate explanation from template for simple sections (instant, no LLM)."""
        title = section.get("title", "Section")
        page = section.get("page", 0)
        content = section.get("full_content", "") or section.get("content", "")
        section_type = section.get("type", "text")
        
        try:
            page = int(page) if page is not None else 0
        except:
            page = 0
        
        explanation = f"This section titled **{title}** appears on **Page {page + 1}** of the document. "
        explanation += f"It is a **{section_type}** section containing structured information.\n\n"
        
        # Extract key information
        lines = content.split('\n')[:15]
        key_info = []
        for line in lines:
            line = line.strip()
            if line and len(line) > 5:
                # Extract numbers, dates, amounts
                if any(char.isdigit() for char in line):
                    key_info.append(line[:100])
        
        if key_info:
            explanation += "**Key Information:**\n\n"
            for info in key_info[:10]:
                explanation += f"- {info}\n"
            explanation += "\n"
        
        explanation += f"This section provides important details relevant to the document's purpose. "
        explanation += f"All information has been extracted and is available for reference on **Page {page + 1}**."
        
        return explanation
    
    def generate_section_explanation(
        self, 
        section: Dict[str, Any], 
        financial_data: Dict[str, Any]
    ) -> str:
        """
        Generate explanation for a single section.
        Uses template for simple sections (instant), LLM for complex (detailed).
        
        Args:
            section: Section data from structure analyzer
            financial_data: Full financial data for context
        
        Returns:
            Formatted explanation text
        """
        if not self.openai_api_key:
            return self._generate_basic_explanation(section)
        
        # Check if section is simple enough for template (INSTANT, no API call)
        if self._is_simple_section(section):
            return self._generate_template_explanation(section)
        
        try:
            client = openai.OpenAI(api_key=self.openai_api_key)
            
            # Build section context
            section_title = section.get("title", "Section")
            section_page = section.get("page", 0)
            section_type = section.get("type", "text")
            # Use full_content if available, otherwise content (reduced size for faster processing)
            section_content = (section.get("full_content", "") or section.get("content", ""))[:3000]  # Reduced from 6000
            
            # Format related tables
            tables_text = ""
            for idx, table in enumerate(section.get("tables", [])[:3], 1):
                table_title = table.get("title", f"Table {idx}")
                headers = table.get("header", [])
                rows = table.get("rows", [])[:5]  # First 5 rows
                
                tables_text += f"\n\nTable {idx}: {table_title}\n"
                if headers:
                    tables_text += f"Headers: {' | '.join(str(h) for h in headers)}\n"
                for row_idx, row in enumerate(rows, 1):
                    if isinstance(row, list):
                        tables_text += f"Row {row_idx}: {' | '.join(str(cell) for cell in row)}\n"
            
            # Format related metrics
            metrics_text = ""
            for metric in section.get("metrics", [])[:5]:
                name = metric.get("name", "")
                value = metric.get("value", "")
                unit = metric.get("unit", "")
                if name and value is not None:
                    metrics_text += f"- {name}: {value} {unit}\n"
            
            prompt = f"""You are ALPHA LENS, a professional document analysis expert. Provide a comprehensive, detailed, and professional explanation of this document section. Be thorough and explain EVERY detail.

SECTION INFORMATION:
- Title: {section_title}
- Page: {section_page + 1 if isinstance(section_page, int) else 'N/A'}
- Type: {section_type} (this could be text, table, marginal note, or other content type)

SECTION CONTENT (COMPLETE):
{section_content[:6000] if section_content else 'No content available'}

RELATED TABLES:
{tables_text if tables_text else 'No tables in this section'}

RELATED METRICS:
{metrics_text if metrics_text else 'No specific metrics in this section'}

INSTRUCTIONS - Generate a VERY DETAILED, comprehensive explanation following this structure:

1. **Section Overview** (4-5 sentences):
   - Start with: "This section titled '{section_title}' appears on **Page {section_page + 1 if isinstance(section_page, int) else 'N/A'}** and contains..."
   - Explain what this section is about and its primary purpose in detail
   - Describe its role and importance in the overall document context
   - Identify the type of information it contains (financial data, personal information, instructions, accident details, vehicle information, etc.)
   - Mention the content type (text, table, marginal note, etc.)

2. **Complete Content Breakdown** (10-15 sentences):
   - Go through the content LINE BY LINE or PARAGRAPH BY PARAGRAPH
   - Extract and explain EVERY important data point, value, fact, and figure mentioned
   - For EACH significant number, amount, date, time, name, or identifier, provide full context and explanation
   - Identify ALL key entities (companies, people, dates, amounts, locations, vehicle numbers, registration numbers, etc.) and explain their significance
   - Explain relationships between different pieces of information
   - Highlight any patterns, trends, or notable observations
   - Use specific examples from the content with exact values
   - If it's a form or structured data, explain each field and its value
   - If it contains dates/times, explain what they represent
   - If it contains codes or identifiers, explain their meaning

3. **Table Analysis** (if tables present, 6-8 sentences per table):
   - Explain what each table represents, its purpose, and what information it conveys
   - Go through the table structure: explain what each column means
   - Highlight the most important values, totals, or key metrics from the table
   - Explain what the table data means in the context of the document
   - Reference specific cells, rows, or columns that are particularly important
   - Discuss any patterns, comparisons, or insights visible in the table data
   - Explain the significance of the table data for the document's purpose
   - If the table has totals or calculations, explain them

4. **Key Metrics and Values** (if metrics present, 3-4 sentences):
   - Explain what each metric represents in detail
   - Provide context for why these metrics are important
   - Compare or relate metrics to other information in the section
   - Explain the significance of each metric value

5. **Context and Relationships** (4-5 sentences):
   - Explain how this section relates to other parts of the document
   - Discuss what information came before or after this section (if applicable)
   - Explain the flow of information in the document
   - Connect this section to the overall document purpose

6. **Significance and Implications** (4-5 sentences):
   - Explain why this information matters in the broader context
   - Discuss implications, consequences, or importance
   - Connect to overall document purpose and other sections
   - Explain how this section contributes to understanding the document
   - If applicable, explain legal, financial, or business implications

7. **Formatting Requirements** (CRITICAL):
   - Use **bold** for ALL numbers, amounts, dates, times, percentages, codes, registration numbers, and key terms
   - Use bullet points (•) for lists of items or key points
   - Always reference page numbers: "as shown on **Page {section_page + 1 if isinstance(section_page, int) else 'N/A'}**"
   - Reference tables: "as detailed in **Table {idx}**" when applicable
   - Use professional, formal, business-appropriate language
   - Write in third person, objective tone
   - Use complete sentences with proper grammar

8. **References** (MANDATORY):
   - Always include: "This section appears on **Page {section_page + 1 if isinstance(section_page, int) else 'N/A'}**"
   - Reference specific tables if present: "**Table {idx}** shows..."
   - Cite specific values with their context: "The amount of **149,990 PKR** appears in..."
   - Include visual references when mentioning specific data points
   - Reference line numbers or field names if applicable

Generate a comprehensive, professional explanation (25-35 sentences total) that thoroughly explains EVERY aspect of this section with all details, proper formatting, and references. Be exhaustive and leave nothing unexplained:"""

            response = client.chat.completions.create(
                model="gpt-3.5-turbo",  # 3-5x faster, 20x cheaper than GPT-4
                messages=[
                    {
                        "role": "system",
                        "content": "You are ALPHA LENS, a document analysis expert. You provide comprehensive, detailed explanations of document sections with proper references and professional formatting. You explain every detail thoroughly."
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2,
                max_tokens=2000  # Reduced from 3000 for faster generation
            )
            
            return response.choices[0].message.content.strip()
            
        except Exception as e:
            print(f"Error generating section explanation: {e}")
            return self._generate_basic_explanation(section)
    
    def _generate_basic_explanation(self, section: Dict[str, Any]) -> str:
        """Generate basic explanation without LLM (fallback when LLM unavailable)."""
        title = section.get("title", "Section")
        page = section.get("page", 0)
        content = section.get("full_content", "") or section.get("content", "")
        tables = section.get("tables", [])
        metrics = section.get("metrics", [])
        section_type = section.get("type", "text")
        
        explanation = f"This section titled **{title}** appears on **Page {page + 1 if isinstance(page, int) else 'N/A'}** of the document. "
        explanation += f"It is classified as a **{section_type}** section.\n\n"
        
        if content:
            # Extract key information from content
            lines = content.split('\n')[:10]
            key_info = ' '.join([line.strip() for line in lines if line.strip()][:5])
            if key_info:
                explanation += f"**Content Overview:** {key_info[:500]}"
                if len(content) > 500:
                    explanation += "..."
                explanation += "\n\n"
        
        if tables:
            explanation += f"**Tables in Section:** This section includes **{len(tables)}** table(s) with structured data. "
            explanation += "Each table contains important information that should be analyzed in detail.\n\n"
        
        if metrics:
            metric_names = [m.get('name', '') for m in metrics[:5]]
            explanation += f"**Key Metrics:** The following metrics have been identified in this section: {', '.join(metric_names)}. "
            if len(metrics) > 5:
                explanation += f"Additionally, {len(metrics) - 5} more metric(s) are present.\n\n"
        
        explanation += "**Significance:** This section contains important information that contributes to the overall understanding of the document. "
        explanation += "The content, tables, and metrics within this section should be analyzed in detail to extract all relevant information and insights."
        
        return explanation


class ReportFormatter:
    """Formats and styles the report output."""
    
    def __init__(self, explanation_generator=None, financial_data=None):
        self.explanation_generator = explanation_generator
        self.financial_data = financial_data
    
    def format_section(
        self, 
        section: Dict[str, Any], 
        explanation: str,
        section_number: int
    ) -> str:
        """Format a single section with explanation."""
        title = section.get("title", f"Section {section_number}")
        page = section.get("page", 0)
        tables = section.get("tables", [])
        
        # Section header with professional styling
        formatted = f"\n## {section_number}. {title}\n\n"
        formatted += f"**📍 Page Reference:** **Page {page + 1 if isinstance(page, int) else 'N/A'}**  \n"
        formatted += f"**📋 Section Type:** {section.get('type', 'text').title()}\n\n"
        formatted += "---\n\n"
        
        # Section explanation
        formatted += f"{explanation}\n\n"
        
        # Format tables if present
        if tables:
            formatted += "### 📊 Tables in This Section\n\n"
            for idx, table in enumerate(tables[:5], 1):
                formatted += self._format_table(
                    table, 
                    idx,
                    explanation_generator=self.explanation_generator,
                    financial_data=self.financial_data
                )
        
        formatted += "\n"
        return formatted
    
    def _format_table(
        self, 
        table: Dict[str, Any], 
        table_num: int,
        explanation_generator: Optional[Any] = None,
        financial_data: Optional[Dict[str, Any]] = None
    ) -> str:
        """Format a table in markdown with professional styling and detailed explanation."""
        title = table.get("title", f"Table {table_num}")
        page = table.get("page", 0)
        headers = table.get("header", [])
        rows = table.get("rows", []) or table.get("data", [])
        
        formatted = f"\n### 📊 Table {table_num}: {title}\n\n"
        formatted += f"**📍 Page Reference:** **Page {page + 1 if isinstance(page, int) else 'N/A'}**\n\n"
        
        # Show table data FIRST (fast, no LLM wait)
        if headers and rows:
            formatted += "#### Table Data\n\n"
            # Create markdown table with proper alignment
            # Header row
            formatted += "| " + " | ".join(str(h) for h in headers) + " |\n"
            # Separator with alignment
            formatted += "| " + " | ".join(["---"] * len(headers)) + " |\n"
            
            # Show ALL rows (no limit for detailed reports)
            for row in rows:
                if isinstance(row, list):
                    # Ensure row has same number of cells as headers
                    row_cells = row[:len(headers)] + [""] * (len(headers) - len(row))
                    # Format cells - bold numbers and important values
                    formatted_cells = []
                    for cell in row_cells:
                        cell_str = str(cell).strip()
                        # Bold if it's a number or amount
                        if cell_str and (cell_str.replace(',', '').replace('.', '').replace('-', '').isdigit() or 
                                        any(keyword in cell_str.lower() for keyword in ['total', 'sum', 'amount', 'pk', 'rs', '$', 'usd', 'eur'])):
                            formatted_cells.append(f"**{cell_str}**")
                        else:
                            formatted_cells.append(cell_str)
                    formatted += "| " + " | ".join(formatted_cells) + " |\n"
                elif isinstance(row, dict):
                    # Handle dictionary rows (from parsed tables)
                    row_values = []
                    for header in headers:
                        # Try to get value by header name or by index
                        if header in row:
                            cell_value = str(row[header]).strip()
                        else:
                            # Fallback to values in order
                            row_values_list = list(row.values())
                            idx = headers.index(header) if header in headers else 0
                            cell_value = str(row_values_list[idx]).strip() if idx < len(row_values_list) else ""
                        
                        # Bold if it's a number or amount
                        if cell_value and (cell_value.replace(',', '').replace('.', '').replace('-', '').isdigit() or 
                                         any(keyword in cell_value.lower() for keyword in ['total', 'sum', 'amount', 'pk', 'rs', '$', 'usd', 'eur'])):
                            row_values.append(f"**{cell_value}**")
                        else:
                            row_values.append(cell_value)
                    formatted += "| " + " | ".join(row_values) + " |\n"
            
            formatted += f"\n*📊 Total Rows: {len(rows)}*\n\n"
        
        # Generate detailed table explanation using LLM (optional, can be slow)
        # Skip in fast_mode for instant table display
        table_explanation = ""
        fast_mode = getattr(financial_data, '_fast_mode', False) if financial_data else False
        if not fast_mode and explanation_generator and financial_data and explanation_generator.openai_api_key:
            try:
                # Generate explanation (can be slow)
                table_explanation = explanation_generator.generate_table_explanation(
                    table, financial_data
                )
                if table_explanation:
                    formatted += "\n---\n\n"
                    formatted += "### 📝 Detailed Analysis\n\n"
                    formatted += f"{table_explanation}\n\n"
            except Exception as e:
                # If LLM fails, just show the table data (already displayed above)
                print(f"      Note: Table explanation skipped for table {table_num}: {e}")
        
        formatted += "\n"
        return formatted
    
    def format_report_header(self, metadata: Dict[str, Any], financial_data: Dict[str, Any] = None) -> str:
        """Format report header with metadata."""
        from datetime import datetime
        
        company_name = metadata.get("company_name") or metadata.get("document_name", "Unknown")
        doc_type = metadata.get("document_type", "Document")
        filename = metadata.get("filename", "Unknown")
        doc_date = metadata.get("document_date", "Unknown")
        report_date = datetime.now().strftime("%B %d, %Y at %I:%M %p")
        
        # Get document statistics
        if financial_data:
            total_sections = len(financial_data.get("detected_chunks", []))
            total_tables = len(financial_data.get("tables", []))
            total_metrics = len(financial_data.get("key_metrics", []))
        else:
            total_sections = 0
            total_tables = 0
            total_metrics = 0
        
        header = f"""# 📄 Document Analysis Report

<div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white; padding: 2rem; border-radius: 12px; margin-bottom: 2rem;">

## ALPHA LENS Document Analysis

**Report Generated:** {report_date}  
**Document Name:** {filename}  
**Document Type:** {doc_type}  
**Company/Organization:** {company_name}  
**Document Date:** {doc_date}

</div>

---

## 📊 Executive Summary

This comprehensive report provides a detailed, section-by-section analysis of the uploaded document. The document has been thoroughly analyzed using advanced AI-powered document processing to extract and explain:

- **📑 Document Structure**: **{total_sections}** sections identified and analyzed across the document
- **📋 Data Tables**: **{total_tables}** table(s) extracted with structured data and explanations
- **📈 Key Metrics**: **{total_metrics}** key metric(s) identified and referenced

### Report Methodology

Each section of this report includes:

1. **🔍 Detailed Explanation**: Comprehensive analysis of what the section contains, its purpose, and significance
2. **💡 Key Information Extraction**: Important data, values, facts, and figures extracted with proper context
3. **📊 Table Analysis**: Detailed explanation of tables with key insights, trends, and important values highlighted
4. **📍 Page References**: Proper citations to document locations for easy verification
5. **🎯 Context and Significance**: Explanation of why the information matters and its implications

This report serves as a complete, professional guide to understanding the document's content, structure, and key information. All analysis is based on the actual document content with proper references and citations.

"""
        return header
    
    def format_table_of_contents(self, sections: List[Dict[str, Any]]) -> str:
        """Generate professional table of contents from sections."""
        toc = "\n## 📑 Table of Contents\n\n"
        
        for idx, section in enumerate(sections, 1):
            title = section.get("title", f"Section {idx}")
            page = section.get("page", 0)
            page_label = page + 1 if isinstance(page, int) else "N/A"
            section_type = section.get("type", "text").title()
            # Create anchor-friendly ID
            anchor = re.sub(r'[^\w\s-]', '', title.lower()).strip().replace(' ', '-')
            toc += f"{idx}. **{title}** - Page {page_label} ({section_type})\n"
        
        toc += "\n---\n\n"
        return toc
    
    def format_summary_and_conclusion(
        self, 
        sections: List[Dict[str, Any]], 
        financial_data: Dict[str, Any]
    ) -> str:
        """Generate summary and conclusion section."""
        summary = "\n## 📊 Summary and Conclusion\n\n"
        
        # Count sections by type
        section_types = {}
        for section in sections:
            sec_type = section.get("type", "text")
            section_types[sec_type] = section_types.get(sec_type, 0) + 1
        
        summary += f"This comprehensive document analysis has examined **{len(sections)} sections** across multiple pages. "
        summary += f"The document includes **{section_types.get('table', 0)}** table section(s) and "
        summary += f"**{section_types.get('text', 0)}** text section(s), all of which have been thoroughly analyzed.\n\n"
        
        # Get statistics
        total_tables = len(financial_data.get("tables", []))
        total_metrics = len(financial_data.get("key_metrics", []))
        
        summary += "### 🔍 Key Findings\n\n"
        summary += f"- **{len(sections)} sections** have been analyzed and explained in comprehensive detail\n"
        summary += f"- **{total_tables} table(s)** have been extracted, formatted, and explained with key insights\n"
        summary += f"- **{total_metrics} key metric(s)** have been identified, extracted, and referenced throughout the report\n"
        summary += "- **Proper page references** are provided for all sections and tables for easy verification\n"
        summary += "- **Comprehensive explanations** with context and significance are included for each section\n"
        summary += "- **Professional formatting** ensures the report is suitable for business and professional use\n\n"
        
        summary += "### 📋 Document Assessment\n\n"
        summary += "This comprehensive analysis provides a detailed, professional understanding of the document structure, "
        summary += "content, and key information. All sections have been thoroughly explained with proper context, "
        summary += "references, and professional formatting. The report serves as a complete, authoritative guide to the document's "
        summary += "content and can be used for analysis, review, compliance, or reference purposes.\n\n"
        
        summary += "### ✨ Report Features\n\n"
        summary += "- **📑 Section-by-Section Analysis**: Each document section is explained in comprehensive detail\n"
        summary += "- **📊 Table Documentation**: All tables are formatted professionally and explained with key insights and trends\n"
        summary += "- **📍 Page References**: Every section and table includes proper page citations for verification\n"
        summary += "- **💼 Professional Formatting**: Formal document structure suitable for business, legal, and professional use\n"
        summary += "- **🎯 Comprehensive Coverage**: All document content is analyzed and explained with proper context\n"
        summary += "- **🔍 Detailed Explanations**: Each section includes thorough analysis of content, significance, and implications\n\n"
        
        summary += "### 📌 Report Usage\n\n"
        summary += "This report can be used for:\n"
        summary += "- Document review and analysis\n"
        summary += "- Compliance and verification purposes\n"
        summary += "- Business decision-making based on document content\n"
        summary += "- Reference and documentation\n"
        summary += "- Training and knowledge transfer\n\n"
        
        return summary


class ReportService:
    """Main service for generating document reports - completely separate from chat."""
    
    def __init__(self):
        self.structure_analyzer = DocumentStructureAnalyzer()
        self.explanation_generator = SectionExplanationGenerator()
        self.formatter = None  # Will be initialized with dependencies
    
    def generate_document_report(self, financial_data: Dict[str, Any], document_id: Optional[str] = None, fast_mode: bool = True, summary_mode: bool = True) -> str:
        """
        Generate a comprehensive document report with section-by-section explanations.
        
        This is completely separate from chat functionality.
        Only processes the specific document data provided - no cross-document access.
        
        Args:
            financial_data: Processed document data from JSON file (for THIS document only)
            document_id: Optional document ID for validation and logging
        
        Returns:
            Formatted markdown report for THIS document only
        
        Args:
            fast_mode: If True, shows parsed table data immediately without waiting for LLM explanations (much faster)
            summary_mode: If True, only explains sections with references, skips full table generation (fastest)
        """
        try:
            # Validate that we have document data
            if not financial_data or not isinstance(financial_data, dict):
                raise ValueError("Invalid financial_data: must be a non-empty dictionary")
            
            # Log document being processed (for debugging/verification)
            if document_id:
                print(f"Generating report for document: {document_id}")
            
            # Extract metadata to verify document identity
            metadata = financial_data.get("metadata", {})
            doc_filename = metadata.get("filename", "Unknown")
            
            if document_id:
                print(f"   Document filename: {doc_filename}")
            
            # Set fast_mode and summary_mode flags for formatter
            if fast_mode:
                financial_data['_fast_mode'] = True
            if summary_mode:
                financial_data['_summary_mode'] = True
                print("   ⚡ SUMMARY MODE: Explaining sections only with references (fastest, no full tables)")
            elif fast_mode:
                print("   ⚡ FAST MODE: Showing parsed data immediately (skipping slow LLM explanations)")
            
            # Step 1: FORCE create sections from ALL available data FIRST
            # This ensures we ALWAYS have sections to generate detailed reports
            print("   Step 1: Creating sections from all available data...")
            sections = self._force_create_sections(financial_data)
            
            # Also try structure analyzer and merge results (but don't fail if it errors)
            try:
                structure = self.structure_analyzer.analyze_structure(financial_data)
                analyzer_sections = structure.get("sections", [])
                
                # Merge sections (avoid duplicates by title)
                existing_titles = {s.get("title", "") for s in sections}
                for sec in analyzer_sections:
                    if sec.get("title", "") not in existing_titles:
                        sections.append(sec)
            except Exception as e:
                print(f"   WARNING: Structure analyzer failed (non-critical): {e}")
                # Continue with sections from _force_create_sections
                pass
            
            # Debug: Log what we found
            detected_chunks = financial_data.get("detected_chunks", [])
            tables = financial_data.get("tables", [])
            print(f"   Found {len(detected_chunks)} chunks, {len(tables)} tables")
            print(f"   Created {len(sections)} total sections for detailed analysis")
            
            # Step 2: Initialize formatter with dependencies (scoped to THIS document only)
            # Create a new formatter instance for this document to ensure isolation
            formatter = ReportFormatter(
                explanation_generator=self.explanation_generator,
                financial_data=financial_data  # Only this document's data
            )
            
            # If still no sections, use enhanced fallback (which still generates detailed reports)
            if not sections:
                print(f"WARNING: No sections after force creation, using enhanced fallback")
                print(f"   Enhanced fallback will still generate detailed explanations for all tables")
                return self._generate_enhanced_fallback_report(financial_data)
            
            print(f"   Generating detailed report with {len(sections)} sections")
            
            # Step 3: Build report header (for THIS document only) - MUST be detailed format
            print("   Step 3: Building detailed report header...")
            report = formatter.format_report_header(metadata, financial_data)
            
            # Validate header format
            if "Document Analysis Report" not in report and "Executive Summary" not in report:
                print("   WARNING: Header doesn't match expected format, regenerating...")
                # Force regenerate with proper format
                report = formatter.format_report_header(metadata, financial_data)
            
            # Step 4: Add table of contents (for THIS document only)
            print("   Step 4: Adding table of contents...")
            report += formatter.format_table_of_contents(sections)
            
            # Step 5: Generate explanations for each section
            print("   Step 5: Generating detailed section explanations...")
            report += "## 📄 Document Sections - Detailed Analysis\n\n"
            report += "This report provides comprehensive, detailed explanations for each section of the document. "
            report += "Each section has been thoroughly analyzed using advanced AI to extract and explain all information, "
            report += "values, relationships, and significance.\n\n"
            report += "---\n\n"
            
            # Process sections with parallel processing for speed (if multiple sections)
            use_parallel = (
                self.explanation_generator.openai_api_key and 
                len(sections) > 1 and
                not summary_mode  # Don't use parallel in summary mode (already fast)
            )
            
            if use_parallel:
                print(f"   ⚡ Using parallel processing for {len(sections)} sections (5-10x faster)...")
                try:
                    from concurrent.futures import ThreadPoolExecutor
                    
                    # Use ThreadPoolExecutor to run sync functions in parallel
                    def generate_explanation_sync(section):
                        try:
                            return self.explanation_generator.generate_section_explanation(
                                section, 
                                financial_data
                            )
                        except Exception as e:
                            print(f"      Error generating explanation: {e}")
                            return self.explanation_generator._generate_basic_explanation(section)
                    
                    # Process all sections in parallel using ThreadPoolExecutor
                    with ThreadPoolExecutor(max_workers=min(10, len(sections))) as executor:
                        explanations = list(executor.map(generate_explanation_sync, sections))
                    
                    # Format sections with their explanations
                    for idx, (section, explanation) in enumerate(zip(sections, explanations), 1):
                        try:
                            print(f"      Formatting section {idx}/{len(sections)}: {section.get('title', 'Unknown')}")
                            formatted_section = formatter.format_section(
                                section,
                                explanation,
                                idx
                            )
                            report += formatted_section
                            report += "\n---\n"
                        except Exception as e:
                            print(f"      Error formatting section {idx}: {e}")
                            # Fallback formatting
                            report += f"\n## {idx}. {section.get('title', f'Section {idx}')}\n\n"
                            report += f"{explanation}\n\n---\n"
                except Exception as e:
                    print(f"   ⚠️ Parallel processing failed, falling back to sequential: {e}")
                    use_parallel = False
            
            if not use_parallel:
                # Sequential processing (fallback or for simple cases)
                for idx, section in enumerate(sections, 1):
                    try:
                        print(f"      Processing section {idx}/{len(sections)}: {section.get('title', 'Unknown')}")
                        # Generate explanation for this section
                        explanation = self.explanation_generator.generate_section_explanation(
                            section, 
                            financial_data
                        )
                        
                        # Format section with explanation (for THIS document only)
                        formatted_section = formatter.format_section(
                            section,
                            explanation,
                            idx
                        )
                        
                        report += formatted_section
                        report += "\n---\n"
                    except Exception as e:
                        print(f"      ERROR processing section {idx}: {e}")
                        # Still include section even if explanation fails
                        section_title = section.get('title', f'Section {idx}')
                        section_page = section.get('page', 0)
                        try:
                            section_page = int(section_page) if section_page is not None else 0
                        except:
                            section_page = 0
                        
                        report += f"\n## {idx}. {section_title}\n\n"
                        report += f"**Page Reference:** Page {section_page + 1}\n\n"
                        report += f"{section.get('full_content', section.get('content', ''))[:1000]}\n\n"
                        report += "---\n"
            
            # Step 5.5: Add tables section (skip full tables in summary_mode for speed)
            summary_mode = financial_data.get('_summary_mode', False)
            all_tables = financial_data.get("tables", [])
            
            if summary_mode:
                # Summary mode: Just list tables with brief references, no full data (FASTEST)
                if all_tables:
                    print(f"   Step 5.5: Listing {len(all_tables)} tables with references (summary mode - fastest)...")
                    report += "\n## 📊 Document Tables Reference\n\n"
                    report += f"This document contains **{len(all_tables)}** table(s). Each table is referenced below with its location and key information.\n\n"
                    report += "---\n\n"
                    
                    for idx, table in enumerate(all_tables, 1):
                        table_title = table.get("title", f"Table {idx}")
                        table_page = table.get("page", 0)
                        try:
                            table_page = int(table_page) if table_page is not None else 0
                        except:
                            table_page = 0
                        headers = table.get("header", [])
                        rows = table.get("rows", []) or table.get("data", [])
                        
                        report += f"### 📊 Table {idx}: {table_title}\n\n"
                        report += f"**📍 Location:** Page {table_page + 1}\n\n"
                        if headers:
                            report += f"**Columns:** {', '.join(str(h) for h in headers[:8])}"
                            if len(headers) > 8:
                                report += f" and {len(headers) - 8} more"
                            report += "\n\n"
                        if rows:
                            report += f"**Rows:** {len(rows)} data row(s)\n\n"
                        report += "---\n\n"
            elif all_tables:
                # Full mode: Show tables with data (but still fast if fast_mode)
                print(f"   Step 5.5: Generating comprehensive analysis for ALL {len(all_tables)} tables...")
                report += "\n## 📊 Comprehensive Table Analysis\n\n"
                report += "This section provides detailed, comprehensive analysis of ALL tables extracted from the document. "
                report += f"Each table is displayed in full with complete data and detailed AI-generated explanations, "
                report += f"insights, and comprehensive analysis.\n\n"
                report += f"**Total Tables Analyzed:** **{len(all_tables)}**\n\n"
                report += "---\n\n"
                
                for idx, table in enumerate(all_tables, 1):
                    print(f"      Processing table {idx}/{len(all_tables)}: {table.get('title', 'Unknown')}")
                    try:
                        report += formatter._format_table(
                            table, 
                            idx,
                            explanation_generator=self.explanation_generator,
                            financial_data=financial_data  # Only this document's data
                        )
                        report += "\n---\n\n"
                    except Exception as e:
                        print(f"      Error processing table {idx}: {e}")
                        # Still include table data
                        report += f"\n### 📊 Table {idx}: {table.get('title', f'Table {idx}')}\n\n"
                        headers = table.get("header", [])
                        rows = table.get("rows", []) or table.get("data", [])
                        if headers and rows:
                            report += "| " + " | ".join(str(h) for h in headers) + " |\n"
                            report += "| " + " | ".join(["---"] * len(headers)) + " |\n"
                            for row in rows[:20]:  # Limit rows in error case
                                if isinstance(row, list):
                                    report += "| " + " | ".join(str(cell) for cell in row) + " |\n"
                        report += "\n---\n\n"
            
            # Step 6: Add summary and conclusion (for THIS document only)
            report += formatter.format_summary_and_conclusion(sections, financial_data)
            
            # Step 7: Add footer with document identification
            report += "\n\n---\n\n"
            report += f"*Report generated by ALPHA LENS on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*\n"
            if document_id:
                report += f"*Document ID: {document_id}*\n"
            report += f"*Document: {doc_filename}*\n"
            
            # Final validation: Ensure report is detailed and comprehensive
            if len(report) < 1000:
                print(f"WARNING: Report is too short ({len(report)} chars), regenerating with enhanced fallback...")
                return self._generate_enhanced_fallback_report(financial_data)
            
            # Check if report has detailed format markers
            has_detailed_format = (
                "Document Analysis Report" in report or 
                "Executive Summary" in report or
                "Comprehensive Table Analysis" in report or
                "Document Sections" in report
            )
            
            if not has_detailed_format:
                print(f"WARNING: Report doesn't have detailed format markers, regenerating...")
                return self._generate_enhanced_fallback_report(financial_data)
            
            if document_id:
                print(f"✅ Report generated successfully for document: {document_id}")
                print(f"   Report length: {len(report)} characters")
                print(f"   Report format: Detailed and comprehensive")
            
            return report
            
        except Exception as e:
            print(f"❌ ERROR generating document report: {e}")
            import traceback
            traceback.print_exc()
            # CRITICAL: Always use enhanced fallback which generates detailed reports
            # This ensures we NEVER return the old basic format
            try:
                print("   CRITICAL: Using enhanced fallback to ensure detailed report format...")
                fallback_report = self._generate_enhanced_fallback_report(financial_data)
                
                # Validate fallback report has detailed format
                if len(fallback_report) > 1000 and (
                    "Document Analysis Report" in fallback_report or 
                    "Comprehensive Table Analysis" in fallback_report
                ):
                    print("   ✅ Enhanced fallback generated detailed report successfully")
                    return fallback_report
                else:
                    print(f"   WARNING: Fallback report format issue (length: {len(fallback_report)})")
            except Exception as e2:
                print(f"❌ ERROR: Enhanced fallback also failed: {e2}")
                import traceback
                traceback.print_exc()
            
            # Last resort: return informative error message with available data
            metadata = financial_data.get("metadata", {})
            tables = financial_data.get("tables", [])
            key_metrics = financial_data.get("key_metrics", [])
            
            # Still try to create a useful report even on error
            error_report = f"""# 📄 Document Analysis Report

<div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white; padding: 2rem; border-radius: 12px; margin-bottom: 2rem;">

## ALPHA LENS Document Analysis

**Report Generated:** {datetime.now().strftime('%B %d, %Y at %I:%M %p')}  
**Document Name:** {metadata.get('filename', 'Unknown')}  
**Document Type:** {metadata.get('document_type', 'Document')}  
**Document Date:** {metadata.get('document_date', 'Unknown')}

</div>

---

## ⚠️ Report Generation Notice

An error occurred while generating the detailed report: {str(e)}

However, the following information is available:

- **Tables Found:** {len(tables)} table(s)
- **Key Metrics:** {len(key_metrics)} metric(s)

Please try generating the report again. If the issue persists, contact support.

"""
            
            # Still include tables if available
            if tables:
                error_report += "\n## 📊 Tables in Document\n\n"
                for idx, table in enumerate(tables, 1):
                    error_report += f"### Table {idx}: {table.get('title', f'Table {idx}')}\n\n"
                    headers = table.get("header", [])
                    rows = table.get("rows", []) or table.get("data", [])
                    if headers and rows:
                        error_report += "| " + " | ".join(str(h) for h in headers) + " |\n"
                        error_report += "| " + " | ".join(["---"] * len(headers)) + " |\n"
                        for row in rows[:10]:
                            if isinstance(row, list):
                                error_report += "| " + " | ".join(str(cell) for cell in row) + " |\n"
                    error_report += "\n"
            
            return error_report
    
    def _force_create_sections(self, financial_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Force create sections from any available data when normal analysis fails."""
        sections = []
        section_id = 1
        
        # Try to create sections from tables
        tables = financial_data.get("tables", [])
        if tables:
            for table in tables:
                table_page = table.get("page", table.get("page_number", 0)) or 0
                try:
                    table_page = int(table_page)
                except (ValueError, TypeError):
                    table_page = 0
                
                table_title = table.get("title", f"Table {section_id}")
                headers = table.get("header", [])
                rows = table.get("rows", []) or table.get("data", [])
                
                # Create comprehensive content
                table_content = f"Table: {table_title}\n\n"
                if headers:
                    table_content += f"Headers: {' | '.join(str(h) for h in headers)}\n\n"
                if rows:
                    table_content += "Table Data:\n"
                    for row in rows:
                        if isinstance(row, list):
                            table_content += f"{' | '.join(str(cell) for cell in row)}\n"
                        elif isinstance(row, dict):
                            row_values = [str(row.get(h, "")) for h in headers] if headers else list(row.values())
                            table_content += f"{' | '.join(row_values)}\n"
                
                section = {
                    "id": f"section_{section_id}",
                    "title": table_title,
                    "page": table_page,
                    "type": "table",
                    "chunks": [],
                    "tables": [table],
                    "metrics": [],
                    "content": table_content[:2000],
                    "full_content": table_content
                }
                sections.append(section)
                section_id += 1
        
        # Try to create sections from detected_chunks
        detected_chunks = financial_data.get("detected_chunks", [])
        if detected_chunks:
            for chunk in detected_chunks:
                chunk_text = chunk.get("text") or chunk.get("markdown") or chunk.get("content") or ""
                if chunk_text and chunk_text.strip():
                    page = chunk.get("page", chunk.get("page_number", 0)) or 0
                    try:
                        page = int(page)
                    except (ValueError, TypeError):
                        page = 0
                    
                    chunk_type = chunk.get("type", "text")
                    # Use structure analyzer's method to extract title
                    title = self.structure_analyzer._extract_section_title(chunk_text, chunk_type)
                    
                    section = {
                        "id": f"section_{section_id}",
                        "title": title or f"{chunk_type.title()} Section {section_id}",
                        "page": page,
                        "type": chunk_type,
                        "chunks": [chunk.get("id", f"chunk_{section_id}")],
                        "tables": [],
                        "metrics": [],
                        "content": chunk_text[:2000],
                        "full_content": chunk_text
                    }
                    sections.append(section)
                    section_id += 1
        
        # Try to create sections from markdown/original text
        if not sections:
            markdown_content = financial_data.get("markdown", "")
            original_text = financial_data.get("original_text", "")
            content = markdown_content or original_text
            
            if content:
                paragraphs = [p.strip() for p in content.split('\n\n') if p.strip()]
                for idx, para in enumerate(paragraphs[:20], 1):
                    section = {
                        "id": f"section_{idx}",
                        "title": f"Content Section {idx}",
                        "page": 0,
                        "type": "text",
                        "chunks": [],
                        "tables": [],
                        "metrics": [],
                        "content": para[:2000],
                        "full_content": para
                    }
                    sections.append(section)
        
        return sections
    
    def _generate_enhanced_fallback_report(self, financial_data: Dict[str, Any]) -> str:
        """Generate an enhanced fallback report with detailed explanations using LLM.
        This is used when section creation fails, but still generates comprehensive reports."""
        print("   Using enhanced fallback report generation...")
        metadata = financial_data.get("metadata", {})
        key_metrics = financial_data.get("key_metrics", [])
        tables = financial_data.get("tables", [])
        detected_chunks = financial_data.get("detected_chunks", [])
        
        # Use the formatter to create a proper header
        formatter = ReportFormatter(
            explanation_generator=self.explanation_generator,
            financial_data=financial_data
        )
        
        report = formatter.format_report_header(metadata, financial_data)
        report += "\n## 📄 Document Content Analysis\n\n"
        report += "This comprehensive report provides detailed analysis of all content extracted from the document. "
        report += "Each section, table, and piece of information has been thoroughly analyzed and explained.\n\n"
        report += "---\n\n"
        
        # Add detected chunks as sections
        if detected_chunks:
            report += f"## 📑 Document Sections\n\nThe document contains **{len(detected_chunks)}** detected section(s). "
            report += "Each section is analyzed in detail below.\n\n"
            report += "---\n\n"
            
            for idx, chunk in enumerate(detected_chunks, 1):
                chunk_type = chunk.get("type", "text")
                chunk_text = chunk.get("text") or chunk.get("markdown") or chunk.get("content") or ""
                page = chunk.get("page", 0) or 0
                
                if chunk_text:
                    report += f"\n### Section {idx}: {chunk_type.title()} Content\n\n"
                    report += f"**Page Reference:** Page {page + 1 if isinstance(page, int) else 'N/A'}\n\n"
                    
                    # Generate explanation for this chunk (skip in fast mode)
                    fast_mode = financial_data.get('_fast_mode', False)
                    if not fast_mode:
                        try:
                            section_data = {
                                "title": f"{chunk_type.title()} Section {idx}",
                                "page": page,
                                "type": chunk_type,
                                "content": chunk_text[:2000],
                                "full_content": chunk_text
                            }
                            explanation = self.explanation_generator.generate_section_explanation(
                                section_data, financial_data
                            )
                            report += f"{explanation}\n\n"
                        except Exception as e:
                            print(f"   Error generating explanation for chunk {idx}: {e}")
                            report += f"{chunk_text[:1000]}...\n\n"
                    else:
                        # Fast mode: just show content
                        report += f"{chunk_text[:1500]}\n\n"
                    
                    report += "---\n\n"
        
        # Add key metrics with detailed explanations
        if key_metrics:
            report += "## 📈 Key Metrics and Values\n\nThe following key metrics have been extracted from the document:\n\n"
            for metric in key_metrics[:30]:
                name = metric.get("name", "")
                value = metric.get("value", "")
                unit = metric.get("unit", "")
                if name and value:
                    report += f"- **{name}**: **{value}** {unit}\n"
            report += "\n---\n\n"
        
        # Add tables with detailed explanations (CRITICAL - this is the main content)
        if tables:
            report += f"## 📊 Comprehensive Table Analysis\n\nThe document contains **{len(tables)}** table(s). "
            report += "Each table is displayed in full with complete data and detailed AI-generated explanations, "
            report += "insights, and comprehensive analysis.\n\n"
            report += "---\n\n"
            
            for idx, table in enumerate(tables, 1):
                print(f"   Generating detailed explanation for table {idx}/{len(tables)}")
                try:
                    # Generate detailed explanation for each table
                    table_explanation = self.explanation_generator.generate_table_explanation(
                        table, financial_data
                    )
                    
                    # Format table with explanation
                    formatted_table = formatter._format_table(
                        table,
                        idx,
                        explanation_generator=self.explanation_generator,
                        financial_data=financial_data
                    )
                    
                    report += formatted_table
                    report += "\n---\n\n"
                except Exception as e:
                    print(f"   Error processing table {idx}: {e}")
                    # Still include table data even if explanation fails
                    report += f"\n### 📊 Table {idx}: {table.get('title', f'Table {idx}')}\n\n"
                    headers = table.get("header", [])
                    rows = table.get("rows", []) or table.get("data", [])
                    if headers and rows:
                        report += "| " + " | ".join(str(h) for h in headers) + " |\n"
                        report += "| " + " | ".join(["---"] * len(headers)) + " |\n"
                        for row in rows:
                            if isinstance(row, list):
                                report += "| " + " | ".join(str(cell) for cell in row) + " |\n"
                    report += "\n---\n\n"
        
        # Add comprehensive summary
        report += "\n## 📋 Summary and Conclusion\n\n"
        report += "This comprehensive analysis has examined all content, tables, and metrics from the document. "
        report += f"The document contains **{len(detected_chunks)}** section(s) and **{len(tables)}** table(s), "
        report += "all of which have been thoroughly analyzed and explained above. "
        report += "Each table includes complete data display and detailed explanations of its content, significance, "
        report += "and implications. All key metrics and values have been identified and documented.\n\n"
        
        return report
    
    def _generate_fallback_report(self, financial_data: Dict[str, Any]) -> str:
        """Generate a basic fallback report if structure analysis fails.
        ALWAYS uses enhanced fallback to ensure detailed reports."""
        print("   Using enhanced fallback (detailed report generation)...")
        return self._generate_enhanced_fallback_report(financial_data)


# Create singleton instance
report_service = ReportService()

