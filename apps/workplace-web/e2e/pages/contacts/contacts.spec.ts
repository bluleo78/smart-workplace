// 연락처 E2E — 라우트 → 목록 API → 상세 배선(@wiring), 한글 IME 연속 입력(@input), 좁은 폭 2단 배치·lg 경계 입력 유지(@layout) (page.route 모킹).
// 타입 필터·검색 쿼리, 선택 표시, 그룹 뷰 헤더 버튼, 사이드바 타이틀, 즐겨찾기 필터·빈 상태, 외부 고급 필터, 404 안내(데스크톱)는
// src/pages/contacts/contactsPage.test.tsx 가, 404 안내(모바일)는 src/pages/mobile/backContacts.test.tsx 가 지킨다(WP-966).
import type { Page } from "@playwright/test";

import {
  external,
  member,
  memberDetail,
  page as makePage,
} from "../../factories/contacts.factory";
import { expect, test } from "../../fixtures/auth.fixture";
import { trackRequests } from "../../fixtures/requests";
import { resizeAndSettle } from "../../fixtures/wait";

// /api/v1/contacts 목록 — 멤버·외부 1건씩(쿼리와 무관).
async function stubList(page: Page) {
  await page.route(
    (url) => url.pathname === "/api/v1/contacts",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makePage([member(), external()])),
      }),
  );
}

async function stubMemberDetail(page: Page) {
  await page.route(
    (url) => url.pathname === "/api/v1/contacts/members/1",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(memberDetail()),
      }),
  );
}

test(
  "연락처에 들어가면 목록 API 결과가 행으로 보이고, 행을 누르면 상세 API 결과가 보인다",
  { tag: ["@wiring", "@smoke"] },
  async ({ authenticatedPage: page }) => {
    await stubList(page);
    await stubMemberDetail(page);

    await page.goto("/contacts");

    // 목록에 멤버·외부 모두 노출
    await expect(page.getByTestId("contact-row-MEMBER-1")).toBeVisible();
    await expect(page.getByTestId("contact-row-EXTERNAL-100")).toBeVisible();

    // 멤버 클릭 → 상세 패널
    await page.getByTestId("contact-row-MEMBER-1").click();
    await expect(page.getByTestId("contact-detail-member")).toContainText(
      "김멤버",
    );
    await expect(page.getByTestId("contact-detail-member")).toContainText(
      "개발팀",
    );
  },
);

// WP-974 — 검색어가 URL q 에 직접 묶여 있으면 키 입력마다 라우터 이동을 거치며 한글 IME 조합이 끊겼다.
// 로컬 draft + 300ms debounce 로 바뀐 뒤: 입력값은 즉시 전부 반영되고(끊김 없음), 목록 API 의 search 파라미터는
// 완성된 전체 글자로 한 번만 나간다(키 입력마다 요청하지 않는다).
test(
  "검색창에 한글을 연속 입력해도 끊기지 않고, API search 는 완성 글자로 한 번만 나간다 (WP-974)",
  { tag: "@input" },
  async ({ authenticatedPage: page }) => {
    await stubList(page);
    const tracker = trackRequests(page, "GET", "/api/v1/contacts");
    await page.goto("/contacts");
    await tracker.waitFor(1); // 초기 목록 조회

    const search = page.getByTestId("contact-search");
    // pressSequentially — 키 입력마다 별도 input 이벤트가 나가 URL 왕복 타이밍 버그를 재현한다.
    await search.pressSequentially("외부인", { delay: 30 });
    // 끊김 없이 입력값 전체가 그대로 남는다(자소 분리·일부 유실 없음).
    await expect(search).toHaveValue("외부인");

    // debounce(300ms) 전에는 추가 요청이 없다가, 한 번만 완성된 검색어로 나간다.
    await tracker.waitFor(2, { timeout: 2000 });
    expect(tracker.lastUrl()?.searchParams.get("search")).toBe("외부인");
    expect(tracker.count()).toBe(2);
  },
);

// #113 전폭 PageHeader + 좁은 화면 뒤로가기 — 800px 에서 상세를 열면 목록이 CSS 중단점(hidden lg:flex)으로 숨는 2단 배치라 실제 브라우저로 본다.
test(
  "연락처 전폭 헤더 + 좁은 화면 뒤로가기",
  { tag: ["@layout", "@smoke"] },
  async ({ authenticatedPage: page }) => {
    await stubList(page);
    await stubMemberDetail(page);
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto("/contacts");
    await expect(page.getByTestId("page-header")).toContainText("연락처");
    await expect(page.getByTestId("contact-create")).toBeVisible();
    const firstRow = page.getByTestId(/^contact-row-/).first();
    await firstRow.click();
    await expect(page.getByTestId("contact-back")).toBeVisible();
    await expect(page.getByTestId("contact-list")).toBeHidden();
    // 모바일 셸(WP-125): 상세가 열리면 하단 탭바 숨김, 뒤로가기 시 복귀
    await expect(page.getByTestId("mobile-tabbar")).toHaveCount(0);
    await page.getByTestId("mobile-back").click();
    await expect(page.getByTestId("contact-list")).toBeVisible();
    await expect(page.getByTestId("mobile-tabbar")).toBeVisible();
  },
);

// WP-1472: 연락처 본문은 MobileSidebarSheet(데스크톱 사이드바 ↔ 모바일 시트) 안에 있다 — lg(1024px) 경계를 넘을 때 본문이 다시 마운트되면
// 열린 새 연락처 창과 입력이 사라졌다. useIsMobile 이 matchMedia 로 바뀌는 실제 폭 전환이라 브라우저(@layout)로 본다(WP-1468 과 같은 방식).
test(
  "새 연락처 창의 입력이 lg 경계를 넘어도 남고, 모바일에선 ☰ 로 목록 시트가 열린다 (WP-1472)",
  { tag: ["@layout"] },
  async ({ authenticatedPage: page }) => {
    const DESKTOP = { width: 1440, height: 900 };
    const MOBILE = { width: 390, height: 844 };
    await stubList(page);
    await page.setViewportSize(DESKTOP);
    await page.goto("/contacts");
    await page.getByTestId("contact-create").click();
    const dialog = page.getByTestId("external-contact-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("c-name").fill("쓰던 이름");

    await resizeAndSettle(page, MOBILE);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("c-name")).toHaveValue("쓰던 이름");

    await resizeAndSettle(page, DESKTOP);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("c-name")).toHaveValue("쓰던 이름");

    // 창을 닫고 모바일로 가면 ☰ 가 생기고 목록 시트가 열린다(데스크톱에선 ☰ 가 없다).
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.locator("[data-mobile-sidebar-trigger]")).toHaveCount(0);
    await resizeAndSettle(page, MOBILE);
    const sheet = page.getByTestId("mobile-sidebar-sheet");
    await page.locator("[data-mobile-sidebar-trigger]").click();
    await expect(sheet).toBeVisible();

    // 시트를 연 채 데스크톱에 갔다 돌아오면 시트는 닫혀 있다(경계를 넘으면 닫는다) — ☰ 로 다시 열 수 있다.
    await resizeAndSettle(page, DESKTOP);
    await expect(sheet).toHaveCount(0);
    await resizeAndSettle(page, MOBILE);
    await expect(sheet).toHaveCount(0);
    await page.locator("[data-mobile-sidebar-trigger]").click();
    await expect(sheet).toBeVisible();
  },
);
