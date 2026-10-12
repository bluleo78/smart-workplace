// src/lib/activeTenant.ts
// 활성 테넌트(표시용 localStorage 보관값)와 access 토큰의 tenant 클레임 판독.
// WP-341 후속: 쓰던 테넌트가 정지·삭제되면 서버 refresh 가 로그아웃 대신 다른 테넌트(또는 tenant-less) 토큰을 돌려준다.
// 웹은 새 토큰의 tenant 클레임을 보관값과 비교해 "테넌트가 바뀌었는지" 를 알아내야 하므로, 판독을 이 모듈 한곳에 둔다.
import type { Membership } from '../types/auth';

const ACTIVE_TENANT_KEY = 'activeTenant';

/** 보관된 활성 테넌트. 없거나 깨졌으면 null. 데이터 격리는 서버 JWT+RLS 가 강제하므로 이 값은 화면 표시용이다. */
export function readActiveTenant(): Membership | null {
  try {
    const raw = localStorage.getItem(ACTIVE_TENANT_KEY);
    return raw ? (JSON.parse(raw) as Membership) : null;
  } catch {
    return null;
  }
}

/** 활성 테넌트를 기록한다(null 이면 지운다). login 단일 자동선택/select-tenant/refresh 대체 테넌트 시점에 기록. */
export function writeActiveTenant(m: Membership | null) {
  if (m) localStorage.setItem(ACTIVE_TENANT_KEY, JSON.stringify(m));
  else localStorage.removeItem(ACTIVE_TENANT_KEY);
}

/**
 * access 토큰(JWT) 의 tenant 클레임.
 * - number: tenant-scoped 토큰
 * - null: JWT 이지만 tenant 클레임 없음(tenant-less — 로그인 직후·다중 소속 미선택 상태)
 * - undefined: JWT 로 읽을 수 없음(판단 불가) — 호출부는 "변화 없음" 으로 취급한다(E2E 의 불투명 mock 토큰 포함).
 * 서명 검증은 하지 않는다 — 신뢰 판단이 아니라 서버가 이미 정한 테넌트를 화면 상태와 맞추는 용도다.
 */
export function tenantClaimOf(token: string | null | undefined): number | null | undefined {
  if (!token) return undefined;
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload: unknown = JSON.parse(atob(padded));
    if (typeof payload !== 'object' || payload === null) return undefined;
    const tenant = (payload as Record<string, unknown>).tenant;
    if (tenant === undefined || tenant === null) return null;
    return typeof tenant === 'number' ? tenant : undefined;
  } catch {
    return undefined;
  }
}

/**
 * refresh 로 받은 새 access 토큰의 테넌트가 "이 탭이 쓰던" 테넌트와 다른가.
 * - 기준은 이 탭 메모리의 직전 access 토큰(refresh 요청 전에 잡아 둔 값)의 tenant 클레임이다. localStorage 활성 테넌트는 모든 탭이
 *   공유하므로 다른 탭이 먼저 새 테넌트로 바꿔 두면 이 탭의 변경을 놓친다(이전 테넌트 화면에 새 테넌트 데이터가 섞임) — 그래서 보조로만 쓴다.
 * - 직전 토큰이 없거나 판독 불가일 때만 보관된 활성 테넌트(stored)로 대체한다. 보관값 없음은 tenant-less(선택 전)로 본다.
 * - 새 토큰이 판독 불가면 false(변화 없음 — E2E 의 불투명 mock 토큰 포함).
 */
export function tenantChangedSince(
  newToken: string | null | undefined,
  previousToken: string | null | undefined,
  stored: Membership | null,
): boolean {
  const next = tenantClaimOf(newToken);
  if (next === undefined) return false;
  const prev = tenantClaimOf(previousToken);
  const baseline = prev !== undefined ? prev : (stored?.tenantId ?? null);
  return next !== baseline;
}

/** 소속(선택 가능한) 워크스페이스가 하나도 없을 때 로그인 화면 안내 — 로그인 NO_WORKSPACE 와 refresh 후 0개 경로가 같은 문구를 쓴다. */
export const NO_WORKSPACE_MESSAGE = '접속 가능한 워크스페이스가 없습니다. 관리자에게 문의하세요.';
/** 쓰던 워크스페이스를 잃고 다른 워크스페이스로 이어 갔을 때 리로드 후 한 번 띄우는 토스트. */
export const TENANT_SWITCHED_MESSAGE = '이전 워크스페이스를 더 이상 사용할 수 없어 다른 워크스페이스로 이동했습니다.';
/** 쓰던 워크스페이스를 잃고 tenant-less 가 됐을 때 선택 화면에 띄우는 안내. */
export const TENANT_LOST_SELECT_MESSAGE = '이전 워크스페이스를 더 이상 사용할 수 없습니다. 워크스페이스를 선택하세요.';

const TENANT_CHANGED_KEY = 'tenantChanged';

/**
 * 리로드 직전에 "테넌트가 바뀌어 리로드함" 을 1회성으로 표시한다(sessionStorage — 이 탭에만, 리로드는 넘어감). 리로드는 조용히
 * 일어나므로 리로드 후 초기화가 결과(다른 워크스페이스 진입 / 선택 필요)에 맞는 안내를 띄울 수 있게 한다. 저장소가 막혀 있어도
 * 리로드 자체는 진행돼야 하므로 오류는 삼킨다.
 */
export function markTenantChanged() {
  try {
    sessionStorage.setItem(TENANT_CHANGED_KEY, '1');
  } catch {
    // 저장소 접근 불가 — 안내만 생략.
  }
}

/** 남겨 둔 표시를 꺼내고 지운다(한 번만 보이도록). 없거나 읽을 수 없으면 false. */
export function takeTenantChanged(): boolean {
  try {
    const v = sessionStorage.getItem(TENANT_CHANGED_KEY);
    sessionStorage.removeItem(TENANT_CHANGED_KEY);
    return v !== null;
  } catch {
    return false;
  }
}
