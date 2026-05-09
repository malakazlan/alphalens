import AnalyzerView from "../AnalyzerView";

// Workspace for one document — `/dashboard/analyzer/{docId}`.
// Browser back/forward/refresh/share-link all behave correctly because
// the URL is the source of truth for which doc is open.
export default function Page({ params }: { params: { docId: string } }) {
  return <AnalyzerView docIdFromUrl={params.docId} />;
}
