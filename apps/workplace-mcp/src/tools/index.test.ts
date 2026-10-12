import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildSharedTools, type SharedTool, type SharedToolClient } from '@smart-workplace/mcp-tools-shared';
import type { PatApiClient } from '../clients/workplace-api.js';
import { FULL_SCOPE } from '../mcp/scope.js';
import { buildUserTools, exposableTools, selectTools } from './index.js';

// 도구 목록 구성만 검사하므로 클라이언트 메서드는 호출되지 않는다.
const client = {} as PatApiClient;

describe('buildUserTools', () => {
  // 개수는 적지 않는다 — 도구 이름 전체는 공유 패키지 스냅샷이 고정하고, 아래 패리티가 공유본과 같음을 본다.
  it('공유 도구를 이름 중복 없이 반환한다', () => {
    const names = buildUserTools(client).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // #846: mcp 가 같은 이름의 도구를 따로 정의하면(드리프트의 원천) 스키마가 공유본과 달라진다.
  it('모든 도구의 이름·입력 스키마가 공유 정의와 일치한다', () => {
    const signature = (tools: { name: string; inputSchema: z.ZodType }[]) =>
      tools.map((t) => ({ name: t.name, schema: z.toJSONSchema(t.inputSchema) }));
    expect(signature(buildUserTools(client))).toEqual(signature(exposableTools(buildSharedTools({} as SharedToolClient))));
  });

  // #853: PAT 는 스코프 없이 사용자 권한을 그대로 갖는다 — 되돌릴 수 없는 도구는 확인 카드 없이 열리면 안 된다.
  it('destructive 도구는 노출하지 않는다', () => {
    const base = (name: string) => ({ name, description: name, app: 'issue' as const, inputSchema: z.object({}), handler: async () => '' });
    const hints = { destructive: false, idempotent: true };
    const fake = (name: string, kind: SharedTool['kind']): SharedTool =>
      kind === 'read' ? { ...base(name), kind } : { ...base(name), kind, hints };
    const exposed = exposableTools([fake('r', 'read'), fake('w', 'write'), fake('d', 'destructive')]);
    expect(exposed.map((t) => t.name)).toEqual(['r', 'w']);
    expect(buildUserTools(client).filter((t) => t.kind === 'destructive')).toEqual([]);
  });

  // 노출 도구 이름·등급을 고정 — 공유 패키지에 새 도구가 들어오면 PAT 표면이 바뀐다는 사실이 이 스냅샷 diff 로 드러난다.
  it('노출 도구 이름·kind 스냅샷', () => {
    const exposed = buildUserTools(client)
      .map((t) => `${t.name}:${t.kind}`)
      .sort();
    expect(exposed).toMatchSnapshot();
  });

  // 서버 레이어가 inputSchema.shape 를 registerTool 에 넘기므로 z.object 가 아니면 파라미터가 통째로 사라진다.
  it('모든 입력 스키마는 z.object 다', () => {
    for (const t of buildUserTools(client)) expect(t.inputSchema, t.name).toBeInstanceOf(z.ZodObject);
  });
});

// WP-350: 연결 범위에 따른 도구 선택. 이름이 아니라 앱 태그·kind 로 고르므로 새 도구가 들어와도 규칙이 그대로 맞아야 한다.
describe('selectTools (WP-350)', () => {
  const all = buildUserTools(client);
  const names = (tools: SharedTool[]) => tools.map((t) => t.name);

  it('기본 범위는 전체를 그대로 돌려준다', () => {
    expect(names(selectTools(all, FULL_SCOPE))).toEqual(names(all));
  });

  it('읽기 전용은 kind=read 만 남기고, 쓰기 도구는 하나도 없다', () => {
    const ro = selectTools(all, { apps: null, readOnly: true });
    expect(ro.length).toBeGreaterThan(0);
    expect(ro.every((t) => t.kind === 'read')).toBe(true);
    expect(names(ro)).toContain('list_issues');
    expect(names(ro)).not.toContain('create_issue');
  });

  it('앱을 고르면 그 앱 도구만 남는다 — 여러 앱이면 합집합', () => {
    expect(names(selectTools(all, { apps: ['notify'], readOnly: false })).sort()).toEqual([
      'list_notifications',
      'mark_all_notifications_read',
      'mark_notification_read',
    ]);
    const issueWiki = names(selectTools(all, { apps: ['issue', 'wiki'], readOnly: false }));
    expect(issueWiki).toContain('create_issue');
    expect(issueWiki).toContain('search_wiki');
    expect(issueWiki).not.toContain('list_mail');
  });

  // 여러 앱에 걸친 도구는 고른 앱 중 하나만 속해도 남아야 그 앱 안에서 일이 끊기지 않는다(README 앱 표).
  it('여러 앱에 걸친 도구는 한쪽만 골라도 남고, 고르지 않은 앱 도구는 같이 오지 않는다', () => {
    const issueOnly = names(selectTools(all, { apps: ['issue'], readOnly: false }));
    expect(issueOnly).toEqual(expect.arrayContaining(['read_attachment', 'list_projects', 'get_project']));
    expect(issueOnly).not.toContain('update_project');
    const driveOnly = names(selectTools(all, { apps: ['drive'], readOnly: false }));
    expect(driveOnly).toContain('read_attachment');
    expect(driveOnly).not.toContain('get_issue_detail');
  });

  it('앱 선택과 읽기 전용을 함께 쓰면 교집합', () => {
    const tools = selectTools(all, { apps: ['calendar'], readOnly: true });
    expect(names(tools).sort()).toEqual(['get_event', 'list_events', 'search_members']); // search_members: 참석자 username 확인용으로 calendar 에도 실린다
  });
});

