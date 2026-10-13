import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSubagents } from '../../subagent-loader.js';

const subagentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('wiki-agent 정의', () => {
  const loaded = loadSubagents(subagentsDir);
  it('loadSubagents 로 wiki-agent 가 로드된다', () => {
    expect(loaded['wiki-agent']).toBeDefined();
  });
  it('tools 는 읽기(search/get)+쓰기(create/update/move/restore)+삭제 제안(#856)', () => {
    expect(loaded['wiki-agent'].tools).toEqual([
      'mcp__workplace__list_wiki_spaces',
      'mcp__workplace__search_wiki',
      'mcp__workplace__get_wiki_page',
      'mcp__workplace__read_file', // WP-358: 본문 이미지 읽기
      'mcp__workplace__list_wiki_pages', // #850: 페이지 트리
      'mcp__workplace__list_wiki_backlinks', // #850: 백링크
      'mcp__workplace__create_wiki_page',
      'mcp__workplace__update_wiki_page',
      'mcp__workplace__move_wiki_page', // #855: 페이지 이동
      'mcp__workplace__restore_wiki_revision', // WP-357: 이전 판 복원(직접 실행)
      'mcp__workplace__propose_delete_wiki_page', // #856: 페이지 삭제 제안
      'mcp__workplace__submit_response',
    ]);
  });
  // WP-309: 일부 수정 요청에 노트 전체를 다시 쓰며 공백을 정규화하고 사람 텍스트를 지운 사례 — 범위 밖 원문 복사 규칙을 고정한다.
  it('수정 시 요청 범위 밖 블록은 읽은 그대로 바이트 단위 복사(정규화·삭제 금지)를 지시한다 (WP-309)', () => {
    const prompt = loaded['wiki-agent'].prompt;
    expect(prompt).toContain('바이트 단위 그대로');
    expect(prompt).toContain('정규화하지 마세요');
  });
  it('maxTurns 설정 + 본문에 노트·버전 안내', () => {
    expect(loaded['wiki-agent'].maxTurns).toBeGreaterThan(0);
    expect(loaded['wiki-agent'].prompt).toContain('노트');
  });

  // WP-357: 요약·판 기록은 get_wiki_page 옵션이고, 판 복원은 명시 요청·판 확정 뒤에만 한다.
  it('get_wiki_page 의 includeSummary·includeRevisions 와 판 복원(restore_wiki_revision) 사용 규칙·search_wiki spaceId 를 안내한다 (WP-357)', () => {
    const prompt = loaded['wiki-agent'].prompt;
    expect(prompt).toContain('includeSummary');
    expect(prompt).toContain('`summaryStatus` 가 `STALE`');
    expect(prompt).toContain('includeRevisions');
    expect(prompt).toContain('`revisionsOmitted`');
    expect(prompt).toContain('restore_wiki_revision(pageId, version)');
    expect(prompt).toContain('명시적으로 요청했고 어느 판인지 확정됐을 때만');
    expect(prompt).toContain('`spaceId` 를 줍니다');
  });

  // WP-352: 트리·검색이 잘릴 수 있으므로 hiddenChildren 을 parentId 로 펼치거나 일부만 봤다고 밝히도록 안내한다.
  it('list_wiki_pages 의 truncated·hiddenChildren(parentId 로 펼치기)과 search_wiki 의 truncated 안내가 있다', () => {
    const prompt = loaded['wiki-agent'].prompt;
    expect(prompt).toContain('list_wiki_pages(spaceId, parentId?)');
    expect(prompt).toContain('`hiddenChildren`');
    expect(prompt).toContain('`parentId` 로 다시 호출해 펼치거나');
    expect(prompt).toContain('{items, truncated?}');
    expect(prompt).toContain('일부만 봤다고 밝힙니다');
  });

  // WP-358: 노트 첨부는 지금 이미지뿐이라 read_file(source="wiki")가 이미지를 돌려준다. id 는 본문의 이미지 주소에서 얻는다.
  it('read_file 을 source "wiki" + pageId·attachmentId(본문 이미지 주소)로 안내하고 추측을 금한다 (WP-358)', () => {
    const prompt = loaded['wiki-agent'].prompt;
    expect(prompt).toContain('read_file(source="wiki", pageId, attachmentId)');
    expect(prompt).toContain('/api/v1/wiki/pages/{pageId}/attachments/{attachmentId}/content');
    expect(prompt).toContain('추측하지 말고');
  });
});
