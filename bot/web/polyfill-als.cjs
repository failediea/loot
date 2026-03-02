// Polyfill globalThis.AsyncLocalStorage for Node <22 (required by Next.js 14.2+)
const { AsyncLocalStorage } = require("async_hooks");
if (!globalThis.AsyncLocalStorage) {
  globalThis.AsyncLocalStorage = AsyncLocalStorage;
}
