import { describe, it, expect } from 'vitest';

import { CHAT_SYSTEM_PROMPT } from './chat-system-prompt.js';
import { KOREAN_ONLY_RULE } from './system-prompt.js';

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

  // WP-1375: 반복 업무 이슈의 이슈챗 답변 규칙.
  it('반복 업무 규칙 — 다음 회차 전달 사실만 말하고 회차를 약속·대신 실행하지 않는다', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('## 반복 업무');
    expect(CHAT_SYSTEM_PROMPT).toContain('다음 회차에 이 글이 전달된다');
    expect(CHAT_SYSTEM_PROMPT).toContain('회차 실행 결과를 약속하거나 지금 회차를 대신 실행하지 않는다');
    expect(CHAT_SYSTEM_PROMPT).toContain('약속하거나');
    expect(CHAT_SYSTEM_PROMPT).not.toContain('WP-1375');
    expect(CHAT_SYSTEM_PROMPT).toContain('반복 업무가 아니면 회차 이야기를 하지 않는다');
  });

  // WP-1375: 회차는 맡긴 사람의 결정만 따른다 — 다른 사람의 지시는 맡긴 사람 확인이 필요하다고 답한다.
  it('반복 업무 규칙 — 맡긴 사람이 아닌 사람의 지시는 맡긴 사람 확인이 필요하다고 답한다', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('회차는 그중 맡긴 사람의 결정만 따릅니다');
    expect(CHAT_SYSTEM_PROMPT).toContain('맡긴 사람이 아닌 사람이 회차에 할 일을 지시하면 「맡긴 사람이 확인해야 회차에 반영된다」고 답한다.');
  });
});

// WP-1408: 이슈 챗 AI(chat 프로필)는 쓰기 도구가 없다 — 쓰기 요청에 「플랫폼 제약, 수동으로 하라」고 엉뚱하게 답했다. 사실대로 안내하고 한국어로만 쓴다.
// 리뷰: 회차가 처리한다고 약속하지 않는다 — 고치는 일은 맡긴 사람의 반복 지시에 따라서만 일어나므로 맡긴 사람·담당에게 요청하라고 안내한다.
describe('CHAT_SYSTEM_PROMPT — 쓰기 요청 안내·한국어 고정 (WP-1408)', () => {
  it('이 대화에서는 이슈를 고칠 수 없다고 사실대로 말한다', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('이 대화에서는 이슈를 고칠 수 없습니다(조회와 챗 답만 합니다)');
  });

  it('반복 업무 이슈의 쓰기 요청 — 처리를 약속하지 않고, 맡긴 사람의 반복 지시로만 고쳐진다고 안내하며, 플랫폼 제약·수동 처리를 말하지 않는다', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain(
      '이슈를 고치는 일은 맡긴 사람이 정한 반복 지시에 따라 「지금 실행」이나 다음 회차에서만 일어나므로, 처리된다고 약속하지 않는다',
    );
    expect(CHAT_SYSTEM_PROMPT).toContain('맡긴 사람이 아니면 맡긴 사람이나 담당에게 요청하라고 안내한다');
    expect(CHAT_SYSTEM_PROMPT).toContain('「플랫폼 제약」이라거나 「수동으로 하라」고 말하지 않는다');
    expect(CHAT_SYSTEM_PROMPT).not.toContain('다음 회차에서 처리된다고 안내한다');
  });

  it('한국어 고정 문구는 반복 지시문과 같은 상수를 쓴다', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain(`- ${KOREAN_ONLY_RULE}`);
  });
});
