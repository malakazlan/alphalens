Assignment: Security Analysis of Your FYP-2 System
Deadline: 25 - 2 - 26
1. Background
Information Security is the practice of protecting information from unauthorized access, use, disclosure, destruction, modification, or disruption 
Modern software systems face continuous threats due to the Internet, cloud computing, and IoT technologies.
Security must be integrated into the software development lifecycle, not added after development 
This assignment requires students to analyze the security of their own Final Year Project (FYP-2) using concepts studied in lectures.
2. Assignment Objective
By completing this assignment, students will:
•	Apply CIA Triad (Confidentiality, Integrity, Availability)
•	Identify assets, threats, vulnerabilities, and attacks
•	Analyze software security weaknesses
•	Propose security safeguards and countermeasures
•	Understand the role of security in the software development lifecycle
3. Main Task — Use Your FYP-2 System
You must perform a security assessment of your own FYP that has been developed up to FYP-2 stage.
4. Report Structure
Section 1 — FYP Overview (10 Marks)
Describe your system:
Include:
•	Project Title
•	System Purpose
•	Target Users
•	Platform/Technologies used (Web, Mobile, IoT, AI, etc.)
•	Type of data handled by the system
(Approx. ½ page)
Section 2 — Identify Information Assets (10 Marks)
An asset is anything that has value to the system.
Examples from lecture:
•	Data
•	Applications
•	Hardware
•	Network resources
•	Users
Create a table:
Asset	Description	Importance
Examples:
•	User accounts
•	Database
•	Admin panel
•	API services
•	Cloud storage
Section 3 — Threats, Attacks & Vulnerabilities (20 Marks)
From Week-3 lecture:
•	Threat: potential risk to an asset
•	Attack: action that damages or compromises the system
•	Vulnerability: weakness that can be exploited 
Create a table:
Asset	Possible Threat	Possible Attack	Vulnerability
Examples:
•	Malware
•	Phishing
•	Insider misuse
•	SQL Injection
•	DDoS
•	Device theft
•	Human error
Section 4 — CIA Triad Analysis (20 Marks)
Apply the CIA Triangle to your FYP system.
Create a table:
CIA Principle	Risk in Your FYP	Impact if Compromised
Confidentiality	Data leakage, unauthorized access	
Integrity	Data tampering, fake records	
Availability	Server crash, DDoS, power failure	

Section 5 — Software Security Analysis (20 Marks)
Identify current weaknesses in your FYP.
Examples:
•	Weak authentication
•	Hardcoded credentials
•	No encryption
•	Poor input validation
•	No logging/monitoring
•	Outdated software libraries
•	No backup system
Create a table:
Vulnerability	Location in Your System	Risk Level

Section 6 — Security Safeguards & Countermeasures (20 Marks)
Propose practical solutions.
Use lecture examples:
•	Cryptography
•	Access control
•	Secure programming
•	Policies and awareness
Create a table:
Security Goal	Countermeasure	How it protects system
Confidentiality		
Integrity		
Availability		
Minimum 2 solutions per CIA principle.
Section 7 — Reflection (10 Marks)
Answer briefly:
1.	Which CIA principle is most critical for your FYP and why?
2.	Which threats are most realistic for your system?
3.	What security improvements will you implement before FYP-Final?
5. Submission Requirements
•	Report length: 4–6 pages
•	Include tables and diagrams where possible
•	Submit Word File
•	Individual work
6. Presentation (In-Class)
Each student will give a 2-minute presentation covering:
•	FYP overview
•	Biggest security risk
•	Best security solution

---

## Completed Security Assessment Report — ALPHA LENS

### Section 1 — FYP Overview (10 Marks)

**Project Title:** ALPHA LENS

**System Purpose:** ALPHA LENS is a financial document analysis platform that uses AI to extract, analyze, and enable conversational queries on financial documents. The system integrates Landing.AI's ADE (Automated Document Extraction) API for document processing and OpenAI for intelligent chat responses. Users can upload PDF financial documents, ask questions in natural language, and generate professional financial analysis reports.

**Target Users:** Professionals and analysts who need to process and query financial documents (e.g., financial statements, reports); any user requiring AI-assisted document understanding and report generation.

**Platform/Technologies Used:** Web application (frontend: HTML5, CSS3, Vanilla JavaScript with ES6+, PDF.js; backend: FastAPI with Python 3.10+); Supabase (PostgreSQL with Row Level Security, Supabase Storage, Supabase Auth with JWT); AI services (Landing.AI ADE API, OpenAI GPT-3.5/GPT-4); vector store (local file-based JSON for semantic search); deployment on Render.com.

**Type of Data Handled:** User credentials (email, password hashes via Supabase Auth); JWT access and refresh tokens; uploaded financial PDFs; extracted and processed financial data (metadata, tables, key metrics, document markdown); document metadata and processing status; conversation history (currently in-memory); API keys and configuration (environment variables). Data is user-scoped and isolated per account.

---

