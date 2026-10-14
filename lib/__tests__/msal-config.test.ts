import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogLevel, PublicClientApplication } from "@azure/msal-browser";

vi.mock("@/lib/runtime-config", () => ({
  getPublicClientId: () => "00000000-0000-4000-8000-000000000001",
}));

import { msalConfig } from "../msal-config";

const storageFallback =
  "[Tue, 13 Oct 2026 00:00:00 GMT] : [] : @azure/msal-browser@5.25.0 : Error - ReferenceError: window is not defined";
const log = msalConfig.system!.loggerOptions!.loggerCallback!;

beforeEach(() => {
  vi.stubGlobal("window", undefined);
  Reflect.deleteProperty(globalThis, "window");
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("Unexpected network access");
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MSAL server storage diagnostics", () => {
  it("constructs the real client without logging its expected server storage fallback", () => {
    const networkClient = {
      sendGetRequestAsync: vi.fn(() => { throw new Error("Unexpected MSAL GET"); }),
      sendPostRequestAsync: vi.fn(() => { throw new Error("Unexpected MSAL POST"); }),
    };
    expect(() => new PublicClientApplication({
      ...msalConfig,
      system: { ...msalConfig.system, networkClient },
    })).not.toThrow();
    expect(console.error).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(networkClient.sendGetRequestAsync).not.toHaveBeenCalled();
    expect(networkClient.sendPostRequestAsync).not.toHaveBeenCalled();
  });

  it("keeps the same diagnostic visible in the browser", () => {
    vi.stubGlobal("window", {});
    log(LogLevel.Error, storageFallback, false);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(storageFallback);
  });

  it.each([
    storageFallback + ".foo",
    storageFallback + "\nAdditional failure",
    storageFallback + "\n",
    storageFallback + "\r\n",
    storageFallback.replace("[]", "[request-id]"),
    storageFallback.replace("@azure/msal-browser", "@azure/msal-node"),
    "ReferenceError: window is not defined",
    "BrowserAuthError: token acquisition failed",
    "InteractionRequiredAuthError: consent required",
  ])("keeps other server errors visible: %s", (message) => {
    log(LogLevel.Error, message, false);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(message);
  });

  it("keeps warnings visible", () => {
    log(LogLevel.Warning, storageFallback, false);
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(storageFallback);
  });

  it("continues to omit messages containing PII", () => {
    log(LogLevel.Error, "Private authentication detail", true);
    log(LogLevel.Warning, "Private authentication detail", true);
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });
});
