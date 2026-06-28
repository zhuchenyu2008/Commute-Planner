import { afterEach, describe, expect, it, vi } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;

describe("db", () => {
  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }

    vi.resetModules();
  });

  it("sets the local SQLite default before Prisma reads DATABASE_URL", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();

    const { prisma } = await import("@/lib/db");

    expect(process.env.DATABASE_URL).toBe("file:./dev.db");
    await prisma.$disconnect();
  });
});
