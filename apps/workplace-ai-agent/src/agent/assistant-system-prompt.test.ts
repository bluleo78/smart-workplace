import { describe, expect, it } from 'vitest';
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

describe('project-agent 라우팅·라벨 (M3)', () => {
  it('위임 테이블에 project-agent 행이 포함된다', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('project-agent');
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/프로젝트/);
  });
  it('project-agent → 프로젝트 전문가에게 위임 중', () => {
    expect(delegationLabel('project-agent')).toBe('프로젝트 전문가에게 위임 중');
  });
});

describe('drive-agent 라우팅·라벨 (M3)', () => {
  it('위임 테이블에 drive-agent 행이 포함된다', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('drive-agent');
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/드라이브|파일/);
  });
  it('drive-agent → 드라이브 전문가에게 위임 중', () => {
    expect(delegationLabel('drive-agent')).toBe('드라이브 전문가에게 위임 중');
  });
});

describe('한-턴-다건-제안 가드 (#351)', () => {
  it('같은 종류 비가역 작업은 한 턴에 여러 건 제안 가능하다는 지침이 포함된다', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('propose_');
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/같은 종류.*비가역.*여러 건 제안 가능/s);
  });
  it('의존 관계 작업은 하나씩 확인받으라는 종속성 가드가 유지된다', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/앞 결과에 의존|앞 작업 결과에 의존|의존하는 작업/s);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/하나씩 확인 후 진행|하나씩 확인받은 뒤/s);
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

describe('ASSISTANT_SYSTEM_PROMPT — 동사 기반 라우팅(#460)', () => {
  const p = ASSISTANT_SYSTEM_PROMPT;

  it('읽기 조회는 라우터가 직접 처리하라고 지시한다', () => {
    expect(p).toMatch(/직접 (읽고|조회|처리)/);
    // 읽기 도구를 직접 호출하라는 명시
    expect(p).toContain('list_events');
  });

  it('일정·캘린더 "반드시 위임" 강제 문구를 제거했다', () => {
    expect(p).not.toContain('시간 범위·표현 방식과 무관하게');
  });

  it('쓰기/제안은 여전히 위임한다(회귀 방지)', () => {
    expect(p).toMatch(/생성·수정·삭제/);
    expect(p).toContain('calendar-agent');
  });

  it('메일 요약·이슈 분석 위임 규칙은 유지(회귀 방지)', () => {
    expect(p).toContain('mail-agent');
    expect(p).toContain('show_mail_list');
  });

  it('자유 텍스트 금지·respond_chat 통로·general-purpose 금지를 유지한다', () => {
    expect(p).toContain('respond_chat');
    expect(p).toContain('general-purpose');
    expect(p).toMatch(/자유 텍스트/);
  });

  it('8개 도메인 위임 라벨은 불변', () => {
    expect(delegationLabel('calendar-agent')).toBe('캘린더 전문가에게 위임 중');
    expect(delegationLabel('unknown')).toBeNull();
  });
});
