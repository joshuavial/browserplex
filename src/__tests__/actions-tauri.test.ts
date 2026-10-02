import { afterEach, describe, expect, it, vi } from "vitest";
import { browserPressKey } from "../core/actions.js";
import { sessionManager } from "../core/sessions.js";

describe("Tauri actions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes a focused key chord through the Tauri automation channel", async () => {
    const command = vi.fn().mockResolvedValue({ key: "Enter" });
    vi.spyOn(sessionManager, "getOrThrow").mockReturnValue({
      type: "tauri",
      tauri: { command },
    } as never);

    await expect(
      browserPressKey({ session: "native-app", key: "Meta+Enter" }),
    ).resolves.toEqual({ text: "Pressed 'Meta+Enter'" });
    expect(command).toHaveBeenCalledWith({
      command: "eval",
      expression: expect.stringContaining(
        '"key":"Enter","altKey":false,"ctrlKey":false,"metaKey":true,"shiftKey":false',
      ),
      timeoutMs: 5000,
    });
  });

  it("rejects unknown key modifiers before sending a Tauri command", async () => {
    const command = vi.fn();
    vi.spyOn(sessionManager, "getOrThrow").mockReturnValue({
      type: "tauri",
      tauri: { command },
    } as never);

    await expect(
      browserPressKey({ session: "native-app", key: "Hyper+Enter" }),
    ).rejects.toThrow("unsupported key modifier 'Hyper'");
    expect(command).not.toHaveBeenCalled();
  });
});
