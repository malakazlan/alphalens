import AnalyzerView from "./AnalyzerView";

// Pre-upload state — `/dashboard/analyzer` (no doc selected).
// The workspace lives at `/dashboard/analyzer/[docId]`.
export default function Page() {
  return <AnalyzerView docIdFromUrl={null} />;
}
