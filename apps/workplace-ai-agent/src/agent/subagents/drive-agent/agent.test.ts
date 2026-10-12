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
  it('tools 는 읽기 7개 + 쓰기 5개 + 삭제제안 2개 + submit_response(총 15개)', () => {
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
  it('maxTurns 설정 + 본문에 드라이브·읽기 안내', () => {
    expect(loaded['drive-agent'].maxTurns).toBeGreaterThan(0);
    expect(loaded['drive-agent'].prompt).toMatch(/드라이브|파일/);
  });
});
