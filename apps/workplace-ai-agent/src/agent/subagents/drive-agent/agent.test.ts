import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSubagents } from '../../subagent-loader.js';

const subagentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('drive-agent 정의', () => {
  const loaded = loadSubagents(subagentsDir);
  it('loadSubagents 로 drive-agent 가 로드된다', () => {
    expect(loaded['drive-agent']).toBeDefined();
  });
  it('tools 는 읽기 7개 + 쓰기 8개 + 삭제제안 2개 + submit_response(총 18개)', () => {
    expect(loaded['drive-agent'].tools).toEqual([
      'mcp__workplace__list_drive_spaces',
      'mcp__workplace__list_drive_items',
      'mcp__workplace__search_drive',
      'mcp__workplace__get_drive_file_summary',
      'mcp__workplace__read_attachment', // WP-346: 파일 본문(추출 텍스트 구간)·이미지 읽기
      'mcp__workplace__search_drive_content',
      'mcp__workplace__list_drive_trash', // #855: 휴지통 조회
      'mcp__workplace__create_drive_folder',
      'mcp__workplace__rename_drive_folder',
      'mcp__workplace__move_drive_folder',
      'mcp__workplace__move_drive_file',
      'mcp__workplace__rename_drive_file', // WP-354: 파일 이름 변경
      'mcp__workplace__copy_drive_item', // WP-354: 파일·폴더 복사
      'mcp__workplace__import_attachment_to_drive', // WP-354: 이슈·채팅 첨부 가져오기
      'mcp__workplace__restore_drive_item', // #855: 휴지통 복원
      'mcp__workplace__propose_delete_file',
      'mcp__workplace__propose_delete_folder',
      'mcp__workplace__submit_response',
    ]);
  });
  // WP-346: 내용 읽기는 source "drive" + driveFileId 로, READY 가 아니면 추측하지 않도록 안내한다.
  it('본문이 read_attachment 를 source "drive" + driveFileId 로 안내하고 비-READY 상태 추측을 금한다', () => {
    const prompt = loaded['drive-agent'].prompt;
    expect(prompt).toContain('read_attachment(source="drive", driveFileId, offset?, limit?)');
    expect(prompt).toContain('nextOffset');
    expect(prompt).toMatch(/READY.*내용을 추측하지 말고/s);
  });
  // WP-353: 폴더 목록·검색 결과의 식별자 이름이 folderId 다(예전엔 id) — 입력 이름과 같다.
  it('폴더는 목록·검색·휴지통 모두 folderId 로 가리키라고 안내한다(옛 `id` 안내 없음)', () => {
    const prompt = loaded['drive-agent'].prompt;
    expect(prompt).toContain('폴더는 `folderId`(목록·검색·휴지통 모두 같은 이름)');
    expect(prompt).not.toContain('목록의 폴더 `id`');
  });
  it('maxTurns 설정 + 본문에 드라이브·읽기 안내', () => {
    expect(loaded['drive-agent'].maxTurns).toBeGreaterThan(0);
    expect(loaded['drive-agent'].prompt).toMatch(/드라이브|파일/);
  });

  // WP-352: 목록·검색이 한 번에 일부만 줄 수 있으므로 이어 조회하거나 일부만 봤다고 밝히도록 안내한다.
  it('list_drive_items 의 hasMore·nextOffset 과 search_drive 의 truncated 안내가 있다', () => {
    const prompt = loaded['drive-agent'].prompt;
    expect(prompt).toContain('`hasMore`·`nextOffset`');
    expect(prompt).toContain('`nextOffset` 을 `offset` 으로 넘겨');
    expect(prompt).toContain('`truncated`');
    expect(prompt).toContain('일부만 봤다고 밝힙니다');
  });

  // WP-354: 파일 이름변경·복사·첨부 가져오기·버전·백링크 안내가 있고, "파일 이름 변경은 미지원" 류 안내는 없다.
  it('파일 이름 변경·복사·첨부 가져오기·버전/백링크 옵션을 안내하고 롤백은 미지원으로 둔다', () => {
    const prompt = loaded['drive-agent'].prompt;
    expect(prompt).toContain('rename_drive_file(driveFileId, name)');
    expect(prompt).toContain('copy_drive_item(driveFileId | folderId, targetFolderId?)');
    expect(prompt).toContain('import_attachment_to_drive(spaceId, attachmentId, folderId?)');
    expect(prompt).toContain('includeVersions');
    expect(prompt).toContain('includeBacklinks');
    expect(prompt).toContain('버전 롤백');
    expect(prompt).not.toMatch(/파일 이름 변경은 미지원/);
  });
});
