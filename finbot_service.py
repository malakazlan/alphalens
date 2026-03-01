"""
FinBot Service — Agentic Financial Assistant
Uses OpenAI function calling to fetch live market data, news, and provide investment analysis.
Completely separate from document chat functionality.
"""

import os
import json
import traceback
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta

try:
    import openai
    from config import settings
except ImportError:
    openai = None
    settings = None

try:
    import yfinance as yf
except ImportError:
    yf = None

try:
    import finnhub
except ImportError:
    finnhub = None


# ──────────────────────────────────────────────
# Tool implementations (called by OpenAI)
# ──────────────────────────────────────────────

def get_stock_quote(symbol: str) -> Dict[str, Any]:
    """Fetch real-time stock/commodity/crypto quote using yfinance."""
    if not yf:
        return {"error": "yfinance not installed"}
    try:
        ticker = yf.Ticker(symbol.upper())
        info = ticker.info
        if not info or info.get("trailingPegRatio") is None and info.get("regularMarketPrice") is None:
            # Try fast_info for basic price data
            fast = ticker.fast_info
            if hasattr(fast, "last_price") and fast.last_price:
                return {
                    "symbol": symbol.upper(),
                    "price": round(fast.last_price, 2),
                    "currency": getattr(fast, "currency", "USD"),
                    "exchange": getattr(fast, "exchange", "N/A"),
                    "note": "Limited data available for this symbol"
                }
            return {"error": f"No data found for symbol '{symbol}'. Check the ticker."}

        price = info.get("regularMarketPrice") or info.get("currentPrice") or info.get("previousClose", 0)
        prev_close = info.get("previousClose") or info.get("regularMarketPreviousClose", price)
        change = round(price - prev_close, 2) if price and prev_close else 0
        change_pct = round((change / prev_close) * 100, 2) if prev_close else 0

        result = {
            "symbol": symbol.upper(),
            "name": info.get("shortName") or info.get("longName", symbol.upper()),
            "price": round(price, 2),
            "change": change,
            "change_percent": change_pct,
            "currency": info.get("currency", "USD"),
            "market_cap": info.get("marketCap"),
            "pe_ratio": info.get("trailingPE"),
            "forward_pe": info.get("forwardPE"),
            "dividend_yield": round(info.get("dividendYield", 0) * 100, 2) if info.get("dividendYield") else None,
            "52_week_high": info.get("fiftyTwoWeekHigh"),
            "52_week_low": info.get("fiftyTwoWeekLow"),
            "volume": info.get("volume"),
            "avg_volume": info.get("averageVolume"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "exchange": info.get("exchange"),
        }
        # Remove None values
        return {k: v for k, v in result.items() if v is not None}
    except Exception as e:
        return {"error": f"Failed to fetch quote for '{symbol}': {str(e)}"}


def get_price_history(symbol: str, period: str = "1y") -> Dict[str, Any]:
    """Fetch price history and calculate returns."""
    if not yf:
        return {"error": "yfinance not installed"}
    try:
        valid_periods = ["1mo", "3mo", "6mo", "1y", "2y", "5y"]
        if period not in valid_periods:
            period = "1y"

        ticker = yf.Ticker(symbol.upper())
        hist = ticker.history(period=period)

        if hist.empty:
            return {"error": f"No historical data for '{symbol}'"}

        closes = hist["Close"].tolist()
        dates = [d.strftime("%Y-%m-%d") for d in hist.index]

        # Calculate returns at various intervals
        returns = {}
        if len(closes) >= 2:
            returns["total"] = round(((closes[-1] - closes[0]) / closes[0]) * 100, 2)
        if len(closes) >= 22:  # ~1 month
            returns["1_month"] = round(((closes[-1] - closes[-22]) / closes[-22]) * 100, 2)
        if len(closes) >= 66:  # ~3 months
            returns["3_month"] = round(((closes[-1] - closes[-66]) / closes[-66]) * 100, 2)
        if len(closes) >= 132:  # ~6 months
            returns["6_month"] = round(((closes[-1] - closes[-132]) / closes[-132]) * 100, 2)
        if len(closes) >= 252:  # ~1 year
            returns["1_year"] = round(((closes[-1] - closes[-252]) / closes[-252]) * 100, 2)

        # Basic statistics
        high = max(closes)
        low = min(closes)
        avg = sum(closes) / len(closes)
        volatility = (sum((c - avg) ** 2 for c in closes) / len(closes)) ** 0.5

        return {
            "symbol": symbol.upper(),
            "period": period,
            "data_points": len(closes),
            "current_price": round(closes[-1], 2),
            "period_start_price": round(closes[0], 2),
            "period_high": round(high, 2),
            "period_low": round(low, 2),
            "average_price": round(avg, 2),
            "volatility": round(volatility, 2),
            "returns": returns,
        }
    except Exception as e:
        return {"error": f"Failed to fetch history for '{symbol}': {str(e)}"}


def get_financial_news(query: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Fetch financial news from Finnhub."""
    api_key = settings.FINNHUB_API_KEY if settings else os.getenv("FINNHUB_API_KEY")
    if not api_key:
        return [{"error": "Finnhub API key not configured"}]
    if not finnhub:
        return [{"error": "finnhub-python not installed"}]
    try:
        client = finnhub.Client(api_key=api_key)

        # Determine if query looks like a ticker
        q = query.strip().upper()
        # Try market news first if it's a general topic
        if len(q) <= 5 and q.isalpha():
            # Treat as ticker — get company news
            today = datetime.now().strftime("%Y-%m-%d")
            month_ago = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
            news = client.company_news(q, _from=month_ago, to=today)
        else:
            # General market news
            news = client.general_news("general", min_id=0)

        results = []
        for item in news[:limit]:
            results.append({
                "title": item.get("headline", ""),
                "summary": item.get("summary", "")[:200],
                "source": item.get("source", ""),
                "url": item.get("url", ""),
                "date": datetime.fromtimestamp(item.get("datetime", 0)).strftime("%Y-%m-%d %H:%M") if item.get("datetime") else "",
                "category": item.get("category", ""),
            })
        if not results:
            return [{"info": f"No recent news found for '{query}'"}]
        return results
    except Exception as e:
        return [{"error": f"Failed to fetch news: {str(e)}"}]


def get_news_feed(category: str = "general", limit: int = 10) -> List[Dict[str, Any]]:
    """Fetch news feed for the sidebar. Returns list of {title, source, url, date, summary?, image?}."""
    api_key = settings.FINNHUB_API_KEY if settings else os.getenv("FINNHUB_API_KEY")
    if not api_key:
        return []
    if not finnhub:
        return []
    try:
        client = finnhub.Client(api_key=api_key)
        if category and category.strip().upper() not in ("GENERAL", "CRYPTO", "FOREX", "MERGER", ""):
            news = client.general_news("general", min_id=0)
        else:
            news = client.general_news(category.strip().lower() or "general", min_id=0)
        results: List[Dict[str, Any]] = []
        for item in news[:limit]:
            entry = {
                "title": item.get("headline", ""),
                "source": item.get("source", ""),
                "url": item.get("url", ""),
                "date": datetime.fromtimestamp(item.get("datetime", 0)).strftime("%Y-%m-%d %H:%M") if item.get("datetime") else "",
                "summary": (item.get("summary") or "")[:200],
                "category": item.get("category", ""),
            }
            if item.get("image"):
                entry["image"] = item.get("image")
            results.append(entry)
        return results
    except Exception:
        return []


def calculate_investment_return(amount: float, symbol: str, years: int = 3) -> Dict[str, Any]:
    """Calculate projected investment returns based on historical performance."""
    if not yf:
        return {"error": "yfinance not installed"}
    try:
        ticker = yf.Ticker(symbol.upper())
        # Fetch max available history for better projections
        hist = ticker.history(period="5y")
        if hist.empty:
            return {"error": f"No historical data for '{symbol}'"}

        closes = hist["Close"].tolist()
        if len(closes) < 50:
            return {"error": f"Insufficient data for '{symbol}' to project returns"}

        # Calculate annualized return from available data
        total_days = len(closes)
        total_years = total_days / 252  # Trading days per year
        total_return = closes[-1] / closes[0]
        annual_return = (total_return ** (1 / total_years)) - 1

        # Calculate annualized volatility
        daily_returns = [(closes[i] - closes[i-1]) / closes[i-1] for i in range(1, len(closes))]
        avg_daily = sum(daily_returns) / len(daily_returns)
        variance = sum((r - avg_daily) ** 2 for r in daily_returns) / len(daily_returns)
        daily_vol = variance ** 0.5
        annual_vol = daily_vol * (252 ** 0.5)

        # Project returns (conservative, expected, optimistic)
        projected_expected = amount * ((1 + annual_return) ** years)
        projected_optimistic = amount * ((1 + annual_return + annual_vol * 0.5) ** years)
        projected_conservative = amount * ((1 + max(annual_return - annual_vol * 0.5, -0.5)) ** years)

        # Risk assessment
        if annual_vol < 0.15:
            risk = "Low"
        elif annual_vol < 0.25:
            risk = "Medium"
        elif annual_vol < 0.40:
            risk = "High"
        else:
            risk = "Very High"

        return {
            "symbol": symbol.upper(),
            "investment_amount": amount,
            "investment_period_years": years,
            "historical_annual_return": round(annual_return * 100, 2),
            "annual_volatility": round(annual_vol * 100, 2),
            "risk_level": risk,
            "projections": {
                "conservative": round(projected_conservative, 2),
                "expected": round(projected_expected, 2),
                "optimistic": round(projected_optimistic, 2),
            },
            "expected_profit": round(projected_expected - amount, 2),
            "expected_return_percent": round(((projected_expected / amount) - 1) * 100, 2),
            "based_on": f"{round(total_years, 1)} years of historical data",
            "current_price": round(closes[-1], 2),
            "shares_you_could_buy": round(amount / closes[-1], 4),
        }
    except Exception as e:
        return {"error": f"Failed to calculate returns: {str(e)}"}


def compare_stocks(symbols: List[str]) -> Dict[str, Any]:
    """Compare multiple stocks side by side."""
    if not yf:
        return {"error": "yfinance not installed"}
    try:
        comparisons = []
        for sym in symbols[:6]:  # Max 6 stocks
            quote = get_stock_quote(sym)
            if "error" not in quote:
                # Also get 1-year return
                hist = get_price_history(sym, "1y")
                yr_return = hist.get("returns", {}).get("total") if "error" not in hist else None
                quote["1_year_return"] = yr_return
                comparisons.append(quote)
            else:
                comparisons.append({"symbol": sym.upper(), "error": quote["error"]})

        return {
            "stocks_compared": len(comparisons),
            "comparison": comparisons
        }
    except Exception as e:
        return {"error": f"Failed to compare stocks: {str(e)}"}


# ──────────────────────────────────────────────
# OpenAI tool definitions
# ──────────────────────────────────────────────

FINBOT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_stock_quote",
            "description": "Get real-time price, market cap, P/E ratio, and other data for a stock, ETF, commodity, or crypto. Use standard tickers (e.g., AAPL, MSFT, GC=F for gold, BTC-USD for bitcoin, EURUSD=X for forex).",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {
                        "type": "string",
                        "description": "Stock/asset ticker symbol. Examples: AAPL, MSFT, TSLA, GC=F (gold), SI=F (silver), BTC-USD (bitcoin), ETH-USD (ethereum), EURUSD=X (EUR/USD forex)"
                    }
                },
                "required": ["symbol"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_price_history",
            "description": "Get historical price data and calculate returns over a period. Use this to analyze trends and performance.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Ticker symbol"},
                    "period": {
                        "type": "string",
                        "enum": ["1mo", "3mo", "6mo", "1y", "2y", "5y"],
                        "description": "Time period for history. Default: 1y"
                    }
                },
                "required": ["symbol"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_financial_news",
            "description": "Get latest financial news for a specific stock ticker or general market topic.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Stock ticker (e.g., AAPL) or topic (e.g., 'market crash', 'interest rates')"},
                    "limit": {"type": "integer", "description": "Number of articles (max 10, default 5)"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_investment_return",
            "description": "Calculate projected investment returns for a given amount and time period based on historical performance.",
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {"type": "number", "description": "Investment amount in USD"},
                    "symbol": {"type": "string", "description": "Ticker symbol to invest in"},
                    "years": {"type": "integer", "description": "Investment period in years (1-10)"}
                },
                "required": ["amount", "symbol"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "compare_stocks",
            "description": "Compare multiple stocks/assets side by side with prices, returns, and metrics.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbols": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of ticker symbols to compare (max 6)"
                    }
                },
                "required": ["symbols"]
            }
        }
    }
]

# Map tool names to functions
TOOL_FUNCTIONS = {
    "get_stock_quote": get_stock_quote,
    "get_price_history": get_price_history,
    "get_financial_news": get_financial_news,
    "calculate_investment_return": calculate_investment_return,
    "compare_stocks": compare_stocks,
}


# ──────────────────────────────────────────────
# System prompt
# ──────────────────────────────────────────────

FINBOT_SYSTEM_PROMPT = """You are FinBot, an AI-powered financial assistant built into Alpha Lens. You help users with:

1. **Live market data**: Stock prices, commodity prices (gold, silver), crypto prices, forex rates
2. **Investment analysis**: Historical performance, return projections, risk assessment
3. **Financial news**: Latest news about stocks, markets, and economic events
4. **Stock comparisons**: Side-by-side analysis of multiple investments
5. **General finance knowledge**: Explain financial concepts (P/E ratio, market cap, dividends, etc.)
6. **Investment guidance**: Portfolio suggestions, diversification advice, risk management

IMPORTANT RULES:
- You ONLY discuss finance, investing, economics, and markets. If a user asks about anything unrelated to finance (cooking, sports, coding, etc.), politely decline and redirect to finance topics.
- Always use your tools to fetch LIVE data when users ask about prices, returns, or news. Never make up prices or data.
- When recommending investments, ALWAYS include a disclaimer that this is for educational purposes and not professional financial advice.
- Present data clearly with key numbers highlighted.
- When comparing investments, use tables when you have data from compare_stocks.
- For investment projections, always mention that past performance doesn't guarantee future results.
- Be conversational but professional. Use emojis sparingly for visual clarity (📈📉💰📊).
- If the user mentions a stock by name but not ticker, infer the ticker (e.g., "Apple" → AAPL, "Tesla" → TSLA).
- For gold use GC=F, silver SI=F, bitcoin BTC-USD, ethereum ETH-USD.
- Keep responses concise but informative. Use markdown formatting for readability.

DISCLAIMER (include when giving investment advice):
> ⚠️ *This is for educational and informational purposes only, not professional financial advice. Always consult a licensed financial advisor before making investment decisions.*"""


# ──────────────────────────────────────────────
# FinBot Service — Agentic Chat Loop
# ──────────────────────────────────────────────

class FinBotService:
    """Main service for the agentic FinBot chatbot."""

    def __init__(self):
        raw = settings.OPENAI_API_KEY if settings else os.getenv("OPENAI_API_KEY")
        self.api_key = (raw or "").strip() or None  # no newline/space in header
        self.client = None
        if self.api_key and openai:
            self.client = openai.OpenAI(api_key=self.api_key, timeout=90.0)
        # In-memory conversation history per session
        self.conversations: Dict[str, List[Dict[str, str]]] = {}

    def _get_or_create_session(self, session_id: str) -> List[Dict[str, str]]:
        """Get existing conversation or create new one with system prompt."""
        if session_id not in self.conversations:
            self.conversations[session_id] = [
                {"role": "system", "content": FINBOT_SYSTEM_PROMPT}
            ]
        return self.conversations[session_id]

    def _execute_tool(self, tool_name: str, arguments: Dict[str, Any]) -> str:
        """Execute a tool function and return the result as JSON string."""
        func = TOOL_FUNCTIONS.get(tool_name)
        if not func:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})
        try:
            result = func(**arguments)
            return json.dumps(result, default=str)
        except Exception as e:
            return json.dumps({"error": f"Tool '{tool_name}' failed: {str(e)}"})

    async def chat(self, session_id: str, user_message: str) -> Dict[str, Any]:
        """
        Process a user message through the agentic loop.
        The LLM may call tools multiple times before producing a final answer.
        """
        if not self.client:
            return {
                "response": "⚠️ FinBot requires an OpenAI API key. Please configure OPENAI_API_KEY in your environment.",
                "tools_used": []
            }

        messages = self._get_or_create_session(session_id)
        messages.append({"role": "user", "content": user_message})

        tools_used = []
        max_iterations = 5  # Prevent infinite tool-calling loops

        try:
            for iteration in range(max_iterations):
                # Call OpenAI with function calling
                response = self.client.chat.completions.create(
                    model="gpt-4o-mini",  # Fast + cheap, great for function calling
                    messages=messages,
                    tools=FINBOT_TOOLS,
                    tool_choice="auto",
                    temperature=0.7,
                    max_tokens=1500,
                )

                choice = response.choices[0]

                # If the model wants to call tools
                if choice.finish_reason == "tool_calls" and choice.message.tool_calls:
                    # Add the assistant message with tool calls
                    messages.append(choice.message.model_dump())

                    # Execute each tool call
                    for tool_call in choice.message.tool_calls:
                        fn_name = tool_call.function.name
                        fn_args = json.loads(tool_call.function.arguments)

                        print(f"   🔧 FinBot calling tool: {fn_name}({fn_args})")
                        tool_result = self._execute_tool(fn_name, fn_args)
                        tools_used.append({"tool": fn_name, "args": fn_args})

                        # Add tool result to messages
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": tool_result
                        })
                else:
                    # Model produced a final text response
                    assistant_message = choice.message.content or ""
                    messages.append({"role": "assistant", "content": assistant_message})

                    # Trim conversation to prevent token explosion (keep last 20 turns)
                    if len(messages) > 42:  # system + 20 turns (user+assistant)
                        messages[:] = [messages[0]] + messages[-40:]

                    return {
                        "response": assistant_message,
                        "tools_used": tools_used
                    }

            # If we exhausted iterations, return what we have
            return {
                "response": "I gathered the data but ran into complexity. Let me try answering with what I have. Could you rephrase your question?",
                "tools_used": tools_used
            }

        except openai.RateLimitError:
            return {
                "response": "⚠️ Rate limit reached. Please wait a moment and try again.",
                "tools_used": tools_used
            }
        except Exception as e:
            err_msg = str(e).strip()
            print(f"❌ FinBot error: {e}")
            traceback.print_exc()
            # Friendly message for connection/timeout (common on Render cold start)
            if not err_msg:
                err_msg = "Unknown error"
            if "connection" in err_msg.lower() or "timeout" in err_msg.lower() or "connect" in err_msg.lower():
                return {
                    "response": "⚠️ Could not reach the AI service (connection or timeout). This can happen on first use after idle. Please try again in a few seconds.",
                    "tools_used": tools_used
                }
            return {
                "response": f"Something went wrong: {err_msg}. Please try again.",
                "tools_used": tools_used
            }

    def clear_session(self, session_id: str):
        """Clear conversation history for a session."""
        if session_id in self.conversations:
            del self.conversations[session_id]


# Create singleton instance
finbot_service = FinBotService()
