import { createContext, useContext, type ReactNode } from "react";

type CurrentLine = {
  lineId: string;
  lineNumber: number;
  equipmentId?: string;
};

const Ctx = createContext<CurrentLine | null>(null);

export function CurrentLineProvider({ value, children }: { value: CurrentLine; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrentLine(): CurrentLine | null {
  return useContext(Ctx);
}
