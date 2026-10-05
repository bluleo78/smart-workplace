#!/usr/bin/env node
/**
 * 소개 자료 화면 촬영 스크립트.
 *
 *   INTRO_WEB=http://localhost:6273 INTRO_API=http://localhost:6160 node docs/intro/scripts/capture-screens.mjs
 *   INTRO_SHOTS_ONLY=home,calendar node ...   # 일부만 다시 찍기
 *
 * 전제: seed-demo.mjs → seed-ai.mjs 까지 끝난 격리 스택(README 참조). 운영·공유 DB 를 찍지 않는다.
 *
 * 규격: 뷰포트 1440×810(16:9) · deviceScaleFactor 2 → 2880×1620. 1440 은 사이드바·속성 패널이 겹치지 않으면서
 * 슬라이드에 넣었을 때 글자가 너무 작아지지 않는 폭이다. 확대 컷은 같은 배율의 요소 촬영으로 따로 남긴다.
 *
 * 화면은 문구가 아니라 data-testid 로 찾는다 — AI 결과물 문구는 실행마다 달라지기 때문이다.
 * 브라우저 인증은 로그인 화면을 거친다(access token 이 메모리에만 있어 저장소 주입으로 흉내 낼 수 없다).
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PEOPLE, AGENT, PROJECT_KEY, login } from './seed-demo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const SHOTS = path.join(ROOT, 'docs/intro/deck/shots');
const WEB = process.env.INTRO_WEB ?? 'http://localhost:6173';
const API = (process.env.INTRO_API ?? 'http://localhost:6160') + '/api/v1';
const PASSWORD = process.env.INTRO_PASS ?? 'IntroShot1!';
const AI_WAIT = 4 * 60 * 1000;

const require = createRequire(path.join(ROOT, 'apps/workplace-web/package.json'));
const { chromium } = require('@playwright/test');

const ONLY = process.env.INTRO_SHOTS_ONLY ? new Set(process.env.INTRO_SHOTS_ONLY.split(',')) : null;

async function api(token, method, p, body) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** 화면이 자리를 잡을 때까지 — 네트워크 정지 + 애니메이션 여유. */
async function settle(page, ms = 1200) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
}

async function shoot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  console.log(`  ${name}.png`);
}

/** 요소 하나만 같은 배율로 — 슬라이드의 확대 컷용. pad 만큼 주변을 넉넉히 포함한다. */
async function shootElement(page, locator, name, pad = 12) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${name}: 요소가 화면에 없다`);
  await page.screenshot({
    path: path.join(SHOTS, `${name}.png`),
    clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 },
  });
  console.log(`  ${name}.png (확대 컷)`);
}

/**
 * 슬라이드 번호 표시용 좌표 기록 — 요소의 실제 위치를 원본 px(=CSS px × 배율)로 남긴다.
 * deck.js 가 이 좌표로 빨간 박스·지시선을 그리므로, 화면이 바뀌어도 재촬영만 하면 표시가 따라온다.
 */
const BOXES = {};
async function mark(page, shot, key, locator, dpr = 2) {
  const box = await locator.first().boundingBox();
  if (!box) throw new Error(`${shot}:${key} 표시 대상이 화면에 없다`);
  BOXES[shot] ??= {};
  BOXES[shot][key] = { x: Math.round(box.x * dpr), y: Math.round(box.y * dpr), w: Math.round(box.width * dpr), h: Math.round(box.height * dpr) };
}

/** 여러 요소를 함께 감싸는 영역(예: 목록 머리~마지막 줄)을 기록한다. */
async function markUnion(page, shot, key, locators, dpr = 2) {
  const boxes = await Promise.all(locators.map((l) => l.first().boundingBox()));
  if (boxes.some((b) => !b)) throw new Error(`${shot}:${key} 표시 대상이 화면에 없다`);
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.width));
  const btm = Math.max(...boxes.map((b) => b.y + b.height));
  BOXES[shot] ??= {};
  BOXES[shot][key] = { x: Math.round(x * dpr), y: Math.round(y * dpr), w: Math.round((r - x) * dpr), h: Math.round((btm - y) * dpr) };
}

/** 기록한 좌표를 shots/boxes.js 로 쓴다. 일부만 다시 찍을 때는 기존 좌표와 합친다. */
async function writeBoxes() {
  const file = path.join(SHOTS, 'boxes.js');
  let prev = {};
  try {
    const text = await readFile(file, 'utf8');
    prev = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch {
    /* 첫 촬영 */
  }
  const merged = { ...prev, ...BOXES };
  await writeFile(file, `// capture-screens.mjs 가 생성 — 손으로 고치지 않는다.\nwindow.SHOT_BOXES = ${JSON.stringify(merged, null, 1)};\n`);
}

