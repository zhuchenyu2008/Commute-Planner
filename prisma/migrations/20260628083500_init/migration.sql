-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "defaultCity" TEXT NOT NULL DEFAULT '宁波',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "originName" TEXT NOT NULL DEFAULT '家',
    "originLngLat" TEXT NOT NULL,
    "routePreference" TEXT NOT NULL DEFAULT 'balanced',
    "telegramChatId" TEXT,
    "emailRecipient" TEXT,
    "reminderCadenceJson" TEXT NOT NULL DEFAULT '[30,20,15,10,5,0]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tripId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "purpose" TEXT NOT NULL DEFAULT 'planning',
    "prompt" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "timeoutMs" INTEGER NOT NULL DEFAULT 600000,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentSession_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentSessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentMessage_agentSessionId_fkey" FOREIGN KEY ("agentSessionId") REFERENCES "AgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentToolCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentSessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requestJson" TEXT NOT NULL,
    "responseJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "durationMs" INTEGER,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentToolCall_agentSessionId_fkey" FOREIGN KEY ("agentSessionId") REFERENCES "AgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "agentSessionId" TEXT,
    "title" TEXT NOT NULL,
    "rawPrompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "timezone" TEXT NOT NULL,
    "targetArriveAt" DATETIME,
    "finalStopName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Trip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TripStop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "lngLat" TEXT,
    "targetArriveAt" DATETIME,
    "plannedStayMin" INTEGER,
    "kind" TEXT NOT NULL DEFAULT 'destination',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TripStop_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TripLeg" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "fromStopId" TEXT,
    "toStopId" TEXT NOT NULL,
    "originName" TEXT NOT NULL,
    "originLngLat" TEXT NOT NULL,
    "destinationName" TEXT NOT NULL,
    "destinationLngLat" TEXT,
    "targetArriveAt" DATETIME,
    "latestDepartAt" DATETIME,
    "selectedCandidateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TripLeg_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TripLeg_fromStopId_fkey" FOREIGN KEY ("fromStopId") REFERENCES "TripStop" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TripLeg_toStopId_fkey" FOREIGN KEY ("toStopId") REFERENCES "TripStop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TripLeg_selectedCandidateId_fkey" FOREIGN KEY ("selectedCandidateId") REFERENCES "RouteCandidate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RouteCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "legId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "routeMinutes" INTEGER NOT NULL,
    "bufferMinutes" INTEGER NOT NULL,
    "totalMinutes" INTEGER NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "rationale" TEXT NOT NULL,
    "sourceJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RouteCandidate_legId_fkey" FOREIGN KEY ("legId") REFERENCES "TripLeg" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RouteSegment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "legId" TEXT NOT NULL,
    "candidateId" TEXT,
    "order" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "minutes" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'agent',
    "rawJson" TEXT,
    CONSTRAINT "RouteSegment_legId_fkey" FOREIGN KEY ("legId") REFERENCES "TripLeg" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RouteSegment_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "RouteCandidate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BufferComponent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "legId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'agent_inference',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BufferComponent_legId_fkey" FOREIGN KEY ("legId") REFERENCES "TripLeg" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReminderJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripId" TEXT NOT NULL,
    "legId" TEXT,
    "kind" TEXT NOT NULL,
    "scheduledFor" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "lockedAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "dedupeKey" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReminderJob_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReminderJob_legId_fkey" FOREIGN KEY ("legId") REFERENCES "TripLeg" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecalculationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripId" TEXT NOT NULL,
    "legId" TEXT,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecalculationLog_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecalculationLog_legId_fkey" FOREIGN KEY ("legId") REFERENCES "TripLeg" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripId" TEXT NOT NULL,
    "legId" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recipient" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationLog_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NotificationLog_legId_fkey" FOREIGN KEY ("legId") REFERENCES "TripLeg" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,
    "confirmedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Memory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MemoryCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "AgentSession_userId_idx" ON "AgentSession"("userId");

-- CreateIndex
CREATE INDEX "AgentSession_tripId_idx" ON "AgentSession"("tripId");

-- CreateIndex
CREATE INDEX "AgentSession_status_idx" ON "AgentSession"("status");

