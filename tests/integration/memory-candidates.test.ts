import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import {
  confirmMemoryCandidate,
  ignoreMemoryCandidate,
} from "@/lib/memories/actions";
import { ensureTestDatabase } from "./test-db";

type CurrentUser = Awaited<ReturnType<typeof getCurrentUser>>;
const getCurrentUserMock = vi.hoisted(() =>
  vi.fn<() => Promise<CurrentUser | null>>()
);

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, getCurrentUser: getCurrentUserMock };
});

describe("memory candidate actions", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  beforeEach(() => {
    getCurrentUserMock.mockReset();
  });

  it("confirms a candidate into a reusable memory", async () => {
    const { POST } = await import(
      "@app/api/memory-candidates/[candidateId]/confirm/route"
    );
    const user = await prisma.user.create({
      data: {
        email: `confirm-memory-${Date.now()}@example.com`,
        name: "Memory User",
        passwordHash: "hash",
      },
      include: { settings: true },
    });
    const candidate = await prisma.memoryCandidate.create({
      data: {
        userId: user.id,
        kind: "origin",
        label: "常从外事学校出发",
        valueJson: JSON.stringify({
          originName: "外事学校",
          originLngLat: "121.1,29.1",
        }),
      },
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ candidateId: candidate.id }),
    });

    expect(response.status).toBe(200);
    await expect(
      prisma.memory.findFirstOrThrow({
        where: { userId: user.id, label: "常从外事学校出发" },
      })
    ).resolves.toMatchObject({
      kind: "origin",
      label: "常从外事学校出发",
    });
    await expect(
      prisma.memoryCandidate.findUniqueOrThrow({ where: { id: candidate.id } })
    ).resolves.toMatchObject({
      status: "confirmed",
    });
  });

  it("ignores a candidate without creating memory", async () => {
    const { POST } = await import(
      "@app/api/memory-candidates/[candidateId]/ignore/route"
    );
    const user = await prisma.user.create({
      data: {
        email: `ignore-memory-${Date.now()}@example.com`,
        name: "Ignore User",
        passwordHash: "hash",
      },
      include: { settings: true },
    });
    const candidate = await prisma.memoryCandidate.create({
      data: {
        userId: user.id,
        kind: "preference",
        label: "偏好骑行",
        valueJson: JSON.stringify({ mode: "bike" }),
      },
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ candidateId: candidate.id }),
    });

    expect(response.status).toBe(200);
    await expect(
      prisma.memory.count({ where: { userId: user.id, label: "偏好骑行" } })
    ).resolves.toBe(0);
    await expect(
      prisma.memoryCandidate.findUniqueOrThrow({ where: { id: candidate.id } })
    ).resolves.toMatchObject({
      status: "ignored",
    });
  });

  it("rejects confirming an already handled candidate without duplicating memory", async () => {
    const { POST } = await import(
      "@app/api/memory-candidates/[candidateId]/confirm/route"
    );
    const user = await prisma.user.create({
      data: {
        email: `confirm-handled-memory-${Date.now()}@example.com`,
        name: "Handled Confirm User",
        passwordHash: "hash",
      },
      include: { settings: true },
    });
    const candidate = await prisma.memoryCandidate.create({
      data: {
        userId: user.id,
        kind: "origin",
        label: "已确认出发地",
        valueJson: JSON.stringify({ originName: "外事学校" }),
        status: "confirmed",
      },
    });
    await prisma.memory.create({
      data: {
        userId: user.id,
        kind: candidate.kind,
        label: candidate.label,
        valueJson: candidate.valueJson,
      },
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ candidateId: candidate.id }),
    });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toMatchObject({ error: "记忆候选已处理" });
    await expect(
      prisma.memory.count({ where: { userId: user.id, label: candidate.label } })
    ).resolves.toBe(1);
    await expect(
      prisma.memoryCandidate.findUniqueOrThrow({ where: { id: candidate.id } })
    ).resolves.toMatchObject({ status: "confirmed" });
  });

  it("rejects ignoring an already handled candidate without changing status", async () => {
    const { POST } = await import(
      "@app/api/memory-candidates/[candidateId]/ignore/route"
    );
    const user = await prisma.user.create({
      data: {
        email: `ignore-handled-memory-${Date.now()}@example.com`,
        name: "Handled Ignore User",
        passwordHash: "hash",
      },
      include: { settings: true },
    });
    const candidate = await prisma.memoryCandidate.create({
      data: {
        userId: user.id,
        kind: "preference",
        label: "已确认偏好",
        valueJson: JSON.stringify({ routePreference: "balanced" }),
        status: "confirmed",
      },
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ candidateId: candidate.id }),
    });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toMatchObject({ error: "记忆候选已处理" });
    await expect(
      prisma.memoryCandidate.findUniqueOrThrow({ where: { id: candidate.id } })
    ).resolves.toMatchObject({ status: "confirmed" });
  });

  it("returns not found for a missing candidate", async () => {
    const { POST } = await import(
      "@app/api/memory-candidates/[candidateId]/confirm/route"
    );
    const user = await prisma.user.create({
      data: {
        email: `missing-memory-${Date.now()}@example.com`,
        name: "Missing User",
        passwordHash: "hash",
      },
      include: { settings: true },
    });
    getCurrentUserMock.mockResolvedValue(user);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ candidateId: "missing-candidate" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toMatchObject({ error: "未找到记忆候选" });
  });

  it("allows only one concurrent confirm to create memory", async () => {
    const user = await prisma.user.create({
      data: {
        email: `concurrent-confirm-memory-${Date.now()}@example.com`,
        name: "Concurrent Confirm User",
        passwordHash: "hash",
      },
    });
    const candidate = await prisma.memoryCandidate.create({
      data: {
        userId: user.id,
        kind: "origin",
        label: "并发确认出发地",
        valueJson: JSON.stringify({ originName: "外事学校" }),
      },
    });

    const results = await Promise.allSettled([
      confirmMemoryCandidate({ candidateId: candidate.id, userId: user.id }),
      confirmMemoryCandidate({ candidateId: candidate.id, userId: user.id }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(
      prisma.memory.count({ where: { userId: user.id, label: candidate.label } })
    ).resolves.toBe(1);
    await expect(
      prisma.memoryCandidate.findUniqueOrThrow({ where: { id: candidate.id } })
    ).resolves.toMatchObject({ status: "confirmed" });
  });

  it("allows only one concurrent ignore to handle a candidate", async () => {
    const user = await prisma.user.create({
      data: {
        email: `concurrent-ignore-memory-${Date.now()}@example.com`,
        name: "Concurrent Ignore User",
        passwordHash: "hash",
      },
    });
    const candidate = await prisma.memoryCandidate.create({
      data: {
        userId: user.id,
        kind: "preference",
        label: "并发忽略偏好",
        valueJson: JSON.stringify({ mode: "bike" }),
      },
    });

    const results = await Promise.allSettled([
      ignoreMemoryCandidate({ candidateId: candidate.id, userId: user.id }),
      ignoreMemoryCandidate({ candidateId: candidate.id, userId: user.id }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(
      prisma.memory.count({ where: { userId: user.id, label: candidate.label } })
    ).resolves.toBe(0);
    await expect(
      prisma.memoryCandidate.findUniqueOrThrow({ where: { id: candidate.id } })
    ).resolves.toMatchObject({ status: "ignored" });
  });
});
