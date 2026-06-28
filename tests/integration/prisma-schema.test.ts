import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Prisma schema", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");

  it("models the Agent-centered multi-stop trip graph", () => {
    for (const model of [
      "User",
      "Session",
      "UserSettings",
      "AgentSession",
      "AgentMessage",
      "AgentToolCall",
      "Trip",
      "TripStop",
      "TripLeg",
      "RouteCandidate",
      "RouteSegment",
      "BufferComponent",
      "ReminderJob",
      "RecalculationLog",
      "NotificationLog",
      "Memory",
      "MemoryCandidate"
    ]) {
      expect(schema).toContain(`model ${model}`);
    }
  });

  it("stores ordered stops and legs for multi-stop itineraries", () => {
    expect(schema).toContain("order           Int");
    expect(schema).toContain("fromStopId      String?");
    expect(schema).toContain("toStopId        String");
  });

  it("allows each route candidate to own its ordered segment timeline", () => {
    expect(schema).toContain('routeCandidates       RouteCandidate[]   @relation("LegRouteCandidates")');
    expect(schema).toContain('selectedCandidate     RouteCandidate?    @relation("SelectedRouteCandidate", fields: [selectedCandidateId], references: [id], onDelete: SetNull)');
    expect(schema).toContain('leg             TripLeg        @relation("LegRouteCandidates", fields: [legId], references: [id], onDelete: Cascade)');
    expect(schema).toContain('selectedForLegs TripLeg[]      @relation("SelectedRouteCandidate")');
    expect(schema).toContain("@@unique([candidateId, order])");
    expect(schema).toContain("@@index([legId, order])");
    expect(schema).not.toContain("@@unique([legId, order])");
  });
});
