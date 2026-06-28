import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { readEnv } from "./env";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClientType;
};

process.env.DATABASE_URL ??= readEnv(process.env).databaseUrl;

const { PrismaClient } = require("@prisma/client") as typeof import("@prisma/client");

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
