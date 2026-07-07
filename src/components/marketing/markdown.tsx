import type { ReactNode } from "react";

/**
 * Renderer de Markdown minimalista y SEGURO para las guías (ARQUITECTURA §9):
 * construye elementos React directamente — CERO dangerouslySetInnerHTML, cero
 * HTML crudo. Lo que no matchea un patrón conocido se muestra como texto plano.
 *
 * Soporta lo que usan las guías reales del seed:
 *  - Headings # ## ### (demovidos un nivel: # → h2, para no duplicar el H1 de la página)
 *  - Párrafos, listas `- ` / `* ` y numeradas `1. `
 *  - Blockquotes `> ` (usados como avisos ⚠️ en las guías)
 *  - Inline: **negrita**, *itálica*, `código`, [links](https://…) solo http/https
 */

const INLINE_PATTERN =
  /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;

const LINK_PATTERN = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0;
    const token = match[0];
    if (start > last) nodes.push(text.slice(last, start));

    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="rounded-sm bg-surface-subtle px-1.5 py-0.5 font-mono text-[0.875em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const link = LINK_PATTERN.exec(token);
      if (link) {
        nodes.push(
          <a
            key={key}
            href={link[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-700 underline decoration-brand-200 underline-offset-2 transition-colors hover:decoration-brand-700 dark:text-brand-300 dark:decoration-brand-700"
          >
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = start + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function isBlockBoundary(line: string): boolean {
  return (
    !line.trim() ||
    /^#{1,4}\s+/.test(line) ||
    line.startsWith(">") ||
    /^[-*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line)
  );
}

export function Markdown({ source }: { source: string }) {
  const lines = source.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      // Demovemos un nivel: el H1 de la página es el título de la guía.
      const level = Math.min(heading[1].length + 1, 4);
      const content = renderInline(heading[2], `h-${key}`);
      if (level === 2) {
        blocks.push(
          <h2
            key={key++}
            className="mt-10 font-display text-2xl font-bold tracking-tight text-foreground first:mt-0"
          >
            {content}
          </h2>,
        );
      } else if (level === 3) {
        blocks.push(
          <h3
            key={key++}
            className="mt-8 font-display text-xl font-semibold text-foreground"
          >
            {content}
          </h3>,
        );
      } else {
        blocks.push(
          <h4 key={key++} className="mt-6 font-display text-lg font-semibold text-foreground">
            {content}
          </h4>,
        );
      }
      i++;
      continue;
    }

    if (line.startsWith(">")) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoted.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={key++}
          className="rounded-md border-l-4 border-warning bg-warning-bg px-4 py-3 text-sm leading-relaxed text-foreground"
        >
          {renderInline(quoted.join(" ").trim(), `q-${key}`)}
        </blockquote>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(
          <li key={items.length}>
            {renderInline(lines[i].replace(/^[-*]\s+/, ""), `ul-${key}-${items.length}`)}
          </li>,
        );
        i++;
      }
      blocks.push(
        <ul
          key={key++}
          className="list-disc space-y-2 pl-5 leading-relaxed text-foreground-secondary marker:text-foreground-muted"
        >
          {items}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(
          <li key={items.length}>
            {renderInline(lines[i].replace(/^\d+\.\s+/, ""), `ol-${key}-${items.length}`)}
          </li>,
        );
        i++;
      }
      blocks.push(
        <ol
          key={key++}
          className="list-decimal space-y-2 pl-5 leading-relaxed text-foreground-secondary marker:font-semibold marker:text-foreground"
        >
          {items}
        </ol>,
      );
      continue;
    }

    // Párrafo: acumula hasta el próximo límite de bloque.
    const paragraph: string[] = [line];
    i++;
    while (i < lines.length && !isBlockBoundary(lines[i])) {
      paragraph.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="leading-relaxed text-foreground-secondary">
        {renderInline(paragraph.join(" ").trim(), `p-${key}`)}
      </p>,
    );
  }

  return <div className="space-y-4 text-base">{blocks}</div>;
}
