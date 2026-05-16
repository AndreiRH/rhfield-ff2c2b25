import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";

function LineLayout() {
  const { lineNumber } = useParams({ strict: false });
  // Force full remount of all child page components when the line changes,
  // so they re-fetch data and reset local state for the new line.
  return <Outlet key={String(lineNumber)} />;
}

export const Route = createFileRoute("/p/$projectId/lines/$lineNumber")({
  component: LineLayout,
});
