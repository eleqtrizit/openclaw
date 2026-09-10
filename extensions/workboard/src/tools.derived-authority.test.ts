import path from "node:path";
import { useAutoCleanupTempDirTracker } from "openclaw/plugin-sdk/test-env";
import { afterEach, describe, expect, it } from "vitest";
import { dispatchAndStartWorkboardCards } from "./dispatcher.js";
import { createWorkboardSqliteStores } from "./sqlite-store.js";
import { WorkboardStore } from "./store.js";
import { createWorkboardTools } from "./tools.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

describe("dispatched Workboard derived-child compatibility", () => {
  it.each(["create", "link", "decompose"] as const)(
    "persists authorized %s through the dispatched tool and SQLite",
    async (operation) => {
      const dbPath = path.join(tempDirs.make("workboard-derived-authority-"), "workboard.sqlite");
      const local = createWorkboardSqliteStores({ dbPath });
      const observer = createWorkboardSqliteStores({ dbPath });
      const store = new WorkboardStore(local.cards);
      const observed = new WorkboardStore(observer.cards);
      try {
        const parent = await store.create({
          title: "Assigned orchestration parent",
          status: "ready",
          agentId: "worker",
          workspaceAccess: { unrestricted: true },
        });
        const existingChild =
          operation === "link"
            ? await store.create({ title: "Derived child", createdByCardId: parent.id })
            : undefined;
        let sessionKey = "";
        await dispatchAndStartWorkboardCards({
          store,
          subagent: {
            run: async (input) => {
              sessionKey = input.sessionKey;
              return { runId: "derived-authority-run", sessionKey };
            },
          },
          options: { cardId: parent.id, now: 10, maxStarts: 1 },
        });
        expect(sessionKey).toContain(`subagent:workboard-default-${parent.id}`);
        const tool = createWorkboardTools({
          store,
          context: { agentId: "worker", sessionKey },
        }).find((entry) => entry.name === `workboard_${operation}`)!;
        await tool.execute(
          "allowed-derived-operation",
          operation === "create"
            ? { title: "Derived child", parents: [parent.id], createdByCardId: parent.id }
            : operation === "link"
              ? { parentId: parent.id, childId: existingChild!.id }
              : { id: parent.id, children: [{ title: "Derived child" }] },
        );
        const cards = await observed.list();
        expect(cards).toHaveLength(2);
        const child = cards.find((card) => card.id !== parent.id)!;
        expect(child).toMatchObject({
          title: "Derived child",
          metadata: { automation: { createdByCardId: parent.id } },
        });
        expect(child.metadata?.links).toContainEqual(
          expect.objectContaining({ type: "parent", targetCardId: parent.id }),
        );
        const persistedParent = await observed.get(parent.id);
        expect(persistedParent?.metadata?.links).toContainEqual(
          expect.objectContaining({ type: "child", targetCardId: child.id }),
        );
        if (operation === "decompose") {
          expect(persistedParent?.status).toBe("done");
        }
      } finally {
        local.close();
        observer.close();
      }
    },
  );
});
