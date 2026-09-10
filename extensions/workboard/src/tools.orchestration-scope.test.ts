import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDeferred } from "openclaw/plugin-sdk/extension-shared";
import { describe, expect, it, vi } from "vitest";
import { dispatchAndStartWorkboardCards } from "./dispatcher.js";
import { createWorkboardSqliteStores } from "./sqlite-store.js";
import { WorkboardStore } from "./store.js";
import { createWorkboardTools } from "./tools.js";

function createHarness() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workboard-tool-scope-"));
  const dbPath = path.join(directory, "workboard.sqlite");
  const local = createWorkboardSqliteStores({ dbPath });
  const remote = createWorkboardSqliteStores({ dbPath });
  return {
    store: new WorkboardStore(local.cards),
    host: new WorkboardStore(remote.cards),
    close() {
      local.close();
      remote.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function dispatchParent(store: WorkboardStore, host: WorkboardStore) {
  const parent = await store.create({
    title: "Assigned parent",
    status: "ready",
    agentId: "worker",
    workspaceAccess: { unrestricted: true },
  });
  let sessionKey = "";
  await dispatchAndStartWorkboardCards({
    store,
    subagent: {
      run: async (input) => {
        sessionKey = input.sessionKey;
        return { runId: "orchestration-scope-run", sessionKey };
      },
    },
    options: { cardId: parent.id, now: 10, maxStarts: 1 },
  });
  expect(sessionKey).toContain(`subagent:workboard-default-${parent.id}`);
  await host.update(parent.id, { status: "todo" });
  return { parent, sessionKey };
}

describe("Workboard orchestration tool persistence authority", () => {
  it.each(["worker", "operator"] as const)(
    "preserves allowed specification and decomposition for an ordinary %s",
    async (actor) => {
      const harness = createHarness();
      const { store, host } = harness;
      try {
        const { parent, sessionKey } = await dispatchParent(store, host);
        const tools = createWorkboardTools({
          store,
          context: {
            agentId: "worker",
            sessionKey: actor === "worker" ? sessionKey : "agent:worker:main",
          },
        });
        const specify = tools.find((tool) => tool.name === "workboard_specify")!;
        const decompose = tools.find((tool) => tool.name === "workboard_decompose")!;
        await specify.execute("specify", { id: parent.id, title: "Specified parent" });
        await expect(host.get(parent.id)).resolves.toMatchObject({
          title: "Specified parent",
          status: "todo",
        });
        await decompose.execute("decompose", {
          id: parent.id,
          completeParent: false,
          children: [{ title: "Derived child" }],
        });
        const cards = await host.list();
        expect(cards).toHaveLength(2);
        expect(cards.find((card) => card.id !== parent.id)).toMatchObject({
          title: "Derived child",
          metadata: { automation: { createdByCardId: parent.id } },
        });
        expect((await host.get(parent.id))?.metadata?.links).toContainEqual(
          expect.objectContaining({
            type: "child",
            targetCardId: cards.find((card) => card.id !== parent.id)?.id,
          }),
        );
      } finally {
        harness.close();
      }
    },
  );

  it.each(["specify", "decompose"] as const)(
    "rejects revoked %s authority at persistence without changing parent or children",
    async (operation) => {
      const harness = createHarness();
      const { store, host } = harness;
      const reached = createDeferred<void>();
      const resume = createDeferred<void>();
      try {
        const { parent, sessionKey } = await dispatchParent(store, host);
        await store.create({
          title: "Existing child",
          parents: [parent.id],
          createdByCardId: parent.id,
        });
        // Pause after tool authorization but before the real store entrypoint. The
        // second SQLite connection revokes the assignment before any operation write.
        const specify = store.specify.bind(store);
        const decompose = store.decompose.bind(store);
        const spy =
          operation === "specify"
            ? vi.spyOn(store, "specify").mockImplementation(async (...args) => {
                reached.resolve();
                await resume.promise;
                return specify(...args);
              })
            : vi.spyOn(store, "decompose").mockImplementation(async (...args) => {
                reached.resolve();
                await resume.promise;
                return decompose(...args);
              });
        const tool = createWorkboardTools({
          store,
          context: { agentId: "worker", sessionKey },
        }).find((entry) => entry.name === `workboard_${operation}`)!;
        const pending = tool.execute("revoked-operation", {
          id: parent.id,
          ...(operation === "specify"
            ? { title: "Changed parent" }
            : { children: [{ title: "New child" }], completeParent: false }),
        });
        const rejected = expect(pending).rejects.toThrow("no longer assigned");
        await reached.promise;
        await host.update(parent.id, { sessionKey: "agent:worker:subagent:replacement" });
        const before = await host.list();
        resume.resolve();
        await rejected;
        await expect(host.list()).resolves.toEqual(before);
        spy.mockRestore();
      } finally {
        resume.resolve();
        harness.close();
      }
    },
  );
});
