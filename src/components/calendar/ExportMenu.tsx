import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download } from "lucide-react";
import {
  runExport,
  type ExportActivity,
  type ExportLine,
} from "@/lib/calendar-export";

interface ExportMenuProps {
  activities: ExportActivity[];
  lines?: ExportLine[];
  projectName: string;
  scopeLabel: string;
  disabled?: boolean;
}

export function ExportMenu({
  activities,
  lines,
  projectName,
  scopeLabel,
  disabled,
}: ExportMenuProps) {
  const opts = { activities, lines, projectName, scopeLabel };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={disabled || activities.length === 0}
        >
          <Download className="h-4 w-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Download as</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => runExport("pdf", opts)}>
          PDF document
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => runExport("xlsx", opts)}>
          Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => runExport("csv", opts)}>
          CSV
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => runExport("ics", opts)}>
          Calendar feed (.ics)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
