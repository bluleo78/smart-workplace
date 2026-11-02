// /settings/agents/:id — AI 작업 화면 보기(WP-1277) E2E. 실제 WebSocket(Playwright routeWebSocket 의 가짜 서버)으로 터미널 바이트가 그려지고,
// 입력 허용은 확인 창 뒤 서버가 input:true 를 돌려준 다음에만 띠가 뜨는지 본다(@platform — 브라우저 WebSocket·xterm 렌더).
// 상태 전이·프레임 판정은 src/lib/agentScreen.test.ts 가 지킨다. 스크린샷은 test-results/exploratory/wp-1277-agent-screen/<timestamp>/screenshots/.
import path from 'node:path';

import { expect, test } from '../../fixtures/auth.fixture';
import { createAgent, createLocation, createObserved, createSetting, PROJECTS, TEMPLATES } from '../../../src/test/kits/admin/agentRuntime';

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const SHOT_DIR = path.resolve(process.cwd(), '../../test-results/exploratory/wp-1277-agent-screen', STAMP, 'screenshots');
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const AGENT = createAgent(100, { username: 'kodi', name: 'Kodi', runMode: 'WORKSPACE' });
const SETTING = createSetting(100, {
  status: 'RUNNING',
  desired: 'RUN',
  observed: createObserved({ agentState: 'WORKING', agentIssueKey: 'WP-1277' }),
  effectiveLocation: createLocation(),
});

// 가짜 AI 화면 — Claude Code 두 칸(작업·대기)과 tmux 상태 줄 비슷하게. 시제품 캡처용이라 실제 출력과 같을 필요는 없다.
const ESC = '\x1b';
function fakeScreen(window: 'WP' | 'events', cols: number, rows: number): string {
  const lines: string[] = [];
  const body = rows - 1; // 마지막 줄은 tmux 상태 줄
  const half = Math.floor((cols - 1) / 2);
  if (window === 'WP') {
    const left = [
      `${ESC}[1m WP ${ESC}[0m`,
      '',
      `${ESC}[38;5;208m●${ESC}[0m Reading apps/workplace-api/src/main/java/com/workplace/agentruntime/…`,
      '  ⎿  Read 182 lines',
      '',
      `${ESC}[38;5;208m●${ESC}[0m Bash(./gradlew test --tests 'com.workplace.agentruntime.*')`,
      '  ⎿  Running… (2m 14s)',
      '',
      `${ESC}[2m> 작업 중 — WP-1277 작업 화면 보기${ESC}[0m`,
    ];
    const right = [`${ESC}[1m WD ${ESC}[0m`, '', `${ESC}[32m✓${ESC}[0m 할 일 없음 — 다음 확인 14:30`, '', `${ESC}[2m> /loop /genia-works:work-loop WD${ESC}[0m`];
    // 칸 경계는 커서 이동으로 맞춘다(한글 폭과 무관하게 같은 열에)
    for (let i = 0; i < body; i++) lines.push(`${left[i] ?? ''}${ESC}[${i + 1};${half + 1}H${ESC}[2m│${ESC}[0m ${right[i] ?? ''}`);
  } else {
    lines.push(`${ESC}[1m 알림 감시 ${ESC}[0m`, '', '14:02:11 wake WP-1277 (이슈 챗 새 글)', '14:05:40 wake WD-412 (담당 지정)');
    while (lines.length < body) lines.push('');
  }
  const bar = ` [kodi] 0:WP${window === 'WP' ? '*' : ''}  1:events${window === 'events' ? '*' : ''}`.padEnd(cols);
  return `${ESC}[H${ESC}[2J` + lines.map((l, i) => `${ESC}[${i + 1};1H${l}`).join('') + `${ESC}[${rows};1H${ESC}[7m${bar}${ESC}[0m`;
}

