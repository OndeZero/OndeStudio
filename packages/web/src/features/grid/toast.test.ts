import { beforeEach, describe, expect, it, vi } from "vitest";
import { pushToast, runToastAction, toasts } from "./toast";

beforeEach(() => {
  toasts.splice(0);
  vi.clearAllMocks();
});

describe("toast actions", () => {
  it("fires the action and dismisses the toast (the undo affordance, docs/2 §7.5)", () => {
    const run = vi.fn();
    pushToast("info", "Edit applied.", 6000, { label: "Undo", run });

    const toast = toasts[0];
    expect(toast?.action?.label).toBe("Undo");

    runToastAction(toast!.id);
    expect(run).toHaveBeenCalledOnce();
    // The toast clears itself once the action fires — no lingering second click.
    expect(toasts.find((t) => t.id === toast!.id)).toBeUndefined();
  });

  it("dismisses cleanly when the toast carries no action", () => {
    pushToast("info", "Slot created.");
    const id = toasts[0]!.id;
    runToastAction(id);
    expect(toasts).toHaveLength(0);
  });
});
