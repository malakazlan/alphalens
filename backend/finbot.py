"""FinBot — live market data helpers using yfinance + per-user portfolio."""
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Any

import requests
import yfinance as yf

import finbot_repo
from config import settings

logger = logging.getLogger(__name__)


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


# ── Portfolio P&L (user-context tool, dispatched with user_id) ────────────────
def get_portfolio_pnl(user_id: str) -> dict:
    """Compute live P&L across the user's open holdings.

    Pulls each unique ticker's current price once from yfinance, then folds
    holdings into a per-position summary plus an overall total.
    """
    try:
        holdings = finbot_repo.list_holdings(user_id)
    except Exception as e:
        return {"error": f"Could not load holdings: {e}"}

    if not holdings:
        return {"holdings": [], "summary": {"total_value": 0.0, "total_cost": 0.0,
                                            "total_pnl": 0.0, "total_pnl_pct": 0.0,
                                            "position_count": 0}}

    # Fetch each ticker's current price once.
    tickers = sorted({h["ticker"] for h in holdings})
    prices: dict[str, float | None] = {}
    for tk in tickers:
        try:
            info = yf.Ticker(tk).info
            prices[tk] = _safe(
                info.get("currentPrice") or info.get("regularMarketPrice")
            )
        except Exception:
            prices[tk] = None

    rows = []
    total_value = 0.0
    total_cost = 0.0
    for h in holdings:
        qty = float(h["quantity"])
        cost = float(h["cost_basis"])
        price = prices.get(h["ticker"])
        value = round(price * qty, 2) if price is not None else None
        pnl = round(value - cost, 2) if value is not None else None
        pnl_pct = round((pnl / cost) * 100, 2) if pnl is not None and cost > 0 else None
        rows.append({
            "id":            h["id"],
            "ticker":        h["ticker"],
            "quantity":      qty,
            "cost_basis":    cost,
            "current_price": price,
            "current_value": value,
            "pnl_dollars":   pnl,
            "pnl_pct":       pnl_pct,
            "currency":      h.get("currency", "USD"),
            "account_type":  h.get("account_type"),
            "opened_at":     h.get("opened_at"),
            "note":          h.get("note"),
        })
        if value is not None:
            total_value += value
        total_cost += cost

    total_pnl = round(total_value - total_cost, 2) if total_value else None
    total_pnl_pct = (
        round((total_pnl / total_cost) * 100, 2)
        if total_pnl is not None and total_cost > 0
        else None
    )

    return {
        "holdings": rows,
        "summary": {
            "total_value":   round(total_value, 2),
            "total_cost":    round(total_cost, 2),
            "total_pnl":     total_pnl,
            "total_pnl_pct": total_pnl_pct,
            "position_count": len(rows),
        },
    }


# ── Earnings calendar ────────────────────────────────────────────────────────
def get_earnings_calendar(ticker: str) -> dict:
    """Next earnings date + EPS / revenue estimates if yfinance has them."""
    try:
        t = yf.Ticker(ticker.upper())
        cal = t.calendar or {}
        # yfinance returns a dict on most builds; older returned a DataFrame.
        if hasattr(cal, "to_dict"):
            cal = cal.to_dict()
        out: dict[str, Any] = {"ticker": ticker.upper()}
        # Common keys: "Earnings Date", "EPS Estimate", "Revenue Estimate"
        ed = cal.get("Earnings Date") or cal.get("earningsDate")
        if isinstance(ed, list) and ed:
            out["next_earnings_date"] = str(ed[0])
        elif ed:
            out["next_earnings_date"] = str(ed)
        if (eps_est := cal.get("EPS Estimate") or cal.get("epsEstimate")) is not None:
            out["eps_estimate"] = _safe(eps_est if not isinstance(eps_est, list) else (eps_est[0] if eps_est else None))
        if (rev_est := cal.get("Revenue Estimate") or cal.get("revenueEstimate")) is not None:
            out["revenue_estimate"] = _safe(rev_est if not isinstance(rev_est, list) else (rev_est[0] if rev_est else None))
        if (rev_low := cal.get("Revenue Low")) is not None:
            out["revenue_low"] = _safe(rev_low)
        if (rev_high := cal.get("Revenue High")) is not None:
            out["revenue_high"] = _safe(rev_high)

        # Last reported earnings (recent history)
        try:
            edates = t.earnings_dates  # may not exist on all yfinance versions
            if edates is not None and not edates.empty:
                # Filter past earnings only
                past = edates.dropna(subset=["Reported EPS"]) if "Reported EPS" in edates.columns else edates
                if not past.empty:
                    last = past.iloc[0]
                    out["last_reported"] = {
                        "date": str(last.name.date()) if hasattr(last.name, "date") else str(last.name),
                        "eps_actual":   _safe(last.get("Reported EPS")),
                        "eps_estimate": _safe(last.get("EPS Estimate")),
                        "surprise_pct": _safe(last.get("Surprise(%)")),
                    }
        except Exception:
            pass

        return out
    except Exception as e:
        return {"error": str(e), "ticker": ticker.upper()}


