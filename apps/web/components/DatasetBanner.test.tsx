import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DatasetBanner, datasetState } from "./DatasetBanner";

describe("DatasetBanner", () => {
  it.each([
    ["warming", "We’re collecting enough current-patch games"],
    ["stale", "Statistics were last updated"],
    ["fresh", ""]
  ] as const)("renders the %s state", (state, message) => {
    render(<DatasetBanner state={state} publishedAt="2026-08-01T10:00:00Z" />);
    if (message) expect(screen.getByText(new RegExp(message))).toBeVisible();
    else expect(screen.queryByRole("status")).toBeNull();
  });

  it("uses exact six-hour boundary and fails safe for invalid/future timestamps", () => {
    const now = new Date("2026-08-01T16:00:00Z");
    expect(datasetState({ publishedAt: "2026-08-01T10:00:00Z" }, now)).toBe("fresh");
    expect(datasetState({ publishedAt: "2026-08-01T09:59:59Z" }, now)).toBe("stale");
    expect(datasetState({ publishedAt: "not-a-date" }, now)).toBe("warming");
    expect(datasetState({ publishedAt: "2026-08-01T16:00:01Z" }, now)).toBe("warming");
  });
});
