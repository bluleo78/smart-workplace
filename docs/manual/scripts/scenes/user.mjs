// user 매뉴얼 촬영 장면 목록(WP-1196). 촬영 대상 표(shots/targets.md 「사용자 매뉴얼」)를 구현한다.
// 04장 그림(ai-collaboration-*)은 아직 소개서 촬영본을 가져온 샘플이라 여기 장면이 없다 — 다시 찍는 것은 다음 단계다.
//
// 장면 형식:
//   { id: '샷-id', shots?: ['샷-id', ...], account: '계정 아이디', async run({ page, rec, api }) { ... } }
//   - page: 로그인된 Playwright 페이지(뷰포트 1440x810, 배율 2, 라이트 테마)
//   - rec:  createShotRecorder — 장면은 capture() 로 표식 좌표를 쌓고 그림을 저장한다
//   - api:  (method, path, body?) → JSON. MANUAL_API 에 이 계정의 bearer 토큰으로 요청하는 헬퍼(이 책 장면은 쓰지 않는다)
//
// 촬영 환경은 **운영**의 매뉴얼 전용 테넌트(누리커머스)다. 그래서 장면은 읽기만 한다(앱이 저절로 보내는 읽음 처리 같은 쓰기는
// openHome·openApp 이 거는 guardReadOnly 가 브라우저 안에서 막는다):
//   화면을 열고, 메뉴·창을 열고, 칸을 채운 뒤 닫기만 한다. 로그인 폼 제출·알림 읽음·위젯 추가·저장·테마 전환을 하지 않는다.
//   편집 모드는 언제나 「취소」로 끝내고, 레일 펼침처럼 브라우저 저장소에 남는 조작은 finally 에서 되돌린다.
// 페이지는 계정별로 공유된다: 장면은 먼저 자기 시작 URL 로 goto 한다(앞 장면의 화면이 남아 있을 수 있다).
// 결정적으로 찍는다: 브라우저 시계를 FIXED_NOW 로 고정해 「n분 전」·「오늘」 계산이 매번 같게 한다(아래 주석).
import { newShotContext } from '../lib/capture-kit.mjs';
import { capture, closeDialog, dialog, guardReadOnly } from '../lib/scene-kit.mjs';

const ACCOUNT = 'seoyeon@example.com'; // 소유자 김서연 — 시드(seed-user.mjs)가 쓰는 촬영 계정
const WEB = () => process.env.MANUAL_WEB; // capture.mjs 가 촬영 전에 있는지 확인한다

// 브라우저 시계를 고정할 시각 — 마지막 시드(대화·캘린더 보강: DM·스레드 답글·반응·초대 일정·태그)를 넣은 직후.
// 그 시드의 마지막 쓰기가 2026-10-29 19:49:03 KST 라, 그 뒤 몇 분으로 두어 「n분 전」이 자연스럽고 오늘이 10-29 로 남게 한다.
// (그 전 홈 보강 시드 — 오늘 마감 MOB-14·기한 지남 MOB-15·이준호의 멘션 — 는 18:13:33 KST 에 넣었다.)
// 홈의 「n분 전」, 오늘 일정, 마감 계산이 모두 브라우저 시각 기준이라 고정하지 않으면 다시 찍을 때마다 그림이 바뀐다.
// 시드가 날짜를 촬영일 기준 상대값으로 넣으므로 **시드를 다시 넣으면 이 값도 새 시드 직후로 바꾼다.**
// 실제 시각보다 앞선 시각은 쓰지 않는다(토큰 만료 판단이 미래 시각으로 어긋나지 않게) — 이 시각이 지난 뒤에 찍는다.
const FIXED_NOW = new Date('2026-10-29T19:55:00+09:00');

// 홈 위젯 본문은 지연 로딩되고 각자 데이터를 따로 받는다 — 스켈레톤·aria-busy 가 모두 사라지고 글꼴이 다 읽힌 뒤 찍는다.
async function settle(page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid=dashboard-skeleton], [aria-busy="true"], [data-slot=skeleton]').length === 0,
    null,
    { timeout: 20000 },
  );
  await page.evaluate(() => document.fonts.ready);
}

/** 시계를 고정하고 홈을 연다. 요약·내 작업·오늘 일정·알림 위젯이 다 그려질 때까지 기다린다. */
async function openHome(page) {
  await guardReadOnly(page.context(), { extraBlock: (url) => /\/(catchup|summary)(\?|$)/.test(url) }); // 아래 openApp 주석
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto(`${WEB()}/`);
  await page.getByTestId('dashboard-counts').waitFor();
  await page.getByTestId('dash-mytasks').waitFor();
  await page.getByTestId('inbox-trigger').waitFor();
  // AI 비서가 있는 계정이라 화면 위 가운데에 AI 어시스턴트 단추가 뜬다(useAiAvailable). 단추만 기다리고 누르지 않는다.
  await page.getByTestId('chat-launcher').waitFor();
  await settle(page);
}

/** 로그아웃 상태 화면을 새 컨텍스트에서 연다 — 공유 페이지를 로그아웃시키지 않는다. 끝나면 컨텍스트를 닫는다. */
async function withLoggedOut(page, fn) {
  const ctx = await newShotContext(page.context().browser());
  try {
    await fn(await ctx.newPage());
  } finally {
    await ctx.close();
  }
}

/** 레일을 펼친 채로 fn 을 돌린다. 펼침은 localStorage(app-rail-expanded)에 남으므로 끝나면 지운다(다음 장면은 goto 로 다시 접힌 상태). */
async function withRailExpanded(page, fn) {
  await page.getByTestId('rail-toggle').click();
  await page.getByTestId('rail-collapse').waitFor();
  try {
    await fn();
  } finally {
    await page.evaluate(() => localStorage.removeItem('app-rail-expanded'));
  }
}