-- CreateIndex
CREATE INDEX "AgentMessage_agentSessionId_idx" ON "AgentMessage"("agentSessionId");

-- CreateIndex
CREATE INDEX "AgentMessage_createdAt_idx" ON "AgentMessage"("createdAt");

-- CreateIndex
CREATE INDEX "AgentToolCall_agentSessionId_idx" ON "AgentToolCall"("agentSessionId");

-- CreateIndex
CREATE INDEX "AgentToolCall_status_idx" ON "AgentToolCall"("status");

-- CreateIndex
CREATE INDEX "Trip_userId_idx" ON "Trip"("userId");

-- CreateIndex
CREATE INDEX "Trip_status_idx" ON "Trip"("status");

-- CreateIndex
CREATE INDEX "Trip_targetArriveAt_idx" ON "Trip"("targetArriveAt");

-- CreateIndex
CREATE INDEX "TripStop_tripId_idx" ON "TripStop"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "TripStop_tripId_order_key" ON "TripStop"("tripId", "order");

-- CreateIndex
CREATE INDEX "TripLeg_tripId_idx" ON "TripLeg"("tripId");

-- CreateIndex
CREATE INDEX "TripLeg_fromStopId_idx" ON "TripLeg"("fromStopId");

-- CreateIndex
CREATE INDEX "TripLeg_toStopId_idx" ON "TripLeg"("toStopId");

-- CreateIndex
CREATE INDEX "TripLeg_selectedCandidateId_idx" ON "TripLeg"("selectedCandidateId");

-- CreateIndex
CREATE UNIQUE INDEX "TripLeg_tripId_order_key" ON "TripLeg"("tripId", "order");

-- CreateIndex
CREATE INDEX "RouteCandidate_legId_idx" ON "RouteCandidate"("legId");

-- CreateIndex
CREATE INDEX "RouteCandidate_mode_idx" ON "RouteCandidate"("mode");

-- CreateIndex
CREATE INDEX "RouteCandidate_selected_idx" ON "RouteCandidate"("selected");

-- CreateIndex
CREATE INDEX "RouteSegment_legId_order_idx" ON "RouteSegment"("legId", "order");

-- CreateIndex
CREATE INDEX "RouteSegment_candidateId_idx" ON "RouteSegment"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "RouteSegment_candidateId_order_key" ON "RouteSegment"("candidateId", "order");

-- CreateIndex
CREATE INDEX "BufferComponent_legId_idx" ON "BufferComponent"("legId");

-- CreateIndex
CREATE INDEX "BufferComponent_category_idx" ON "BufferComponent"("category");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderJob_dedupeKey_key" ON "ReminderJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "ReminderJob_tripId_idx" ON "ReminderJob"("tripId");

-- CreateIndex
CREATE INDEX "ReminderJob_legId_idx" ON "ReminderJob"("legId");

-- CreateIndex
CREATE INDEX "ReminderJob_status_scheduledFor_idx" ON "ReminderJob"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "RecalculationLog_tripId_idx" ON "RecalculationLog"("tripId");

-- CreateIndex
CREATE INDEX "RecalculationLog_legId_idx" ON "RecalculationLog"("legId");

-- CreateIndex
CREATE INDEX "RecalculationLog_createdAt_idx" ON "RecalculationLog"("createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_tripId_idx" ON "NotificationLog"("tripId");

-- CreateIndex
CREATE INDEX "NotificationLog_legId_idx" ON "NotificationLog"("legId");

-- CreateIndex
CREATE INDEX "NotificationLog_channel_idx" ON "NotificationLog"("channel");

-- CreateIndex
CREATE INDEX "NotificationLog_status_idx" ON "NotificationLog"("status");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_dedupeKey_key" ON "NotificationLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "Memory_userId_idx" ON "Memory"("userId");

-- CreateIndex
CREATE INDEX "Memory_kind_idx" ON "Memory"("kind");

-- CreateIndex
CREATE INDEX "MemoryCandidate_userId_idx" ON "MemoryCandidate"("userId");

-- CreateIndex
CREATE INDEX "MemoryCandidate_status_idx" ON "MemoryCandidate"("status");
