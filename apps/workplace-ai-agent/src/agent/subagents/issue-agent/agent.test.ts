import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSubagents } from '../../subagent-loader.js';

const subagentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('issue-agent 정의', () => {
  const loaded = loadSubagents(subagentsDir);

  it('loadSubagents 로 issue-agent 가 로드된다', () => {
    expect(loaded['issue-agent']).toBeDefined();
  });

  it('tools 는 이슈 MCP 도구 + #371 list_issues + 신규 create/update_issue/update_comment + watch_issue + upload_file + 이슈·코멘트 삭제 제안(#856) 을 포함한다', () => {
    expect(loaded['issue-agent'].tools).toEqual([
      'mcp__workplace__list_issues',
      'mcp__workplace__get_issue_detail',
      'mcp__workplace__read_file', // WP-346: 이슈 첨부 본문(추출 텍스트 구간)·이미지 읽기
      'mcp__workplace__add_comment',
      'mcp__workplace__update_comment',
      'mcp__workplace__create_issue',
      'mcp__workplace__update_issue',
      'mcp__workplace__unassign_self',
      // #844: 의존관계 쓰기 + 쓰기 값 조달용 조회(유형·라벨, 사람 username)
      'mcp__workplace__add_issue_dependency',
      'mcp__workplace__remove_issue_dependency',
      // #854: 이슈 워치/해제(멱등) — WP-421 에서 watch_issue(watching) 하나로 합쳐졌다
      'mcp__workplace__watch_issue',
      // WP-421: 첨부용 텍스트 파일 올려 두기(AI Chat 은 content 모드만)
      'mcp__workplace__upload_file',
      // #856: 이슈·코멘트 삭제 제안(확인 카드)
      'mcp__workplace__propose_delete_issue',
      'mcp__workplace__propose_delete_comment',
      'mcp__workplace__get_project',
      'mcp__workplace__search_members',
      'mcp__workplace__submit_response',
    ]);
  });

  // WP-356: create_issue 한 번에 라벨·마일스톤·사이클을 저장하고, 새 list_issues 필터·커스텀 필드·드라이브 링크를 안내한다.
  it('WP-356: 생성 한 번에 함께 저장, list_issues 의 watching·parent·milestone·field, update_issue 의 fields·driveFileId 를 안내한다', () => {
    const prompt = loaded['issue-agent'].prompt;
    expect(prompt).toContain('생성 호출 한 번에');
    expect(prompt).toContain('`update_issue` 를 다시 부를 필요가 없습니다');
    for (const k of ['watching: true', '`parent`', '`milestone`', '`field`', '`fields`', '`driveFileId`', '`watchers`', '`driveLinks`']) {
      expect(prompt, k).toContain(k);
    }
    // 드라이브 조회 도구가 없으므로 driveFileId 는 라우터가 위임 prompt 에 적어 준 값만 쓴다.
    expect(prompt).toContain('위임 prompt 에 라우터가 적어 준 값');
  });

  // WP-346: 첨부는 get_issue_detail 의 attachments[].attachmentId 로 source "issue" 읽기(WP-353: fileId → attachmentId).
  it('본문이 read_file 을 source "issue" + issueKey + attachmentId 로 안내한다', () => {
    const prompt = loaded['issue-agent'].prompt;
    expect(prompt).toContain('read_file(source="issue", issueKey, attachmentId, offset?, limit?)');
    expect(prompt).toContain('attachments[].attachmentId');
  });

  // WP-343: update_status 폐지 — 상태 변경은 update_issue 의 status 로 지시한다.
  it('폐지된 update_status 를 tools·본문 어디에도 두지 않고 update_issue 의 status 로 안내한다', () => {
    expect(loaded['issue-agent'].tools).not.toContain('mcp__workplace__update_status');
    const prompt = loaded['issue-agent'].prompt;
    expect(prompt).not.toContain('update_status');
    expect(prompt).toContain('update_issue(issueKey, status=...)');
  });

  // update_issue 는 실패해도 throw 하지 않으므로 상태 변경 지시 옆에서 ok/results 확인을 요구한다.
  it('상태 변경 지시가 ok·results.content 확인과 실패 비성공 보고를 요구한다', () => {
    const prompt = loaded['issue-agent'].prompt;
    expect(prompt).toContain('결과의 `ok` 가 false 이거나 `results.content` 가 `failed` 로 시작하면 상태가 **바뀌지 않은 것**');
    expect(prompt).toContain('상태 변경이 실패(`ok` false)하면 성공했다고 쓰는 코멘트·보고를 하지 말고');
  });

  it('maxTurns=20, description·본문이 비어있지 않다', () => {
    expect(loaded['issue-agent'].maxTurns).toBe(20);
    expect(loaded['issue-agent'].description.length).toBeGreaterThan(0);
    expect(loaded['issue-agent'].prompt).toContain('이슈');
  });

  // WP-53: "나에게 할당해줘" 에서 계정을 되묻지 않고 assignees "me" 를 쓰도록 안내한다.
  it('본인 담당 지정은 assignees "me" 로 처리하도록 안내한다', () => {
    const prompt = loaded['issue-agent'].prompt;
    expect(prompt).toContain('나에게 할당해줘');
    expect(prompt).toContain('assignees 에 `"me"`');
  });

  // WP-352: size 를 안 줘도 기본 30건에서 잘리므로, 잘렸는지 보고 이어 조회하거나 일부만이라고 밝히게 한다.
  it('list_issues 가 잘리면(hasMore·nextCursor) 이어 조회하거나 일부만이라고 밝히도록 안내한다', () => {
    const prompt = loaded['issue-agent'].prompt;
    expect(prompt).toContain('`hasMore`·`nextCursor`');
    expect(prompt).toContain('`cursor` 로 넘겨');
    expect(prompt).toContain('일부만이라고 밝히세요');
  });

  // WP-353: get_issue_detail 의 코멘트는 최근 30건만 온다 — 수정·삭제할 오래된 코멘트는 allComments 로 찾게 한다.
  it('코멘트 상한(commentsOmitted)과 allComments 로 더 읽는 방법을 안내한다', () => {
    const prompt = loaded['issue-agent'].prompt;
    expect(prompt).toContain('commentsOmitted');
    expect(prompt).toContain('allComments=true');
    expect(prompt).toContain('최근 200건');
  });
  // WP-421: 구독·해제가 watch_issue(watching) 하나로 합쳐졌고, 첨부용 텍스트는 upload_file 의 content 로만 올린다(AI Chat 은 업로드 링크 불가).
  it('watch_issue(watching)·upload_file(content 전용) 안내가 있고 옛 unwatch_issue 는 없다 (WP-421)', () => {
    const prompt = loaded['issue-agent'].prompt;
    expect(prompt).toContain('watch_issue(issueKey, watching)');
    expect(prompt).not.toContain('unwatch_issue');
    expect(prompt).toContain('upload_file(name, content)');
    expect(prompt).toContain('업로드 링크는 만들 수 없습니다');
    // WP-422: 받은 fileId 는 fileIds 로 이슈에 붙이고, update_issue 첨부 실패는 results.attachments 로 확인한다.
    expect(prompt).toContain('`fileIds`');
    expect(prompt).toContain('results.attachments');
  });
});