/** 편집 모드로 fn 을 돌리고, 어떻게 끝나든 저장하지 않고 「취소」로 빠져나온다(열린 창은 먼저 닫는다). */
async function withEditMode(page, fn) {
  await page.getByTestId('dashboard-edit-toggle').click();
  await page.getByTestId('dashboard-edit-banner').waitFor();
  try {
    await fn();
  } finally {
    if (await page.getByTestId('add-widget-modal').isVisible()) await page.keyboard.press('Escape');
    if (await page.getByTestId('dashboard-edit-cancel').isVisible()) await page.getByTestId('dashboard-edit-cancel').click();
  }
}

/**
 * 대화·캘린더 장면 공용 — 시계를 고정하고 화면을 연다. 이 컨텍스트의 쓰기 요청은 guardReadOnly 가 브라우저 안에서 막는다
 * (채널을 열기만 해도 가는 읽음 처리 POST, 스레드 읽음 POST — 막지 않으면 01~03장 그림의 안 읽음 수가 바뀐다).
 * 채널 캐치업 요약(GET …/catchup)·노트 페이지 요약(GET …/summary)은 AI 를 부르므로 함께 막는다.
 */
async function openApp(page, path) {
  await guardReadOnly(page.context(), { extraBlock: (url) => /\/(catchup|summary)(\?|$)/.test(url) });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto(`${WEB()}${path}`);
  await page.getByTestId('chat-launcher').waitFor();
}

/** 대화 앱에서 시드 채널 「모바일-주문앱」 을 연다(채널 id 는 운영 값이라 사이드바 이름으로 찾는다). 메시지가 다 그려진 뒤 돌려준다. */
async function openChannel(page) {
  await openApp(page, '/chat');
  await page.getByRole('link', { name: /모바일-주문앱/ }).click();
  await page.getByText('재주문 버튼 최종 시안').waitFor();
  await page.getByText('답글 1개').waitFor();
  await page.evaluate(() => document.fonts.ready);
}

/** 캘린더를 월 보기로 연다(시드 일정이 그려질 때까지). 고른 보기는 브라우저에 남으므로 매번 월 보기를 눌러 맞춘다. */
async function openCalendar(page) {
  await openApp(page, '/calendar');
  await page.getByTestId('calendar-view-month-btn').click();
  await page.getByTestId('calendar-view-month').getByText('재주문 디자인 리뷰').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
}

/** 뷰포트를 잠시 바꿔 fn 을 돌리고 되돌린다 — 본문 전체 폭 요소를 1400px 근처로 자르려고 데스크톱 최소 폭(1024)으로 찍을 때. */
async function withViewport(page, width, fn) {
  const original = page.viewportSize();
  await page.setViewportSize({ width, height: original.height });
  try {
    await fn();
  } finally {
    await page.setViewportSize(original);
  }
}

// 05장부터의 그림은 표식 상자를 글자에서 조금 띄운다 — 글자 요소의 상자가 글자에 딱 붙거나 좁아 빨간 테두리가 글자를 자르거나 덮었다.
// (01~03장 그림은 이미 찍어 검수한 좌표라 그대로 둔다.)
const MARK_PAD = 4; // CSS px — 원본 8px
const capturePadded = (page, rec, id, marks) => capture(page, rec, id, marks, { pad: MARK_PAD });

/** MOB 프로젝트 이슈 목록을 연다. view 는 「목록」·「보드」 — 고른 보기가 브라우저에 남아 매번 눌러 맞춘다. */
async function openProject(page, view) {
  await openApp(page, '/projects/MOB');
  const toggle = page.getByRole('group', { name: '뷰 전환' });
  await toggle.waitFor();
  await (view === '보드' ? toggle.getByRole('button', { name: '보드' }) : toggle.getByRole('button').first()).click();
  await page.getByText('베타 오픈 Go/No-Go 체크리스트 확정').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
}

