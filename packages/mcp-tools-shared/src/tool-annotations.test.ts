import { describe, expect, it } from 'vitest';
import type { SharedTool } from './mcp-tool.js';
import { buildSharedTools, type SharedToolClient } from './shared-tools.js';
import { toolAnnotations } from './tool-annotations.js';
import { TOOL_LABELS } from './tool-labels.js';

const tools = buildSharedTools({} as unknown as SharedToolClient);

// 도구별 [kind, destructive, idempotent, openWorld] 표(WP-342). read 는 힌트가 없어 null.
// 새 도구나 재분류가 이 표의 diff 로 리뷰에 드러나게 한다 — 판단 기준은 mcp-tool.ts 의 ToolHints 주석 참조.
const R = null;
const EXPECTED: Record<string, readonly [kind: string, destructive: boolean | null, idempotent: boolean | null, openWorld: boolean | null]> = {
  add_channel_message: ['write', false, false, false],
  add_comment: ['write', false, false, false],
  add_contact_favorite: ['write', false, true, false],
  add_issue_dependency: ['write', false, true, false],
  add_user_group_member: ['write', false, true, false],
  create_channel: ['write', false, false, false],
  create_issue: ['write', false, false, false],
  create_issue_from_mail: ['write', false, true, false],
  create_user_group: ['write', false, false, false],
  create_wiki_page: ['write', false, false, false],
  draft_issue_from_mail: ['read', R, R, R],
  draft_mail_reply: ['read', R, R, R],
  edit_comment: ['write', true, true, false],
  get_channel_messages: ['read', R, R, R],
  get_contact_facets: ['read', R, R, R],
  get_drive_file_summary: ['read', R, R, R],
  get_event: ['read', R, R, R],
  get_external_contact: ['read', R, R, R],
  get_issue_detail: ['read', R, R, R],
  get_mail: ['read', R, R, R],
  get_mail_summary: ['read', R, R, R],
  get_member: ['read', R, R, R],
  get_member_contact: ['read', R, R, R],
  get_project: ['read', R, R, R],
  get_thread_replies: ['read', R, R, R],
  get_user_group: ['read', R, R, R],
  get_wiki_backlinks: ['read', R, R, R],
  get_wiki_page: ['read', R, R, R],
  leave_channel: ['write', true, true, false],
  list_channels: ['read', R, R, R],
  list_contacts: ['read', R, R, R],
  list_drive_items: ['read', R, R, R],
  list_drive_spaces: ['read', R, R, R],
  list_drive_trash: ['read', R, R, R],
  list_events: ['read', R, R, R],
  list_issues: ['read', R, R, R],
  list_mail: ['read', R, R, R],
  list_mail_accounts: ['read', R, R, R],
  list_notifications: ['read', R, R, R],
  list_projects: ['read', R, R, R],
  list_user_groups: ['read', R, R, R],
  list_wiki_pages: ['read', R, R, R],
  list_wiki_spaces: ['read', R, R, R],
  mark_all_notifications_read: ['write', true, true, false],
  mark_mail_read: ['write', true, true, true],
  mark_notification_read: ['write', true, true, false],
  move_wiki_page: ['write', true, true, false],
  open_dm: ['write', false, true, false],
  remove_contact_favorite: ['write', true, true, false],
  remove_issue_dependency: ['write', true, true, false],
  remove_user_group_member: ['write', true, true, false],
  restore_drive_item: ['write', false, false, false],
  rsvp_event: ['write', true, false, false],
  search_drive: ['read', R, R, R],
  search_drive_content: ['read', R, R, R],
  search_members: ['read', R, R, R],
  search_wiki: ['read', R, R, R],
  unwatch_issue: ['write', true, true, false],
  update_issue: ['write', true, true, false],
  update_project: ['write', true, true, false],
  update_user_group: ['write', true, true, false],
  update_wiki_page: ['write', true, false, false],
  watch_issue: ['write', false, true, false],
};

describe('도구 연산 성격 표(WP-342)', () => {
  it('표와 공유 도구의 이름이 정확히 일치한다(추가·삭제 모두 표 갱신을 강제)', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('도구별 kind·destructive·idempotent·openWorld 가 표와 같다', () => {
    const actual = Object.fromEntries(
      tools.map((t) => [
        t.name,
        t.kind === 'read'
          ? [t.kind, R, R, R]
          : [t.kind, t.hints.destructive, t.hints.idempotent, t.hints.openWorld ?? false],
      ]),
    );
    expect(actual).toEqual(EXPECTED);
  });
});

describe('toolAnnotations', () => {
  const byName = (n: string): SharedTool => tools.find((t) => t.name === n)!;

  it('read: 읽기 전용·워크스페이스 안만 알리고 destructive·idempotent 는 싣지 않는다', () => {
    expect(toolAnnotations(byName('get_issue_detail'))).toEqual({
      title: TOOL_LABELS.get_issue_detail.label,
      readOnlyHint: true,
      openWorldHint: false,
    });
  });

  it('write: 덮어쓰기(update_issue)는 destructive, 멱등으로 알린다', () => {
    expect(toolAnnotations(byName('update_issue'))).toEqual({
      title: '이슈 수정',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('write: 추가만 하는 create_issue 는 destructive·idempotent 모두 false', () => {
    expect(toolAnnotations(byName('create_issue'))).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
  });

  it('원본 메일 서버에 닿는 mark_mail_read 만 openWorld=true 다', () => {
    const open = tools.filter((t) => toolAnnotations(t).openWorldHint).map((t) => t.name);
    expect(open).toEqual(['mark_mail_read']);
  });

  it('모든 공유 도구가 title 을 가진다', () => {
    for (const t of tools) expect(toolAnnotations(t).title, t.name).toBeTruthy();
  });
});

// 타입 강제 — write·destructive 가 hints 를 빠뜨리면 typecheck 가 실패해야 한다(tsc 가 이 파일도 검사한다).
describe('SharedTool 타입', () => {
  it('hints 없는 write/destructive 와 hints 가 붙은 read 는 컴파일되지 않는다', () => {
    const base = { name: 'x', description: 'x', inputSchema: tools[0].inputSchema, handler: async () => 'ok' };
    // @ts-expect-error write 는 hints 필수
    const noHints: SharedTool = { ...base, kind: 'write' };
    // @ts-expect-error destructive 도 hints 필수
    const noHints2: SharedTool = { ...base, kind: 'destructive' };
    // @ts-expect-error read 는 hints 를 가질 수 없다
    const readWithHints: SharedTool = { ...base, kind: 'read', hints: { destructive: false, idempotent: true } };
    const ok: SharedTool = { ...base, kind: 'write', hints: { destructive: false, idempotent: true } };
    expect([noHints, noHints2, readWithHints, ok]).toHaveLength(4);
  });
});
