"use client";

import {
  createContext,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { m } from "motion/react";
import { cn } from "@/lib/utils";

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  idBase: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error(`<${component}> debe usarse dentro de <Tabs>`);
  }
  return context;
}

export interface TabsProps {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function Tabs({
  defaultValue,
  value: controlledValue,
  onValueChange,
  children,
  className,
}: TabsProps) {
  const idBase = useId();
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const value = controlledValue ?? internalValue;

  const context = useMemo<TabsContextValue>(
    () => ({
      value,
      setValue: (next: string) => {
        setInternalValue(next);
        onValueChange?.(next);
      },
      idBase,
    }),
    [value, onValueChange, idBase],
  );

  return (
    <TabsContext.Provider value={context}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  children,
  className,
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Flechas ← → mueven foco y seleccionan (patrón WAI-ARIA tabs)
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const tabsEls = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ??
        [],
    );
    const currentIndex = tabsEls.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    if (currentIndex === -1) return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = tabsEls[(currentIndex + delta + tabsEls.length) % tabsEls.length];
    next.focus();
    next.click();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        "scrollbar-none relative flex gap-1 overflow-x-auto border-b border-border-subtle",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { value: selectedValue, setValue, idBase } = useTabsContext("TabsTrigger");
  const selected = selectedValue === value;

  return (
    <button
      type="button"
      role="tab"
      id={`${idBase}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${idBase}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      onClick={() => setValue(value)}
      className={cn(
        "relative flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-4 text-sm font-medium",
        "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
        selected
          ? "text-foreground"
          : "text-foreground-secondary hover:text-foreground",
        className,
      )}
    >
      {children}
      {selected && (
        // underline con color de marca, se desliza entre tabs
        <m.span
          layoutId={`${idBase}-underline`}
          aria-hidden="true"
          className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand"
          transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
        />
      )}
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { value: selectedValue, idBase } = useTabsContext("TabsContent");
  const selected = selectedValue === value;

  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${value}`}
      aria-labelledby={`${idBase}-tab-${value}`}
      hidden={!selected}
      tabIndex={0}
      className={cn("pt-4 focus-visible:outline-none", className)}
    >
      {selected && children}
    </div>
  );
}
