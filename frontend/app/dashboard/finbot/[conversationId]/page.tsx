import { FinBotShell } from "../FinBotShell";

// Resumed conversation route: /dashboard/finbot/{conversationId}.
// Re-uses the same shell component as the bare /dashboard/finbot route so
// chat behaviour is identical — only the source of the URL param differs.
export default function Page({ params }: { params: { conversationId: string } }) {
  return <FinBotShell conversationId={params.conversationId} />;
}
