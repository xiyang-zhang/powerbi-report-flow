import { describe, expect, it } from "vitest";
import { desktopHostAvailable, isHostUnavailable, reportFolderIsOpen } from "../src/report/validate";

describe("preview host parsing", () => {
  it("detects an available desktop host", () => {
    const json = {
      data: {
        hosts: [
          { host: "service", available: true },
          { host: "desktop", available: true },
        ],
      },
    };
    expect(desktopHostAvailable(json)).toBe(true);
  });

  it("detects an unavailable desktop host", () => {
    expect(desktopHostAvailable({ data: { hosts: [{ host: "desktop", available: false }] } })).toBe(false);
  });

  it("returns undefined for unrecognized output", () => {
    expect(desktopHostAvailable({ ok: true })).toBeUndefined();
  });

  it("recognizes HOST_UNAVAILABLE and open report folders", () => {
    expect(isHostUnavailable({ error: { code: "HOST_UNAVAILABLE" } })).toBe(true);
    expect(reportFolderIsOpen({ data: { reports: [{ folder: "C:\\Reports\\Demo.Report" }] } }, "C:\\Reports\\Demo.Report")).toBe(true);
    expect(reportFolderIsOpen({ data: { reports: [{ folder: "C:\\Reports\\Other.Report" }] } }, "C:\\Reports\\Demo.Report")).toBe(false);
  });
});