test.describe('/settings/agents/:id 작업 화면 보기', () => {
  test('보기 전용으로 붙고, 입력 허용은 확인 뒤 서버가 켜야 띠가 뜬다', { tag: '@platform' }, async ({ adminPage: page }) => {
    await page.route('**/api/v1/admin/agent-templates', (r) => r.fulfill(json(TEMPLATES)));
    await page.route('**/api/v1/admin/agent-runtime-summaries', (r) => r.fulfill(json([])));
    await page.route('**/api/v1/admin/agent-locations', (r) => r.fulfill(json([createLocation()])));
    await page.route(/\/api\/v1\/admin\/agents(\?.*)?$/, (r) => r.fulfill(json([AGENT])));
    await page.route(/\/api\/v1\/admin\/agents\/100$/, (r) => r.fulfill(json(AGENT)));
    await page.route(/\/api\/v1\/admin\/agents\/100\/runtime-setting$/, (r) => r.fulfill(json(SETTING)));
    await page.route(/\/api\/v1\/admin\/agents\/100\/runtime-setting\/projects$/, (r) => r.fulfill(json(PROJECTS)));
    await page.route(/\/api\/v1\/admin\/agents\/100\/repo-credentials$/, (r) =>
      r.fulfill(json([{ id: 1, kind: 'GITHUB', host: 'github.com', createdAt: '2026-11-02T00:00:00Z', lastUsedAt: null }])),
    );
    await page.route(/\/api\/v1\/admin\/agents\/100\/provider-credential$/, (r) =>
      r.fulfill(json({ id: 1, provider: 'anthropic', baseUrl: null, label: null, createdAt: '2026-10-20T00:00:00Z', lastUsedAt: null })),
    );
    await page.route(/\/api\/v1\/admin\/agents\/100\/keys$/, (r) => r.fulfill(json([])));
    await page.route(/\/api\/v1\/admin\/agents\/100\/screen-sessions$/, (r) =>
      r.fulfill(json({ sessionId: 's-1', ticket: 'tk-1', expiresAt: new Date(Date.now() + 30_000).toISOString() }, 201)),
    );

    // 가짜 Works 화면 소켓 — 붙으면 상태·창·화면을 보내고, 창 고르기·입력 허용 프레임에 답한다. 받은 프레임은 기록.
    const received: string[] = [];
    let binaryCount = 0;
    await page.routeWebSocket(/\/api\/v1\/admin\/agent-screen\?ticket=tk-1$/, (ws) => {
      const windows = (active: number) => ({
        type: 'windows',
        items: [
          { index: 0, name: 'WP', width: 240, height: 59, active: active === 0 },
          { index: 1, name: 'events', width: 240, height: 59, active: active === 1 },
        ],
      });
      ws.send(JSON.stringify({ type: 'status', state: 'attached' }));
      ws.send(JSON.stringify({ type: 'input', enabled: false, allowed: true }));
      ws.send(JSON.stringify(windows(0)));
      let size = { cols: 120, rows: 40 };
      let shown: 'WP' | 'events' = 'WP';
      const draw = () => ws.send(Buffer.from(fakeScreen(shown, size.cols, size.rows)));
      ws.onMessage((m) => {
        if (typeof m !== 'string') {
          binaryCount++;
          return;
        }
        received.push(m);
        const f = JSON.parse(m) as { type: string; index?: number; enabled?: boolean; cols?: number; rows?: number };
        // tmux 처럼 — 크기가 바뀌면 그 크기로, 창을 바꾸면 그 창을 다시 그린다
        if (f.type === 'resize') {
          size = { cols: f.cols ?? 120, rows: f.rows ?? 40 };
          draw();
        }
        if (f.type === 'window') {
          shown = f.index === 1 ? 'events' : 'WP';
          ws.send(JSON.stringify(windows(f.index ?? 0)));
          draw();
        }
        if (f.type === 'input') ws.send(JSON.stringify({ type: 'input', enabled: f.enabled, allowed: true }));
      });
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/settings/agents/100');
    await page.getByTestId('agent-screen-open').click();
    const dialog = page.getByTestId('agent-screen-dialog');
    await expect(dialog.getByTestId('agent-screen-phase')).toHaveText('연결됨');
    await expect(dialog.getByTestId('agent-screen-mode')).toHaveText('보기 전용');
    await expect(dialog.getByTestId('agent-screen-terminal')).toContainText('작업 중 — WP-1277');
    await expect.poll(() => received.some((m) => m.includes('"type":"resize"'))).toBe(true);
    await page.screenshot({ path: path.join(SHOT_DIR, '01-view-only.png') });

    // 창 탭 — 「알림」으로 바꾸면 보기 세션만 바뀐다(서버에 window 프레임)
    await dialog.getByRole('tab', { name: '알림' }).click();
    await expect(dialog.getByTestId('agent-screen-terminal')).toContainText('알림 감시');
    expect(received).toContainEqual(JSON.stringify({ type: 'window', index: 1 }));
    await dialog.getByRole('tab', { name: 'WP' }).click();

    await dialog.getByTestId('agent-screen-input-on').click();
    await expect(page.getByTestId('agent-screen-input-confirm')).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, '02-input-confirm.png') });
    await page.getByTestId('agent-screen-input-confirm').getByRole('button', { name: '입력 허용' }).click();
    await expect(dialog.getByTestId('agent-screen-input-band')).toContainText('입력 중 — 치는 키가 AI 화면에 그대로 갑니다.');
    await expect(dialog.getByTestId('agent-screen-mode')).toHaveText('입력 중');
    // 입력 중에는 키가 바이너리로 간다
    await dialog.getByTestId('agent-screen-terminal').click();
    await page.keyboard.type('1');
    await expect.poll(() => binaryCount).toBeGreaterThan(0);
    await page.screenshot({ path: path.join(SHOT_DIR, '03-input-on.png') });

    await dialog.getByRole('button', { name: '보기 전용으로' }).click();
    await expect(dialog.getByTestId('agent-screen-mode')).toHaveText('보기 전용');
  });
});
