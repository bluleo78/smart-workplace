// operator 매뉴얼 촬영 장면 목록(WP-1195). 촬영 대상 표(shots/targets.md 「운영자 매뉴얼」)를 구현한다.
//
// 장면 형식:
//   { id: '샷-id', shots?: ['샷-id', ...], account: '계정 아이디', async run({ page, rec, api }) { ... } }
//   - page: 로그인된 Playwright 페이지(운영자 책은 뷰포트 900x810, 배율 2, 라이트 테마 — books.mjs capture.viewport)
//   - rec:  createShotRecorder — 장면은 capture() 로 표식 좌표를 쌓고 그림을 저장한다
//   - api:  (method, path, body?) → JSON. MANUAL_API/api/platform 에 운영자 토큰으로 요청하는 시드용 헬퍼
//
// 페이지는 계정별로 공유된다: 장면은 먼저 자기 시작 URL 로 goto 한다(앞 장면의 화면이 남아 있을 수 있다).
// mark 와 shoot 는 같은 스크롤 위치에서 한다: 스크린샷은 뷰포트 기준이라 스크롤하면 좌표가 어긋난다(capture() 가 붙여서 한다).
// 결정적으로 찍는다: 토스트 숨김·애니메이션 정지는 촬영 컨텍스트가, 입력 커서 숨김은 rec.shoot 이 한다(capture-kit).
// capture() 는 찍기 직전에 마우스를 구석으로 옮겨 클릭한 단추·행에 남은 hover 강조를 없앤다.
// 한 장면이 여러 그림을 찍으면 shots 로 밝힌다 — MANUAL_SHOTS_ONLY 에 그림 id 를 적으면 그 장면이 돈다.
// 생성·편집·멤버 추가 창은 채우기만 하고 제출하지 않는다 — 다시 찍어도 같은 데이터·같은 화면이 나오게.
// 전제: seed-operator.mjs 를 돌린 격리 스택. 영구 삭제 장면은 돌 때마다 자기 테넌트(별빛스튜디오)를 새로 만들어 그것만 지운다.
import { newShotContext } from '../lib/capture-kit.mjs';
import { BOOKS } from '../lib/books.mjs';
import { OPERATOR } from '../lib/operator-seed.mjs';

const ACCOUNT = OPERATOR.username;
const WEB = () => process.env.MANUAL_WEB; // capture.mjs 가 촬영 전에 있는지 확인한다

/**
 * 그림 한 장을 찍는다 — 마우스를 구석으로 옮기고(hover 강조 제거), marks 를 적은 순서대로 기록한 뒤 저장한다.
 * marks 는 { 키: 로케이터 | [로케이터...] }. 배열이면 합집합 상자다. 적은 순서가 boxes.json 의 키 순서가 된다.
 */
async function capture(page, rec, id, marks) {
  await page.mouse.move(0, 0);
  for (const [key, loc] of Object.entries(marks)) await rec.mark(id, key, ...[loc].flat());
  await rec.shoot(page, id);
}

// 열린 대화 창(일반·확인 창 공용) — 여러 개면 마지막에 열린 것.
const dialog = (page) => page.locator('[role=dialog], [role=alertdialog]').last();

/** 여는 단추(data-testid)를 눌러 대화 창을 열고, 창이 나타나면 그 창을 돌려준다. */
async function openDialog(page, openerTestId) {
  await page.getByTestId(openerTestId).click();
  const d = dialog(page);
  await d.waitFor();
  return d;
}

/** 대화 창을 제출·확정하지 않고 닫는다. */
const closeDialog = (page) => page.keyboard.press('Escape');

// 테넌트 이름 → id. 목록은 한 번만 받아 두고, 모르는 이름이면(실행 중에 만든 테넌트 등) 다시 받는다.
let tenantIds = new Map();
/** 이름으로 테넌트 id 를 찾는다(시드가 만든 것). 없으면 시드부터 돌리라고 알린다. */
async function tenantId(api, name) {
  if (!tenantIds.has(name)) tenantIds = new Map((await api('GET', '/tenants')).map((t) => [t.name, t.id]));
  if (!tenantIds.has(name)) throw new Error(`테넌트 ${name} 이 없다 — seed-operator.mjs 를 먼저 돌린다`);
  return tenantIds.get(name);
}

