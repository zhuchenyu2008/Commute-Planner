export const AGENT_TRANSITION_PROMPT_KEY = "commute-planner:agent-prompt";
export const AGENT_TRANSITION_SESSION_KEY = "commute-planner:agent-session";

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => unknown;
};

const ROUTE_VIEW_TRANSITION_TIMEOUT_MS = 1200;

let pendingRouteTransition: {
  resolve: () => void;
  timeoutId: number | undefined;
} | null = null;

function resolvePendingRouteTransition() {
  if (!pendingRouteTransition) {
    return;
  }

  const { resolve, timeoutId } = pendingRouteTransition;
  pendingRouteTransition = null;

  if (timeoutId !== undefined && typeof window !== "undefined") {
    window.clearTimeout(timeoutId);
  }

  resolve();
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const matchMedia = window.matchMedia;

    if (typeof matchMedia !== "function") {
      return false;
    }

    return matchMedia.call(window, "(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function savePendingAgentPrompt(prompt: string, sessionId?: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const trimmedPrompt = prompt.trim();
  const trimmedSessionId = sessionId?.trim() ?? "";

  if (trimmedPrompt.length === 0) {
    return;
  }

  try {
    window.sessionStorage.setItem(AGENT_TRANSITION_PROMPT_KEY, trimmedPrompt);
  } catch {
    return;
  }

  try {
    if (trimmedSessionId) {
      window.sessionStorage.setItem(
        AGENT_TRANSITION_SESSION_KEY,
        trimmedSessionId
      );
    } else {
      window.sessionStorage.removeItem(AGENT_TRANSITION_SESSION_KEY);
    }
  } catch {
    return;
  }
}

export function takePendingAgentPrompt(sessionId?: string): string {
  if (typeof window === "undefined") {
    return "";
  }

  let prompt = "";
  let storedSessionId = "";

  try {
    prompt = window.sessionStorage.getItem(AGENT_TRANSITION_PROMPT_KEY) ?? "";
  } catch {
    return "";
  }

  try {
    storedSessionId =
      window.sessionStorage.getItem(AGENT_TRANSITION_SESSION_KEY) ?? "";
  } catch {
    storedSessionId = "";
  }

  try {
    window.sessionStorage.removeItem(AGENT_TRANSITION_PROMPT_KEY);
  } catch {
    // Best-effort cleanup only; the prompt should still be usable.
  }

  try {
    window.sessionStorage.removeItem(AGENT_TRANSITION_SESSION_KEY);
  } catch {
    // Best-effort cleanup only; the prompt should still be usable.
  }

  if (sessionId && storedSessionId && storedSessionId !== sessionId) {
    return "";
  }

  return prompt;
}

export function completeRouteViewTransition(): void {
  resolvePendingRouteTransition();
}

export function startRouteViewTransition(navigate: () => void): void {
  resolvePendingRouteTransition();

  if (prefersReducedMotion()) {
    navigate();
    return;
  }

  if (typeof document === "undefined") {
    navigate();
    return;
  }

  const transitionDocument = document as ViewTransitionDocument;

  if (typeof transitionDocument.startViewTransition !== "function") {
    navigate();
    return;
  }

  transitionDocument.startViewTransition(() => {
    navigate();

    return new Promise<void>((resolve) => {
      const timeoutId =
        typeof window === "undefined"
          ? undefined
          : window.setTimeout(
              resolvePendingRouteTransition,
              ROUTE_VIEW_TRANSITION_TIMEOUT_MS
            );

      pendingRouteTransition = { resolve, timeoutId };
    });
  });
}
