// Nextcloud Talk tests cover pre-authentication webhook in-flight admission behavior.
import { createConnection, type Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { createNextcloudTalkWebhookServer } from "./monitor.js";
import { createSignedCreateMessageRequest } from "./monitor.test-fixtures.js";

const WEBHOOK_PATH = "/nextcloud-talk-webhook-preauth-inflight";
const IN_FLIGHT_LIMIT = 64;
const PROMISED_BODY_BYTES = 65536;

function openIncompleteWebhookRequest(params: {
  host: string;
  port: number;
  sockets: Socket[];
}): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: params.host, port: params.port });
    params.sockets.push(socket);
    socket.once("error", reject);
    socket.once("connect", () => {
      // Promise a body larger than one TCP segment but send only one byte, so the
      // pre-auth read stays open without completing signature verification.
      socket.write(
        [
          `POST ${WEBHOOK_PATH} HTTP/1.1`,
          `Host: ${params.host}:${params.port}`,
          "Content-Type: application/json",
          `Content-Length: ${PROMISED_BODY_BYTES}`,
          "X-Nextcloud-Talk-Signature: invalid-but-present",
          "X-Nextcloud-Talk-Random: attacker-controlled",
          "X-Nextcloud-Talk-Backend: https://nextcloud.example",
          "Connection: close",
          "",
          "{",
        ].join("\r\n"),
      );
      resolve(socket);
    });
  });
}

function readEntireResponse(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString();
    });
    socket.once("error", reject);
    socket.once("close", () => resolve(data));
  });
}

describe("Nextcloud Talk webhook pre-authentication in-flight limit", () => {
  it("rejects overflow requests while 64 pre-auth body reads are held open, then recovers", async () => {
    const dispatches: string[] = [];
    const { server, start, stop } = createNextcloudTalkWebhookServer({
      host: "127.0.0.1",
      port: 0,
      path: WEBHOOK_PATH,
      secret: "nextcloud-secret", // pragma: allowlist secret
      onWebhook: async (rawBody) => {
        dispatches.push(rawBody);
        return "accepted";
      },
    });
    const sockets: Socket[] = [];
    try {
      let requestCount = 0;
      server.on("request", () => {
        requestCount += 1;
      });
      await start();
      const address = server.address();
      if (!address || typeof address === "string") {
        // SAFETY: a TCP listener on port 0 always reports an AddressInfo.
        throw new Error("expected TCP listener address");
      }
      const host = address.address;
      const port = address.port;

      // Hold the full pre-auth admission budget open with incomplete bodies.
      await Promise.all(
        Array.from({ length: IN_FLIGHT_LIMIT }, () =>
          openIncompleteWebhookRequest({ host, port, sockets }),
        ),
      );
      await vi.waitFor(() => expect(requestCount).toBe(IN_FLIGHT_LIMIT));

      // The next request must be rejected immediately with a close-aware 429
      // instead of pinning another reader until the pre-auth timeout.
      const overflow = await openIncompleteWebhookRequest({ host, port, sockets });
      const overflowResponse = await readEntireResponse(overflow);
      expect(overflowResponse.startsWith("HTTP/1.1 429")).toBe(true);
      expect(overflowResponse.toLowerCase()).toContain("connection: close");
      expect(dispatches).toHaveLength(0);

      // Releasing the held reads must restore admission for legitimate traffic.
      for (const socket of sockets.splice(0)) {
        socket.destroy();
      }
      const { body, headers } = createSignedCreateMessageRequest();
      await vi.waitFor(async () => {
        const response = await fetch(`http://${host}:${port}${WEBHOOK_PATH}`, {
          method: "POST",
          headers,
          body,
        });
        expect(response.status).toBe(200);
      });
      expect(dispatches).toHaveLength(1);
    } finally {
      for (const socket of sockets.splice(0)) {
        socket.destroy();
      }
      await stop();
    }
  }, 30_000);
});
