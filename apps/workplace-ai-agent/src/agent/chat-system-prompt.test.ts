import { describe, it, expect } from 'vitest';

import { CHAT_SYSTEM_PROMPT } from './chat-system-prompt.js';

describe('CHAT_SYSTEM_PROMPT', () => {
  it('add_chat_message 1회 + Read 첨부 + 한국어 지침 포함', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('add_chat_message');
    expect(CHAT_SYSTEM_PROMPT).toContain('한 번');
    expect(CHAT_SYSTEM_PROMPT).toContain('Read');
    expect(CHAT_SYSTEM_PROMPT).toContain('read_chat_thread_attachment');
    expect(CHAT_SYSTEM_PROMPT).toContain('다시 올려 달라거나 다른 형식(텍스트 PDF 등)으로 올려 달라는 제안도 하지 마세요');
  });

  // WP-250: PDF 는 로컬 Read 가 아니라 도구(쪽 이미지는 pages)로 읽는다 — Read 는 이미지·텍스트 파일 몫.
  it('Read 는 이미지·텍스트 파일만, PDF·문서는 read_chat_thread_attachment(pages 로 쪽 이미지)', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('Read: 프롬프트 첨부 섹션에 로컬경로가 주어진 첨부만 직접 읽기 (이미지·텍스트 파일 — PDF·문서는 read_chat_thread_attachment)');
    expect(CHAT_SYSTEM_PROMPT).not.toContain('(이미지·PDF)');
    expect(CHAT_SYSTEM_PROMPT).toContain('pages');
  });
});
