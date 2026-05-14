import { useRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Camera, Image as ImageIcon } from "lucide-react";

// Asks the user to pick between camera and gallery (mobile-friendly).
export function PhotoPicker({
  onPick,
  children,
}: {
  onPick: (file: File) => void;
  children: React.ReactNode;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onPick(f);
    e.target.value = "";
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => cameraRef.current?.click()}>
            <Camera className="mr-2 h-4 w-4" /> Take photo
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => galleryRef.current?.click()}>
            <ImageIcon className="mr-2 h-4 w-4" /> Choose from gallery
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handle}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handle}
      />
    </>
  );
}
