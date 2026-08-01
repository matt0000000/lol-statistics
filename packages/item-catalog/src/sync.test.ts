import { describe, expect, it } from "vitest";
import { patchPublicationTransition, PATCH_ROLLOVER_LOCK_ORDER } from "./sync";

describe("patch publication rollover", () => {
  it("clears publication ownership and timestamp on every deactivated patch", () => {
    expect(patchPublicationTransition(false)).toEqual({ activePublicationId: null, publishedAt: null });
  });

  it("preserves publication ownership during same-patch refresh", () => {
    expect(patchPublicationTransition(true)).toEqual({});
  });

  it("locks global active publications before patch rows", () => {
    expect(PATCH_ROLLOVER_LOCK_ORDER).toEqual(["active_publications", "patches"]);
  });
});
