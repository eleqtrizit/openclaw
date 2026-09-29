// The owning dispatch suite supplies the scoped session-store mocks this fixture needs.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { normalizeSessionDeliveryState } from "../../utils/delivery-context.shared.js";
import type { MsgContext } from "../templating.js";
import type { ReplyPayload } from "../types.js";
import {
  createDispatcher,
  emptyConfig,
  mocks,
  replyMediaPathMocks,
  sessionStoreMocks,
} from "./dispatch-from-config.shared.test-harness.js";
import {
  describe0BeforeEach0,
  dispatchReplyFromConfig,
  firstRouteReplyCall,
  globalBeforeAll0,
  installThreadingTestPlugin,
  setNoAbort,
} from "./dispatch-from-config.test-harness.js";
import type { InternalGetReplyOptions } from "./get-reply.types.js";
import { buildTestCtx } from "./test-ctx.js";

beforeAll(globalBeforeAll0);

describe("reply media delivery ownership", () => {
  beforeEach(describe0BeforeEach0);

  it.each(["internal", "explicit", "inherited"] as const)(
    "keeps media staging with the actual %s reply owner",
    async (route) => {
      setNoAbort();
      mocks.routeReply.mockClear();
      installThreadingTestPlugin({ id: "imessage" });
      const dispatcher = createDispatcher();
      const original = "/workspace/chart.png";
      const staged = "/managed/chart.png";
      replyMediaPathMocks.createReplyMediaPathNormalizer.mockReturnValue(
        async (payload: ReplyPayload) => ({ ...payload, mediaUrls: [staged] }),
      );
      if (route === "inherited") {
        sessionStoreMocks.currentEntry = {
          sessionId: "media-owner",
          updatedAt: 1,
          delivery: normalizeSessionDeliveryState({
            context: { channel: "imessage", to: "imessage:+15550001111" },
          }),
        };
      }
      const ctx = buildTestCtx({
        SessionKey: "agent:main:media-owner",
        Provider: "webchat",
        Surface: "webchat",
        OriginatingChannel: route === "inherited" ? undefined : "imessage",
        OriginatingTo: route === "inherited" ? undefined : "imessage:+15550001111",
        ExplicitDeliverRoute: route === "explicit",
        ...(route === "inherited"
          ? {
              InputProvenance: {
                kind: "inter_session" as const,
                sourceTool: "sessions_send",
                sourceSessionKey: "agent:main:source",
              },
            }
          : {}),
      });
      const replyResolver = async (_ctx: MsgContext, opts?: InternalGetReplyOptions) => {
        expect(opts?.mediaNormalizationOwner).toBe(route === "internal" ? "gateway" : undefined);
        return { text: "hi", mediaUrls: [original] };
      };
      await dispatchReplyFromConfig({
        ctx,
        cfg: emptyConfig,
        dispatcher,
        replyResolver,
        replyOptions: { mediaNormalizationOwner: "gateway" },
      });
      if (route === "internal") {
        expect(mocks.routeReply).not.toHaveBeenCalled();
        expect(dispatcher.sendFinalReply).toHaveBeenCalledWith(
          expect.objectContaining({ mediaUrls: [original] }),
        );
      } else {
        expect(dispatcher.sendFinalReply).not.toHaveBeenCalled();
        expect(firstRouteReplyCall()).toMatchObject({
          channel: "imessage",
          to: "imessage:+15550001111",
          payload: { mediaUrls: [staged] },
        });
      }
    },
  );

  it("fails closed when the current session authority row disappears", async () => {
    setNoAbort();
    installThreadingTestPlugin({ id: "imessage" });
    const dispatcher = createDispatcher();
    sessionStoreMocks.currentEntry = {
      sessionId: "media-policy-missing",
      updatedAt: 1,
      permissionMode: "full",
      sessionRoot: "/workspace/session",
    };
    replyMediaPathMocks.createReplyMediaPathNormalizer.mockImplementation((options) => {
      const mediaOptions = options as { allowHostWorkspace?: boolean };
      return async (payload: ReplyPayload) =>
        mediaOptions.allowHostWorkspace === false ? { ...payload, mediaUrls: undefined } : payload;
    });
    const ctx = buildTestCtx({
      SessionKey: "agent:main:media-policy-missing",
      Provider: "webchat",
      Surface: "webchat",
      OriginatingChannel: "imessage",
      OriginatingTo: "imessage:+15550001111",
      ExplicitDeliverRoute: true,
    });

    await dispatchReplyFromConfig({
      ctx,
      cfg: emptyConfig,
      dispatcher,
      replyResolver: async () => {
        sessionStoreMocks.currentEntry = undefined;
        return { text: "updated", mediaUrls: ["/workspace/private.pdf"] };
      },
      replyOptions: { mediaNormalizationOwner: "gateway" },
    });

    expect(replyMediaPathMocks.createReplyMediaPathNormalizer).toHaveBeenCalledWith(
      expect.objectContaining({ allowHostWorkspace: false }),
    );
    expect(firstRouteReplyCall()).toMatchObject({ payload: { mediaUrls: undefined } });
  });

  it("uses the current restricted session policy for delivery-stage media", async () => {
    setNoAbort();
    installThreadingTestPlugin({ id: "imessage" });
    const dispatcher = createDispatcher();
    const sessionRoot = "/workspace/restricted-session";
    sessionStoreMocks.currentEntry = {
      sessionId: "media-policy",
      updatedAt: 1,
      permissionMode: "full",
      sessionRoot,
    };
    replyMediaPathMocks.createReplyMediaPathNormalizer.mockReturnValue(
      async (payload: ReplyPayload) => payload,
    );
    const ctx = buildTestCtx({
      SessionKey: "agent:main:media-policy",
      Provider: "webchat",
      Surface: "webchat",
      OriginatingChannel: "imessage",
      OriginatingTo: "imessage:+15550001111",
      ExplicitDeliverRoute: true,
    });

    await dispatchReplyFromConfig({
      ctx,
      cfg: emptyConfig,
      dispatcher,
      replyResolver: async () => {
        sessionStoreMocks.currentEntry = {
          ...sessionStoreMocks.currentEntry,
          permissionMode: "workspace",
        };
        return { text: "updated", mediaUrls: ["/outside/report.pdf"] };
      },
      replyOptions: { mediaNormalizationOwner: "gateway" },
    });

    expect(replyMediaPathMocks.createReplyMediaPathNormalizer).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionWorkspaceDir: sessionRoot,
        workspaceOnly: true,
      }),
    );
  });
});
