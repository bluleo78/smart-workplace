import { describe, expect, it, vi } from "vitest";

import { emitAiStreamEvent, onAiStreamEvent } from "./aiEventBus";

describe("aiEventBus", () => {
  it("등록된 리스너에게 이벤트를 전달한다", () => {
    const listener = vi.fn();
    onAiStreamEvent("wiki.ai.delta", listener);
    emitAiStreamEvent("wiki.ai.delta", { correlationId: "a", text: "요약" });
    expect(listener).toHaveBeenCalledWith({ correlationId: "a", text: "요약" });
  });

  it("구독 해제 후에는 이벤트를 받지 않는다", () => {
    const listener = vi.fn();
    const unsubscribe = onAiStreamEvent("wiki.ai.done", listener);
    unsubscribe();
    emitAiStreamEvent("wiki.ai.done", { correlationId: "a" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("다른 이벤트 이름의 리스너는 호출되지 않는다", () => {
    const deltaListener = vi.fn();
    const doneListener = vi.fn();
    onAiStreamEvent("wiki.ai.delta", deltaListener);
    onAiStreamEvent("wiki.ai.done", doneListener);
    emitAiStreamEvent("wiki.ai.delta", { correlationId: "a", text: "x" });
    expect(deltaListener).toHaveBeenCalledTimes(1);
    expect(doneListener).not.toHaveBeenCalled();
  });

  it("같은 이름에 여러 리스너를 등록하면 모두 호출된다", () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    onAiStreamEvent("wiki.ai.delta", l1);
    onAiStreamEvent("wiki.ai.delta", l2);
    emitAiStreamEvent("wiki.ai.delta", {});
    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(1);
  });
});
