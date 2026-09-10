import type { WorkboardCard } from "@openclaw/workboard-contract";
import { createDeferred } from "openclaw/plugin-sdk/extension-shared";
import { describe, expect, it, vi } from "vitest";
import { dispatchAndStartWorkboardCards } from "./dispatcher.js";
import type { PersistedWorkboardCard, WorkboardKeyedStore } from "./persistence-types.js";
import { workboardSessionKeyForCard } from "./session-link.js";
import { WorkboardStore } from "./store.js";
import { createWorkboardTools } from "./tools.js";

function createMemoryStore<T = PersistedWorkboardCard>(options?: {
  beforeRegister?: () => Promise<void>;
}): WorkboardKeyedStore<T> {
  const entries = new Map<string, T>();
  return {
    async register(key, value) {
      await options?.beforeRegister?.();
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

async function linkDispatchedCard(store: WorkboardStore, card: WorkboardCard) {
  return await store.update(card.id, { sessionKey: workboardSessionKeyForCard(card) });
}

describe("dispatched Workboard worker confinement", () => {
  it("rejects unrelated lifecycle targets regardless of claim state or token", async () => {
    const store = new WorkboardStore(createMemoryStore());
    const assigned = await linkDispatchedCard(
      store,
      await store.create({ title: "Assigned", agentId: "worker", boardId: "default" }),
    );
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
    const assigned = await linkDispatchedCard(
      store,
      await store.create({ title: "Assigned", agentId: "worker", boardId: "ops" }),
    );
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

  it("uses trusted explicit bindings and rejects card creation", async () => {
    const store = new WorkboardStore(createMemoryStore());
    const assigned = await linkDispatchedCard(
      store,
      await store.create({ title: "Assigned", agentId: "worker" }),
    );
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
    ).rejects.toThrow("cannot create, link, decompose");
    await expect(
      tools.get("workboard_create")?.execute("derived-create", {
        title: "Derived child",
        parents: [assigned.id],
        createdByCardId: assigned.id,
      }),
    ).rejects.toThrow("cannot create, link, decompose");
  });

  it("rejects unrelated claimed-only lifecycle targets without side effects", async () => {
    const store = new WorkboardStore(createMemoryStore());
    const assigned = await linkDispatchedCard(
      store,
      await store.create({ title: "Assigned", agentId: "worker" }),
    );
    const completeTarget = await store.create({ title: "Complete target", agentId: "worker" });
    const blockTarget = await store.create({ title: "Block target", agentId: "worker" });
    const violationTarget = await store.create({ title: "Violation target", agentId: "worker" });
    const targets = [completeTarget, blockTarget, violationTarget];
    const tokens = ["complete-token", "block-token", "violation-token"];
    for (const [index, target] of targets.entries()) {
      await store.claim(target.id, { ownerId: "worker", token: tokens[index] });
    }
    const before = await Promise.all(targets.map((target) => store.get(target.id)));
    const tools = toolMap(store, {
      agentId: "worker",
      sessionKey: workboardSessionKeyForCard(assigned),
    });

    await expect(
      tools.get("workboard_complete")?.execute("complete-unrelated", {
        id: completeTarget.id,
        token: tokens[0],
        summary: "Should not complete.",
      }),
    ).rejects.toThrow("only their assigned card");
    await expect(
      tools.get("workboard_block")?.execute("block-unrelated", {
        id: blockTarget.id,
        token: tokens[1],
        reason: "Should not block.",
      }),
    ).rejects.toThrow("only their assigned card");
    await expect(
      tools.get("workboard_protocol_violation")?.execute("violate-unrelated", {
        id: violationTarget.id,
        token: tokens[2],
        detail: "Should not record.",
      }),
    ).rejects.toThrow("only their assigned card");

    for (const [index, target] of targets.entries()) {
      await expect(store.get(target.id)).resolves.toEqual(before[index]);
    }
  });

  it("rejects derived creation without side effects", async () => {
    const store = new WorkboardStore(createMemoryStore());
    const assigned = await linkDispatchedCard(
      store,
      await store.create({ title: "Assigned", agentId: "worker" }),
    );
    const unrelated = await store.create({ title: "Unrelated", agentId: "worker" });
    const tools = toolMap(store, {
      agentId: "worker",
      sessionKey: workboardSessionKeyForCard(assigned),
    });
    const before = await store.list({});
    const assignedBefore = await store.get(assigned.id);
    const unrelatedBefore = await store.get(unrelated.id);

    await expect(
      tools.get("workboard_create")?.execute("multi-parent-create", {
        title: "Illegitimate child",
        createdByCardId: assigned.id,
        parents: [assigned.id, unrelated.id],
      }),
    ).rejects.toThrow("cannot create, link, decompose");

    await expect(store.list({})).resolves.toHaveLength(before.length);
    await expect(store.get(assigned.id)).resolves.toEqual(assignedBefore);
    await expect(store.get(unrelated.id)).resolves.toEqual(unrelatedBefore);
  });

  it("rejects link and decomposition without side effects", async () => {
    const store = new WorkboardStore(createMemoryStore());
    const assigned = await linkDispatchedCard(
      store,
      await store.create({ title: "Assigned", agentId: "worker" }),
    );
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

    const before = await store.list({});
    await expect(
      tools.get("workboard_link")?.execute("link-derived", {
        parentId: assigned.id,
        childId: derived.id,
      }),
    ).rejects.toThrow("cannot create, link, decompose");

    await expect(
      tools.get("workboard_decompose")?.execute("decompose", {
        id: assigned.id,
        completeParent: false,
        children: [{ title: "Decomposed child" }],
      }),
    ).rejects.toThrow("cannot create, link, decompose");

    await expect(store.list({})).resolves.toEqual(before);
    await expect(store.get(unrelated.id)).resolves.toEqual(unrelated);
  });

  it("rejects board-wide mutations while preserving read access", async () => {
    const store = new WorkboardStore(createMemoryStore());
    const assigned = await linkDispatchedCard(
      store,
      await store.create({ title: "Assigned", agentId: "worker" }),
    );
    const tools = toolMap(store, {
      agentId: "worker",
      sessionKey: workboardSessionKeyForCard(assigned),
    });

    await expect(
      tools.get("workboard_read")?.execute("read", { id: assigned.id }),
    ).resolves.toBeDefined();
    await expect(tools.get("workboard_dispatch")?.execute("dispatch", {})).rejects.toThrow(
      "board-wide mutation operations",
    );
  });

  it("carries dispatcher-owned identity to tools and revalidates it at queued persistence", async () => {
    const paused = createDeferred<void>();
    const resume = createDeferred<void>();
    let pauseNextRegister = false;
    const persistence = createMemoryStore({
      beforeRegister: async () => {
        if (!pauseNextRegister) {
          return;
        }
        pauseNextRegister = false;
        paused.resolve();
        await resume.promise;
      },
    });
    const store = new WorkboardStore(persistence);
    const host = new WorkboardStore(persistence);
    const assigned = await store.create({
      title: "Assigned",
      agentId: "worker",
      status: "ready",
      workspaceAccess: { unrestricted: true },
    });
    const unrelated = await store.create({ title: "Unrelated", agentId: "worker" });
    const gate = await store.create({ title: "Queue gate" });
    let workerSessionKey = "";
    const run = vi.fn().mockImplementation(async (input: { sessionKey: string }) => {
      workerSessionKey = input.sessionKey;
      return { runId: "run-authority-proof", sessionKey: input.sessionKey };
    });

    await dispatchAndStartWorkboardCards({
      store,
      subagent: { run },
      options: { cardId: assigned.id, now: 10, maxStarts: 1 },
    });
    expect(workerSessionKey).toContain(`subagent:workboard-default-${assigned.id}`);
    const claimedAssigned = await store.get(assigned.id);
    const assignedToken = claimedAssigned?.metadata?.claim?.token;
    expect(assignedToken).toEqual(expect.any(String));
    const workerTools = toolMap(store, { agentId: "worker", sessionKey: workerSessionKey });
    await expect(
      workerTools.get("workboard_heartbeat")?.execute("assigned-heartbeat", {
        id: assigned.id,
        token: assignedToken,
      }),
    ).resolves.toBeDefined();

    const operatorTools = toolMap(store, { agentId: "worker", sessionKey: "agent:worker:main" });
    await expect(
      operatorTools.get("workboard_move")?.execute("operator-recovery", {
        id: unrelated.id,
        status: "ready",
      }),
    ).resolves.toBeDefined();

    pauseNextRegister = true;
    const gateMutation = store.update(gate.id, { notes: "Hold the mutation queue." });
    await paused.promise;
    const queuedHeartbeat = workerTools.get("workboard_heartbeat")?.execute("queued-heartbeat", {
      id: assigned.id,
      token: assignedToken,
    });
    await Promise.resolve();
    await host.update(assigned.id, {
      sessionKey: "agent:worker:subagent:workboard-default-reassigned",
    });
    const reassigned = await host.get(assigned.id);
    resume.resolve();
    await gateMutation;
    await expect(queuedHeartbeat).rejects.toThrow("no longer assigned");
    await expect(host.get(assigned.id)).resolves.toEqual(reassigned);
  });
});
