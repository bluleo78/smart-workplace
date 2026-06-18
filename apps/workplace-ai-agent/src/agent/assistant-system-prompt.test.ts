import { describe, it, expect } from 'vitest';
import { ASSISTANT_SYSTEM_PROMPT, delegationLabel } from './assistant-system-prompt.js';

describe('ASSISTANT_SYSTEM_PROMPT', () => {
  it('순수 라우터 지시 + issue-agent 위임 테이블 + general-purpose 금지 문구 포함', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('라우터');
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('issue-agent');
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('subagent_type');
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('general-purpose');
    // 금지 문구가 명시적이어야 한다.
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/general-purpose.*절대 금지|절대 금지.*general-purpose/s);
  });

  it('show_* 표시 도구를 메인이 직접 쓸 수 있음을 안내', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('show_');
  });
});

describe('wiki-agent 라우팅·라벨 (M3)', () => {
  it('위임 테이블에 wiki-agent 행이 포함된다', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('wiki-agent');
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/위키|문서/);
  });
  it('wiki-agent → 위키 전문가에게 위임 중', () => {
    expect(delegationLabel('wiki-agent')).toBe('위키 전문가에게 위임 중');
  });
});

describe('mail-agent 라우팅·라벨 (M3)', () => {
  it('위임 테이블에 mail-agent 행이 포함된다', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('mail-agent');
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/메일|이메일/);
  });
  it('mail-agent → 메일 전문가에게 위임 중', () => {
    expect(delegationLabel('mail-agent')).toBe('메일 전문가에게 위임 중');
  });
});

describe('contacts-agent 라우팅·라벨 (M3)', () => {
  it('위임 테이블에 contacts-agent 행이 포함된다', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('contacts-agent');
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/연락처/);
  });
  it('contacts-agent → 연락처 전문가에게 위임 중', () => {
    expect(delegationLabel('contacts-agent')).toBe('연락처 전문가에게 위임 중');
  });
});

describe('delegationLabel', () => {
  it('issue-agent → 이슈 전문가에게 위임 중', () => {
    expect(delegationLabel('issue-agent')).toBe('이슈 전문가에게 위임 중');
  });
  it('미정의 타입 → null', () => {
    expect(delegationLabel('general-purpose')).toBeNull();
    expect(delegationLabel('')).toBeNull();
  });
  it('위임 테이블에 calendar-agent 행이 포함된다', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('calendar-agent');
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('일정');
  });
  it('calendar-agent → 캘린더 전문가에게 위임 중', () => {
    expect(delegationLabel('calendar-agent')).toBe('캘린더 전문가에게 위임 중');
  });
  it('위임 테이블에 messaging-agent 행이 포함된다', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('messaging-agent');
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/채널|메시지|대화/);
  });
  it('messaging-agent → 메시징 전문가에게 위임 중', () => {
    expect(delegationLabel('messaging-agent')).toBe('메시징 전문가에게 위임 중');
  });
});
