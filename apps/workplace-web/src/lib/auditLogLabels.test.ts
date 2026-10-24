// 감사 로그 라벨·facet 단일값 단위 테스트(WP-412) — 이전 E2E admin/audit-log-action-resource-labels(신규 enum 한글 라벨)·
// admin/audit-log-filters(전송 링크 facet 라벨·단일값 교체)를 대체한다. 표 셀·facet → API param 배선은 남은 E2E 가 지킨다.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AUDIT_ACTION_TYPES, formatAuditAction, formatAuditResource, lastFacetValue } from './auditLogLabels';

afterEach(() => vi.restoreAllMocks());

describe('formatAuditAction / formatAuditResource (#109, #778, WP-335, WP-369)', () => {
  it('신규 액션·리소스도 경고 없이 한글 라벨로', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(formatAuditAction('FILE_UPLOAD')).toBe('파일 업로드');
    expect(formatAuditAction('USER_TOKEN_ISSUED')).toBe('PAT 발급');
    expect(formatAuditAction('MEMBER_CREATED')).toBe('구성원 계정 생성');
    expect(formatAuditAction('FILE_RENAME')).toBe('파일 이름 변경');
    expect(formatAuditAction('TRANSFER_LINK_CREATE')).toBe('전송 링크 발급');
    expect(formatAuditAction('TRANSFER_LINK_USE')).toBe('전송 링크 사용');
    expect(formatAuditResource('drive')).toBe('드라이브');
    expect(formatAuditResource('user_api_token')).toBe('API 토큰');
    expect(warn).not.toHaveBeenCalled();
  });

  it('WP-567: 구성원·역할 관리 기록과 이미 기록되던 인증·SSO 액션도 한글 라벨로', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(formatAuditAction('MEMBER_ROLES_CHANGED')).toBe('구성원 역할 변경');
    expect(formatAuditAction('MEMBER_SUSPENDED')).toBe('구성원 정지');
    expect(formatAuditAction('MEMBER_REACTIVATED')).toBe('구성원 정지 해제');
    expect(formatAuditAction('PASSWORD_CHANGED')).toBe('비밀번호 변경');
    expect(formatAuditAction('ROLE_PERMISSIONS_CHANGED')).toBe('역할 권한 변경');
    expect(formatAuditAction('LOGIN_FAILED')).toBe('로그인 실패');
    expect(formatAuditAction('SSO_SETTING_CHANGED')).toBe('SSO 설정 변경');
    expect(formatAuditResource('role')).toBe('역할');
    expect(formatAuditResource('tenant')).toBe('워크스페이스');
    expect(warn).not.toHaveBeenCalled();
  });

  it('WP-706: 공용 비서 지정·해제·설정 변경 기록도 한글 라벨로', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(formatAuditAction('WORKSPACE_ASSISTANT_SET')).toBe('공용 비서 지정');
    expect(formatAuditAction('WORKSPACE_ASSISTANT_CLEARED')).toBe('공용 비서 해제');
    expect(formatAuditAction('WORKSPACE_ASSISTANT_SETTINGS_CHANGED')).toBe('공용 비서 설정 변경');
    expect(formatAuditResource('workspace_assistant')).toBe('공용 비서');
    expect(warn).not.toHaveBeenCalled();
  });

  it('WP-579: 노트 공유 액션 7개와 「노트」 리소스가 한글 라벨로(raw·경고 없음)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(formatAuditAction('WIKI_SHARE_CREATED')).toBe('노트 공유 생성');
    expect(formatAuditAction('WIKI_SHARE_UPDATED')).toBe('노트 공유 변경');
    expect(formatAuditAction('WIKI_SHARE_PEOPLE_CHANGED')).toBe('노트 공유 대상 변경');
    expect(formatAuditAction('WIKI_SHARE_REGENERATED')).toBe('노트 공유 링크 재발급');
    expect(formatAuditAction('WIKI_SHARE_REVOKED')).toBe('노트 공유 해제');
    expect(formatAuditAction('WIKI_SHARE_ACCESS_DENIED')).toBe('노트 공유 요청 거절');
    expect(formatAuditAction('WIKI_SHARE_POLICY_CHANGED')).toBe('노트 외부 공유 설정 변경');
    expect(formatAuditResource('wiki')).toBe('노트');
    // 정책 변경은 resource tenant 로 남는다 — 기존 「워크스페이스」 라벨이 그대로 쓰인다.
    expect(formatAuditResource('tenant')).toBe('워크스페이스');
    expect(warn).not.toHaveBeenCalled();
  });

  it('모르는 값은 raw 를 보여 주고 경고, 빈 값은 「-」', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(formatAuditAction('FUTURE_EVENT')).toBe('FUTURE_EVENT');
    expect(formatAuditResource(null)).toBe('-');
    expect(warn).toHaveBeenCalledWith('[AuditLog] Unknown actionType: FUTURE_EVENT');
  });

  it('facet 옵션 목록에 전송 링크 발급·사용이 있다', () => {
    expect(AUDIT_ACTION_TYPES.filter((t) => t.value.startsWith('TRANSFER_LINK')).map((t) => t.label)).toEqual([
      '전송 링크 발급',
      '전송 링크 사용',
    ]);
  });
});

describe('lastFacetValue', () => {
  it('새 값을 고르면(append) 마지막 값만 남겨 이전 값을 교체한다', () => {
    expect(lastFacetValue(['CREATE', 'UPDATE'])).toBe('UPDATE');
    expect(lastFacetValue(['CREATE'])).toBe('CREATE');
  });
  it('비었으면 필터 없음', () => {
    expect(lastFacetValue([])).toBe('');
    expect(lastFacetValue(undefined)).toBe('');
  });
});

// WP-811: 프로젝트 상태 추가·수정·순서 변경·삭제는 리소스 project_status 로 남는다.
describe('formatAuditResource — 프로젝트 상태(WP-811)', () => {
  it('project_status 는 「프로젝트 상태」로(raw·경고 없음)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(formatAuditResource('project_status')).toBe('프로젝트 상태');
    expect(warn).not.toHaveBeenCalled();
  });
});
