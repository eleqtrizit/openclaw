import path from "node:path";
import { createDeferred } from "openclaw/plugin-sdk/extension-shared";
import { useAutoCleanupTempDirTracker } from "openclaw/plugin-sdk/test-env";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchAndStartWorkboardCards } from "./dispatcher.js";
import { createWorkboardSqliteStores } from "./sqlite-store.js";
import { WorkboardStore } from "./store.js";
import { createWorkboardTools } from "./tools.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function createHarness() {
  const directory = tempDirs.make("workboard-tool-scope-");
  const dbPath = path.join(directory, "workboard.sqlite");
  const local = createWorkboardSqliteStores({ dbPath });
  const remote = createWorkboardSqliteStores({ dbPath });
  return {
    store: new WorkboardStore(local.cards),
    host: new WorkboardStore(remote.cards),
    close() {
      local.close();
      remote.close();
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

describe("Workboard dispatched same-card orchestration scope", () => {
  it("preserves same-card specification for a dispatched worker", async () => {
    const harness = createHarness();
    const { store, host } = harness;
    try {
      const { parent, sessionKey } = await dispatchParent(store, host);
      const tools = createWorkboardTools({
        store,
        context: { agentId: "worker", sessionKey },
      });
      const specify = tools.find((tool) => tool.name === "workboard_specify")!;
      await specify.execute("specify", { id: parent.id, title: "Specified parent" });
      await expect(host.get(parent.id)).resolves.toMatchObject({
        title: "Specified parent",
        status: "todo",
      });
    } finally {
      harness.close();
    }
  });

  it("rejects revoked specification authority without changing the parent", async () => {
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
      const spy = vi.spyOn(store, "specify").mockImplementation(async (...args) => {
        reached.resolve();
        await resume.promise;
        return specify(...args);
      });
      const tool = createWorkboardTools({
        store,
        context: { agentId: "worker", sessionKey },
      }).find((entry) => entry.name === "workboard_specify")!;
      const pending = tool.execute("revoked-operation", {
        id: parent.id,
        title: "Changed parent",
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
  });
});
