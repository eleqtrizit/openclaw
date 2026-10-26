import { parentPort } from "node:worker_threads";
import {
  getActiveRemoteModelCatalog,
  getRemoteModelCatalogProviderOverlay,
} from "./remote-overlay.js";

const config = { models: { catalogRefresh: { enabled: true } } };

parentPort!.postMessage(
  {
    overlay: getRemoteModelCatalogProviderOverlay(config, "anthropic"),
    pricing: getActiveRemoteModelCatalog(config)?.pricing,
  },
  [],
);
