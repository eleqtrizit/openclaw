import { describe, expect, it } from "vitest";
import type { PersistedWorkboardCard, WorkboardKeyedStore } from "./persistence-types.js";
import { workboardSessionKeyForCard } from "./session-link.js";
import { WorkboardStore } from "./store.js";
import { createWorkboardTools } from "./tools.js";

function createMemoryStore<T = PersistedWorkboardCard>(): WorkboardKeyedStore<T> {
  const entries = new Map<string, T>();
  return {
    async register(key, value) {
      entries.set(key, value);
    },
    async lookup(key) {
      return entries.get(key);
    },
    async delete(key) {
      return entries.delete(key);
    },
    async entries() {
      return [...entries].flatMap(([key, value]) => (value ? [{ key, value }] : []));
    },
  };
}

function toolMap(
  store: WorkboardStore,
  context: Parameters<typeof createWorkboardTools>[0]["context"],
) {
  return new Map(createWorkboardTools({ store, context }).map((tool) => [tool.name, tool]));
}

function payload(result: unknown): Record<string, unknown> {
  return (result as { details?: Record<string, unknown> }).details ?? {};
}

describe("dispatched Workboard worker confinement", () => {
  it("rejects unrelated lifecycle targets regardless of claim state or token", async () => {
    const store = new WorkboardStore(createMemoryStore());
    const assigned = await store.create({
      title: "Assigned",
      agentId: "worker",
      boardId: "default",
    });
    const unclaimed = await store.create({ title: "Unclaimed", agentId: "worker" });
    const sameOwner = await store.create({ title: "Same owner", agentId: "worker" });
    const tokenTarget = await store.create({ title: "Token target", agentId: "other" });
    await store.claim(sameOwner.id, { ownerId: "worker", token: "same-owner-token" });
    await store.claim(tokenTarget.id, { ownerId: "other", token: "target-token" });

    const tools = toolMap(store, {
      agentId: "worker",
      sessionKey: workboardSessionKeyForCard(assigned),
    });
    const attempts = [
      { id: unclaimed.id, status: "review" },
      { id: sameOwner.id, status: "review" },
      { id: tokenTarget.id, status: "review", token: "target-token" },
    ];
    for (const [index, attempt] of attempts.entries()) {
      await expect(
        tools.get("workboard_move")?.execute(`cross-card-${index}`, attempt),
      ).rejects.toThrow("only their assigned card");
    }
    await expect(
      tools.get("workboard_claim")?.execute("claim-unrelated", { id: unclaimed.id }),
    ).rejects.toThrow("only their assigned card");
  });

  it("accepts the assigned lifecycle and preserves ordinary operator behavior", async () => {
    const store = new WorkboardStore(createMemoryStore());
    const assigned = await store.create({ title: "Assigned", agentId: "worker", boardId: "ops" });
    const unrelated = await store.create({ title: "Operator target", agentId: "worker" });
    const workerTools = toolMap(store, {
      agentId: "worker",
      sessionKey: workboardSessionKeyForCard(assigned),
    });
    const claimed = payload(
      await workerTools.get("workboard_claim")?.execute("claim-assigned", { id: assigned.id }),
    );
    const token = claimed.token as string;
    await expect(
      workerTools
        .get("workboard_heartbeat")
        ?.execute("heartbeat-assigned", { id: assigned.id, token }),
    ).resolves.toBeDefined();
    await expect(
      workerTools.get("workboard_proof")?.execute("proof-assigned", {
        id: assigned.id,
        token,
        status: "passed",
        note: "confined lifecycle works",
      }),
    ).resolves.toBeDefined();

    const operatorTools = toolMap(store, { agentId: "worker", sessionKey: "agent:worker:main" });
    await expect(
      operatorTools.get("workboard_move")?.execute("operator-cross-card", {
        id: unrelated.id,
        status: "ready",
      }),
    ).resolves.toBeDefined();
  });

  it("uses trusted explicit bindings and permits only derived child creation", async () => {
    const store = new WorkboardStore(createMemoryStore());
    const assigned = await store.create({ title: "Assigned", agentId: "worker" });
    const unrelated = await store.create({ title: "Unrelated", agentId: "worker" });
    const tools = toolMap(store, {
      agentId: "worker",
      sessionKey: "agent:worker:main",
      toolBindings: { workboard: { dispatchedCardId: assigned.id } },
    });

    await expect(
      tools.get("workboard_move")?.execute("forged-target", {
        id: unrelated.id,
        status: "review",
      }),
    ).rejects.toThrow("only their assigned card");
    await expect(
      tools.get("workboard_create")?.execute("unrelated-create", { title: "Detached child" }),
    ).rejects.toThrow("only children explicitly linked");

    const created = payload(
      await tools.get("workboard_create")?.execute("derived-create", {
        title: "Derived child",
        parents: [assigned.id],
        createdByCardId: assigned.id,
      }),
    ).card as { id: string };
    await expect(store.get(created.id)).resolves.toMatchObject({
      metadata: { automation: { createdByCardId: assigned.id } },
    });
  });

  it("preserves decomposition and links only children derived from the assigned card", async () => {
    const store = new WorkboardStore(createMemoryStore());
    const assigned = await store.create({ title: "Assigned", agentId: "worker" });
    const derived = await store.create({
      title: "Derived",
      agentId: "worker",
      createdByCardId: assigned.id,
    });
    const unrelated = await store.create({ title: "Unrelated", agentId: "worker" });
    const tools = toolMap(store, {
      agentId: "worker",
      sessionKey: workboardSessionKeyForCard(assigned),
    });

    await expect(
      tools.get("workboard_link")?.execute("link-derived", {
        parentId: assigned.id,
        childId: derived.id,
      }),
    ).resolves.toBeDefined();
    await expect(
      tools.get("workboard_link")?.execute("link-unrelated", {
        parentId: assigned.id,
        childId: unrelated.id,
      }),
    ).rejects.toThrow("only children derived");

    const result = payload(
      await tools.get("workboard_decompose")?.execute("decompose", {
        id: assigned.id,
        completeParent: false,
        children: [{ title: "Decomposed child" }],
      }),
    );
    expect(result.children).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          automation: expect.objectContaining({ createdByCardId: assigned.id }),
        }),
      }),
    ]);
  });

  it("rejects board-wide mutations while preserving read access", async () => {
    const store = new WorkboardStore(createMemoryStore());
    const assigned = await store.create({ title: "Assigned", agentId: "worker" });
    const tools = toolMap(store, {
      agentId: "worker",
      sessionKey: workboardSessionKeyForCard(assigned),
    });

    await expect(
      tools.get("workboard_read")?.execute("read", { id: assigned.id }),
    ).resolves.toBeDefined();
    await expect(tools.get("workboard_dispatch")?.execute("dispatch", {})).rejects.toThrow(
      "cannot run board-wide mutation",
    );
  });
});
