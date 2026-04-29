import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { TieredMemory } from "./memory.js";
import { ThalamusRouter } from "./router.js";

export default definePluginEntry({
  name: "thalamus",
  version: "0.1.0",
  setup(ctx) {
    const router = new ThalamusRouter();
    const memory = new TieredMemory();
    ctx.expose("thalamus.router", router);
    ctx.expose("thalamus.memory", memory);
  },
});
