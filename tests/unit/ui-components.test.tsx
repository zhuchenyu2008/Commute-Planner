import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootLayout from "@app/layout";
import {
  buildAgentEvents,
  getAgentConversationHref,
  getAgentSessionViewState,
} from "@/components/agent/agent-event-list";
import { BottomNav } from "@/components/bottom-nav";
import { getAgentStartResult } from "@/components/home/commute-input";
import { BufferList } from "@/components/trips/buffer-list";
import { RouteTimeline } from "@/components/trips/route-timeline";

describe("sample-aligned UI components", () => {
  it("renders BottomNav labels and navigation aria labels", () => {
    const html = renderToStaticMarkup(<BottomNav active="home" />);

    expect(html).toContain("aria-label=\"Home\"");
    expect(html).toContain("aria-label=\"History\"");
    expect(html).toContain("aria-label=\"Settings\"");
    expect(html).toContain("aria-label=\"Memories\"");
    expect(html).toContain("Home");
    expect(html).toContain("History");
    expect(html).toContain("Settings");
    expect(html).toContain("Memories");
  });

  it("renders buffer items with weather as zero-minute context", () => {
    const html = renderToStaticMarkup(
      <BufferList
        buffers={[
          {
            id: "traffic",
            category: "traffic",
            label: "Traffic cushion",
            minutes: 8,
            reason: "Evening congestion on the ring road",
          },
          {
            id: "weather",
            category: "weather",
            label: "Weather reference",
            minutes: 0,
            reason: "Light rain expected near arrival",
          },
        ]}
      />
    );

    expect(html).toContain("Traffic cushion");
    expect(html).toContain("8 min");
    expect(html).toContain("Weather reference");
    expect(html).toContain("0 min");
    expect(html).toContain("Light rain expected near arrival");
  });

  it("renders route timeline segment titles", () => {
    const html = renderToStaticMarkup(
      <RouteTimeline
        segments={[
          {
            id: "walk",
            mode: "walk",
            title: "Walk to Metro Line 4",
            detail: "Exit B",
            minutes: 5,
          },
          {
            id: "train",
            mode: "transit",
            title: "Metro Line 4",
            detail: "8 stops northbound",
            minutes: 20,
          },
        ]}
      />
    );

    expect(html).toContain("Walk to Metro Line 4");
    expect(html).toContain("Metro Line 4");
  });

  it("renders grouped route timelines for multi-stop trips", () => {
    const html = renderToStaticMarkup(
      <RouteTimeline
        groups={[
          {
            id: "leg-a",
            title: "Home to Stop A",
            subtitle: "Arrive by 08:40",
            segments: [
              {
                id: "metro-a",
                mode: "transit",
                title: "Metro to Stop A",
                detail: "6 stops",
                minutes: 18,
              },
            ],
          },
          {
            id: "leg-b",
            title: "Stop A to Cinema",
            subtitle: "Arrive by 09:15",
            segments: [
              {
                id: "inside-b",
                mode: "destination",
                title: "Walk inside the mall",
                detail: "Enter through Gate 2 and go to level 4",
                minutes: 7,
              },
            ],
          },
        ]}
        segments={[]}
      />
    );

    expect(html).toContain("Home to Stop A");
    expect(html).toContain("Stop A to Cinema");
    expect(html).toContain("Walk inside the mall");
  });

  it("orders agent messages and tool calls chronologically", () => {
    const events = buildAgentEvents({
      messages: [
        {
          id: "assistant-late",
          role: "assistant",
          content: "Selected route",
          createdAt: "2026-06-28T08:03:00.000Z",
        },
      ],
      toolCalls: [
        {
          id: "poi-early",
          name: "searchPoi",
          status: "completed",
          createdAt: "2026-06-28T08:01:00.000Z",
        },
      ],
    });

    expect(events.map((event) => event.title)).toEqual([
      "searchPoi",
      "Agent update",
    ]);
  });

  it("only auto-redirects completed agent sessions when enabled", () => {
    expect(
      getAgentSessionViewState({
        autoRedirect: true,
        session: { status: "completed", tripId: "trip-1" },
      }).redirectTo
    ).toBe("/trips/trip-1");
    expect(
      getAgentSessionViewState({
        autoRedirect: false,
        session: { status: "completed", tripId: "trip-1" },
      }).redirectTo
    ).toBeNull();
  });

  it("builds conversation links that do not auto-redirect completed sessions", () => {
    expect(getAgentConversationHref("session-1")).toBe(
      "/agent/session-1?view=conversation"
    );
  });

  it("marks failed agent sessions as terminal instead of loading", () => {
    const state = getAgentSessionViewState({
      autoRedirect: true,
      session: { status: "failed", tripId: null },
    });

    expect(state.isTerminal).toBe(true);
    expect(state.isLoading).toBe(false);
  });

  it("routes unauthenticated agent starts to login", () => {
    expect(getAgentStartResult(401, {})).toEqual({
      route: "/login",
      error: "",
    });
  });

  it("loads Inter from the root layout", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <main>App</main>
      </RootLayout>
    );

    expect(html).toContain("fonts.googleapis.com");
    expect(html).toContain("family=Inter");
  });
});
