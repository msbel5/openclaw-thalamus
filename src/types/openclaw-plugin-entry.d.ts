declare module "openclaw/plugin-sdk/plugin-entry" {
  export interface OpenClawPluginContext {
    expose(name: string, value: unknown): void;
    register?(name: string, value: unknown): void;
  }

  export interface OpenClawPluginEntry {
    name: string;
    version: string;
    setup(ctx: OpenClawPluginContext): void | Promise<void>;
  }

  export function definePluginEntry(
    entry: OpenClawPluginEntry,
  ): OpenClawPluginEntry;
}
