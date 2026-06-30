import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Prisma schema", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const optionalOriginMigration = readFileSync(
    "prisma/migrations/20260628193000_optional_origin_settings/migration.sql",
    "utf8"
  );
  const uniqueTelegramChatIdMigration = readFileSync(
    "prisma/migrations/20260630120000_unique_telegram_chat_id/migration.sql",
    "utf8"
  );

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
      "MemoryCandidate",
    ]) {
      expect(schema).toContain(`model ${model}`);
    }
  });

  it("stores ordered stops and legs for multi-stop itineraries", () => {
    expect(schema).toContain("order                 Int");
    expect(schema).toContain("fromStopId            String?");
    expect(schema).toContain("toStopId              String");
  });

  it("allows each route candidate to own its ordered segment timeline", () => {
    expect(schema).toContain(
      'routeCandidates       RouteCandidate[]   @relation("LegRouteCandidates")'
    );
    expect(schema).toContain(
      'selectedCandidate     RouteCandidate?    @relation("SelectedRouteCandidate", fields: [selectedCandidateId], references: [id], onDelete: SetNull)'
    );
    expect(schema).toContain(
      'leg             TripLeg        @relation("LegRouteCandidates", fields: [legId], references: [id], onDelete: Cascade)'
    );
    expect(schema).toContain(
      'selectedForLegs TripLeg[]      @relation("SelectedRouteCandidate")'
    );
    expect(schema).toContain("@@unique([candidateId, order])");
    expect(schema).toContain("@@index([legId, order])");
    expect(schema).not.toContain("@@unique([legId, order])");
  });

  it("allows user settings to omit a default origin", () => {
    expect(schema).toContain("originName          String?");
    expect(schema).toContain("originLngLat        String?");
    expect(schema).not.toContain('originName          String   @default("家")');

    expect(optionalOriginMigration).toContain('"originName" TEXT,');
    expect(optionalOriginMigration).toContain('"originLngLat" TEXT,');
    expect(optionalOriginMigration).not.toContain('"originName" TEXT NOT NULL');
    expect(optionalOriginMigration).not.toContain('"originLngLat" TEXT NOT NULL');
  });

  it("requires each saved Telegram Chat ID to be bound to only one user", () => {
    expect(schema).toContain("telegramChatId      String?  @unique");
    expect(uniqueTelegramChatIdMigration).toContain(
      'CREATE UNIQUE INDEX "UserSettings_telegramChatId_key" ON "UserSettings"("telegramChatId");'
    );
  });

  it("stores Telegram chat state and bot polling offsets", () => {
    const telegramMigration = readFileSync(
      "prisma/migrations/20260630090000_telegram_agent_entry/migration.sql",
      "utf8"
    );

    for (const model of ["TelegramChatState", "TelegramBotState"]) {
      expect(schema).toContain(`model ${model}`);
    }

    expect(schema).toContain("telegramChatStates TelegramChatState[]");
    expect(schema).toContain("chatId               String   @unique");
    expect(schema).toContain("activeAgentSessionId String?");
    expect(schema).toContain("activeTripId         String?");
    expect(schema).toContain('mode                 String   @default("idle")');
    expect(schema).toContain("lastUpdateId         Int?");

    expect(telegramMigration).toContain('CREATE TABLE "TelegramChatState"');
    expect(telegramMigration).toContain(
      'CREATE UNIQUE INDEX "TelegramChatState_chatId_key"'
    );
    expect(telegramMigration).toContain('CREATE TABLE "TelegramBotState"');
  });
});
