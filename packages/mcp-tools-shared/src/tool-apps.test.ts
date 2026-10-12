import { describe, expect, it } from 'vitest';
import { buildSharedTools, type SharedToolClient } from './shared-tools.js';
import { isToolApp, TOOL_APP_GUIDES, TOOL_APPS, toolApps } from './tool-apps.js';

// 도구 구성 시점에는 클라이언트 메서드를 부르지 않으므로 빈 객체로 충분하다.
const tools = buildSharedTools({} as unknown as SharedToolClient);

// WP-350: 앱 태그는 타입으로 필수이지만(빠뜨리면 typecheck 실패), 런타임에서도 유효한 앱 이름인지 확인한다.
describe('도구 앱 태그 (WP-350)', () => {
  it('모든 공유 도구에 비어 있지 않은 앱 태그가 있고, 앱 이름은 모두 유효하며 중복이 없다', () => {
    for (const t of tools) {
      const apps = toolApps(t);
      expect(apps.length, t.name).toBeGreaterThan(0);
      expect(new Set(apps).size, t.name).toBe(apps.length);
      for (const a of apps) expect(isToolApp(a), `${t.name}:${a}`).toBe(true);
    }
  });

  // 앱을 골랐는데 도구가 하나도 없거나(오타·이름 변경), 읽기 전용으로 연결하면 비는 앱은 안내가 무의미해진다.
  it('모든 앱에 도구가 있고, 읽기 도구도 하나 이상 있다(읽기 전용 연결이 비지 않는다)', () => {
    for (const app of TOOL_APPS) {
      const inApp = tools.filter((t) => toolApps(t).includes(app));
      expect(inApp.length, app).toBeGreaterThan(0);
      expect(inApp.some((t) => t.kind === 'read'), app).toBe(true);
    }
  });

  // 안내(instructions)에 실리는 시작 도구 이름이 실제 도구·앱과 어긋나면 모델에게 없는 도구를 알려 주게 된다(도구 이름 변경 시 여기서 잡힌다).
  it('앱 안내의 시작 도구는 실제로 그 앱에 속한 도구다', () => {
    for (const app of TOOL_APPS) {
      for (const name of TOOL_APP_GUIDES[app].entry) {
        const t = tools.find((x) => x.name === name);
        expect(t, `${app}:${name}`).toBeDefined();
        expect(toolApps(t!), `${app}:${name}`).toContain(app);
      }
    }
  });

  // 도구별 앱 분류를 고정 — 새 도구·분류 변경이 리뷰 가능한 diff 로 드러나게 한다(README 앱 표와 함께 갱신).
  it('도구별 앱 스냅샷', () => {
    const byTool = Object.fromEntries([...tools].sort((a, b) => a.name.localeCompare(b.name)).map((t) => [t.name, toolApps(t).join(',')]));
    expect(byTool).toMatchSnapshot();
  });
});
