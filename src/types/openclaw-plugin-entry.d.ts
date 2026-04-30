declare module "openclaw/plugin-sdk/plugin-entry" {
  import type {
    OpenClawPluginApi,
    OpenClawPluginConfigSchema,
  } from "openclaw/plugin-sdk/core";

  export interface DefinePluginEntryOptions {
    id: string;
    name: string;
    description: string;
    kind?: string;
    configSchema?:
      | OpenClawPluginConfigSchema
      | (() => OpenClawPluginConfigSchema);
    register(api: OpenClawPluginApi): void;
  }

  export interface OpenClawPluginEntry {
    id: string;
    name: string;
    description: string;
    configSchema: OpenClawPluginConfigSchema;
    register(api: OpenClawPluginApi): void;
  }

  export function definePluginEntry(
    entry: DefinePluginEntryOptions,
  ): OpenClawPluginEntry;
}

declare module "openclaw/plugin-sdk/core" {
  export type OpenClawPluginConfigSchema = Record<string, unknown>;

  export interface PluginLogger {
    debug?(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  }

  export interface OpenClawPluginApi {
    id: string;
    name: string;
    version?: string;
    description?: string;
    source: string;
    rootDir?: string;
    pluginConfig?: Record<string, unknown>;
    logger: PluginLogger;
    resolvePath(input: string): string;
    registerTool(tool: {
      name: string;
      description: string;
      parameters: unknown;
      execute(
        toolCallId: string,
        params: unknown,
        signal?: AbortSignal,
      ): Promise<unknown>;
    }): void;
    on(
      hookName: string,
      handler: (event: unknown) => void | Promise<void>,
      opts?: { priority?: number },
    ): void;
  }

  export function jsonResult(payload: unknown): unknown;
}
