// src/components/layout/inboxViewTabs.test.tsx
// 「알림 | 보관함」 전환 탭의 APG Tabs 키보드 패턴 회귀 테스트(WP-1843).
// roving tabindex·id·aria-controls 와 방향키·Home·End 이동(자동 활성화)을 jsdom 으로 판정한다.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { type InboxView, InboxViewTabs } from "./InboxList";

/** view 상태를 쥐고 탭 뒤에 「다음」 단추를 둔 래퍼 — Tab 키가 탭 밖으로 나가는지 본다. */
function Harness({ onChange }: { onChange?: (v: InboxView) => void }) {
  const [view, setView] = useState<InboxView>("inbox");
  return (
    <div>
      <InboxViewTabs
        view={view}
        onChange={(v) => {
          onChange?.(v);
          setView(v);
        }}
      />
      <button type="button">다음</button>
    </div>
  );
}

const inboxTab = () => screen.getByTestId("inbox-tab-inbox");
const archiveTab = () => screen.getByTestId("inbox-tab-archive");

describe("InboxViewTabs 키보드(WP-1843)", () => {
  it("roving tabindex 와 탭↔패널 연결 속성", () => {
    render(<Harness />);
    expect(inboxTab()).toHaveAttribute("tabindex", "0");
    expect(inboxTab()).toHaveAttribute("id", "inbox-view-tab-inbox");
    expect(inboxTab()).toHaveAttribute("aria-controls", "inbox-view-panel");
    expect(archiveTab()).toHaveAttribute("tabindex", "-1");
    expect(archiveTab()).toHaveAttribute("id", "inbox-view-tab-archive");
    expect(archiveTab()).toHaveAttribute("aria-controls", "inbox-view-panel");
  });

  it("→ 로 보관함 선택·초점 이동, 다시 → 로 알림으로 감김", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    inboxTab().focus();
    await user.keyboard("{ArrowRight}");
    expect(archiveTab()).toHaveAttribute("aria-selected", "true");
    expect(archiveTab()).toHaveFocus();
    expect(archiveTab()).toHaveAttribute("tabindex", "0");
    expect(inboxTab()).toHaveAttribute("tabindex", "-1");
    await user.keyboard("{ArrowRight}");
    expect(inboxTab()).toHaveAttribute("aria-selected", "true");
    expect(inboxTab()).toHaveFocus();
  });

  it("← 는 첫 탭에서 마지막 탭으로 감김", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    inboxTab().focus();
    await user.keyboard("{ArrowLeft}");
    expect(archiveTab()).toHaveAttribute("aria-selected", "true");
    expect(archiveTab()).toHaveFocus();
  });

  it("Home·End", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    inboxTab().focus();
    await user.keyboard("{End}");
    expect(archiveTab()).toHaveAttribute("aria-selected", "true");
    expect(archiveTab()).toHaveFocus();
    await user.keyboard("{Home}");
    expect(inboxTab()).toHaveAttribute("aria-selected", "true");
    expect(inboxTab()).toHaveFocus();
  });

  it("같은 탭이면 onChange 를 부르지 않는다", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    inboxTab().focus();
    await user.keyboard("{Home}");
    expect(onChange).not.toHaveBeenCalled();
  });

  // 수식키(Alt·Shift) 조합은 브라우저·보조기기 단축키라 가로채지 않는다 — 선택·초점이 그대로다.
  it.each([
    ["Alt+→", "{Alt>}{ArrowRight}{/Alt}"],
    ["Shift+→·Shift+End", "{Shift>}{ArrowRight}{End}{/Shift}"],
  ])("수식키 조합(%s)은 무시", async (_name, keys) => {
    const user = userEvent.setup();
    render(<Harness />);
    inboxTab().focus();
    await user.keyboard(keys);
    expect(inboxTab()).toHaveAttribute("aria-selected", "true");
    expect(inboxTab()).toHaveFocus();
  });

  it("방향키는 선택 탭이 아니라 초점이 있는 탭에서 움직인다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    // 보조기기·스크립트가 선택되지 않은 보관함 탭에 초점을 둔 경우 — ← 는 그 왼쪽(알림)으로 가야 한다.
    archiveTab().focus();
    await user.keyboard("{ArrowLeft}");
    expect(inboxTab()).toHaveFocus();
    expect(inboxTab()).toHaveAttribute("aria-selected", "true");
  });

  it("Tab 은 탭 밖 다음 요소로", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    inboxTab().focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "다음" })).toHaveFocus();
  });
});