/** 장면 하나를 실행한다 — 실패해도 나머지는 계속 찍고, 끝에 실패 목록을 보고한다. */
const failures = [];
async function scene(name, fn) {
  if (ONLY && !ONLY.has(name)) return;
  console.log(`▶ ${name}`);
  try {
    await fn();
  } catch (e) {
    failures.push(`${name}: ${e.message.split('\n')[0]}`);
    console.error(`  ✗ ${e.message.split('\n')[0]}`);
  }
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  // 전체 촬영이면 이전 원본을 비운다 — 한 장면이 실패했을 때 지난 실행의 다른 데이터 화면이 섞여 남지 않게.
  if (!ONLY) {
    for (const f of await readdir(SHOTS)) if (f.endsWith('.png') || f === 'boxes.js') await rm(path.join(SHOTS, f));
  }
  const pm = PEOPLE[0];
  const token = await login(pm.username);
  const agentId = (await api(token, 'GET', '/admin/agents')).find((a) => a.username === AGENT.username).id;

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 810 },
    deviceScaleFactor: 2,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    colorScheme: 'light',
  });
  const page = await context.newPage();
  await page.goto(`${WEB}/login`);
  await page.getByPlaceholder('아이디를 입력하세요').fill(pm.username);
  await page.locator('input[type=password]').fill(PASSWORD);
  await page.locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

  /** 표시 기록 실패는 촬영을 막지 않는다 — 없는 표시는 슬라이드에서 숨겨지고(deck.js) 경고만 남긴다. */
  const soft = (p) => p.catch((e) => console.warn(`  (표시 생략) ${e.message.split('\n')[0]}`));
  const channelByName = async (name) => {
    const list = await api(token, 'GET', '/messaging/channels');
    return (list.content ?? list).find((c) => c.name === name);
  };

  // 1·2장 — 홈
  await scene('home', async () => {
    await page.goto(`${WEB}/`);
    await settle(page);
    await soft(mark(page, 'home', 'rail', page.getByTestId('app-rail')));
    await soft(mark(page, 'home', 'counts', page.getByTestId('dashboard-counts')));
    await soft(mark(page, 'home', 'focus', page.getByTestId('dashboard-attention')));
    await soft(mark(page, 'home', 'ai', page.getByTestId('chat-launcher')));
    await shoot(page, 'home');
    // 홈은 멘션·알림이 "지금 신경 쓸 일"로 보여야 하므로 그대로 찍고, 이후 화면에는 배지 숫자가 남지 않도록 읽음 처리한다.
    await api(token, 'POST', '/notifications/read-all');
  });

  // 3장 — 담당자 선택창에 사람과 에이전트가 나란히
  await scene('assignee', async () => {
    await page.goto(`${WEB}/projects/${PROJECT_KEY}/issues/8`);
    await settle(page);
    await page.getByTestId('assignee-picker-trigger').click();
    await page.getByTestId(`assignee-option-${agentId}`).waitFor();
    await settle(page, 500);
    await soft(mark(page, 'assignee', 'picker', page.getByTestId('assignee-picker')));
    await soft(mark(page, 'assignee', 'agent', page.getByTestId(`assignee-option-${agentId}`)));
    await soft(mark(page, 'assignee', 'suggest', page.getByTestId('ai-classify-btn')));
    await shoot(page, 'assignee');
    await page.keyboard.press('Escape');
  });

  // 4장 — AI 가 처리한 이슈(회귀 테스트 체크리스트)
  await scene('ai-issue', async () => {
    const list = await api(token, 'GET', `/projects/${PROJECT_KEY}/issues?q=${encodeURIComponent('회귀 테스트 체크리스트')}`);
    const n = (list.content ?? list.items ?? list).find((i) => i.title.startsWith('MOB-7 회귀'))?.number ?? 16;
    await page.goto(`${WEB}/projects/${PROJECT_KEY}/issues/${n}`);
    await settle(page);
    const aiComments = page.locator('li[data-agent="true"]');
    await aiComments.first().waitFor();
    // 결과 코멘트(마지막 AI 코멘트)의 머리(작성자 "지니 · AI")가 화면 위쪽에 오도록 스크롤
    await aiComments.last().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.mouse.wheel(0, -160);
    await settle(page, 600);
    await mark(page, 'ai-issue', 'start', aiComments.first());
    await mark(page, 'ai-issue', 'result', aiComments.last());
    await shoot(page, 'ai-issue');
    await page.getByRole('tab', { name: '이력' }).click();
    await settle(page, 600);
    await markUnion(page, 'ai-issue-history', 'changes', [
      page.getByText('상태 변경: 할 일 → 진행 중'),
      page.getByText('상태 변경: 진행 중 → 완료'),
    ]);
    await shoot(page, 'ai-issue-history');
  });

  // 10장 근거 — AI 가 노트(PRD)를 읽고 일한 이슈(베타 안내 메일 초안)
  await scene('ai-note', async () => {
    const list = await api(token, 'GET', `/projects/${PROJECT_KEY}/issues?q=${encodeURIComponent('베타 테스터 안내 메일 초안')}`);
    const n = (list.content ?? list.items ?? list).find((i) => i.title === '베타 테스터 안내 메일 초안 작성')?.number ?? 14;
    await page.goto(`${WEB}/projects/${PROJECT_KEY}/issues/${n}`);
    await settle(page);
    const aiComments = page.locator('li[data-agent="true"]');
    await aiComments.first().waitFor();
    await aiComments.first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.mouse.wheel(0, -120);
    await settle(page, 600);
    await mark(page, 'ai-note', 'start', aiComments.first());
    await soft(mark(page, 'ai-note', 'result', aiComments.last()));
    await shoot(page, 'ai-note');
  });

  // 7장 — 채널: AI 가 올린 이슈 생성 제안 카드 → 승인(대기 중인 제안이 있을 때만)
  await scene('channel', async () => {
    const ch = await channelByName('모바일-주문앱');
    await page.goto(`${WEB}/chat/channels/${ch.id}`);
    await settle(page);
    const pending = page.locator('[data-testid^="proposal-confirm-"]').last();
    await pending.waitFor({ timeout: 15000 });
    const card = page.locator('[data-testid^="proposal-card-"]').last();
    await card.scrollIntoViewIfNeeded();
    await settle(page, 500);
    await soft(mark(page, 'channel-proposal', 'mention', page.locator('[data-testid^="message-"]').filter({ hasText: '@지니' }).last()));
    await mark(page, 'channel-proposal', 'card', card);
    await mark(page, 'channel-proposal', 'approve', pending);
    await shoot(page, 'channel-proposal');
    await pending.click();
    const id = (await card.getAttribute('data-testid')).replace('proposal-card-', '');
    await page.getByTestId(`proposal-confirmed-${id}`).waitFor({ timeout: 30000 });
    await page.getByText(/만들었어요/).last().waitFor({ timeout: 30000 });
    await settle(page);
    await mark(page, 'channel-confirmed', 'done', page.locator('[data-testid^="message-"]').filter({ hasText: '만들었어요' }).last());
    await soft(mark(page, 'channel-confirmed', 'card', card));
    await shoot(page, 'channel-confirmed');
  });

  // 5장 — AI 위임 작업: 채널에서 막 맡긴 일이 진행 중으로 보이는 시점에 찍는다
  await scene('ai-tasks', async () => {
    await page.goto(`${WEB}/me/ai-tasks`);
    await settle(page);
    await soft(mark(page, 'ai-tasks', 'nav', page.getByRole('link', { name: 'AI 위임 작업' })));
    await soft(mark(page, 'ai-tasks', 'rows', page.locator('table tbody, [role="table"]').first()));
    await shoot(page, 'ai-tasks');
  });

  // 8장 — 놓친 대화 요약(5건 이상 안 읽음 → 카드 자동 열림)
  await scene('catchup', async () => {
    const ch = await channelByName('디자인-리뷰');
    await page.goto(`${WEB}/chat/channels/${ch.id}`);
    const card = page.getByTestId('catchup-card');
    await card.waitFor({ timeout: 30000 });
    await page.getByTestId('catchup-skeleton').waitFor({ state: 'detached', timeout: AI_WAIT });
    await settle(page, 800);
    await mark(page, 'catchup', 'card', card);
    await shoot(page, 'catchup');
  });

  // 8장 — 이슈 AI 현황 요약 + 이슈 채팅의 AI 답변
  await scene('issue-summary', async () => {
    await page.goto(`${WEB}/projects/${PROJECT_KEY}/issues/7`);
    await settle(page);
    const ctx = page.getByTestId('issue-instant-context');
    await ctx.waitFor();
    await mark(page, 'issue-summary', 'card', ctx);
    await soft(mark(page, 'issue-summary', 'suggest', page.getByTestId('ai-classify-btn')));
    await soft(mark(page, 'issue-summary', 'chat', page.getByTestId('issue-chat-open')));
    await shoot(page, 'issue-summary');
    await page.getByTestId('issue-chat-open').click();
    const drawer = page.getByTestId('issue-chat-drawer');
    await drawer.waitFor();
    await settle(page, 1500);
    await mark(page, 'issue-chat', 'drawer', drawer);
    await shoot(page, 'issue-chat');
  });

  // 6장 — 어디서든 ⌘K 로 AI 에게 요청
  await scene('ai-panel', async () => {
    await page.goto(`${WEB}/projects/${PROJECT_KEY}`);
    await settle(page);
    await soft(mark(page, 'ai-panel', 'launcher', page.getByTestId('chat-launcher')));
    await page.getByTestId('chat-launcher').click();
    const input = page.getByTestId('chat-input');
    await input.waitFor();
    await input.fill('이번 주 재주문 기능 진행 상황이랑 내 일정 정리해 줘');
    await page.getByRole('button', { name: '보내기' }).click();
    await page.getByTestId('chat-stop').waitFor({ timeout: 30000 });
    await page.getByTestId('chat-stop').waitFor({ state: 'detached', timeout: AI_WAIT });
    await settle(page, 1500);
    await mark(page, 'ai-panel', 'answer', page.getByTestId('chat-scroll'));
    await soft(mark(page, 'ai-panel', 'context', page.getByText('화면 참고').first()));
    await shoot(page, 'ai-panel');
    await page.keyboard.press('Escape');
  });

  // 9장 — 계획과 진행
  await scene('project', async () => {
    await page.goto(`${WEB}/projects/${PROJECT_KEY}`);
    await settle(page);
    await soft(mark(page, 'project', 'cycle', page.getByText('스프린트 7').first().locator('xpath=ancestor::*[contains(@class,"border")][1]')));
    await shoot(page, 'project');
    await page.goto(`${WEB}/projects/${PROJECT_KEY}/timeline`);
    await settle(page);
    await page.getByRole('button', { name: '오늘' }).click().catch(() => {});
    await settle(page, 800);
    await soft(mark(page, 'timeline', 'milestone', page.getByText('베타 오픈').first()));
    await shoot(page, 'timeline');
  });

  // 10장 — 노트: 팀 문서(PRD). AI 는 이 노트를 근거로 일한다(ai-note 장면).
  // "AI 초안 작성"은 스트리밍 결과의 마크다운(표·굵게·목록)이 깨져 들어가 소개 장면에서 뺐다(WP-255).
  await scene('wiki', async () => {
    const spaces = await api(token, 'GET', '/wiki/spaces');
    const space = (spaces.content ?? spaces).find((s) => s.name === '모바일 주문 앱');
    const pages = await api(token, 'GET', `/wiki/spaces/${space.id}/pages`);
    const target = (pages.content ?? pages.items ?? pages).find((p) => p.title === '제품 요구사항 (PRD)');
    await page.goto(`${WEB}/wiki/spaces/${space.id}/pages/${target.id}`);
    await settle(page, 2000);
    await soft(markUnion(page, 'wiki-prd', 'tree', [page.getByText('제품 요구사항 (PRD)').first(), page.getByText('출시 체크리스트').first()]));
    await shoot(page, 'wiki-prd');
  });

  // 메일 — 연결된 M365 계정의 데모 메일([누리커머스])만 검색해 보여 준다(실 메일 노출 방지).
  await scene('mail', async () => {
    await page.goto(`${WEB}/mail`);
    await settle(page);
    await page.getByTestId('mail-search').fill('【누리커머스】'); // send-demo-mail.mjs 의 제목 머리말
    await page.keyboard.press('Enter');
    await settle(page, 2000);
    const row = (subject) => page.locator('[data-testid^="mail-row-"]').filter({ hasText: subject }).first();
    await soft(markUnion(page, 'mail-list', 'rows', [row('포인트 결제'), row('배송 추적')]));
    await soft(mark(page, 'mail-list', 'category', page.locator('[data-testid^="mail-badge-category-"]').first()));

    // 메일 1: AI 요약 + 답장 초안
    await row('포인트 결제').click();
    await page.getByTestId('mail-detail').waitFor();
    await page.getByTestId('mail-ai-summary').waitFor({ timeout: AI_WAIT });
    await settle(page, 1500);
    await shoot(page, 'mail-list'); // 목록 + 열린 메일(요약 포함)을 한 장에
    await mark(page, 'mail-detail', 'summary', page.getByTestId('mail-ai-summary'));
    await mark(page, 'mail-detail', 'reply', page.getByTestId('mail-ai-reply-draft'));
    await mark(page, 'mail-detail', 'issue', page.getByTestId('mail-ai-issue'));
    await soft(markUnion(page, 'mail-detail', 'actions', [page.getByTestId('mail-ai-reply-draft'), page.getByTestId('mail-ai-issue')]));
    await shoot(page, 'mail-detail');
    await page.getByTestId('mail-ai-reply-draft').click();
    const dock = page.getByTestId('mail-compose-dock');
    await dock.waitFor({ timeout: AI_WAIT });
    // 초안이 본문에 채워질 때까지(입력란이 비어 있지 않을 때까지)
    await page.waitForFunction(() => {
      const d = document.querySelector('[data-testid="mail-compose-dock"]');
      return d && (d.innerText || '').length > 200;
    }, null, { timeout: AI_WAIT });
    await settle(page, 1500);
    await mark(page, 'mail-reply', 'dock', dock);
    await soft(mark(page, 'mail-reply', 'review', page.getByTestId('mail-review-tab')));
    await shoot(page, 'mail-reply');
    // 보내지 않고 닫는다(확인창이 뜨면 버리기)
    await page.getByTestId('mail-compose-close').click().catch(() => {});
    await page.getByRole('button', { name: /버리기|삭제|닫기|확인/ }).first().click({ timeout: 2000 }).catch(() => {});
    await settle(page, 800);

    // 메일 2: AI 이슈 생성 — 초안 대화상자까지만(이슈는 만들지 않는다)
    await row('쿠폰').click();
    await page.getByTestId('mail-detail').waitFor();
    await settle(page, 1000);
    await page.getByTestId('mail-ai-issue').click();
    const dialog = page.getByTestId('mail-to-issue-dialog');
    await dialog.waitFor();
    await page.waitForFunction(() => {
      const t = document.querySelector('[data-testid="mail-to-issue-dialog"] input');
      return t && t.value && t.value.length > 3;
    }, null, { timeout: AI_WAIT });
    await settle(page, 1200);
    await mark(page, 'mail-issue', 'dialog', dialog);
    await shoot(page, 'mail-issue');
    await page.keyboard.press('Escape');
  });

  // 드라이브 — 팀 공간 문서 + 미리보기의 AI 요약(문서 처리 워커가 본문을 추출해 둔 경우)
  await scene('drive', async () => {
    const spaces = await api(token, 'GET', '/drive/spaces');
    const space = (spaces.content ?? spaces).find((s) => s.name === '모바일 주문 앱');
    await page.goto(`${WEB}/drive/spaces/${space.id}`);
    await settle(page);
    await page.getByText('기획', { exact: true }).first().dblclick().catch(() => page.getByText('기획', { exact: true }).first().click());
    await settle(page, 1500);
    await soft(markUnion(page, 'drive', 'files', [
      page.locator('[data-testid^="drive-row-file-"]').first(),
      page.locator('[data-testid^="drive-row-file-"]').last(),
    ]));
    await shoot(page, 'drive');
    await page.locator('[data-testid^="drive-row-file-"]').filter({ hasText: '요구사항' }).first().click();
    await page.getByTestId('preview-body').waitFor({ timeout: 30000 });
    await page.getByText('AI 요약', { exact: true }).first().click();
    const card = page.getByTestId('drive-summary-card');
    await card.waitFor({ timeout: 30000 });
    await page.getByTestId('drive-summary-loading').waitFor({ state: 'detached', timeout: AI_WAIT }).catch(() => {});
    await settle(page, 1500);
    await mark(page, 'drive-preview', 'summary', card);
    await shoot(page, 'drive-preview');
    await page.keyboard.press('Escape');
  });

  // 11장 — 캘린더(M365 연동 + 팀 일정 + 이슈 마감일)
  await scene('calendar', async () => {
    await page.goto(`${WEB}/calendar`);
    await settle(page);
    await page.getByTestId('calendar-view-week-btn').click().catch(() => {});
    await settle(page);
    // 주간 보기는 0시부터 그려져 오전 일정이 화면 밖에 있다 — 업무 시간(9시)이 위로 오게 시간 격자를 내린다.
    await page.getByText('9:00', { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
    await settle(page, 500);
    await soft(mark(page, 'calendar', 'event', page.getByText('베타 오픈 Go/No-Go').first()));
    // M365 연동 캘린더 묶음(계정 이름 ~ 마지막 캘린더) — 연동하지 않은 스택이면 건너뛴다
    await soft(markUnion(page, 'calendar', 'm365', [
      page.getByText(/@.+\..+/).filter({ hasNot: page.locator('input') }),
      page.getByText('M365', { exact: true }),
      page.getByText('읽기 전용').last(),
      page.getByText('생일', { exact: true }),
    ]));
    await soft(mark(page, 'calendar', 'due', page.getByText('내 이슈 마감일')));
    await shoot(page, 'calendar');
  });

  // 13·14장 — 설정: API 토큰, 에이전트 관리
  await scene('settings', async () => {
    await page.goto(`${WEB}/settings/tokens`);
    await settle(page);
    await soft(mark(page, 'tokens', 'row', page.getByText('내 AI 도구 연동').locator('xpath=ancestor::tr[1]')));
    await shoot(page, 'tokens');
    await page.goto(`${WEB}/settings/agents`);
    await settle(page);
    await soft(mark(page, 'agents', 'row', page.getByTestId(`agent-row-${agentId}`)));
    await shoot(page, 'agents');
    await page.getByTestId(`agent-row-${agentId}`).click();
    await settle(page, 1200);
    // 시트가 열리며 이름 입력칸에 포커스·선택이 걸린다 — 강조 표시 없이 찍도록 포커스를 뺀다.
    await page.evaluate(() => document.activeElement?.blur());
    await settle(page, 300);
    await soft(markUnion(page, 'agent-detail', 'connection', [page.getByText('AI 연결 및 모델'), page.getByText('생각의 깊이')]));
    await soft(mark(page, 'agent-detail', 'common', page.getByText('이 에이전트를 공통 비서로 지정')));
    await shoot(page, 'agent-detail');
    await page.keyboard.press('Escape');
  });

  // 12장 — 모바일: 같은 데이터·같은 AI 를 휴대폰 전용 화면(MobileShell)으로.
  // 390×844 · 3배율(아이폰 기준) → 원본 1170×2532. 터치·모바일 UA 로 열어야 모바일 셸로 전환된다.
  await scene('mobile', async () => {
    const mctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      colorScheme: 'light',
    });
    const m = await mctx.newPage();
    await m.goto(`${WEB}/login`);
    await m.getByPlaceholder('아이디를 입력하세요').fill(pm.username);
    await m.locator('input[type=password]').fill(PASSWORD);
    await m.locator('button[type=submit]').click();
    await m.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

    await m.goto(`${WEB}/`);
    await m.getByTestId('mobile-tabbar').waitFor();
    await settle(m);
    await soft(mark(m, 'mobile-home', 'ai', m.getByTestId('mobile-tab-ai'), 3));
    await shoot(m, 'mobile-home');

    // 채널에서 AI 제안을 승인한 뒤의 모습(제안 카드 + AI 의 "만들었어요")
    const ch = await channelByName('모바일-주문앱');
    await m.goto(`${WEB}/chat/channels/${ch.id}`);
    await settle(m, 1500);
    await soft(mark(m, 'mobile-channel', 'card', m.locator('[data-testid^="proposal-card-"]').last(), 3));
    await shoot(m, 'mobile-channel');

    // 하단 탭의 AI 로 요청
    await m.goto(`${WEB}/`);
    await settle(m);
    await m.getByTestId('mobile-tab-ai').click();
    const input = m.getByTestId('chat-input');
    await input.waitFor();
    await input.fill('오늘 내 일정이랑 급한 작업 알려줘');
    await m.getByRole('button', { name: '보내기' }).click();
    await m.getByTestId('chat-stop').waitFor({ timeout: 30000 });
    await m.getByTestId('chat-stop').waitFor({ state: 'detached', timeout: AI_WAIT });
    await settle(m, 1500);
    await soft(mark(m, 'mobile-ai', 'answer', m.getByTestId('chat-scroll'), 3));
    await shoot(m, 'mobile-ai');
    await mctx.close();
  });

  await browser.close();
  await writeBoxes();
  if (failures.length) {
    console.error(`\n실패 ${failures.length}건:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
