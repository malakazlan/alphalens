// Requests go through Next.js rewrites → proxied to backend (no CORS).
// Auth is via httpOnly cookie (`access_token`); we never read the token in JS,
// so XSS cannot exfiltrate the session. credentials: "include" sends the cookie
// on every request automatically.
const API = "";

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

export async function apiJSON<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await apiFetch(path, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? data.detail ?? "Request failed");
  return data as T;
}

/** SSE streaming — yields parsed JSON event objects. Returns cleanup fn. */
export function streamSSE(
  path: string,
  body: object,
  onEvent: (event: Record<string, unknown>) => void,
  onDone?: () => void,
  onError?: (err: string) => void
): () => void {
  const controller = new AbortController();

  fetch(`${API}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const txt = await res.text();
        onError?.(txt);
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const evt = JSON.parse(line.slice(6));
              onEvent(evt);
            } catch {}
          }
        }
      }
      onDone?.();
    })
    .catch((err) => {
      if (err.name !== "AbortError") onError?.(err.message ?? "Stream error");
    });

  return () => controller.abort();
}
