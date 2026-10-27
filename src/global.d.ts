export {};
declare global {
  var Logs:
    | (new (moduleName: string) => (...args: unknown[]) => void)
    | undefined;
  var __PLUGIN_VERSION__: string;
}