# ── Dividends ────────────────────────────────────────────────────────────────
def get_dividends(ticker: str) -> dict:
    """Dividend yield, last 5 payments, last-12-months total."""
    try:
        t = yf.Ticker(ticker.upper())
        info = t.info
        divs = t.dividends  # pandas Series indexed by date
        recent = []
        ttm_total = 0.0
        if divs is not None and not divs.empty:
            cutoff = datetime.utcnow() - timedelta(days=365)
            for dt, amt in divs.tail(20).items():
                amt_f = float(amt)
                date_str = dt.strftime("%Y-%m-%d") if hasattr(dt, "strftime") else str(dt)
                recent.append({"date": date_str, "amount": round(amt_f, 6)})
                # Sum payments in the last 12 months for trailing-12-month total
                d_naive = dt.tz_localize(None) if hasattr(dt, "tz") and dt.tz is not None else dt
                if hasattr(d_naive, "to_pydatetime"):
                    d_naive = d_naive.to_pydatetime()
                if isinstance(d_naive, datetime) and d_naive >= cutoff:
                    ttm_total += amt_f

        return {
            "ticker":          ticker.upper(),
            "dividend_yield":  _safe(info.get("dividendYield")),
            "payout_ratio":    _safe(info.get("payoutRatio")),
            "last_dividend":   _safe(info.get("lastDividendValue")),
            "ex_dividend_date": str(info.get("exDividendDate") or "") or None,
            "ttm_total":       round(ttm_total, 6) if ttm_total else None,
            "recent":          recent[-5:],  # last 5 payments
        }
    except Exception as e:
        return {"error": str(e), "ticker": ticker.upper()}


# ── Insider trades (Finnhub) ─────────────────────────────────────────────────
def get_insider_trades(ticker: str) -> dict:
    """Recent insider transactions via Finnhub. Returns last 90 days."""
    api_key = settings.FINNHUB_API_KEY
    if not api_key:
        return {"error": "Finnhub API key not configured", "ticker": ticker.upper()}
    try:
        to_date = datetime.utcnow().date()
        from_date = to_date - timedelta(days=90)
        url = "https://finnhub.io/api/v1/stock/insider-transactions"
        r = requests.get(url, params={
            "symbol": ticker.upper(),
            "from":   from_date.isoformat(),
            "to":     to_date.isoformat(),
            "token":  api_key,
        }, timeout=10)
        r.raise_for_status()
        data = r.json()
        rows = data.get("data") or []

        summary = {"buy_count": 0, "sell_count": 0, "buy_shares": 0, "sell_shares": 0}
        compact = []
        for row in rows[:30]:  # cap context size
            shares = int(row.get("share") or 0)
            change = int(row.get("change") or 0)
            tx_code = (row.get("transactionCode") or "").upper()
            is_buy = change > 0
            is_sell = change < 0
            if is_buy:
                summary["buy_count"] += 1
                summary["buy_shares"] += abs(change)
            elif is_sell:
                summary["sell_count"] += 1
                summary["sell_shares"] += abs(change)
            compact.append({
                "name":               row.get("name"),
                "transaction_date":   row.get("transactionDate"),
                "transaction_code":   tx_code,
                "shares_traded":      change,
                "shares_after":       shares,
                "transaction_price":  _safe(row.get("transactionPrice")),
            })
        return {
            "ticker":  ticker.upper(),
            "from":    from_date.isoformat(),
            "to":      to_date.isoformat(),
            "summary": summary,
            "trades":  compact,
        }
    except requests.RequestException as e:
        return {"error": f"Finnhub request failed: {e}", "ticker": ticker.upper()}
    except Exception as e:
        return {"error": str(e), "ticker": ticker.upper()}


