"""FinBot — live market data helpers using yfinance."""
import json
from datetime import datetime, timedelta
import yfinance as yf


def _safe(val):
    """Return val or None — avoids NaN/Inf in JSON."""
    try:
        if val is None:
            return None
        f = float(val)
        import math
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return val if val else None


def get_quote(ticker: str) -> dict:
    """Current price, change, volume, market cap."""
    try:
        t = yf.Ticker(ticker.upper())
        info = t.info
        price = _safe(info.get("currentPrice") or info.get("regularMarketPrice"))
        prev = _safe(info.get("previousClose") or info.get("regularMarketPreviousClose"))
        change = round(price - prev, 4) if price and prev else None
        change_pct = round((change / prev) * 100, 2) if change and prev else None
        return {
            "ticker": ticker.upper(),
            "name": info.get("shortName") or info.get("longName"),
            "price": price,
            "prev_close": prev,
            "change": change,
            "change_pct": change_pct,
            "currency": info.get("currency", "USD"),
            "exchange": info.get("exchange"),
            "market_cap": _safe(info.get("marketCap")),
            "volume": _safe(info.get("volume") or info.get("regularMarketVolume")),
            "day_high": _safe(info.get("dayHigh") or info.get("regularMarketDayHigh")),
            "day_low": _safe(info.get("dayLow") or info.get("regularMarketDayLow")),
            "52w_high": _safe(info.get("fiftyTwoWeekHigh")),
            "52w_low": _safe(info.get("fiftyTwoWeekLow")),
        }
    except Exception as e:
        return {"error": str(e), "ticker": ticker.upper()}