/** 테넌트 상세를 열고 정보 카드·멤버 표가 다 그려질 때까지 기다린다. */
async function openTenant(page, api, name) {
  await page.goto(`${WEB()}/tenants/${await tenantId(api, name)}`);
  await page.getByTestId('tenant-detail-name').filter({ hasText: name }).waitFor();
  await page.getByTestId('member-row').first().waitFor();
}

/** 목록(/)을 열고 행이 그려질 때까지 기다린다. */
async function openList(page, query = '') {
  await page.goto(`${WEB()}/${query}`);
  await page.getByTestId('tenant-row').first().waitFor();
}

// 자주 쓰는 영역 — 상세 정보 카드(제목·편집·정지가 든 첫 카드).
const infoCard = (page) => page.locator('[data-slot=card]').filter({ has: page.getByTestId('tenant-detail-name') });
// 목록 화면 머리(제목 + 테넌트 생성 + 보기 전환)와 표.
const listHeader = (page) => [page.getByRole('heading', { name: '테넌트', exact: true }), page.getByTestId('create-tenant-button'), page.getByRole('group', { name: '테넌트 보기' })];
const listTable = (page) => page.locator('table').first();
const byTestId = (page, id) => page.getByTestId(id);

export const scenes = [
  // ── 01 소개와 로그인 ──
  {
    id: 'introduction-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      // 로그인 화면은 로그아웃 상태여야 한다 — 공유 페이지를 로그아웃시키지 않고 새 컨텍스트에서 찍는다.
      const ctx = await newShotContext(page.context().browser(), BOOKS.operator.capture.viewport);
      try {
        const p = await ctx.newPage();
        await p.goto(`${WEB()}/login`);
        await byTestId(p, 'login-username').fill(ACCOUNT);
        await byTestId(p, 'login-password').fill('password-mask'); // 화면에는 점으로만 보인다(실제 비밀번호 아님)
        await capture(p, rec, 'introduction-1', {
          card: p.locator('[data-slot=card]'),
          username: byTestId(p, 'login-username'),
          password: byTestId(p, 'login-password'),
          submit: byTestId(p, 'login-submit'),
        });
      } finally {
        await ctx.close();
      }
    },
  },
  {
    id: 'introduction-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openList(page);
      await capture(page, rec, 'introduction-2', { tenants: byTestId(page, 'admin-nav-테넌트'), user: byTestId(page, 'admin-user-menu') });
    },
  },
  {
    id: 'introduction-3',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openList(page);
      await byTestId(page, 'admin-user-menu').click();
      const menu = page.getByRole('menu');
      await menu.waitFor();
      await capture(page, rec, 'introduction-3', {
        menu,
        trigger: byTestId(page, 'admin-user-menu'),
        theme: page.getByRole('menuitem', { name: '테마 전환' }),
        logout: page.getByRole('menuitem', { name: '로그아웃' }),
      });
      await page.keyboard.press('Escape');
    },
  },

  // ── 02 테넌트 만들기와 고치기 ──
  {
    id: 'tenants-1',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openList(page);
      await capture(page, rec, 'tenants-1', {
        header: listHeader(page),
        table: listTable(page),
        toggle: page.getByRole('group', { name: '테넌트 보기' }),
        row: byTestId(page, 'tenant-row').filter({ hasText: '누리커머스' }),
      });
    },
  },
  {
    id: 'tenants-2',
    account: ACCOUNT,
    async run({ page, rec }) {
      await openList(page);
      const d = await openDialog(page, 'create-tenant-button');
      await byTestId(page, 'create-tenant-name').fill('바른회계');
      await byTestId(page, 'create-tenant-owner').fill('minjae@example.com');
      await byTestId(page, 'create-tenant-owner-check').click();
      await byTestId(page, 'create-tenant-owner-found').waitFor();
      await capture(page, rec, 'tenants-2', {
        dialog: d,
        name: byTestId(page, 'create-tenant-name'),
        slug: byTestId(page, 'create-tenant-slug'),
        owner: byTestId(page, 'create-tenant-owner'),
        check: byTestId(page, 'create-tenant-owner-check'),
        submit: byTestId(page, 'create-tenant-submit'),
      });
      await closeDialog(page); // 제출하지 않는다
    },
  },
  {
    id: 'tenants-3',
    account: ACCOUNT,
    async run({ page, rec, api }) {
      await openTenant(page, api, '누리커머스');
      await capture(page, rec, 'tenants-3', {
        card: infoCard(page),
        quota: byTestId(page, 'quota-section'),
        edit: byTestId(page, 'edit-tenant-button'),
      });
    },
  },
  {
    id: 'tenants-4',
    account: ACCOUNT,
    async run({ page, rec, api }) {
      await openTenant(page, api, '누리커머스');
      const d = await openDialog(page, 'edit-tenant-button');
      // 창이 열리면 이름 칸이 글자 전체가 선택된 채 포커스를 받는다 — 선택을 끝으로 접어 글자가 반전되어 찍히지 않게 한다.
      await byTestId(page, 'edit-tenant-name').evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
      await capture(page, rec, 'tenants-4', {
        dialog: d,
        name: byTestId(page, 'edit-tenant-name'),
        slug: byTestId(page, 'edit-tenant-slug'),
        save: byTestId(page, 'edit-tenant-submit'),
      });
      await closeDialog(page);
    },
  },

  // ── 03 테넌트 구성원 ──
  {
    id: 'tenant-members-1',
    account: ACCOUNT,
    async run({ page, rec, api }) {
      await openTenant(page, api, '누리커머스');
      const section = page.locator('section').filter({ has: byTestId(page, 'add-member-button') });
      await section.scrollIntoViewIfNeeded();
      await capture(page, rec, 'tenant-members-1', {
        members: section,
        add: byTestId(page, 'add-member-button'),
        table: section.locator('table'),
      });
    },
  },
  {
    id: 'tenant-members-2',
    account: ACCOUNT,
    async run({ page, rec, api }) {
      await openTenant(page, api, '다온헬스케어');
      const d = await openDialog(page, 'add-member-button');
      await byTestId(page, 'add-member-email').fill('yuna@example.com');
      await byTestId(page, 'add-member-check').click();
      await byTestId(page, 'add-member-found-card').waitFor();
      await capture(page, rec, 'tenant-members-2', {
        dialog: d,
        email: byTestId(page, 'add-member-email'),
        check: byTestId(page, 'add-member-check'),
        found: byTestId(page, 'add-member-found-card'),
        role: byTestId(page, 'add-member-role'),
        submit: byTestId(page, 'add-member-submit'),
      });
      await closeDialog(page);
    },
  },
  {
    id: 'tenant-members-3',
    account: ACCOUNT,
    async run({ page, rec, api }) {
      await openTenant(page, api, '다온헬스케어');
      const d = await openDialog(page, 'add-member-button');
      await byTestId(page, 'add-member-email').fill('sumin@example.com'); // 시드에 없는 가상 이메일
      await byTestId(page, 'add-member-check').click();
      await byTestId(page, 'add-member-name').waitFor();
      await byTestId(page, 'add-member-name').fill('한수민');
      await byTestId(page, 'add-member-password').fill('password-mask'); // 점으로만 보인다
      await capture(page, rec, 'tenant-members-3', {
        dialog: d,
        notice: d.getByText('신규 계정을 생성합니다.'),
        name: byTestId(page, 'add-member-name'),
        password: byTestId(page, 'add-member-password'),
        role: byTestId(page, 'add-member-role'),
        submit: byTestId(page, 'add-member-submit'),
      });
      await closeDialog(page);
    },
  },

  // ── 04 테넌트 정지·활성화와 삭제 ──
  {
    id: 'tenant-lifecycle-1',
    account: ACCOUNT,
    async run({ page, rec, api }) {
      await openTenant(page, api, '한빛물류');
      await capture(page, rec, 'tenant-lifecycle-1', { card: infoCard(page), suspend: byTestId(page, 'suspend-button') });
    },
  },
  {
    id: 'tenant-lifecycle-2',
    account: ACCOUNT,
    async run({ page, rec, api }) {
      await openTenant(page, api, '새솔디자인');
      await capture(page, rec, 'tenant-lifecycle-2', {
        card: infoCard(page),
        status: infoCard(page).getByTestId('tenant-status'),
        activate: byTestId(page, 'activate-button'),
      });
    },
  },
  {
    id: 'tenant-lifecycle-3',
    account: ACCOUNT,
    async run({ page, rec, api }) {
      await openTenant(page, api, '다온헬스케어');
      const danger = byTestId(page, 'danger-zone');
      await danger.scrollIntoViewIfNeeded();
      await capture(page, rec, 'tenant-lifecycle-3', { danger, delete: byTestId(page, 'delete-button') });
    },
  },
  {
    id: 'tenant-lifecycle-4',
    account: ACCOUNT,
    async run({ page, rec, api }) {
      await openTenant(page, api, '다온헬스케어');
      const d = await openDialog(page, 'delete-button');
      await capture(page, rec, 'tenant-lifecycle-4', { dialog: d, confirm: byTestId(page, 'confirm-delete') });
      await closeDialog(page); // 확정하지 않는다
    },
  },
  {
    id: 'tenant-lifecycle-5',
    account: ACCOUNT,
    async run({ page, rec, api }) {
      await openTenant(page, api, '푸른교육');
      await byTestId(page, 'tenant-deleted-banner').waitFor();
      await capture(page, rec, 'tenant-lifecycle-5', {
        banner: byTestId(page, 'tenant-deleted-banner'),
        card: infoCard(page),
        restore: byTestId(page, 'restore-button'),
      });
    },
  },
  {
    // 영구 삭제 확인 창(7) → 진행 배너(8) → 삭제됨 목록(6). 8·6 은 7 에서 실제로 영구 삭제를 시작해야 나오므로 한 장면이다.
    // 영구 삭제는 되돌릴 수 없어 돌 때마다 테넌트를 새로 만든다 — 이름은 같아도 된다(테넌트 이름은 유일 제약이 없다).
    // slug 는 비어 있는 첫 값(byeolbit-studio, -2, …)을 쓴다: 깨끗한 DB 에서는 늘 byeolbit-studio 라 그림이 같다.
    id: 'tenant-lifecycle-7',
    shots: ['tenant-lifecycle-7', 'tenant-lifecycle-8', 'tenant-lifecycle-6'],
    account: ACCOUNT,
    async run({ page, rec, api }) {
      const NAME = '별빛스튜디오';
      const used = new Set((await api('GET', '/tenants')).map((t) => t.slug));
      let slug = 'byeolbit-studio';
      for (let i = 2; used.has(slug); i++) slug = `byeolbit-studio-${i}`;
      const t = await api('POST', '/tenants', { name: NAME, slug });
      await api('POST', `/tenants/${t.id}/delete`);
      await page.goto(`${WEB()}/tenants/${t.id}`);
      await byTestId(page, 'tenant-deleted-banner').waitFor();
      // 멤버 표가 다 그려진 뒤(구성원 없음 안내) 본문을 맨 아래로 내린다 — 표가 그려지는 중에 단추를 누르면 스크롤 위치가
      // 그때그때 달라져 확인 창 뒤 화면이 바뀐다. 맨 아래로 고정하면 위험 구역 전체가 보이는 같은 위치가 된다.
      await page.getByText('멤버가 없습니다.').waitFor();
      await page.locator('main').evaluate((el) => (el.scrollTop = el.scrollHeight));
      const d = await openDialog(page, 'purge-button');
      await byTestId(page, 'purge-confirm-input').fill(NAME);
      // 되돌릴 수 없는 클릭 전에 확인 창 그림을 끝낸다.
      await capture(page, rec, 'tenant-lifecycle-7', {
        dialog: d,
        input: byTestId(page, 'purge-confirm-input'),
        confirm: byTestId(page, 'purge-confirm'),
      });

      await byTestId(page, 'purge-confirm').click();
      const banner = byTestId(page, 'tenant-purging-banner');
      await banner.waitFor();
      await capture(page, rec, 'tenant-lifecycle-8', {
        banner,
        card: infoCard(page),
        status: infoCard(page).getByTestId('tenant-status'),
      });

      // 삭제됨 목록 — 방금 영구 삭제를 시작한 테넌트가 「영구 삭제 중…」 으로 함께 보인다.
      await openList(page, '?view=deleted');
      await byTestId(page, 'tenant-row').filter({ hasText: NAME }).first().waitFor();
      await capture(page, rec, 'tenant-lifecycle-6', {
        header: listHeader(page),
        table: listTable(page),
        toggle: byTestId(page, 'tenant-view-deleted'),
        rows: page.locator('tbody'),
      });
    },
  },
];