### Section 2 — Identify Information Assets (10 Marks)

| Asset | Description | Importance |
|-------|-------------|------------|
| User accounts | Supabase Auth identities (email, hashed passwords, session state) | High — compromise allows full access to a user’s documents and data |
| Documents database | Supabase PostgreSQL `documents` table (ids, user_id, paths, status, metadata) | High — central record of all documents; RLS enforces per-user access |
| Processed financial data | JSON files in Supabase Storage (key metrics, tables, extracted text) | High — core business data; sensitive financial information |
| Original PDFs | Uploaded files in Supabase Storage (`original.pdf` per document) | High — source documents; may contain confidential financial details |
| API services | FastAPI backend (auth, document upload/chat, report generation) | High — entry point for all client operations; must be protected |
| JWT tokens | Access and refresh tokens issued by Supabase Auth | High — possession grants authenticated access to user resources |
| Vector stores | Local JSON vector/chunk data for semantic search | Medium — supports chat quality; less critical than source data |
| Conversation history | In-memory chat history per document (current implementation) | Medium — context for chat; loss affects UX, not primary asset |
| Configuration & secrets | Environment variables (Supabase URL/keys, OpenAI, Landing.AI API keys) | High — leakage enables abuse of external services and data access |
| Frontend application | Static HTML/CSS/JS and PDF.js assets | Medium — tampering could lead to XSS or credential theft if tokens exposed |

---

### Section 3 — Threats, Attacks & Vulnerabilities (20 Marks)

| Asset | Possible Threat | Possible Attack | Vulnerability |
|-------|-----------------|-----------------|---------------|
| User accounts | Credential theft, account takeover | Phishing, credential stuffing, brute force | Weak or reused passwords; token storage in localStorage/cookies (XSS can steal tokens) |
| Documents database | Unauthorized read/write, data exfiltration | SQL injection, abuse of misconfigured RLS | Use of parameterized queries and RLS mitigates; residual risk if RLS bypassed or token leaked |
| Processed/original documents | Data leakage, privacy breach | Unauthorized download, path traversal, IDOR | Storage path and RLS tied to auth.uid(); dependency on correct token and path validation |
| API services | Abuse, denial of service, unauthorized access | DDoS, API abuse, broken authentication | No rate limiting (per architecture); reliance on valid JWT only |
| JWT tokens | Token theft, replay, long-lived sessions | XSS, MITM (if not HTTPS), session fixation | Tokens in localStorage/cookies; HTTPS and short expiry reduce risk |
| Configuration & secrets | Key leakage, lateral movement | Logging of env vars, repo exposure, insider access | Keys in environment; no secret scanning or rotation policy stated |
| Frontend application | Client-side attacks, injection | XSS, malicious script injection | User-generated content and dynamic rendering; need strict output encoding and CSP |
| Conversation history | Information disclosure, tampering | Memory scraping, process compromise | Stored in-memory only; no encryption or integrity checks |
| Cloud/storage | Misconfiguration, policy bypass | Bucket misconfiguration, policy change | Storage RLS depends on path prefix (user_id); first-segment consistency critical |
| External APIs (OpenAI, Landing.AI) | Data sent to third party, API key abuse | Data leakage via provider, key theft | Sensitive content in prompts; keys in env; dependency on provider security |

---

### Section 4 — CIA Triad Analysis (20 Marks)

| CIA Principle | Risk in Your FYP | Impact if Compromised |
|---------------|------------------|------------------------|
| **Confidentiality** | Data leakage (financial PDFs and extracted data); unauthorized access via stolen JWT or session; exposure of API keys or config; third-party exposure via OpenAI/Landing.AI prompts | Loss of trust, regulatory/non-compliance (e.g. financial data), reputational damage, legal liability; competitors or attackers gain sensitive financial information |
| **Integrity** | Data tampering (processed JSON, document metadata); fake or altered records in DB; poisoned vector store or chat context; compromised LLM responses or report content | Incorrect business decisions, invalid reports, legal/audit issues; users act on falsified financial analysis |
| **Availability** | Server or process crash (Render.com, FastAPI); DDoS or resource exhaustion (no rate limiting); dependency failure (Supabase, OpenAI, Landing.AI); loss of in-memory conversation state on restart | Users cannot upload, chat, or generate reports; loss of productivity; SLA breach if deployed for production use |

---

### Section 5 — Software Security Analysis (20 Marks)