/** MOB 이슈 상세를 연다(코멘트가 그려질 때까지). AI 현황 요약은 「요약 생성」 을 눌러야 AI 를 부르므로 누르지 않는다. */
async function openIssue(page, number) {
  await openApp(page, `/projects/MOB/issues/${number}`);
  await byTestId(page, 'property-rail').waitFor();
  await page.getByText('코멘트', { exact: true }).first().waitFor();
  // 첨부·하위 태스크는 따로 받아 오며 그동안 「로딩 중…」 이 보인다 — 모두 사라진 뒤 찍는다.
  await page.waitForFunction(() => !document.body.innerText.includes('로딩 중'), null, { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
}

/** 드라이브 팀 공간 「모바일 주문 앱」 을 연다(공간 id 는 운영 값이라 사이드바 이름으로 찾는다). */
async function openDriveSpace(page) {
  await openApp(page, '/drive');
  await byTestId(page, 'drive-space-list').getByText('모바일 주문 앱').click();
  await page.getByText('기획', { exact: true }).first().waitFor();
  await page.evaluate(() => document.fonts.ready);
}

/** 노트 팀 스페이스의 「제품 요구사항 (PRD)」 를 연다. 본문이 동기화돼 그려질 때까지 기다린다. */
async function openWikiPage(page) {
  await openApp(page, '/wiki');
  const space = page.getByRole('combobox').first();
  if (!(await space.textContent()).includes('모바일 주문 앱')) {
    await space.click();
    await page.getByRole('option', { name: '모바일 주문 앱' }).click();
  }
  await page.getByText('제품 요구사항 (PRD)').first().click();
  await byTestId(page, 'page-body-content').getByText('재주문 소요 시간 60% 단축').waitFor();
  await page.evaluate(() => document.fonts.ready);
}

const byTestId = (page, id) => page.getByTestId(id);
/** 목록 행 전체(체크박스·아이콘 포함) — 이름 글자만 잡으면 상자가 글자에 붙으므로 testid 접두어로 행 컨테이너를 잡는다. */
const rowOf = (page, prefix, text, tag = '') => page.locator(`${tag}[data-testid^="${prefix}"]`).filter({ hasText: text }).first();
const widget = (page, type) => page.locator(`[data-widget=${type}]`);
const railLinks = (page) => page.locator('[data-testid=app-rail] nav a');

export const scenes = [
  // ── 01 소개 ──
  {
    id: 'introduction-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      await withRailExpanded(page, () =>
        capture(page, rec, 'introduction-1', { rail: byTestId(page, 'app-rail') }),
      );
    },
  },

  // ── 02 로그인과 화면 구조 ──
  {
    id: 'login-and-layout-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await withLoggedOut(page, async (p) => {
        await p.goto(`${WEB()}/login`);
        await p.getByRole('link', { name: 'Microsoft 계정으로 로그인' }).waitFor();
        // 가입이 잠긴 운영에서는 가입 가용성 응답이 오면 「회원가입」 링크가 사라진다 — 사라진 뒤 찍어야 매번 같다.
        await p.getByText('계정이 없으신가요? 회원가입').waitFor({ state: 'detached' });
        await p.getByLabel('아이디').fill(ACCOUNT);
        await p.locator('input[type=password]').fill('password-mask'); // 화면에는 점으로만 보인다(실제 비밀번호 아님). 제출하지 않는다
        await p.evaluate(() => document.fonts.ready);
        await capture(p, rec, 'login-and-layout-1', {
          card: p.locator('[data-slot=card]'),
          username: p.getByLabel('아이디'),
          password: p.locator('input[type=password]'),
          submit: p.getByRole('button', { name: '로그인', exact: true }),
          microsoft: p.getByRole('link', { name: 'Microsoft 계정으로 로그인' }),
        });
      });
    },
  },
  {
    id: 'login-and-layout-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await withLoggedOut(page, async (p) => {
        await p.goto(`${WEB()}/signup`);
        const notice = p.getByText('회원가입이 비활성화되어 있습니다. 관리자에게 문의하세요.');
        await notice.waitFor();
        await p.evaluate(() => document.fonts.ready);
        await capture(p, rec, 'login-and-layout-2', {
          card: p.locator('[data-slot=card]'),
          notice,
          login: p.getByRole('link', { name: '로그인' }),
        });
      });
    },
  },
  {
    id: 'login-and-layout-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      await capture(page, rec, 'login-and-layout-3', {
        apps: page.locator('[data-testid=app-rail] nav'),
        assistant: byTestId(page, 'chat-launcher'),
        workspace: byTestId(page, 'workspace-switcher'),
        inbox: byTestId(page, 'inbox-trigger'),
        user: byTestId(page, 'rail-user-menu'),
      });
    },
  },
  {
    id: 'login-and-layout-4',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      await withRailExpanded(page, () =>
        capture(page, rec, 'login-and-layout-4', {
          toggle: byTestId(page, 'rail-collapse'),
          // 레일 링크 첫 항목(홈)부터 마지막 항목(설정)까지 — nav 요소는 아래 빈 공간까지 늘어나 있어 쓰지 않는다.
          apps: [railLinks(page).first(), railLinks(page).last()],
        }),
      );
    },
  },
  {
    id: 'login-and-layout-5',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      // 목록을 여는 것만으로는 읽음 처리되지 않는다(행을 누를 때만 — InboxList). 행·「모두 읽음」은 누르지 않는다.
      await byTestId(page, 'inbox-trigger').click();
      const panel = byTestId(page, 'inbox-panel');
      await panel.getByTestId('inbox-item').first().waitFor();
      await settle(page);
      await capture(page, rec, 'login-and-layout-5', {
        panel,
        trigger: byTestId(page, 'inbox-trigger'),
        item: panel.getByTestId('inbox-item').first(),
        markAll: panel.getByTestId('inbox-mark-all'),
      });
    },
  },
  {
    id: 'login-and-layout-6',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      await byTestId(page, 'workspace-switcher').click();
      const menu = page.getByRole('menu');
      // 소속 목록은 메뉴를 열 때 받아 온다 — 「불러오는 중…」 이 「워크스페이스」 로 바뀐 뒤 찍는다.
      await menu.getByText('워크스페이스', { exact: true }).waitFor();
      await menu.getByRole('menuitem').first().waitFor();
      await capture(page, rec, 'login-and-layout-6', { menu, trigger: byTestId(page, 'workspace-switcher') });
    },
  },
  {
    id: 'login-and-layout-7',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      await byTestId(page, 'rail-user-menu').click();
      const menu = page.getByRole('menu');
      await menu.waitFor();
      // 항목은 누르지 않는다 — 「새 소식」 은 읽음 표시를, 「테마 전환」 은 테마를 바꾼다.
      await capture(page, rec, 'login-and-layout-7', {
        menu,
        trigger: byTestId(page, 'rail-user-menu'),
        profile: page.getByRole('menuitem', { name: '프로필' }),
        whatsNew: byTestId(page, 'whats-new-menu-item'),
        theme: page.getByRole('menuitem', { name: '테마 전환' }),
        logout: page.getByRole('menuitem', { name: '로그아웃' }),
      });
    },
  },

  // ── 03 홈 ──
  {
    id: 'home-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      await capture(page, rec, 'home-1', {
        home: byTestId(page, 'rail-link-/'),
        summary: widget(page, 'synthesis'),
        edit: byTestId(page, 'dashboard-edit-toggle'),
      });
    },
  },
  {
    // 요약 위젯은 본문 전체 폭이라 1440 폭에서는 원본 2600px 가까이 된다. 데스크톱 배치가 유지되는 가장 좁은 폭(1024)으로 찍는다.
    id: 'home-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      const original = page.viewportSize();
      await page.setViewportSize({ width: 1024, height: 810 });
      try {
        await openHome(page);
        await capture(page, rec, 'home-2', {
          counts: byTestId(page, 'dashboard-counts'),
          attention: byTestId(page, 'dashboard-attention'),
        });
      } finally {
        await page.setViewportSize(original);
      }
    },
  },
  {
    id: 'home-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      const w = widget(page, 'my_tasks');
      // 위젯 전체가 보이도록 가운데로 내린다(스크롤 위치를 고정해 매번 같은 화면).
      await w.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await settle(page);
      await capture(page, rec, 'home-3', {
        widget: w,
        title: w.locator('[data-slot=card-header] a'),
        group: w.getByRole('link', { name: '진행 중 →' }),
        // 묶음 머리 바로 아래 행을 고르면 3번 표식이 2번 상자 옆에 붙어 헷갈린다 — 한 행 아래를 고른다.
        row: w.getByRole('link', { name: '이슈 열기: 포인트·쿠폰 통합' }),
      });
    },
  },
  {
    id: 'home-4',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      const w = widget(page, 'quick_actions');
      await capture(page, rec, 'home-4', {
        title: w.locator('[data-slot=card-title]'),
        // 단추 묶음 상자는 위젯 전체 폭이라 단추 셋의 합집합으로 기록한다.
        buttons: [w.getByRole('link', { name: '새 이슈' }), w.getByRole('link', { name: '새 대화' })],
        newIssue: w.getByRole('link', { name: '새 이슈' }),
        newMail: w.getByRole('link', { name: '메일 작성' }),
        newChat: w.getByRole('link', { name: '새 대화' }),
      });
    },
  },
  {
    id: 'home-5',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      await withEditMode(page, async () => {
        const summary = widget(page, 'synthesis');
        await capture(page, rec, 'home-5', {
          add: byTestId(page, 'dashboard-add-widget-open'),
          banner: [byTestId(page, 'dashboard-edit-undo'), byTestId(page, 'dashboard-edit-save')],
          // 첫 위젯(요약) 머리의 단추 줄 — 위로·아래로·숨김·테두리·삭제
          controls: [summary.getByTestId('widget-move-up'), summary.getByTestId('widget-remove')],
          save: byTestId(page, 'dashboard-edit-save'),
        });
      });
    },
  },
  {
    id: 'home-6',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openHome(page);
      await withEditMode(page, async () => {
        await byTestId(page, 'dashboard-add-widget-open').click();
        const modal = byTestId(page, 'add-widget-modal');
        await modal.waitFor();
        // AI 우선순위처럼 미리보기가 예시 데이터를 그리는 위젯 대신 이슈 목록을 고른다. 「+ 위젯 추가」 는 누르지 않는다.
        const card = modal.locator('[data-testid=add-widget-card][data-widget-type=issue_list]');
        await card.click();
        await modal.getByText('미리보기').waitFor();
        await settle(page);
        // 창 제목을 자르기에 넣어야 위 여백이 제목 글자를 반으로 자르지 않는다. 제목 요소는 창 전체 폭이라
        // 글자 폭으로 줄여(화면 모양은 같다) 상자를 잰다 — 촬영 브라우저 안의 스타일만 바꾸고 서버에는 아무것도 쓰지 않는다.
        const title = modal.getByRole('heading', { name: '위젯 추가' });
        await title.evaluate((el) => {
          el.style.width = 'fit-content';
          el.style.alignSelf = 'flex-start';
        });
        await capture(page, rec, 'home-6', {
          title,
          categories: byTestId(page, 'add-widget-categories'),
          grid: byTestId(page, 'add-widget-grid'),
          category: modal.locator('[data-testid=add-widget-category][data-category=전체]'),
          card,
        });
      });
    },
  },

  // ── 05 대화 ── 쓰기(보내기·반응·읽음 처리·채널 만들기)는 하지 않는다. 읽음 처리 POST 는 openApp 의 guardReadOnly 가 막는다.
  {
    id: 'chat-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openChannel(page);
      // 「놓친 대화 요약」 단추(AI)는 누르지 않는다.
      await capturePadded(page, rec, 'chat-1', {
        channels: [page.getByLabel('채널 탐색'), page.getByRole('link', { name: /모바일-주문앱/ })],
        dms: [page.getByLabel('새 메시지'), page.getByRole('link', { name: '김서연 (나)' })],
        threads: page.getByRole('link', { name: /^스레드/ }),
        header: byTestId(page, 'channel-header'),
        composer: byTestId(page, 'message-composer'),
      });
    },
  },
  {
    // 입력기는 본문 전체 폭이라 데스크톱 최소 폭(1024)으로 찍는다. 글을 넣고 첨부 메뉴를 연 채 찍고, 보내지 않는다.
    id: 'chat-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await withViewport(page, 1024, async () => {
        await openChannel(page);
        const input = page.getByLabel('채팅 메시지 작성');
        await input.click();
        await input.pressSequentially('베타 빌드 배포 일정 공유드려요');
        // 메뉴가 열리면 나머지 화면이 보조기기에서 가려져(역할로 못 찾는다) 단추 위치를 먼저 잰다.
        await page.mouse.move(0, 0);
        await rec.mark('chat-2', 'format', page.getByLabel('서식'));
        await rec.mark('chat-2', 'input', input);
        await rec.mark('chat-2', 'send', page.getByRole('button', { name: '보내기' }));
        await rec.mark('chat-2', 'attach', page.getByLabel('첨부 추가'));
        await page.getByLabel('첨부 추가').click();
        const menu = page.getByRole('menu');
        await menu.getByText('드라이브에서 링크').waitFor();
        await capturePadded(page, rec, 'chat-2', { menu });
        await page.keyboard.press('Escape');
        await input.fill(''); // 입력 초안을 남기지 않는다
      });
    },
  },
  {
    // 마우스를 올려야 보이는 메시지 도구 줄 — capture() 는 마우스를 구석으로 옮기므로 직접 기록한다.
    id: 'chat-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openChannel(page);
      const own = page.getByText('이번 주 목표는 재주문 베타 빌드입니다', { exact: false });
      await own.hover();
      const bar = page.locator('[data-message-toolbar]').first();
      await bar.waitFor();
      await rec.mark('chat-3', 'message', own, { pad: MARK_PAD });
      // 도구 줄 단추는 서로 붙어 있고 단추 자체에 여백이 있어 넓히지 않는다(넓히면 이웃 상자와 겹친다).
      await rec.mark('chat-3', 'emoji', bar.getByLabel('이모지 추가'));
      await rec.mark('chat-3', 'thread', bar.getByLabel('스레드', { exact: true }));
      await rec.mark('chat-3', 'edit', bar.locator('[data-testid^=message-edit-]'));
      await rec.mark('chat-3', 'delete', bar.locator('[data-testid^=message-delete-]'));
      await rec.shoot(page, 'chat-3');
    },
  },
  {
    // 스레드 패널 — 패널을 열면 스레드 읽음 POST 가 가지만 guardReadOnly 가 막는다. 답글은 보내지 않는다.
    id: 'chat-4',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openChannel(page);
      await page.getByText('답글 1개').click();
      // 누른 링크에 포커스가 남으면 그 메시지 행의 도구 줄이 떠 있다 — 포커스를 거둔다.
      await page.evaluate(() => document.activeElement?.blur());
      const panel = byTestId(page, 'thread-panel');
      await panel.getByText('확인했습니다. 원인 파악됐고').waitFor();
      await capturePadded(page, rec, 'chat-4', {
        panel,
        root: panel.getByText('iOS 17 에서 재주문 후 수량이 0으로'),
        replies: panel.getByText('확인했습니다. 원인 파악됐고'),
        close: page.getByLabel('스레드 닫기'),
      });
    },
  },
  {
    id: 'chat-5',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openChannel(page);
      await page.getByLabel('채널 탐색').click();
      const d = dialog(page);
      await d.getByText('참여 중').first().waitFor();
      await capturePadded(page, rec, 'chat-5', {
        dialog: d,
        search: d.getByPlaceholder('채널 이름으로 검색'),
        rows: [d.locator('[data-testid^=channel-browser-row-]').first(), d.locator('[data-testid^=channel-browser-row-]').last()],
      });
      await closeDialog(page);
    },
  },
  {
    // 채널 만들기 창 — 이름을 넣기만 하고 「만들기」 는 누르지 않는다.
    id: 'chat-6',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openChannel(page);
      await page.getByLabel('채널 만들기').click();
      const d = dialog(page);
      await d.getByPlaceholder('예: 마케팅').fill('베타-피드백');
      await capturePadded(page, rec, 'chat-6', {
        dialog: d,
        name: d.getByPlaceholder('예: 마케팅'),
        private: d.getByRole('switch'),
        submit: d.getByRole('button', { name: '만들기' }),
      });
      await closeDialog(page);
    },
  },
  {
    // 멤버 창 — 역할을 바꾸거나 내보내지 않는다(목록만 본다).
    id: 'chat-7',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openChannel(page);
      await byTestId(page, 'channel-members-btn').click();
      const d = byTestId(page, 'channel-members-panel');
      await d.getByRole('button', { name: '채널 나가기' }).waitFor();
      await capturePadded(page, rec, 'chat-7', {
        dialog: d,
        add: byTestId(page, 'member-add-trigger'),
        role: d.locator('select').first(),
        leave: d.getByRole('button', { name: '채널 나가기' }),
      });
      await closeDialog(page);
    },
  },
  {
    // 새 메시지 — 받는 사람 후보 목록만 연다(상대를 고르지 않는다 — 고르면 DM 을 찾거나 만들 수 있다).
    id: 'chat-8',
    account: ACCOUNT,
    async run({ page, rec }) {
      await withViewport(page, 1024, async () => {
        await openApp(page, '/chat/new');
        const list = byTestId(page, 'recipient-suggestions');
        await list.getByText('지니').first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        await capturePadded(page, rec, 'chat-8', {
          input: byTestId(page, 'new-message-recipients'),
          filter: list.getByRole('group', { name: '사람·에이전트 필터' }),
          list: list.getByRole('listbox'),
        });
      });
    },
  },

  {
    // 반응 칩과 새 답글 표시 — 박지민 메시지의 반응, 김서연 메시지의 「답글 2개」(새 답글 점).
    // 왼쪽(남의 메시지)과 오른쪽(내 메시지)을 한 그림에 담으려고 데스크톱 최소 폭(1024)으로 찍는다.
    id: 'chat-9',
    account: ACCOUNT,
    async run({ page, rec }) {
      await withViewport(page, 1024, async () => {
        await openChannel(page);
        const bar = page.locator('[data-testid*=reaction-bar-]').first();
        await bar.waitFor();
        await capturePadded(page, rec, 'chat-9', {
          message: page.getByText('재주문 버튼 최종 시안'),
          reactions: bar,
          replies: page.getByText('답글 2개'),
          own: page.getByText('이번 주 목표는 재주문 베타 빌드입니다', { exact: false }),
        });
      });
    },
  },
  {
    // 스레드 모아 보기 — 카드는 누르지 않는다(누르면 스레드가 열려 스레드 읽음을 보낸다 — guardReadOnly 가 막지만 열 필요가 없다).
    id: 'chat-10',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/chat/threads/inbox');
      const card = page.locator('[data-testid^=thread-inbox-card-]').first();
      await card.getByText('새 답글 2개').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await capturePadded(page, rec, 'chat-10', {
        nav: page.getByRole('link', { name: /스레드/ }).first(),
        card,
        badge: card.getByText('새 답글 2개'),
      });
    },
  },
  {
    // DM — 열면 읽음 처리 POST 가 가지만 guardReadOnly 가 막는다. 「놓친 대화 요약」(AI)은 누르지 않는다.
    id: 'chat-11',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/chat');
      await page.getByRole('link', { name: /이준호/ }).first().click();
      await byTestId(page, 'unread-divider').waitFor();
      await page.getByText('감사합니다! 회귀 체크리스트').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await capturePadded(page, rec, 'chat-11', {
        dm: page.getByRole('link', { name: /이준호/ }).first(),
        header: byTestId(page, 'dm-header'),
        divider: byTestId(page, 'unread-divider'),
      });
    },
  },

  // ── 07 캘린더 ── 일정 만들기·수정·삭제·응답은 하지 않는다. 창은 채운 뒤 Esc 로 닫는다.
  {
    id: 'calendar-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openCalendar(page);
      await capturePadded(page, rec, 'calendar-1', {
        create: byTestId(page, 'calendar-new-event'),
        mini: byTestId(page, 'calendar-mini'),
        calendars: [
          page.getByText('내 캘린더', { exact: true }),
          page.getByLabel('캘린더 추가'),
          page.getByLabel('캘린더 표시: 기본'),
          page.getByText('기본', { exact: true }).first(), // 캘린더 행 이름 — 체크 상자만 넣으면 상자 아래 끝이 이름 글자에 걸친다
          { pad: 8 }, // 「내 캘린더」 글자 요소의 상자가 글자 왼쪽 끝에 붙어 있어 더 띄운다
        ],
        nav: [page.getByRole('button', { name: '오늘', exact: true }), page.getByText('2026년 10월').last(), { pad: 8 }], // 제목 글자 상자가 글자보다 좁다
        views: [byTestId(page, 'calendar-view-month-btn'), byTestId(page, 'calendar-view-agenda-btn')],
        // 글자가 아니라 마감 칩 전체(깃발·점선 테두리 포함)를 감싼다 — 글자만 감싸면 테두리가 제목을 덮는다.
        due: page.locator('[data-testid^=calendar-issue-due-]').filter({ hasText: '쿠폰 중복 적용 정책 정리' }).first(),
      });
    },
  },
  {
    id: 'calendar-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openCalendar(page);
      await byTestId(page, 'calendar-view-agenda-btn').click();
      await page.getByText('MOB-15 페이링크 결제 연동 계약서 검토 회신').waitFor();
      await capturePadded(page, rec, 'calendar-2', {
        views: [byTestId(page, 'calendar-view-month-btn'), byTestId(page, 'calendar-view-agenda-btn')],
        due: page.getByText('MOB-14 베타 오픈 Go/No-Go 체크리스트 확정'),
        event: page.getByText('재주문 디자인 리뷰'),
      });
    },
  },
  {
    // 새 일정 창 — 제목만 넣고 저장하지 않는다. 시작·끝은 FIXED_NOW 기준 기본값(오늘 18:20~19:20).
    id: 'calendar-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openCalendar(page);
      await byTestId(page, 'calendar-new-event').click();
      const d = dialog(page);
      await byTestId(page, 'calendar-form-title').fill('베타 오픈 회고');
      await capturePadded(page, rec, 'calendar-3', {
        dialog: d,
        title: byTestId(page, 'calendar-form-title'),
        time: [d.locator('input[type=datetime-local]').first(), d.locator('input[type=datetime-local]').last(), d.getByLabel('반복')],
        place: d.getByPlaceholder('장소 추가'),
        attendees: d.getByLabel('참석자 추가'),
        reminder: d.getByLabel('알림(리마인더)'),
        save: d.getByRole('button', { name: '저장' }),
      });
      await closeDialog(page);
    },
  },
  {
    // 내가 만든 일정을 누르면 바로 수정 창이 열린다 — 참석자 응답 상태를 보여 주고, 수정·삭제하지 않고 닫는다.
    id: 'calendar-4',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openCalendar(page);
      await page.getByText('스프린트 7 데일리').first().click();
      const d = dialog(page);
      await d.getByRole('heading', { name: '일정 수정' }).waitFor();
      await capturePadded(page, rec, 'calendar-4', {
        dialog: d,
        attendees: d.getByLabel('참석자', { exact: true }),
        delete: d.getByRole('button', { name: '삭제' }),
        update: d.getByRole('button', { name: '수정' }),
      });
      await closeDialog(page);
    },
  },
  {
    // 캘린더 추가 창 — 이름을 넣기만 하고 추가하지 않는다.
    id: 'calendar-5',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openCalendar(page);
      await page.getByLabel('캘린더 추가').click();
      const d = dialog(page);
      await d.getByPlaceholder('캘린더 이름').fill('베타 오픈');
      await capturePadded(page, rec, 'calendar-5', {
        dialog: d,
        name: d.getByPlaceholder('캘린더 이름'),
        color: d.getByText('색상', { exact: true }),
        submit: d.getByRole('button', { name: '추가' }),
      });
      await closeDialog(page);
    },
  },
  {
    // 초대받은 일정 — 이준호가 주최한 일정을 누르면 읽기 전용 「일정 보기」가 열린다. 응답 단추는 누르지 않는다.
    id: 'calendar-6',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openCalendar(page);
      await page.getByText('포인트 결제 UI 구현 범위 논의').first().click();
      const d = dialog(page);
      await byTestId(page, 'event-detail-rsvp').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await capturePadded(page, rec, 'calendar-6', {
        dialog: d,
        readonly: byTestId(page, 'event-organizer-only-label'),
        attendees: [byTestId(page, 'event-detail-attendee').first(), byTestId(page, 'event-detail-attendee').last()],
        rsvp: byTestId(page, 'rsvp-controls'),
      });
      await closeDialog(page);
    },
  },
  {
    // 태그 — 사이드바 태그 목록과 태그 메뉴(이름·색 바꾸기·구독 주소…·태그 지우기). 항목은 누르지 않는다.
    id: 'calendar-7',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openCalendar(page);
      const rows = page.locator('[data-testid^=calendar-tag-item-]');
      await rows.first().waitFor();
      await rows.filter({ hasText: '출시' }).hover();
      await page.getByLabel('출시 태그 메뉴').click();
      const menu = page.getByRole('menu');
      await menu.getByText('구독 주소…').waitFor();
      await rec.mark('calendar-7', 'tags', page.getByText('태그', { exact: true }).first(), rows.last(), { pad: MARK_PAD });
      await rec.mark('calendar-7', 'menu', menu, { pad: MARK_PAD });
      await rec.mark('calendar-7', 'feed', menu.getByText('구독 주소…'), { pad: MARK_PAD });
      await rec.shoot(page, 'calendar-7');
      await page.keyboard.press('Escape');
    },
  },

  // ── 08 작업 관리 ── 이슈·프로젝트를 만들거나 고치지 않는다. 창·메뉴는 열고 닫기만 한다.
  {
    id: 'work-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/projects');
      await page.getByText('모바일 주문 앱 2.0').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await capturePadded(page, rec, 'work-1', {
        nav: [page.getByRole('link', { name: '내 작업' }), page.getByRole('link', { name: '전체 보기' })],
        create: page.getByRole('button', { name: /새 프로젝트/ }).last(), // 머리의 「+ 새 프로젝트」(사이드바 「+」 도 같은 이름이다)
        row: page.getByRole('link', { name: /모바일 주문 앱 2\.0/ }).first(),
      });
    },
  },
  {
    id: 'work-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openProject(page, '목록');
      await capturePadded(page, rec, 'work-2', {
        pages: [page.getByRole('button', { name: '사이클' }), page.getByRole('button', { name: '설정' })],
        create: page.getByRole('button', { name: /새 태스크/ }),
        filters: byTestId(page, 'issue-filter-main'),
        view: page.getByRole('group', { name: '뷰 전환' }),
        group: page.getByText('스프린트 7', { exact: true }).first(),
      });
    },
  },
  {
    id: 'work-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openProject(page, '보드');
      try {
        await capturePadded(page, rec, 'work-3', {
          view: page.getByRole('group', { name: '뷰 전환' }),
          column: page.getByText('진행 중', { exact: true }).nth(1),
          card: byTestId(page, 'issue-card-14'), // 카드 전체(MOB-14)
        });
      } finally {
        await page.getByRole('group', { name: '뷰 전환' }).getByRole('button').first().click(); // 목록으로 되돌린다(보기 기억은 이 브라우저에만 남는다)
      }
    },
  },
  {
    // 새 이슈 창 — 제목만 넣고 「생성」 은 누르지 않는다.
    id: 'work-4',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openProject(page, '목록');
      await page.getByRole('button', { name: /새 태스크/ }).click();
      const d = dialog(page);
      await d.getByRole('heading', { name: '새 이슈' }).waitFor();
      await d.getByLabel(/제목/).first().fill('베타 테스터 피드백 정리');
      await capturePadded(page, rec, 'work-4', {
        dialog: d,
        title: d.getByLabel(/제목/).first(),
        body: d.getByText('본문', { exact: true }),
        fields: [byTestId(page, 'create-type-select'), d.locator('input[type=date]').last()],
        submit: d.getByRole('button', { name: '생성' }),
      });
      await closeDialog(page);
    },
  },
  {
    id: 'work-5',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openIssue(page, 7);
      await capturePadded(page, rec, 'work-5', {
        path: byTestId(page, 'issue-breadcrumb'),
        title: page.getByRole('heading', { name: /iOS 17에서 재주문/ }),
        children: page.getByText('하위 태스크', { exact: true }),
        activity: page.getByRole('region', { name: '활동' }).getByRole('tablist'),
        rail: page.getByText('상태·담당', { exact: true }),
      });
    },
  },
  {
    // 상태 목록만 연다(고르지 않는다).
    id: 'work-6',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openIssue(page, 7);
      const status = byTestId(page, 'issue-status-select');
      await status.click();
      const list = page.getByRole('listbox');
      await list.getByText('취소').waitFor();
      await capturePadded(page, rec, 'work-6', {
        panel: page.getByText('상태·담당', { exact: true }),
        status,
        list,
      });
      await page.keyboard.press('Escape');
    },
  },
  {
    id: 'work-7',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/me/tasks/assigned');
      await page.getByText('페이링크 결제 연동 계약서 검토 회신').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await capturePadded(page, rec, 'work-7', {
        tabs: [byTestId(page, 'tab-assigned'), byTestId(page, 'tab-watched')],
        filters: byTestId(page, 'me-task-filter-bar'),
        group: page.getByText('모바일 주문 앱 2.0', { exact: true }).last(),
        row: rowOf(page, 'assigned-row-', '페이링크 결제 연동 계약서 검토 회신', 'tr'), // tbody(assigned-row-project-*)는 빼고 행만
      });
    },
  },
  {
    id: 'work-8',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/projects/MOB/timeline');
      await page.getByText('베타 오픈').first().waitFor();
      await page.getByText('간편 재주문 (2/7)').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await capturePadded(page, rec, 'work-8', {
        scale: [page.getByRole('button', { name: '일', exact: true }), page.getByRole('button', { name: '마일스톤 추가' })],
        filter: page.getByRole('button', { name: /스프린트 7/ }).first(),
        list: page.getByText('이슈', { exact: true }).first(),
        milestone: page.getByText('베타 오픈', { exact: true }).first(),
      });
    },
  },

  // ── 09 드라이브 ── 올리기·폴더 만들기·이동·삭제·공유 링크 만들기는 하지 않는다.
  {
    id: 'drive-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openDriveSpace(page);
      await capturePadded(page, rec, 'drive-1', {
        spaces: byTestId(page, 'drive-space-list'),
        actions: [byTestId(page, 'drive-new-folder'), byTestId(page, 'trash-toggle')],
        search: page.getByLabel('파일명 및 콘텐츠 검색'),
        row: rowOf(page, 'drive-row-folder-', '기획'),
        attachments: byTestId(page, 'drive-nav-attachments'),
        usage: byTestId(page, 'drive-usage-bar'),
      });
    },
  },
  {
    // 폴더 안 — 파일 행에 마우스를 올리고 「⋯」 메뉴를 연다(항목은 누르지 않는다).
    id: 'drive-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openDriveSpace(page);
      await page.getByText('기획', { exact: true }).first().dblclick();
      const file = page.getByText('모바일 주문 앱 2.0 요구사항 정의서.pdf');
      await file.waitFor();
      await file.hover();
      await page.getByLabel('모바일 주문 앱 2.0 요구사항 정의서.pdf 더보기').click();
      const menu = page.getByRole('menu');
      await menu.getByText('버전 이력').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await rec.mark('drive-2', 'path', byTestId(page, 'drive-breadcrumb').first(), { pad: MARK_PAD });
      await rec.mark('drive-2', 'file', rowOf(page, 'drive-row-file-', '모바일 주문 앱 2.0 요구사항 정의서.pdf'), { pad: MARK_PAD });
      await rec.mark('drive-2', 'menu', menu, { pad: MARK_PAD });
      await rec.shoot(page, 'drive-2');
      await page.keyboard.press('Escape');
    },
  },
  {
    id: 'drive-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openDriveSpace(page);
      await byTestId(page, 'drive-new-folder').click();
      const d = dialog(page);
      await d.getByPlaceholder('폴더 이름').fill('디자인 시안');
      await capturePadded(page, rec, 'drive-3', {
        dialog: d,
        name: d.getByPlaceholder('폴더 이름'),
        submit: d.getByRole('button', { name: '만들기' }),
      });
      await closeDialog(page);
    },
  },

  {
    // 공유 링크 창 — 열기만 하고 「링크 생성」 은 누르지 않는다.
    id: 'drive-4',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openDriveSpace(page);
      await page.getByText('기획', { exact: true }).first().dblclick();
      const file = page.getByText('모바일 주문 앱 2.0 요구사항 정의서.pdf');
      await file.waitFor();
      await file.hover();
      await page.getByLabel('모바일 주문 앱 2.0 요구사항 정의서.pdf 공유').click();
      const d = byTestId(page, 'share-link-modal');
      await byTestId(page, 'share-link-create-btn').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await capturePadded(page, rec, 'drive-4', {
        dialog: d,
        audience: d.getByRole('radiogroup', { name: '공유 대상' }),
        options: [d.getByLabel('비밀번호 (선택)'), d.getByLabel('만료일 (선택)')],
        create: byTestId(page, 'share-link-create-btn'),
      });
      await closeDialog(page);
    },
  },

  // ── 10 노트 ── 본문을 고치지 않는다(에디터는 열기만 — 동기화 연결은 빈 갱신만 보낸다). 메뉴·창은 열고 닫기만 한다.
  {
    id: 'wiki-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openWikiPage(page);
      await capturePadded(page, rec, 'wiki-1', {
        space: page.getByRole('combobox').first(),
        tree: [page.getByText('페이지', { exact: true }).first(), page.getByLabel('새 페이지'), page.getByText('출시 체크리스트').first()],
        path: byTestId(page, 'wiki-breadcrumb').first(),
        header: [byTestId(page, 'wiki-share-button'), byTestId(page, 'wiki-ai-header-button')],
        body: byTestId(page, 'page-body-content'),
      });
    },
  },
  {
    id: 'wiki-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openWikiPage(page);
      await byTestId(page, 'wiki-page-menu').click();
      const menu = page.getByRole('menu');
      await menu.getByText('버전 기록').waitFor();
      await capturePadded(page, rec, 'wiki-2', {
        trigger: byTestId(page, 'wiki-page-menu'),
        menu,
        history: byTestId(page, 'wiki-menu-history'),
      });
      await page.keyboard.press('Escape');
    },
  },
  {
    // 공유 창 — 열기만 하고 링크 공유를 켜거나 바꾸지 않는다.
    id: 'wiki-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openWikiPage(page);
      await byTestId(page, 'wiki-share-button').click();
      const d = byTestId(page, 'wiki-share-dialog');
      await byTestId(page, 'wiki-share-switch').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await capturePadded(page, rec, 'wiki-3', {
        dialog: d,
        toggle: byTestId(page, 'wiki-share-switch'),
      });
      await closeDialog(page);
    },
  },

  // ── 11 연락처 ── 즐겨찾기·추가·수정·삭제는 하지 않는다.
  {
    id: 'contacts-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/contacts');
      await page.getByText('한지우').first().click();
      await page.getByText('외부 연락처 · 공유').waitFor();
      await page.mouse.move(0, 0);
      await page.evaluate(() => document.fonts.ready);
      await capturePadded(page, rec, 'contacts-1', {
        views: [page.getByText('전체', { exact: true }).first(), page.getByText('즐겨찾기', { exact: true }).first()],
        groups: [page.getByText('조직도', { exact: true }).first(), page.getByText('그룹이 없습니다')],
        search: page.getByLabel('연락처 검색'),
        row: rowOf(page, 'contact-row-', 'jiwoo.han@partner.example.com'),
        detail: [page.getByRole('heading', { name: '한지우' }), page.getByText('jiwoo.han@partner.example.com').last(), page.getByText('메모', { exact: true })],
        create: page.getByRole('button', { name: '새 외부 연락처' }),
      });
    },
  },
  {
    id: 'contacts-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openApp(page, '/contacts');
      await page.getByRole('button', { name: '새 외부 연락처' }).click();
      const d = dialog(page);
      await d.getByText('공개 범위').waitFor();
      await d.getByLabel(/이름/).first().fill('윤하늘');
      await d.getByLabel('이메일').fill('haneul.yoon@print.example.com');
      await d.getByLabel('소속').fill('하늘인쇄');
      await capturePadded(page, rec, 'contacts-2', {
        dialog: d,
        name: d.getByLabel(/이름/).first(),
        fields: [d.getByLabel('이메일'), d.getByLabel('메모')],
        scope: d.getByLabel('공개 범위'),
        save: d.getByRole('button', { name: '저장' }),
      });
      await closeDialog(page);
    },
  },
];
