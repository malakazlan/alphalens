# Debugging FinBot "Connection error" on Production

If the chatbot works locally but shows **"Connection error"** (or similar) on production, the request reaches your Render app, but **your app cannot reach OpenAI** from Render’s servers.

## 1. Check Render logs (most important)

1. Go to [Render Dashboard](https://dashboard.render.com) → your **alpha-lens** service.
2. Open **Logs**.
3. Send a message in the chatbot on production, then look at the logs right after.

You should see either:

- `💬 FinBot chat from user ...` and then `❌ FinBot error: ...` with the **real** error (e.g. timeout, connection refused, SSL, or API key).
- Or nothing after the FinBot line → request might be failing earlier (e.g. auth).

The exact message after `❌ FinBot error:` tells you what’s wrong.

## 2. Verify environment variables on Render

In Render → your service → **Environment**:

- **OPENAI_API_KEY** – Must be set to a valid OpenAI API key (same one you use locally is fine). If it’s missing or wrong, you’ll often see auth or connection-style errors in the logs.

## 3. Typical causes and fixes

| Cause | What you see in logs / app | Fix |
|-------|----------------------------|-----|
| **OPENAI_API_KEY** not set on Render | Error about API key or connection | Add `OPENAI_API_KEY` in Render → Environment and redeploy. |
| **Cold start / timeout** | "Connection" or "timeout" in logs | Normal on free tier. User can retry after a few seconds. We use a 90s timeout to reduce this. |
| **Network from Render** | Connection/SSL errors in logs | Rare; check Render status. If it keeps failing, try again later or contact Render. |

## 4. Quick checklist

- [ ] Render **Logs** show the real error after `❌ FinBot error:`.
- [ ] **OPENAI_API_KEY** is set in Render **Environment** (and saved).
- [ ] After changing env, a **new deploy** has run (or trigger "Manual Deploy").
- [ ] Try the chatbot again; if it was cold start, the second try often works.

Once you have the exact error line from the logs, you can fix the underlying issue (e.g. add or fix the API key, or treat it as a transient timeout and retry).