| Vulnerability | Location in Your System | Risk Level |
|---------------|-------------------------|------------|
| Token storage in localStorage/cookies | Frontend `auth.js` — JWT stored for API calls | Medium — XSS can steal token and impersonate user |
| No API rate limiting | FastAPI `app.py` — document upload, chat, report endpoints | Medium — abuse, DoS, or cost explosion (e.g. OpenAI, ADE) |
| Conversation history only in-memory | `chat_engine.py` — `conversation_history` dict | Medium — loss on restart; no audit trail or encryption |
| No explicit encryption at rest stated | Supabase Storage and PostgreSQL | Low–Medium — Supabase provides encryption; key management and backup encryption should be confirmed |
| Input validation scope | Request bodies (Pydantic) vs. file content and chat input | Medium — strict validation on structured fields; file type/size and chat input need clear limits and sanitization |
| No security-focused logging/monitoring | Backend — no described audit log for auth failures, access to sensitive docs | Medium — harder to detect breaches or abuse |
| Dependency on environment variables | `config.py` — all secrets from env | Medium — accidental logging or repo commit of .env; no rotation described |
| CORS configuration | `app.py` — CORS middleware | Low–Medium — must be restricted to actual frontend origins in production |
| Outdated or vulnerable dependencies | `requirements.txt`, frontend libraries | Medium — unpatched libs can introduce known CVEs |
| No backup/restore procedure described | Database and Storage | Medium — data loss or ransomware impact if no backups |
| File upload — type/size and malware | `/documents/upload` — PDF upload | Medium — oversized files, non-PDF abuse, or malicious PDFs if not validated |

---

### Section 6 — Security Safeguards & Countermeasures (20 Marks)

| Security Goal | Countermeasure | How It Protects the System |
|---------------|----------------|----------------------------|
| **Confidentiality** | HTTPS only and TLS for all client–server and server–external API traffic | Prevents eavesdropping and token/data interception in transit |
| **Confidentiality** | Row Level Security (RLS) on `documents` and storage with `auth.uid()` | Ensures users only access their own records and files; enforces data isolation |
| **Confidentiality** | Access control via JWT and `get_current_user()` on protected routes | Only authenticated users with valid tokens call document/chat/report APIs |
| **Confidentiality** | Secure storage of secrets (env vars, no hardcoding); optional secret rotation | Reduces risk of key leakage and long-term abuse if a key is exposed |
| **Integrity** | Pydantic request validation and strict file type/size checks on upload | Reduces malformed or malicious input and oversized uploads affecting processing |
| **Integrity** | Parameterized queries and Supabase client usage (no raw SQL concatenation) | Prevents SQL injection and preserves database integrity |
| **Integrity** | Audit logging (auth events, document access, report generation) | Detects tampering and supports forensics; supports integrity of “who did what” |
| **Integrity** | Checksums or integrity checks on stored processed.json (optional) | Detects accidental or malicious modification of processed data |
| **Availability** | Rate limiting on auth, upload, chat, and report endpoints | Mitigates DDoS and abuse; protects backend and external API quotas |
| **Availability** | Health-check endpoint and monitoring (e.g. Render, external monitor) | Fast detection of crashes or dependency failures; supports incident response |
| **Availability** | Regular backups of Supabase DB and Storage with tested restore | Enables recovery from data loss, corruption, or ransomware |
| **Availability** | Graceful degradation and error handling (e.g. when OpenAI/Landing.AI fail) | Reduces full outage impact; users get clear errors instead of total failure |

*Minimum two countermeasures per CIA principle are covered above.*

---

### Section 7 — Reflection (10 Marks)

**1. Which CIA principle is most critical for your FYP and why?**  
**Confidentiality** is the most critical for ALPHA LENS. The system handles financial documents and extracted data that are highly sensitive. A breach (e.g. unauthorized access or leakage) would violate user trust and may violate privacy or financial regulations. Integrity is important for correct analysis and reports, and availability matters for usability, but the primary concern for a financial document platform is keeping that data confidential.

**2. Which threats are most realistic for your system?**  
Most realistic threats: (1) **Credential theft or token theft via XSS** — tokens in localStorage/cookies are a known target. (2) **API abuse and cost/availability impact** — no rate limiting makes chat and upload endpoints attractive for abuse or accidental overload. (3) **Misuse or leakage of API keys** — e.g. from logs or repo exposure. (4) **Dependency or provider outage** (Supabase, Render, OpenAI, Landing.AI) causing unavailability. (5) **Insider or compromised account** — once an account is compromised, RLS limits access to that user’s data only, but that user’s documents are fully exposed.

**3. What security improvements will you implement before FYP-Final?**  
Planned improvements: (1) Implement **API rate limiting** (e.g. per user/IP) on auth, upload, chat, and report endpoints. (2) **Move conversation history to the database** with user/document scoping and optional encryption. (3) **Harden token handling** — consider httpOnly cookies for access token and ensure no tokens in logs. (4) Add **security-focused logging** (auth failures, sensitive document access) and basic monitoring. (5) Define **backup and restore** for Supabase DB and Storage and test restore. (6) **Strict file upload validation** (type, size, and optionally malware scan) and **CSP** (and XSS controls) on the frontend. (7) **Dependency updates and CVE monitoring** (e.g. Dependabot or similar) for backend and frontend.

---

*Document Version: 1.0 — Security Assessment for FYP-2*  
*System: ALPHA LENS — Financial Document Analysis Platform*  
*Aligned with SYSTEM_ARCHITECTURE_REPORT.md*

