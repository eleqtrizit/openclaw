import path from "node:path";
import type { WorkboardCard } from "@openclaw/workboard-contract";
import { useAutoCleanupTempDirTracker } from "openclaw/plugin-sdk/test-env";
import { afterEach, describe, expect, it } from "vitest";
import type { PersistedWorkboardCard } from "./persistence-types.js";
import { createWorkboardSqliteStores } from "./sqlite-store.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function card(id: string, updatedAt: number): WorkboardCard {
  return {
    id,
    title: id,
    status: "todo",
    priority: "normal",
    labels: [],
    position: 0,
    createdAt: 1,
    updatedAt,
  };
}

describe.each(["insert", "update"] as const)("SQLite authority-conditioned %s", (operation) => {
  it.each(["matching", "mismatched", "missing", "omitted"] as const)(
    "honors the %s authority row revision before persisting the target",
    async (condition) => {
      const stores = createWorkboardSqliteStores({
        dbPath: path.join(tempDirs.make("workboard-sqlite-authority-"), "workboard.sqlite"),
      });
      try {
        const parent: PersistedWorkboardCard = { version: 1, card: card("authority", 10) };
        const original: PersistedWorkboardCard = { version: 1, card: card("target", 20) };
        if (condition !== "missing") {
          await stores.cards.register(parent.card.id, parent);
        }
        if (operation === "update") {
          await stores.cards.register(original.card.id, original);
        }
        const before = await stores.cards.entries();
        const next: PersistedWorkboardCard = {
          version: 1,
          card: { ...original.card, title: "Updated target", updatedAt: 30 },
        };
        const authority =
          condition === "omitted"
            ? undefined
            : {
                cardId: parent.card.id,
                expectedUpdatedAt: condition === "mismatched" ? 9 : parent.card.updatedAt,
              };
        const write =
          operation === "insert"
            ? stores.cards.registerIfAbsent(next.card.id, next, authority)
            : stores.cards.registerIfUpdatedAt(
                next.card.id,
                next,
                original.card.updatedAt,
                authority,
              );
        if (condition === "matching" || condition === "omitted") {
          await expect(write).resolves.toBe(true);
          await expect(stores.cards.lookup(next.card.id)).resolves.toMatchObject(next);
          await expect(stores.cards.lookup(parent.card.id)).resolves.toMatchObject(parent);
        } else {
          await expect(write).rejects.toThrow("authority changed before persistence");
          await expect(stores.cards.entries()).resolves.toEqual(before);
          if (operation === "insert") {
            await expect(stores.cards.lookup(next.card.id)).resolves.toBeUndefined();
          } else {
            await expect(stores.cards.lookup(next.card.id)).resolves.toMatchObject(original);
          }
        }
      } finally {
        stores.close();
      }
    },
  );
});
