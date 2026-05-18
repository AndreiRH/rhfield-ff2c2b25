import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { CalendarDays } from "lucide-react";

export function ProjectHotCalendarButton({ projectId }: { projectId: string }) {
  return (
    <Button asChild variant="outline" className="gap-2 w-full sm:w-auto">
      <Link to="/p/$projectId/calendar" params={{ projectId }}>
        <CalendarDays className="h-4 w-4" /> Global calendar
      </Link>
    </Button>
  );
}
