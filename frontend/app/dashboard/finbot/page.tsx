import { FinBotShell } from "./FinBotShell";

// Bare /dashboard/finbot route — opens a fresh chat. The shell creates
// the conversation on first send and upgrades the URL via router.replace.
export default function Page() {
  return <FinBotShell conversationId={null} />;
}