def get_fundamentals(ticker: str) -> dict:
    """Key financial ratios and fundamentals."""
    try:
        t = yf.Ticker(ticker.upper())
        info = t.info
        return {
            "ticker": ticker.upper(),
            "name": info.get("shortName"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "pe_ratio": _safe(info.get("trailingPE")),
            "forward_pe": _safe(info.get("forwardPE")),
            "peg_ratio": _safe(info.get("pegRatio")),
            "price_to_book": _safe(info.get("priceToBook")),
            "ev_to_ebitda": _safe(info.get("enterpriseToEbitda")),
            "revenue": _safe(info.get("totalRevenue")),
            "gross_margin": _safe(info.get("grossMargins")),
            "net_margin": _safe(info.get("netMargins")),
            "roe": _safe(info.get("returnOnEquity")),
            "roa": _safe(info.get("returnOnAssets")),
            "eps": _safe(info.get("trailingEps")),
            "forward_eps": _safe(info.get("forwardEps")),
            "dividend_yield": _safe(info.get("dividendYield")),
            "beta": _safe(info.get("beta")),
            "free_cash_flow": _safe(info.get("freeCashflow")),
            "debt_to_equity": _safe(info.get("debtToEquity")),
        }
    except Exception as e:
        return {"error": str(e), "ticker": ticker.upper()}


def get_price_history(ticker: str, period: str = "1mo") -> dict:
    """OHLCV history. period: 1d,5d,1mo,3mo,6mo,1y,2y,5y."""
    try:
        t = yf.Ticker(ticker.upper())
        hist = t.history(period=period)
        if hist.empty:
            return {"error": "No data", "ticker": ticker.upper()}
        rows = []
        for dt, row in hist.iterrows():
            rows.append({
                "date": dt.strftime("%Y-%m-%d"),
                "open": round(float(row["Open"]), 4),
                "high": round(float(row["High"]), 4),
                "low": round(float(row["Low"]), 4),
                "close": round(float(row["Close"]), 4),
                "volume": int(row["Volume"]),
            })
        first = rows[0]["close"] if rows else None
        last = rows[-1]["close"] if rows else None
        perf = round(((last - first) / first) * 100, 2) if first and last else None
        return {
            "ticker": ticker.upper(),
            "period": period,
            "performance_pct": perf,
            "data_points": len(rows),
            "history": rows[-10:],  # last 10 entries to keep context manageable
        }
    except Exception as e:
        return {"error": str(e), "ticker": ticker.upper()}


def get_news(ticker: str) -> dict:
    """Recent news headlines for a ticker. Supports both old and new yfinance API."""
    try:
        t = yf.Ticker(ticker.upper())
        raw_news = t.news or []
        items = []
        for n in raw_news[:6]:
            # New yfinance API: news items are nested under 'content'
            if "content" in n and isinstance(n["content"], dict):
                c = n["content"]
                title     = c.get("title") or ""
                publisher = (c.get("provider") or {}).get("displayName") or ""
                link      = ((c.get("clickThroughUrl") or c.get("canonicalUrl")) or {}).get("url") or ""
                pub_date  = c.get("pubDate") or c.get("displayTime") or ""
                # Thumbnail: pick smallest resolution for sidebar, largest for carousel
                resolutions = (c.get("thumbnail") or {}).get("resolutions") or []
                image = resolutions[0]["url"] if resolutions else None
            else:
                # Legacy yfinance API
                title     = n.get("title") or ""
                publisher = n.get("publisher") or ""
                link      = n.get("link") or ""
                ts        = n.get("providerPublishTime")
                pub_date  = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M") if ts else ""
                image     = None

            if not title:
                continue
            items.append({
                "title":     title,
                "publisher": publisher,
                "link":      link,
                "published": pub_date[:10] if pub_date else "",
                "image":     image,
            })
        return {"ticker": ticker.upper(), "count": len(items), "news": items}
    except Exception as e:
        return {"error": str(e), "ticker": ticker.upper()}


def compare_stocks(tickers: list[str]) -> dict:
    """Side-by-side comparison of key metrics for multiple tickers."""
    results = []
    for ticker in tickers[:5]:
        try:
            t = yf.Ticker(ticker.upper())
            info = t.info
            price = _safe(info.get("currentPrice") or info.get("regularMarketPrice"))
            prev = _safe(info.get("previousClose"))
            change_pct = round(((price - prev) / prev) * 100, 2) if price and prev else None
            results.append({
                "ticker": ticker.upper(),
                "name": info.get("shortName"),
                "price": price,
                "change_pct": change_pct,
                "market_cap": _safe(info.get("marketCap")),
                "pe_ratio": _safe(info.get("trailingPE")),
                "eps": _safe(info.get("trailingEps")),
                "dividend_yield": _safe(info.get("dividendYield")),
                "beta": _safe(info.get("beta")),
                "52w_high": _safe(info.get("fiftyTwoWeekHigh")),
                "52w_low": _safe(info.get("fiftyTwoWeekLow")),
            })
        except Exception as e:
            results.append({"ticker": ticker.upper(), "error": str(e)})
    return {"comparison": results}


# ── Tool definitions for GPT function calling ─────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_quote",
            "description": "Get current stock price, change, volume, market cap and day range for a ticker symbol.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ticker": {"type": "string", "description": "Stock ticker symbol, e.g. AAPL, TSLA, MSFT"}
                },
                "required": ["ticker"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_fundamentals",
            "description": "Get key financial ratios and fundamentals: P/E, EPS, margins, ROE, beta, dividend yield, etc.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ticker": {"type": "string", "description": "Stock ticker symbol"}
                },
                "required": ["ticker"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_price_history",
            "description": "Get historical price data and performance for a ticker over a given period.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ticker": {"type": "string"},
                    "period": {
                        "type": "string",
                        "enum": ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"],
                        "description": "Time period for history",
                    },
                },
                "required": ["ticker"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_news",
            "description": "Get recent news headlines and articles for a stock ticker.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ticker": {"type": "string"}
                },
                "required": ["ticker"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_stocks",
            "description": "Compare key metrics side-by-side for multiple stocks.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tickers": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of 2-5 ticker symbols to compare",
                    }
                },
                "required": ["tickers"],
            },
        },
    },
]

TOOL_MAP = {
    "get_quote": get_quote,
    "get_fundamentals": get_fundamentals,
    "get_price_history": get_price_history,
    "get_news": get_news,
    "compare_stocks": compare_stocks,
}