# ── Macro indicators (FRED) ──────────────────────────────────────────────────
_FRED_SERIES: dict[str, dict[str, str]] = {
    "fed_funds_rate":  {"id": "FEDFUNDS",  "label": "Federal Funds Rate (%)",        "units": "%"},
    "cpi":             {"id": "CPIAUCSL",  "label": "Consumer Price Index (1982-84=100)", "units": "index"},
    "unemployment":    {"id": "UNRATE",    "label": "Unemployment Rate (%)",         "units": "%"},
    "ten_year_yield":  {"id": "DGS10",     "label": "10-Year Treasury Yield (%)",    "units": "%"},
    "ten_two_spread":  {"id": "T10Y2Y",    "label": "10Y - 2Y Treasury Spread (%)",  "units": "%"},
}


def get_macro_indicators() -> dict:
    """Latest readings + prior reading for key US macro indicators (FRED)."""
    api_key = settings.FRED_API_KEY
    if not api_key:
        return {"error": "FRED_API_KEY not configured."}
    out: dict[str, Any] = {"as_of": datetime.utcnow().date().isoformat(), "indicators": {}}
    for label, meta in _FRED_SERIES.items():
        try:
            r = requests.get(
                "https://api.stlouisfed.org/fred/series/observations",
                params={
                    "series_id":  meta["id"],
                    "api_key":    api_key,
                    "file_type":  "json",
                    "sort_order": "desc",
                    "limit":      4,  # latest + a couple of prior for trend
                },
                timeout=8,
            )
            r.raise_for_status()
            obs = r.json().get("observations", [])
            obs = [o for o in obs if o.get("value") not in (None, ".", "")]
            if not obs:
                out["indicators"][label] = {"error": "no data"}
                continue
            latest = obs[0]
            prior  = obs[1] if len(obs) > 1 else None
            entry: dict[str, Any] = {
                "label":  meta["label"],
                "units":  meta["units"],
                "latest": {"date": latest["date"], "value": float(latest["value"])},
            }
            if prior:
                lat = float(latest["value"])
                pri = float(prior["value"])
                entry["prior"]  = {"date": prior["date"], "value": pri}
                entry["change"] = round(lat - pri, 4)
            out["indicators"][label] = entry
        except Exception as e:
            out["indicators"][label] = {"error": str(e)}
    return out


# ── Technical indicators ─────────────────────────────────────────────────────
def get_technical_indicators(ticker: str, indicators: list[str] | None = None) -> dict:
    """Compute basic technical indicators from yfinance daily history.

    Supported: rsi (14), macd (12/26/9), sma50, sma200, ema20.
    No external math deps — pure pandas (already a yfinance transitive)."""
    indicators = [i.lower() for i in (indicators or ["rsi", "macd", "sma50", "sma200"])]
    try:
        t = yf.Ticker(ticker.upper())
        hist = t.history(period="1y")
        if hist.empty:
            return {"error": "No price data", "ticker": ticker.upper()}
        closes = hist["Close"]
        last_close = float(closes.iloc[-1])
        out: dict[str, Any] = {
            "ticker":     ticker.upper(),
            "last_close": round(last_close, 4),
            "indicators": {},
        }

        if "rsi" in indicators:
            delta = closes.diff()
            gain = delta.clip(lower=0).rolling(14).mean()
            loss = (-delta.clip(upper=0)).rolling(14).mean()
            rs = gain / loss.replace(0, float("nan"))
            rsi = 100 - (100 / (1 + rs))
            r = float(rsi.iloc[-1])
            out["indicators"]["rsi"] = {
                "value": round(r, 2),
                "signal": "overbought" if r > 70 else "oversold" if r < 30 else "neutral",
            }

        if "macd" in indicators:
            ema12 = closes.ewm(span=12, adjust=False).mean()
            ema26 = closes.ewm(span=26, adjust=False).mean()
            macd_line = ema12 - ema26
            signal_line = macd_line.ewm(span=9, adjust=False).mean()
            histogram = macd_line - signal_line
            out["indicators"]["macd"] = {
                "macd":      round(float(macd_line.iloc[-1]), 4),
                "signal":    round(float(signal_line.iloc[-1]), 4),
                "histogram": round(float(histogram.iloc[-1]), 4),
                "cross":
                    "bullish" if histogram.iloc[-1] > 0 and histogram.iloc[-2] <= 0 else
                    "bearish" if histogram.iloc[-1] < 0 and histogram.iloc[-2] >= 0 else
                    "none",
            }

        if "sma50" in indicators and len(closes) >= 50:
            sma50 = float(closes.rolling(50).mean().iloc[-1])
            out["indicators"]["sma50"] = {
                "value":   round(sma50, 4),
                "vs_price": "above" if last_close > sma50 else "below",
            }

        if "sma200" in indicators and len(closes) >= 200:
            sma200 = float(closes.rolling(200).mean().iloc[-1])
            out["indicators"]["sma200"] = {
                "value":   round(sma200, 4),
                "vs_price": "above" if last_close > sma200 else "below",
            }

        if "ema20" in indicators:
            ema20 = float(closes.ewm(span=20, adjust=False).mean().iloc[-1])
            out["indicators"]["ema20"] = {
                "value":   round(ema20, 4),
                "vs_price": "above" if last_close > ema20 else "below",
            }

        return out
    except Exception as e:
        return {"error": str(e), "ticker": ticker.upper()}


