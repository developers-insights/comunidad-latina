"use client";

import { useMemo, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import { GuideCard, type GuideCardData } from "./guide-card";
import { COPY } from "./copy";

/** Normaliza para buscar sin acentos: "guía" matchea "guia". */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Índice de guías con buscador simple 100% client-side (las guías llegan
 * ya cargadas del server) + filtro por topic como chips tocables.
 */
export function GuidesExplorer({ guides }: { guides: GuideCardData[] }) {
  const [query, setQuery] = useState("");
  const [activeTopic, setActiveTopic] = useState<string | null>(null);

  const topics = useMemo(() => {
    const unique = new Set<string>();
    for (const guide of guides) for (const topic of guide.topics) unique.add(topic);
    return [...unique].sort((a, b) => a.localeCompare(b, "es"));
  }, [guides]);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return guides.filter((guide) => {
      if (activeTopic && !guide.topics.includes(activeTopic)) return false;
      if (!q) return true;
      const haystack = normalize(
        `${guide.title} ${guide.summary ?? ""} ${guide.topics.join(" ")}`,
      );
      return haystack.includes(q);
    });
  }, [guides, query, activeTopic]);

  const topicChipClass = (active: boolean) =>
    cn(
      "inline-flex h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium",
      "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
      active
        ? "border-transparent bg-brand text-brand-foreground"
        : "border-border bg-surface text-foreground-secondary hover:bg-surface-subtle",
    );

  return (
    <div className="space-y-6">
      <div className="relative">
        <MagnifyingGlass
          size={20}
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-foreground-muted"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={COPY.guidesIndex.searchPlaceholder}
          aria-label={COPY.guidesIndex.searchPlaceholder}
          className="pl-11"
        />
      </div>

      {topics.length > 0 && (
        <div
          role="group"
          aria-label="Filtrar por tema"
          className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4"
        >
          <button
            type="button"
            aria-pressed={activeTopic === null}
            onClick={() => setActiveTopic(null)}
            className={topicChipClass(activeTopic === null)}
          >
            {COPY.guidesIndex.allTopics}
          </button>
          {topics.map((topic) => (
            <button
              key={topic}
              type="button"
              aria-pressed={activeTopic === topic}
              onClick={() => setActiveTopic((current) => (current === topic ? null : topic))}
              className={topicChipClass(activeTopic === topic)}
            >
              {topic}
            </button>
          ))}
        </div>
      )}

      <p aria-live="polite" className="text-sm text-foreground-muted">
        {COPY.guidesIndex.results(filtered.length)}
      </p>

      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((guide) => (
            <GuideCard key={guide.slug} guide={guide} />
          ))}
        </div>
      ) : (
        <EmptyState
          illustration="/images/empty-state-search.png"
          title={COPY.guidesIndex.emptyTitle}
          message={COPY.guidesIndex.emptyMessage}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery("");
                setActiveTopic(null);
              }}
            >
              {COPY.guidesIndex.emptyAction}
            </Button>
          }
        />
      )}
    </div>
  );
}
