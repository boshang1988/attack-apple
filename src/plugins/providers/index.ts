import { registerDeepSeekProviderPlugin } from './deepseek/index.js';

let defaultsRegistered = false;

export function registerDefaultProviderPlugins(): void {
  if (defaultsRegistered) {
    return;
  }

  // Only deepseek is supported
  registerDeepSeekProviderPlugin();

  defaultsRegistered = true;
}
