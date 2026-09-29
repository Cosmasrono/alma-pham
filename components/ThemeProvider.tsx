"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { cn } from "./ui";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "careflow_theme";

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const [mounted, setMounted] = useState(false);

  // Read stored preference on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === "light" || stored === "dark" || stored === "system") {
        setThemeState(stored);
      }
    } catch {
      // storage unavailable
    }
    setMounted(true);
  }, []);

  // Update DOM and resolved theme whenever theme changes
  useEffect(() => {
    const isDark = theme === "dark" || (theme === "system" && getSystemTheme() === "dark");
    const resolved: ResolvedTheme = isDark ? "dark" : "light";
    setResolvedTheme(resolved);

    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    // Media query listener for system preference changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (theme === "system") {
        const sysDark = mediaQuery.matches;
        setResolvedTheme(sysDark ? "dark" : "light");
        if (sysDark) {
          root.classList.add("dark");
        } else {
          root.classList.remove("dark");
        }
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch {
      // ignore
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

export function ThemeToggle({
  className,
  variant = "button",
  size = "md",
}: {
  className?: string;
  variant?: "button" | "menu" | "pill";
  size?: "sm" | "md";
}) {
  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-xl bg-white/5 text-teal-200/50",
          size === "sm" ? "size-8" : "size-9",
          className,
        )}
        aria-hidden
      />
    );
  }

  if (variant === "pill") {
    return (
      <div
        className={cn(
          "inline-flex items-center rounded-xl border border-white/10 bg-white/5 p-1 text-xs",
          className,
        )}
        role="group"
        aria-label="Theme selection"
      >
        <button
          type="button"
          onClick={() => setTheme("light")}
          aria-label="Light theme"
          aria-pressed={theme === "light"}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium transition-colors",
            theme === "light"
              ? "bg-white/20 text-white shadow-xs"
              : "text-teal-200/70 hover:bg-white/5 hover:text-white",
          )}
        >
          <Sun className="size-3.5" />
          <span>Light</span>
        </button>
        <button
          type="button"
          onClick={() => setTheme("dark")}
          aria-label="Dark theme"
          aria-pressed={theme === "dark"}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium transition-colors",
            theme === "dark"
              ? "bg-white/20 text-white shadow-xs"
              : "text-teal-200/70 hover:bg-white/5 hover:text-white",
          )}
        >
          <Moon className="size-3.5" />
          <span>Dark</span>
        </button>
        <button
          type="button"
          onClick={() => setTheme("system")}
          aria-label="System theme"
          aria-pressed={theme === "system"}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium transition-colors",
            theme === "system"
              ? "bg-white/20 text-white shadow-xs"
              : "text-teal-200/70 hover:bg-white/5 hover:text-white",
          )}
        >
          <Monitor className="size-3.5" />
          <span>Auto</span>
        </button>
      </div>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500",
        size === "sm" ? "size-8" : "size-9",
        "border border-white/15 bg-white/10 text-teal-100 hover:bg-white/20 hover:text-white active:scale-95",
        className,
      )}
    >
      {isDark ? (
        <Sun className="size-4 text-amber-300 transition-transform hover:rotate-45" />
      ) : (
        <Moon className="size-4 text-teal-200 transition-transform hover:-rotate-12" />
      )}
    </button>
  );
}
