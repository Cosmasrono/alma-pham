"use client";

// Floating AI assistant. Available on every page for logged-in staff; asks
// /api/ai, which answers from a live snapshot of the clinic data.
//
// The panel is a working tool rather than a demo bubble: it resizes, keeps the
// conversation across page navigation, renders the model's markdown properly,
// and lets the user stop, retry, copy or start over at any point.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import {
  ArrowDownIcon,
  CheckIcon,
  CopyIcon,
  Maximize2Icon,
  MessageSquarePlusIcon,
  Minimize2Icon,
  RotateCcwIcon,
  SendIcon,
  SparklesIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { cn, Spinner } from "./ui";
import { Markdown } from "./Markdown";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type PanelSize = "normal" | "large" | "full";

const SIZE_ORDER: PanelSize[] = ["normal", "large", "full"];

const SIZE_CLASS: Record<PanelSize, string> = {
  normal:
    "bottom-21 right-5 h-[min(34rem,calc(100dvh-8rem))] w-[min(24rem,calc(100vw-2.5rem))]",
  large:
    "bottom-21 right-5 h-[min(44rem,calc(100dvh-8rem))] w-[min(38rem,calc(100vw-2.5rem))]",
  full: "inset-3 sm:inset-6",
};

const SIZE_STORAGE_KEY = "carepharm.ai.size";
const CHAT_STORAGE_KEY = "carepharm.ai.chat";

/** Starter questions, tuned to the station the user is currently looking at. */
function suggestionsFor(pathname: string): string[] {
  if (pathname.startsWith("/reports") || pathname.startsWith("/admin/accounting"))
    return [
      "Summarize this week's revenue by service line",
      "Which services bring in the most money?",
      "How much is still outstanding, and from whom?",
      "Compare today's takings to the rest of the week",
    ];
  if (pathname.startsWith("/pharmacy") || pathname.startsWith("/admin/medicines"))
    return [
      "What medicines are running low?",
      "Which items sold most this week?",
      "What is my stock worth right now?",
      "Anything out of stock that was prescribed today?",
    ];
  if (pathname.startsWith("/doctor"))
    return [
      "Who is waiting for me right now?",
      "Any emergency or urgent patients in the queue?",
      "Which of my patients are waiting on lab results?",
      "Summarize the patients I have seen today",
    ];
  if (pathname.startsWith("/reception") || pathname.startsWith("/patients"))
    return [
      "Which patients have been waiting longest?",
      "How busy is each station right now?",
      "Who still needs to pay before seeing the doctor?",
      "How many patients have we registered today?",
    ];
  if (pathname.startsWith("/services") || pathname.startsWith("/flow"))
    return [
      "Which orders are still pending?",
      "Where are patients getting stuck today?",
      "What is the average turnaround on lab tests?",
      "Which station has the longest queue?",
    ];
  return [
    "How is the clinic doing today?",
    "Which patients have been waiting longest?",
    "What medicines are running low?",
    "Summarize today's revenue",
  ];
}

/**
 * Both readers run as lazy `useState` initialisers rather than in an effect.
 * That is safe from a hydration standpoint because the panel renders nothing
 * until it is opened — the server and the first client paint agree on the
 * launcher button alone.
 */
function restoreSize(): PanelSize {
  try {
    const stored = localStorage.getItem(SIZE_STORAGE_KEY);
    if (stored && SIZE_ORDER.includes(stored as PanelSize)) {
      return stored as PanelSize;
    }
  } catch {
    // Private browsing or blocked storage — fall through to the default.
  }
  return "normal";
}

