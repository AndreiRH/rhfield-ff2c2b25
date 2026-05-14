import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/p/$projectId/lines/$lineNumber/equipment/$kind")({
  component: () => <Outlet />,
});