# ── Options chain ────────────────────────────────────────────────────────────
def get_options_chain(ticker: str, expiry: str | None = None) -> dict:
    """Calls + puts near-the-money for one expiry. Defaults to nearest expiry.

    Returns at most 7 strikes either side of the current price to keep
    LLM context manageable."""
    try:
        t = yf.Ticker(ticker.upper())
        expiries = list(t.options or [])
        if not expiries:
            return {"ticker": ticker.upper(), "error": "No listed options."}

        chosen = expiry if expiry in expiries else expiries[0]
        chain = t.option_chain(chosen)

        # Spot price for ATM filtering
        info = t.info
        spot = _safe(info.get("currentPrice") or info.get("regularMarketPrice"))

        def trim(df, n_above=7, n_below=7) -> list[dict]:
            if df is None or df.empty:
                return []
            sub = df.copy()
            if spot is not None:
                sub["__abs"] = (sub["strike"] - spot).abs()
                sub = sub.sort_values("__abs").head(n_above + n_below)
                sub = sub.sort_values("strike")
                sub = sub.drop(columns="__abs")
            rows = []
            for _, row in sub.iterrows():
                rows.append({
                    "strike":           _safe(row.get("strike")),
                    "last_price":       _safe(row.get("lastPrice")),
                    "bid":              _safe(row.get("bid")),
                    "ask":              _safe(row.get("ask")),
                    "implied_volatility": _safe(row.get("impliedVolatility")),
                    "volume":           int(row.get("volume") or 0),
                    "open_interest":    int(row.get("openInterest") or 0),
                })
            return rows

        return {
            "ticker":   ticker.upper(),
            "expiry":   chosen,
            "spot":     spot,
            "expiries": expiries[:8],
            "calls":    trim(chain.calls),
            "puts":     trim(chain.puts),
        }
    except Exception as e:
        return {"error": str(e), "ticker": ticker.upper()}


