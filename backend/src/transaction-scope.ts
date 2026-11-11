import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, PrismaClient } from "@prisma/client";

const storage = new AsyncLocalStorage<Prisma.TransactionClient>();
let root: PrismaClient | undefined;

/** The transaction the code runs in, if any. */
export function currentTransaction(): Prisma.TransactionClient | undefined {
  return storage.getStore();
}

/**
 * Runs `work` in one transaction: every query made through an `ambient` client while it runs is a part of it, and a
 * failure drops them all. Inside a transaction it joins that one. Without a database (a test) or on a database that
 * has no transactions (MongoDB) it only runs `work`, and the transaction it gets is `undefined`.
 */
export async function inTransaction<T>(
  work: (transaction: Prisma.TransactionClient | undefined) => Promise<T>,
): Promise<T> {
  const joined = storage.getStore();
  if (joined !== undefined) return work(joined);
  const url = process.env.DATABASE_URL ?? "";
  if (url === "" || /^mongodb/.test(url)) return work(undefined);
  root ??= new PrismaClient();
  return root.$transaction((transaction: Prisma.TransactionClient) => storage.run(transaction, () => work(transaction)), {
    maxWait: 10_000,
    timeout: 60_000,
  });
}

/**
 * The client, answering with the open transaction while there is one. With `models` off only the raw queries and
 * `$transaction` follow it: a client extended to scope its own queries (see tenant-scope.ts) sends those on itself.
 */
export function ambient<T extends object>(client: T, models = true): T {
  return new Proxy(client, {
    get(target, property) {
      const transaction = storage.getStore();
      if (transaction !== undefined) {
        if (property === "$transaction") {
          return (work: unknown) =>
            typeof work === "function" ? work(transaction) : Promise.all(work as unknown[]);
        }
        const raw = typeof property === "string" && property.startsWith("$");
        if ((models || raw) && property in transaction) {
          const value = Reflect.get(transaction, property);
          return typeof value === "function" ? value.bind(transaction) : value;
        }
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
