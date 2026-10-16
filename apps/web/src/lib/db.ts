import { PrismaClient } from "@prisma/client";

// One client per server process. In dev, hot reload would otherwise open a new
// pool on every edit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;