# ── Document linkage (user-context tool, RAG into AlphaLens documents) ──────
def query_user_document(user_id: str, doc_id: str, query: str) -> dict:
    """RAG into a document the user has parsed in AlphaLens Analyzer.

    Verifies ownership, embeds the query, and returns the top chunks from
    Qdrant filtered by both user_id and doc_id. Each chunk includes a
    truncated text snippet, page number, section header, and chunk_id so
    FinBot's reply can cite [chunk_id] references that the frontend can
    navigate back to."""
    # Local imports to avoid circulars at module load.
    import db
    import embeddings
    import qdrant_store

    # 1. Ownership + status check (uses existing documents table).
    try:
        res = (
            db.get_client()
            .table("documents")
            .select("id, filename, status, metadata")
            .eq("id", doc_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        return {"error": f"Could not verify document: {e}"}

    rows = res.data or []
    if not rows:
        return {"error": "Document not found or you don't have access to it."}
    doc = rows[0]
    if doc.get("status") != "complete":
        return {
            "error": f"Document '{doc.get('filename')}' is not ready (status: {doc.get('status')}).",
        }

    # 2. Embed query (single-vector OpenAI call, ~50-100 ms).
    try:
        query_vec = embeddings.embed_query(query)
    except Exception as e:
        return {"error": f"Embedding failed: {e}"}

    # 3. Qdrant search filtered by both user_id and doc_id.
    try:
        points = qdrant_store.search(
            query_vector=query_vec,
            user_id=user_id,
            doc_id=doc_id,
            top_k=5,
        )
    except Exception as e:
        return {"error": f"Vector search failed: {e}"}

    chunks = []
    for p in points:
        payload = getattr(p, "payload", None) or {}
        text = (payload.get("markdown") or "").strip()
        if len(text) > 600:
            text = text[:600].rstrip() + "…"
        chunks.append({
            "chunk_id":       payload.get("chunk_id"),
            "chunk_type":     payload.get("chunk_type"),
            "section_header": payload.get("section_header"),
            "page":           payload.get("page"),
            "score":          round(getattr(p, "score", 0.0), 4) if getattr(p, "score", None) is not None else None,
            "text":           text,
        })

    return {
        "doc_id":   doc_id,
        "filename": doc.get("filename"),
        "query":    query,
        "chunks":   chunks,
        "instructions_for_assistant": (
            "Cite findings using [chunk_id] markers from the chunks above. "
            "Never quote text that isn't in these chunks. If the chunks don't "
            "answer the question, say so plainly."
        ),
    }


# ── Chart rendering (UI side-effect tool) ────────────────────────────────────
# When the LLM calls render_chart, app.py intercepts the result and emits a
# `chart` SSE event so the client can render <FinbotChart spec={...}/>.
# The function returns a chart spec — the dispatcher does NOT feed this whole
# payload back to the LLM (it gets a small ack instead).
_CHART_PERIOD_OK = {"5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"}


def render_chart(chart_type: str, ticker: str, period: str = "6mo") -> dict:
    """Build a chart spec the frontend can render with recharts.

    Currently supports: chart_type='price_line' — daily close-price series."""
    chart_type = (chart_type or "").lower()
    if chart_type != "price_line":
        return {"error": f"Unsupported chart_type '{chart_type}'. Supported: price_line."}

    if period not in _CHART_PERIOD_OK:
        period = "6mo"

    try:
        t = yf.Ticker(ticker.upper())
        hist = t.history(period=period)
        if hist.empty:
            return {"error": f"No price data for {ticker}.", "ticker": ticker.upper()}

        rows = []
        for dt, row in hist.iterrows():
            rows.append({
                "date":  dt.strftime("%Y-%m-%d") if hasattr(dt, "strftime") else str(dt),
                "close": round(float(row["Close"]), 4),
            })

        first_close = rows[0]["close"]
        last_close  = rows[-1]["close"]
        perf_pct = round(((last_close - first_close) / first_close) * 100, 2) if first_close else None

        return {
            "spec": {
                "type":   "price_line",
                "ticker": ticker.upper(),
                "period": period,
                "perf_pct": perf_pct,
                "data":   rows,
            },
        }
    except Exception as e:
        return {"error": str(e), "ticker": ticker.upper()}


# ── Watchlist mutation (user-context tool) ───────────────────────────────────
def add_to_watchlist(
    user_id: str,
    ticker: str,
    alert_above: float | None = None,
    alert_below: float | None = None,
    note: str | None = None,
) -> dict:
    """Save a ticker to the user's watchlist. Returns the new (or existing) row."""
    try:
        # Best-effort idempotency: if already on watchlist, return existing.
        existing = [w for w in finbot_repo.list_watchlist(user_id)
                    if w["ticker"] == ticker.upper()]
        if existing:
            return {"watch": existing[0], "already_present": True}
        watch = finbot_repo.add_watch(user_id, {
            "ticker":      ticker,
            "alert_above": alert_above,
            "alert_below": alert_below,
            "note":        note,
        })
        return {"watch": watch, "already_present": False}
    except Exception as e:
        return {"error": str(e)}


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
    {
        "type": "function",
        "function": {
            "name": "get_portfolio_pnl",
            "description": (
                "Get the user's current portfolio: every open holding with "
                "live price, P&L in dollars and percent, plus an aggregate "
                "summary. Use whenever the user asks about 'my portfolio', "
                "'my positions', 'how am I doing', or a specific ticker they own."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_to_watchlist",
            "description": (
                "Save a ticker to the user's watchlist. Use only when the "
                "user explicitly asks to 'watch', 'follow', 'track', or "
                "'add to watchlist'. Optional alert thresholds notify them "
                "when price crosses above/below a level."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "ticker":      {"type": "string", "description": "Stock ticker symbol"},
                    "alert_above": {"type": "number", "description": "Notify if price crosses above this level"},
                    "alert_below": {"type": "number", "description": "Notify if price crosses below this level"},
                    "note":        {"type": "string", "description": "Optional short note"},
                },
                "required": ["ticker"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_earnings_calendar",
            "description": "Next earnings date and EPS / revenue estimates plus the most recent earnings result for a ticker.",
            "parameters": {
                "type": "object",
                "properties": {"ticker": {"type": "string"}},
                "required": ["ticker"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_dividends",
            "description": "Dividend yield, payout ratio, last 5 payments and trailing-12-month total for a ticker.",
            "parameters": {
                "type": "object",
                "properties": {"ticker": {"type": "string"}},
                "required": ["ticker"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_insider_trades",
            "description": "Recent insider transactions (last 90 days) — name, role-implied transaction code, shares, price.",
            "parameters": {
                "type": "object",
                "properties": {"ticker": {"type": "string"}},
                "required": ["ticker"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_macro_indicators",
            "description": "Latest US macro indicators (Fed funds rate, CPI, unemployment, 10Y yield, 10Y-2Y spread) from FRED. Use when the user asks about rates, inflation, or recession risk.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_technical_indicators",
            "description": "Compute RSI, MACD, SMA50/SMA200/EMA20 from daily price history. Use when the user asks about technicals, oversold/overbought, golden/death cross.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ticker":     {"type": "string"},
                    "indicators": {
                        "type": "array",
                        "items": {"type": "string", "enum": ["rsi", "macd", "sma50", "sma200", "ema20"]},
                        "description": "Subset to compute. Default: rsi, macd, sma50, sma200.",
                    },
                },
                "required": ["ticker"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_options_chain",
            "description": "Calls and puts for one expiry, trimmed to ~7 strikes either side of spot. Default expiry is the nearest. Use only when explicitly asked about options.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ticker": {"type": "string"},
                    "expiry": {"type": "string", "description": "ISO date YYYY-MM-DD; defaults to nearest expiry"},
                },
                "required": ["ticker"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_user_document",
            "description": (
                "Search inside an AlphaLens document the user has uploaded "
                "and parsed (10-K, 10-Q, prospectus, annual report). Returns "
                "the top relevant chunks with text, page, and chunk_id. Cite "
                "[chunk_id] in your reply so the UI can link back to the PDF. "
                "Use this when the user references 'my document', 'the 10-K I "
                "uploaded', a specific filename, or asks about a company they "
                "have documents for."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "doc_id": {
                        "type": "string",
                        "description": "UUID of the user's parsed document. The user typically refers to docs by company name; ask if ambiguous.",
                    },
                    "query":  {
                        "type": "string",
                        "description": "Natural-language question to search for inside the document.",
                    },
                },
                "required": ["doc_id", "query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "render_chart",
            "description": (
                "Render an inline chart in the chat UI. Use sparingly — only "
                "when a visual is more useful than text (e.g. price trend over "
                "weeks/months). The chart appears immediately in the user's "
                "message stream; you don't need to describe its contents."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "chart_type": {
                        "type": "string",
                        "enum": ["price_line"],
                        "description": "Currently only 'price_line' is supported.",
                    },
                    "ticker": {"type": "string"},
                    "period": {
                        "type": "string",
                        "enum": ["5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"],
                        "description": "Default 6mo.",
                    },
                },
                "required": ["chart_type", "ticker"],
            },
        },
    },
]

TOOL_MAP = {
    "get_quote":                get_quote,
    "get_fundamentals":         get_fundamentals,
    "get_price_history":        get_price_history,
    "get_news":                 get_news,
    "compare_stocks":           compare_stocks,
    "get_portfolio_pnl":        get_portfolio_pnl,
    "add_to_watchlist":         add_to_watchlist,
    "get_earnings_calendar":    get_earnings_calendar,
    "get_dividends":            get_dividends,
    "get_insider_trades":       get_insider_trades,
    "get_macro_indicators":     get_macro_indicators,
    "get_technical_indicators": get_technical_indicators,
    "get_options_chain":        get_options_chain,
    "query_user_document":      query_user_document,
    "render_chart":             render_chart,
}

# Tools that require the calling user's id. The agent dispatcher in app.py
# injects user_id automatically for these.
USER_CONTEXT_TOOLS = {"get_portfolio_pnl", "add_to_watchlist", "query_user_document"}
