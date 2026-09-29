"use client";

// A small markdown renderer for assistant replies.
//
// The model answers in markdown whether or not we ask it to, and rendering
// that as plain text is what makes an answer look broken — literal ** around
// every figure, pipes where a table should be. This covers the subset a chat
// answer actually uses: headings, bold/italic, inline code, fenced code,
// bullet and numbered lists, block quotes, rules, links and tables.
//
// It builds React elements rather than HTML strings, so model output can never
// inject markup; link hrefs are still protocol-checked before being rendered.

import { Fragment, type ReactNode } from "react";
import { cn } from "./ui";

/** Only these protocols are allowed to become a clickable link. */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return trimmed; // in-app route
  return null;
}

/** Inline spans, applied recursively so **bold `code`** works. */
function inline(text: string, key = "i"): ReactNode[] {
  if (text === "") return [];

  const rules: {
    re: RegExp;
    node: (m: RegExpMatchArray, k: string) => ReactNode;
  }[] = [
    {
      // Code first — nothing inside a code span should be re-parsed.
      re: /`([^`]+)`/,
      node: (m, k) => (
        <code
          key={k}
          className="rounded bg-teal-950/[0.07] px-1 py-0.5 font-mono text-[0.85em] text-teal-900"
        >
          {m[1]}
        </code>
      ),
    },
    {
      re: /\[([^\]]+)\]\(([^)\s]+)\)/,
      node: (m, k) => {
        const href = safeHref(m[2]);
        if (!href) return <Fragment key={k}>{m[1]}</Fragment>;
        return (
          <a
            key={k}
            href={href}
            target={href.startsWith("/") ? undefined : "_blank"}
            rel="noopener noreferrer"
            className="font-medium text-teal-700 underline underline-offset-2 hover:text-teal-900"
          >
            {inline(m[1], `${k}a`)}
          </a>
        );
      },
    },
    {
      re: /\*\*([^*]+)\*\*/,
      node: (m, k) => (
        <strong key={k} className="font-semibold text-inherit">
          {inline(m[1], `${k}b`)}
        </strong>
      ),
    },
    {
      re: /(?<![\w*])\*([^*\n]+)\*(?![\w*])/,
      node: (m, k) => <em key={k}>{inline(m[1], `${k}e`)}</em>,
    },
    {
      re: /~~([^~]+)~~/,
      node: (m, k) => (
        <s key={k} className="opacity-60">
          {inline(m[1], `${k}s`)}
        </s>
      ),
    },
  ];

  // Whichever rule matches earliest wins; everything before it is plain text
  // and everything after is parsed the same way.
  let best: { index: number; match: RegExpMatchArray; rule: (typeof rules)[number] } | null =
    null;
  for (const rule of rules) {
    const m = text.match(rule.re);
    if (m?.index !== undefined && (best === null || m.index < best.index)) {
      best = { index: m.index, match: m, rule };
    }
  }
  if (!best) return [text];

  return [
    ...(best.index > 0 ? inline(text.slice(0, best.index), `${key}<`) : []),
    best.rule.node(best.match, `${key}=${best.index}`),
    ...inline(text.slice(best.index + best.match[0].length), `${key}>`),
  ];
}

/** Split a `| a | b |` row into its cells. */
function cells(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isDivider = (line: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-");

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  const push = (node: ReactNode) => blocks.push(<Fragment key={blocks.length}>{node}</Fragment>);

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — block separator.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code. An unterminated fence still renders, which matters while
    // the answer is mid-stream.
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence
      push(
        <pre className="my-2 overflow-x-auto rounded-lg bg-teal-950 px-3 py-2 text-xs leading-relaxed text-teal-50">
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Table: a pipe row followed by a --- divider row.
    if (isTableRow(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const header = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      push(
        <div className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-[0.8rem]">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th
                    key={hi}
                    className="border-b border-zinc-300 px-2 py-1.5 text-left font-semibold text-zinc-600"
                  >
                    {inline(h, `th${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-zinc-200/70 last:border-0">
                  {r.map((c, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        "px-2 py-1.5 align-top",
                        // Figures read far better right-aligned.
                        /^[\d.,\s]*(ksh)?[\d.,\s%]*$/i.test(c) && c !== ""
                          ? "text-right tabular-nums"
                          : "",
                      )}
                    >
                      {inline(c, `td${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const heading = line.match(/^\s*(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      push(
        <p
          className={cn(
            "mt-3 mb-1 font-semibold text-zinc-900 first:mt-0",
            level <= 2 ? "text-[0.95rem]" : "text-sm",
          )}
        >
          {inline(heading[2], `h${i}`)}
        </p>,
      );
      i++;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      push(<hr className="my-3 border-zinc-200" />);
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i++].replace(/^\s*>\s?/, ""));
      }
      push(
        <blockquote className="my-2 border-l-2 border-teal-500/50 pl-3 text-zinc-600">
          {inline(body.join(" "), `q${i}`)}
        </blockquote>,
      );
      continue;
    }

    // Lists. Bullets and numbers are collected the same way; only the wrapper
    // element and marker differ.
    const bullet = /^\s*[-*•]\s+(.*)$/;
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = !bullet.test(line) && numbered.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const bm = lines[i].match(bullet);
        const nm = lines[i].match(numbered);
        if (ordered && nm) items.push(nm[2]);
        else if (!ordered && bm) items.push(bm[1]);
        else if (
          // A wrapped continuation line, indented under the previous item.
          items.length > 0 &&
          /^\s{2,}\S/.test(lines[i]) &&
          lines[i].trim() !== ""
        ) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
        } else break;
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      push(
        <Tag className="my-1.5 space-y-1 pl-1">
          {items.map((item, ii) => (
            <li key={ii} className="flex gap-2">
              <span
                className={cn(
                  "shrink-0 select-none text-teal-600",
                  ordered ? "tabular-nums" : "",
                )}
              >
                {ordered ? `${ii + 1}.` : "•"}
              </span>
              <span className="min-w-0 flex-1">{inline(item, `li${i}-${ii}`)}</span>
            </li>
          ))}
        </Tag>,
      );
      continue;
    }

    // Paragraph — everything up to the next blank line or block starter.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*(```|>|#{1,4}\s|[-*•]\s|\d+[.)]\s)/.test(lines[i]) &&
      !(isTableRow(lines[i]) && i + 1 < lines.length && isDivider(lines[i + 1]))
    ) {
      para.push(lines[i++]);
    }
    if (para.length === 0) {
      // Defensive: never leave the cursor parked on an unconsumed line.
      para.push(lines[i++]);
    }
    push(
      <p className="my-1.5 first:mt-0 last:mb-0">
        {para.map((p, pi) => (
          <Fragment key={pi}>
            {pi > 0 && <br />}
            {inline(p, `p${i}-${pi}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className="text-sm leading-relaxed">{blocks}</div>;
}
