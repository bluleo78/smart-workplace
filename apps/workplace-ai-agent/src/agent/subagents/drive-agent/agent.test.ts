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
      'mcp__workplace__read_file', // WP-346: 파일 본문(추출 텍스트 구간)·이미지 읽기
      'mcp__workplace__search_drive_content',
      'mcp__workplace__list_drive_trash', // #855: 휴지통 조회
      'mcp__workplace__create_drive_folder',
      'mcp__workplace__rename_drive_item', // WP-369: 파일·폴더 이름 변경 통합
      'mcp__workplace__move_drive_item', // WP-369: 파일·폴더 이동 통합
      'mcp__workplace__copy_drive_item', // WP-354: 파일·폴더 복사
      'mcp__workplace__import_attachment_to_drive', // WP-354: 이슈·채팅 첨부 가져오기
      'mcp__workplace__restore_drive_item', // #855: 휴지통 복원
      'mcp__workplace__create_drive_download_link', // WP-369: 다운로드 링크
      'mcp__workplace__create_drive_file', // WP-369: 파일 올리기(AI Chat 은 content 모드만)
      'mcp__workplace__propose_delete_file',
      'mcp__workplace__propose_delete_folder',
      'mcp__workplace__submit_response',
    ]);
  });
  // WP-346: 내용 읽기는 source "drive" + driveFileId 로, READY 가 아니면 추측하지 않도록 안내한다.
  it('본문이 read_file 을 source "drive" + driveFileId 로 안내하고 비-READY 상태 추측을 금한다', () => {
    const prompt = loaded['drive-agent'].prompt;
    expect(prompt).toContain('read_file(source="drive", driveFileId, offset?, limit?)');
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
    expect(prompt).toContain('rename_drive_item(driveFileId | folderId, name)');
    expect(prompt).toContain('move_drive_item(driveFileId | folderId, targetFolderId?)');
    expect(prompt).toContain('copy_drive_item(driveFileId | folderId, targetFolderId?)');
    expect(prompt).toContain('import_attachment_to_drive(spaceId, attachmentId, folderId?)');
    expect(prompt).toContain('includeVersions');
    expect(prompt).toContain('includeBacklinks');
    expect(prompt).toContain('버전 롤백');
    expect(prompt).not.toMatch(/파일 이름 변경은 미지원/);
  });

  // WP-369 R6: AI Chat 사용자에게는 셸이 없어 create_drive_file 은 content 모드만 쓰고, 로컬 파일은 웹으로 안내한다.
  it('내용 저장은 content 필수·새 버전 주의, 로컬 파일 업로드는 웹 안내, 다운로드 링크는 10분·한 번·전달 금지를 안내한다', () => {
    const prompt = loaded['drive-agent'].prompt;
    expect(prompt).toContain('create_drive_file(spaceId, name, content, folderId?)');
    expect(prompt).toContain('**`content` 를 반드시 넘깁니다**');
    expect(prompt).toContain('**새 버전**');
    expect(prompt).toMatch(/로컬 파일.*웹 드라이브 화면에서 직접 올리라고/);
    expect(prompt).toContain('create_drive_download_link(driveFileId)');
    expect(prompt).toContain('**10분 동안 한 번만**');
    expect(prompt).toMatch(/다른 사람에게 전달하지 말라고/);
    // WP-369 Task 3: 기존 텍스트 파일은 read_file 로 읽고 driveFileId+content 로 새 버전 저장(이름·폴더 그대로).
    expect(prompt).toContain('`read_file(source="drive", driveFileId)` 로 먼저 읽고');
    expect(prompt).toContain('`create_drive_file(driveFileId, content)` 로 저장합니다');
    // 잘린 덮어쓰기 방지: 끝까지 읽고(nextOffset) READY·truncated 아님일 때만 저장한다.
    expect(prompt).toContain('**전문을 다 읽은 뒤에만 저장합니다**');
    expect(prompt).toMatch(/`nextOffset` 이 있으면 없어질 때까지.*`truncated:true`.*저장하지 말고/);
    expect(prompt).toMatch(/이름·폴더는 그대로.*`spaceId`·`folderId`·`name` 은 넘기지 않습니다/);
    // WP-369 최종 리뷰 I3: html 은 read_file 이 태그를 뺀 글자라 내용으로 고쳐 쓰지 않는다(서버도 409) — 같은 "끝까지 읽기" 문단에 둔다.
    expect(prompt).toMatch(/\*\*전문을 다 읽은 뒤에만 저장합니다\*\*.*\*\*html 파일\(\.html·\.xhtml\)도 내용으로 고치지 않습니다\*\*/);
    expect(prompt).toMatch(/UTF-8 이 아닌 파일.*`truncated:true` 인 파일은.*웹 드라이브 화면에서 같은 이름으로 올리면 새 버전/);
    // 공유 read_file 의 truncated note 는 업로드 링크를 권하지만 AI Chat 에는 링크 모드가 없다 — 그 안내를 따르지 않게 한다.
    expect(prompt).toMatch(/`note` 의 업로드 링크 안내는 따르지 않습니다/);
    // 예전 "업로드는 미지원" 안내는 남기지 않는다.
    expect(prompt).not.toMatch(/업로드·멤버 변경·파일 버전 롤백\(되돌리기\)은 미지원/);
  });

  // WP-354: 라우터가 되묻지 않고 위임하므로, 저장 위치가 모호하면 drive-agent 가 사용자에게 묻는다.
  it('첨부 저장 위치 규칙: 사용자 지정 → 쓰기 가능 스페이스가 하나면 그곳 → 여럿이면 되묻기', () => {
    const prompt = loaded['drive-agent'].prompt;
    expect(prompt).toContain('사용자가 스페이스·폴더를 말했으면');
    expect(prompt).toContain('정확히 하나');
    expect(prompt).toMatch(/후보가 여럿이면.*임의로 고르지 말고.*묻습니다/s);
  });
});
