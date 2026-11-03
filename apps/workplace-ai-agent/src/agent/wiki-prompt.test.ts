import { describe, expect, it } from 'vitest';

import { WIKI_SYSTEM_PROMPT, buildWikiPrompt, type WikiComposeInput } from './wiki-prompt.js';

/** 사용자 메시지만 — 메시지 내용 검사용. */
const buildWikiUserMessage = (i: WikiComposeInput): string => buildWikiPrompt(i).user;

// 공통 입력 — 변형 액션은 selection 을 컨텍스트로 쓴다.
function input(partial: Partial<WikiComposeInput>): WikiComposeInput {
  return {
    assistantAgentId: 1,
    model: 'claude-sonnet-4-6',
    thinkingDepth: 'DEFAULT',
    maxTurns: 5,
    timeoutMs: 90_000,
    action: 'polish',
    pageTitle: '제목',
    pageBody: '전체 본문',
    selection: '선택한 문장',
    ...partial,
  };
}

describe('buildWikiUserMessage — 변형 액션', () => {
  it('rewrite_tone 은 톤(prompt)과 selection 을 포함한다', () => {
    const msg = buildWikiUserMessage(input({ action: 'rewrite_tone', prompt: '격식체' }));
    expect(msg).toContain('격식체');
    expect(msg).toContain('선택한 문장');
  });

  it('translate 는 언어(prompt)와 selection 을 포함한다', () => {
    const msg = buildWikiUserMessage(input({ action: 'translate', prompt: '영어' }));
    expect(msg).toContain('영어');
    expect(msg).toContain('선택한 문장');
  });

  it('expand/condense/polish 는 selection 을 컨텍스트로 쓴다', () => {
    for (const action of ['expand', 'condense', 'polish'] as const) {
      const msg = buildWikiUserMessage(input({ action }));
      expect(msg).toContain('선택한 문장');
    }
  });

  it('selection 이 없으면 pageBody 로 폴백한다', () => {
    const msg = buildWikiUserMessage(input({ action: 'polish', selection: undefined }));
    expect(msg).toContain('전체 본문');
  });
});

describe('buildWikiUserMessage — draft', () => {
  // 페이지 제목 H1 반복 금지 지시(WP-255) — 제목이 본문 밖에 따로 보여 이중 표시되던 문제.
  it('주제·참고 제목과 함께 제목 H1 반복 금지 지시를 포함한다', () => {
    const msg = buildWikiUserMessage(
      input({ action: 'draft', prompt: '4분기 계획', pageTitle: '출시 계획' }),
    );
    expect(msg).toContain('4분기 계획');
    expect(msg).toContain('출시 계획');
    expect(msg).toContain('H1');
    expect(msg).toContain('반복하지 마');
  });
});

// WP-1302 노트 HTML 블록 「AI로 고치기」 — selection 은 지금 HTML 소스, prompt 는 지시, targets 는 고른 요소 설명.
describe('buildWikiUserMessage — fix_html', () => {
  const html = '<h1>3분기</h1>\n<div id="chart"></div>\n<script>draw([1,2,3])</script>';

  it('고른 요소가 없으면 HTML 전체를 대상으로 지시·소스를 싣고 본문은 싣지 않는다', () => {
    const msg = buildWikiUserMessage(
      input({ action: 'fix_html', selection: html, prompt: '제목을 4분기로' }),
    );
    expect(msg).toContain('제목을 4분기로');
    expect(msg).toContain(html);
    expect(msg).toContain('HTML 전체');
    expect(msg).not.toContain('고른 요소:');
    // 노트 본문은 고칠 대상이 아니라 싣지 않는다(토큰 절약).
    expect(msg).not.toContain('전체 본문');
  });

  it('고른 요소가 있으면 번호를 붙여 싣고 그 부분만 고치고 나머지는 그대로 두라고 한다', () => {
    const msg = buildWikiUserMessage(
      input({
        action: 'fix_html',
        selection: html,
        prompt: '색을 파랑으로',
        targets: ['선택자: h1:nth-of-type(1) · 태그: h1', '선택자: #chart · 태그: div'],
      }),
    );
    expect(msg).toContain(
      '고른 요소:\n1. 선택자: h1:nth-of-type(1) · 태그: h1\n2. 선택자: #chart · 태그: div',
    );
    expect(msg).toContain('한 글자도 바꾸지 마');
    expect(msg).not.toContain('HTML 전체다');
  });

  it('소스 전체만(설명·코드 울타리 없이) 내고, 스크립트를 살리고, 새 바깥 자원을 넣지 말라고 한다', () => {
    const msg = buildWikiUserMessage(
      input({ action: 'fix_html', selection: html, prompt: '항목 추가' }),
    );
    expect(msg).toContain('코드 울타리 없이');
    expect(msg).toContain('스크립트');
    expect(msg).toContain('바깥 자원');
  });

  it('빈 고른 요소 글자는 무시한다', () => {
    const msg = buildWikiUserMessage(
      input({ action: 'fix_html', selection: html, prompt: 'x', targets: ['  '] }),
    );
    expect(msg).toContain('HTML 전체');
  });
});

describe('buildWikiPrompt — 시스템 프롬프트', () => {
  it('fix_html 은 HTML 전용(마크다운 지시 없음), 나머지는 노트 작성 보조자 프롬프트', () => {
    const fix = buildWikiPrompt(
      input({ action: 'fix_html', selection: '<p>x</p>', prompt: '색' }),
    ).system;
    expect(fix).toContain('HTML');
    expect(fix).not.toContain('마크다운');
    for (const action of [
      'draft',
      'continue',
      'rewrite_tone',
      'translate',
      'expand',
      'condense',
      'polish',
    ] as const) {
      expect(buildWikiPrompt(input({ action })).system).toBe(WIKI_SYSTEM_PROMPT);
    }
  });
});
