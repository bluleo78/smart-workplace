import { buildSharedTools, TOOL_APP_GUIDES, TOOL_APPS, type SharedToolClient } from '@smart-workplace/mcp-tools-shared';
import { describe, expect, it } from 'vitest';

import { selectTools, exposableTools } from '../tools/index.js';
import { buildInstructions, INSTRUCTIONS_MAX_LENGTH } from './instructions.js';
import { FULL_SCOPE, type McpScope } from './scope.js';

const all = exposableTools(buildSharedTools({} as unknown as SharedToolClient));
const make = (scope: McpScope) => buildInstructions(selectTools(all, scope), scope);

describe('buildInstructions (WP-350)', () => {
  // 클라이언트는 instructions 앞쪽 2,048자까지만 쓴다 — 전체 앱 연결에서도 그 안에 들어와야 한다.
  it('전체 연결의 instructions 는 2,048자 이내이고 모든 앱 안내가 들어 있다', () => {
    const text = make(FULL_SCOPE);
    expect(text.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_LENGTH);
    expect(text).toContain('report work'); // WP-377: AI 작업 보고 안내
    for (const app of TOOL_APPS) expect(text, app).toContain(`- ${TOOL_APP_GUIDES[app].label}:`);
  });

  it('앱별 안내가 맨 앞쪽(요약 한 줄 바로 뒤)에 온다', () => {
    const lines = make(FULL_SCOPE).split('\n');
    expect(lines[1]).toBe('Apps:');
    expect(lines[2]).toMatch(/^- /);
  });

  it('앱을 고르면 고른 앱만 설명한다', () => {
    const text = make({ apps: ['issue', 'wiki'], readOnly: false });
    expect(text).toContain(`- ${TOOL_APP_GUIDES.issue.label}:`);
    expect(text).toContain(`- ${TOOL_APP_GUIDES.wiki.label}:`);
    expect(text).not.toContain(`- ${TOOL_APP_GUIDES.mail.label}:`);
    expect(text).not.toContain(`- ${TOOL_APP_GUIDES.calendar.label}:`);
    // read_file·list_projects 같은 다중 앱 도구가 실려도 고르지 않은 드라이브·프로젝트는 설명하지 않는다.
    expect(text).not.toContain(`- ${TOOL_APP_GUIDES.drive.label}:`);
    expect(text).not.toContain(`- ${TOOL_APP_GUIDES.project.label}:`);
    expect(text).toContain('/mcp/x/issue,wiki'); // 넓히는 방법 안내
  });

  it('읽기 전용이면 쓰기 문구와 쓰기 시작 도구를 싣지 않는다', () => {
    const text = make({ apps: null, readOnly: true });
    expect(text).toContain('Read-only connection');
    expect(text).not.toContain(TOOL_APP_GUIDES.issue.write);
    expect(text).not.toContain(TOOL_APP_GUIDES.messaging.write);
    expect(text).not.toContain('report'); // 읽기 전용에는 작업 보고 안내 없음
    for (const t of all.filter((x) => x.kind !== 'read')) expect(text, t.name).not.toContain(t.name);
  });

  it('안내에 나온 시작 도구는 모두 실제로 로드된 도구다', () => {
    for (const scope of [FULL_SCOPE, { apps: ['mail'], readOnly: true }, { apps: ['project'], readOnly: false }] as McpScope[]) {
      const tools = selectTools(all, scope);
      const loaded = new Set(tools.map((t) => t.name));
      for (const m of make(scope).matchAll(/\(start: ([^)]+)\)/g)) {
        for (const n of m[1].split(', ')) expect(loaded.has(n), n).toBe(true);
      }
    }
  });
});
