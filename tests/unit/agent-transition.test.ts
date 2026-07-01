// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_TRANSITION_PROMPT_KEY,
  completeRouteViewTransition,
  savePendingAgentPrompt,
  startRouteViewTransition,
  takePendingAgentPrompt,
} from "@/lib/ui/agent-transition";

type TestViewTransitionDocument = {
  startViewTransition?: (callback: () => void | Promise<void>) => unknown;
};

describe("agent transition helpers", () => {
  afterEach(() => {
    if (typeof completeRouteViewTransition === "function") {
      completeRouteViewTransition();
    }
    sessionStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (document as unknown as TestViewTransitionDocument)
      .startViewTransition;
  });

  it("saves and consumes trimmed prompt from sessionStorage", () => {
    savePendingAgentPrompt("  take me to the office  ");

    expect(sessionStorage.getItem(AGENT_TRANSITION_PROMPT_KEY)).toBe(
      "take me to the office"
    );
    expect(takePendingAgentPrompt()).toBe("take me to the office");
    expect(sessionStorage.getItem(AGENT_TRANSITION_PROMPT_KEY)).toBeNull();
  });

  it("does not store empty or blank prompts", () => {
    savePendingAgentPrompt("");
    savePendingAgentPrompt("  \n\t  ");

    expect(sessionStorage.getItem(AGENT_TRANSITION_PROMPT_KEY)).toBeNull();
  });

  it("does not throw when saving a prompt if sessionStorage rejects writes", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    expect(() => savePendingAgentPrompt("office")).not.toThrow();
  });

  it("returns empty string when reading a pending prompt fails", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    let prompt: string | undefined;

    expect(() => {
      prompt = takePendingAgentPrompt();
    }).not.toThrow();
    expect(prompt).toBe("");
  });

  it("returns the read prompt when removing the pending prompt fails", () => {
    sessionStorage.setItem(AGENT_TRANSITION_PROMPT_KEY, "office");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    let prompt: string | undefined;

    expect(() => {
      prompt = takePendingAgentPrompt();
    }).not.toThrow();
    expect(prompt).toBe("office");
  });

  it("returns empty when the stored prompt belongs to another session", () => {
    const savePrompt = savePendingAgentPrompt as (
      prompt: string,
      sessionId?: string
    ) => void;
    const takePrompt = takePendingAgentPrompt as (sessionId?: string) => string;

    savePrompt("office", "session-1");

    expect(sessionStorage.getItem(AGENT_TRANSITION_PROMPT_KEY)).toBe("office");
    expect(sessionStorage.getItem("commute-planner:agent-session")).toBe(
      "session-1"
    );
    expect(takePrompt("session-2")).toBe("");
    expect(sessionStorage.getItem(AGENT_TRANSITION_PROMPT_KEY)).toBeNull();
    expect(sessionStorage.getItem("commute-planner:agent-session")).toBeNull();
  });

  it("keeps legacy pending prompts available when no session id was stored", () => {
    const takePrompt = takePendingAgentPrompt as (sessionId?: string) => string;

    sessionStorage.setItem(AGENT_TRANSITION_PROMPT_KEY, "office");

    expect(takePrompt("session-2")).toBe("office");
  });

  it("calls navigate directly when View Transitions are unavailable", () => {
    const navigate = vi.fn();

    startRouteViewTransition(navigate);

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("does not start a View Transition when reduced motion is preferred", () => {
    const navigate = vi.fn();
    const startViewTransition = vi.fn((callback: () => void | Promise<void>) => {
      callback();
      return {};
    });
    (document as unknown as TestViewTransitionDocument).startViewTransition =
      startViewTransition;
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      }))
    );

    startRouteViewTransition(navigate);

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("continues navigation when checking reduced motion throws", () => {
    const navigate = vi.fn();
    const startViewTransition = vi.fn((callback: () => void | Promise<void>) => {
      callback();
      return {};
    });
    const originalMatchMedia = Object.getOwnPropertyDescriptor(
      window,
      "matchMedia"
    );
    (document as unknown as TestViewTransitionDocument).startViewTransition =
      startViewTransition;

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      get() {
        throw new Error("matchMedia blocked");
      },
    });

    try {
      expect(() => startRouteViewTransition(navigate)).not.toThrow();
      expect(startViewTransition).toHaveBeenCalledWith(expect.any(Function));
      expect(navigate).toHaveBeenCalledTimes(1);
    } finally {
      if (originalMatchMedia) {
        Object.defineProperty(window, "matchMedia", originalMatchMedia);
      } else {
        delete (window as Partial<Pick<Window, "matchMedia">>).matchMedia;
      }
    }
  });

  it("uses document.startViewTransition when available and invokes navigate exactly once", () => {
    const navigate = vi.fn();
    const startViewTransition = vi.fn((callback: () => void | Promise<void>) => {
      callback();
      return {};
    });
    (document as unknown as TestViewTransitionDocument).startViewTransition =
      startViewTransition;

    startRouteViewTransition(navigate);

    expect(startViewTransition).toHaveBeenCalledWith(expect.any(Function));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("keeps the route view transition pending until completion is signaled", async () => {
    const navigate = vi.fn();
    let updateResult: void | Promise<void>;
    const startViewTransition = vi.fn(
      (callback: () => void | Promise<void>) => {
        updateResult = callback();
        return {};
      }
    );
    (document as unknown as TestViewTransitionDocument).startViewTransition =
      startViewTransition;

    startRouteViewTransition(navigate);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(updateResult!).toHaveProperty("then");

    let resolved = false;
    const pending = (updateResult! as Promise<void>).then(() => {
      resolved = true;
    });

    await Promise.resolve();

    expect(resolved).toBe(false);

    completeRouteViewTransition();
    await pending;

    expect(resolved).toBe(true);
  });

  it("falls back if route transition completion is never signaled", async () => {
    vi.useFakeTimers();
    const navigate = vi.fn();
    let updateResult: void | Promise<void>;
    const startViewTransition = vi.fn(
      (callback: () => void | Promise<void>) => {
        updateResult = callback();
        return {};
      }
    );
    (document as unknown as TestViewTransitionDocument).startViewTransition =
      startViewTransition;

    startRouteViewTransition(navigate);

    let resolved = false;
    const pending = (updateResult! as Promise<void>).then(() => {
      resolved = true;
    });

    await Promise.resolve();
    vi.advanceTimersByTime(1199);
    await Promise.resolve();

    expect(resolved).toBe(false);

    vi.advanceTimersByTime(1);
    await pending;

    expect(resolved).toBe(true);
  });

  it("resolves a previous pending route transition before direct fallback navigation", async () => {
    vi.useFakeTimers();
    const firstNavigate = vi.fn();
    let updateResult: void | Promise<void>;
    const startViewTransition = vi.fn(
      (callback: () => void | Promise<void>) => {
        updateResult = callback();
        return {};
      }
    );
    (document as unknown as TestViewTransitionDocument).startViewTransition =
      startViewTransition;

    startRouteViewTransition(firstNavigate);

    let resolved = false;
    const pending = (updateResult! as Promise<void>).then(() => {
      resolved = true;
    });

    await Promise.resolve();

    expect(resolved).toBe(false);

    delete (document as unknown as TestViewTransitionDocument)
      .startViewTransition;

    const secondNavigate = vi.fn();
    startRouteViewTransition(secondNavigate);
    await Promise.resolve();

    expect(resolved).toBe(true);
    expect(secondNavigate).toHaveBeenCalledTimes(1);
    await pending;
  });
});
