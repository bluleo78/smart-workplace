// WP-1496: Anthropic 인증 방식 판정·워크스페이스 ID 정리 도우미 단위 테스트.
import { describe, expect, it } from 'vitest';
import { safeWorkspaceId, usesApiKeyAuth } from './anthropic-key.js';

describe('usesApiKeyAuth', () => {
  it('sk-ant-usr(사용자 API 키)·sk-ant-api(표준 API 키)는 x-api-key, 그 밖은 구독 OAuth', () => {
    expect(usesApiKeyAuth('sk-ant-usr01-x')).toBe(true);
    expect(usesApiKeyAuth('sk-ant-api03-x')).toBe(true);
    expect(usesApiKeyAuth('sk-ant-oat01-x')).toBe(false);
    expect(usesApiKeyAuth('tok-abc')).toBe(false);
  });
});

describe('safeWorkspaceId', () => {
  it('보이는 ASCII 만으로 된 값은 앞뒤 공백을 떼고 돌려준다', () => {
    expect(safeWorkspaceId('wrkspc_01abc')).toBe('wrkspc_01abc');
    expect(safeWorkspaceId('  wrkspc_01abc ')).toBe('wrkspc_01abc');
  });

  it('없거나 빈 값은 null', () => {
    expect(safeWorkspaceId(null)).toBeNull();
    expect(safeWorkspaceId(undefined)).toBeNull();
    expect(safeWorkspaceId('   ')).toBeNull();
  });

  it('가운데 공백·줄바꿈·제어 문자가 든 값은 헤더 주입을 막으려 버린다(null)', () => {
    expect(safeWorkspaceId('wrkspc_1\r\nx-evil: 1')).toBeNull();
    expect(safeWorkspaceId('wrkspc 1')).toBeNull();
    expect(safeWorkspaceId('wrkspc_1\tx')).toBeNull();
    expect(safeWorkspaceId('wrkspc_1\u0000')).toBeNull();
    expect(safeWorkspaceId('wrkspc_é1')).toBeNull();
  });

  it('128자를 넘으면 null', () => {
    expect(safeWorkspaceId('w'.repeat(128))).toBe('w'.repeat(128));
    expect(safeWorkspaceId('w'.repeat(129))).toBeNull();
  });
});