/** sessionStorage means a hard refresh keeps the thread, a new tab starts clean. */
function restoreChat(): ChatMessage[] {
  try {
    const stored = sessionStorage.getItem(CHAT_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as ChatMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function AiAssistant() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<PanelSize>(restoreSize);
  const [messages, setMessages] = useState<ChatMessage[]>(restoreChat);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // The last question asked, so a failed request can be retried as-is.
  const lastAskRef = useRef<string | null>(null);

  useEffect(() => {
    if (busy) return; // don't checkpoint half-streamed answers
    try {
      if (messages.length === 0) sessionStorage.removeItem(CHAT_STORAGE_KEY);
      else sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* storage unavailable */
    }
  }, [messages, busy]);

  // Follow the stream only while the user is already at the bottom, so
  // scrolling up to re-read an earlier answer isn't yanked away.
  useLayoutEffect(() => {
    if (!open || !atBottom) return;
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight });
  }, [messages, open, atBottom]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, size]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Ctrl/Cmd-K from anywhere toggles the panel; Escape closes it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape" && open) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const setPanelSize = useCallback((next: PanelSize) => {
    setSize(next);
    try {
      localStorage.setItem(SIZE_STORAGE_KEY, next);
    } catch {
      /* storage unavailable */
    }
  }, []);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }

  function newChat() {
    stop();
    setMessages([]);
    setError(null);
    setInput("");
    lastAskRef.current = null;
    inputRef.current?.focus();
  }

  async function ask(question: string, history?: ChatMessage[]) {
    const text = question.trim();
    if (!text || busy) return;

    const base = history ?? messages;
    const thread: ChatMessage[] = [...base, { role: "user", content: text }];
    lastAskRef.current = text;
    setMessages([...thread, { role: "assistant", content: "" }]);
    setInput("");
    setError(null);
    setBusy(true);
    setAtBottom(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: thread }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "The assistant is unavailable right now.");
        setMessages(thread); // drop the empty assistant bubble
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        const current = answer;
        setMessages([...thread, { role: "assistant", content: current }]);
      }
      if (answer.trim() === "") {
        setError("The assistant returned an empty answer. Try again.");
        setMessages(thread);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // Keep whatever streamed in before the user pressed stop.
        setMessages((prev) =>
          prev.length > 0 && prev[prev.length - 1].content.trim() === ""
            ? prev.slice(0, -1)
            : prev,
        );
      } else {
        setError("Network error. Please try again.");
        setMessages(thread);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function retry() {
    const question = lastAskRef.current;
    if (!question) return;
    // Drop the failed exchange before re-asking, so history stays clean.
    const trimmed = [...messages];
    if (trimmed[trimmed.length - 1]?.role === "user") trimmed.pop();
    void ask(question, trimmed);
  }

  async function copy(index: number) {
    try {
      await navigator.clipboard.writeText(messages[index].content);
      setCopied(index);
      setTimeout(() => setCopied((c) => (c === index ? null : c)), 1500);
    } catch {
      /* clipboard blocked — nothing useful to show */
    }
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void ask(input);
    }
  }

  // Grow the composer with its content, up to a few lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input]);

  const suggestions = suggestionsFor(pathname);
  const nextSize = SIZE_ORDER[(SIZE_ORDER.indexOf(size) + 1) % SIZE_ORDER.length];

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close AI assistant" : "Open AI assistant"}
        title={open ? "Close assistant (Esc)" : "Ask the assistant (Ctrl+K)"}
        className={cn(
          "fixed bottom-5 right-5 z-40 grid h-13 w-13 place-items-center rounded-full text-white shadow-lg shadow-teal-950/30 transition-all hover:scale-105 active:scale-95 print:hidden",
          open ? "bg-teal-950" : "bg-linear-to-br from-teal-500 to-teal-700",
          open && size === "full" && "hidden",
        )}
      >
        {open ? <XIcon className="size-5" /> : <SparklesIcon className="size-5" />}
      </button>

      {open && (
        <div
          className={cn(
            "fixed z-40 flex flex-col overflow-hidden rounded-2xl border border-teal-950/10 bg-white shadow-2xl shadow-teal-950/25 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-[0_25px_60px_rgba(0,0,0,0.6)] print:hidden",
            SIZE_CLASS[size],
          )}
        >
          <header className="flex items-center gap-2.5 bg-linear-to-r from-teal-950 to-teal-900 px-4 py-3 text-white">
            <SparklesIcon className="size-4 shrink-0 text-teal-300" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-tight">
                Amla Medicare Assistant
              </p>
              <p className="truncate text-[11px] text-teal-300/80">
                {busy ? "Thinking…" : "Answers from live clinic data"}
              </p>
            </div>

            <HeaderButton
              onClick={newChat}
              disabled={messages.length === 0 && !busy}
              label="New chat"
            >
              <MessageSquarePlusIcon className="size-4" />
            </HeaderButton>
            <HeaderButton
              onClick={() => setPanelSize(nextSize)}
              label={size === "full" ? "Shrink panel" : "Expand panel"}
            >
              {size === "full" ? (
                <Minimize2Icon className="size-4" />
              ) : (
                <Maximize2Icon className="size-4" />
              )}
            </HeaderButton>
            <HeaderButton onClick={() => setOpen(false)} label="Close assistant">
              <XIcon className="size-4" />
            </HeaderButton>
          </header>

          <div className="relative flex-1 overflow-hidden">
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="h-full space-y-3 overflow-y-auto p-3"
            >
              {messages.length === 0 && (
                <div className="space-y-2 pt-2">
                  <p className="px-1 text-xs text-zinc-400">
                    Ask about patients, queues, revenue or stock:
                  </p>
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => void ask(s)}
                      className="block w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-sm text-zinc-600 transition-colors hover:border-teal-600/30 hover:bg-teal-50 hover:text-teal-900 dark:border-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:border-teal-500/40 dark:hover:bg-teal-950/40 dark:hover:text-teal-200"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {messages.map((m, i) => {
                const streaming = busy && i === messages.length - 1;
                if (m.role === "user") {
                  return (
                    <div
                      key={i}
                      className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-teal-700 px-3 py-2 text-sm leading-relaxed text-white"
                    >
                      {m.content}
                    </div>
                  );
                }
                return (
                  <div key={i} className="group mr-auto max-w-[92%]">
                    <div className="rounded-2xl rounded-bl-md bg-zinc-100 px-3 py-2 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
                      {m.content === "" ? (
                        <Spinner className="my-1 text-teal-700" />
                      ) : (
                        <Markdown text={m.content} />
                      )}
                    </div>
                    {m.content !== "" && !streaming && (
                      <button
                        onClick={() => void copy(i)}
                        className="mt-1 ml-1 inline-flex items-center gap-1 text-[11px] text-zinc-400 opacity-0 transition-opacity hover:text-teal-700 focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        {copied === i ? (
                          <>
                            <CheckIcon className="size-3" /> Copied
                          </>
                        ) : (
                          <>
                            <CopyIcon className="size-3" /> Copy
                          </>
                        )}
                      </button>
                    )}
                  </div>
                );
              })}

              {error && (
                <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-600/15 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-500/30">
                  <p>{error}</p>
                  {lastAskRef.current && (
                    <button
                      onClick={retry}
                      className="mt-1.5 inline-flex items-center gap-1 font-medium text-red-800 underline underline-offset-2 hover:text-red-900 dark:text-red-300 dark:hover:text-red-200"
                    >
                      <RotateCcwIcon className="size-3" /> Retry
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Jump back to the newest message after scrolling up. */}
            {!atBottom && messages.length > 0 && (
              <button
                onClick={() => {
                  setAtBottom(true);
                  const el = scrollRef.current;
                  el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
                }}
                aria-label="Jump to latest"
                className="absolute bottom-3 left-1/2 grid h-8 w-8 -translate-x-1/2 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-md transition-colors hover:text-teal-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:text-teal-300"
              >
                <ArrowDownIcon className="size-4" />
              </button>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
            className="flex items-end gap-2 border-t border-zinc-100 p-2.5 dark:border-zinc-800"
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder="Ask the assistant…  (Enter to send, Shift+Enter for a new line)"
              className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-teal-500"
            />
            {busy ? (
              <button
                type="button"
                onClick={stop}
                aria-label="Stop generating"
                title="Stop generating"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-zinc-800 text-white transition-colors hover:bg-zinc-900"
              >
                <SquareIcon className="size-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={input.trim() === ""}
                aria-label="Send"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-700 text-white transition-colors hover:bg-teal-800 disabled:opacity-40"
              >
                <SendIcon className="size-4" />
              </button>
            )}
          </form>
        </div>
      )}
    </>
  );
}

/** The small icon buttons in the panel's dark header. */
function HeaderButton({
  onClick,
  label,
  disabled,
  children,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-7 shrink-0 place-items-center rounded-lg text-teal-200 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
