import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { authApi } from '../api/auth';
import { setAccessToken } from '../api/client';
import { usersApi } from '../api/users';
import {
  NO_WORKSPACE_MESSAGE,
  readActiveTenant,
  takeTenantChanged,
  TENANT_LOST_SELECT_MESSAGE,
  TENANT_SWITCHED_MESSAGE,
  tenantClaimOf,
  writeActiveTenant,
} from '../lib/activeTenant';
import { clearStarterStorage } from '../lib/ai/starterStorage';
import { clearPushOnLogout } from '../lib/push/subscription';
import type { LoginFormData, SignupFormData } from '../lib/validations/auth';
import { withTimeout } from '../lib/withTimeout';
import type { Membership, UserResponse } from '../types/auth';
import type { RoleResponse } from '../types/role';
import { AuthContext } from './auth-context-value';

const AUTH_FLAG_KEY = 'hasSession';

// React StrictMode(dev)에서 useEffect가 두 번 실행되어 refresh API가 중복 호출되는 것을 방지.
// 동시 호출 시 동일한 Promise를 반환하여 실제 HTTP 요청은 한 번만 발생한다.
let pendingRefresh: Promise<{ data: { accessToken: string } }> | null = null;
function deduplicatedRefresh() {
  if (!pendingRefresh) {
    pendingRefresh = authApi.refresh().finally(() => { pendingRefresh = null; });
  }
  return pendingRefresh;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserResponse | null>(null);
  const [roles, setRoles] = useState<RoleResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTenant, setActiveTenant] = useState<Membership | null>(null);
  const [tenantOptions, setTenantOptions] = useState<Membership[] | null>(null);
  // 로그인/선택 화면에 띄울 세션 안내(워크스페이스 상실·무소속). LoginPage 와 WorkspaceSelectCard 가 표시한다.
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const isAuthenticated = user !== null;

  const fetchUserWithRoles = useCallback(async () => {
    const { data: userDetail } = await usersApi.getMe();
    const userResponse: UserResponse = {
      id: userDetail.id,
      username: userDetail.username,
      email: userDetail.email,
      name: userDetail.name,
      isActive: userDetail.isActive,
      createdAt: userDetail.createdAt,
      kind: userDetail.kind,
      aiAvailable: userDetail.aiAvailable,
      hasPassword: userDetail.hasPassword,
    };
    setUser(userResponse);
    setRoles(userDetail.roles);
    return userDetail;
  }, []);

  useEffect(() => {
    let ignore = false;

    /**
     * tenant-less(또는 토큰의 테넌트를 선택 가능 목록에서 찾지 못함) — 사용자·역할은 테넌트 RLS 아래라 로드하지 않고, 선택 가능한
     * 워크스페이스로 선택 카드를 띄운다(ProtectedRoute → /login → WorkspaceSelectCard). 하나도 없으면 refresh 쿠키를 서버에서
     * 폐기(logout, 실패 무시)하고 세션을 정리해 로그인 폼에 무소속 안내를 띄운다.
     * @param tenantChanged 직전 탭이 테넌트 변경으로 리로드했는가 — 그렇다면 선택 카드에 이유를 알린다.
     */
    const toSelection = async (memberships: Membership[], tenantChanged: boolean) => {
      writeActiveTenant(null);
      setActiveTenant(null);
      if (memberships.length === 0) {
        await authApi.logout().catch(() => {});
        if (ignore) return;
        setAccessToken(null);
        localStorage.removeItem(AUTH_FLAG_KEY);
        setAuthNotice(NO_WORKSPACE_MESSAGE);
        return;
      }
      if (tenantChanged) setAuthNotice(TENANT_LOST_SELECT_MESSAGE);
      setTenantOptions(memberships);
    };

    const initAuth = async () => {
      if (!localStorage.getItem(AUTH_FLAG_KEY)) {
        setIsLoading(false);
        return;
      }

      try {
        const { data: tokens } = await deduplicatedRefresh();
        if (ignore) return;
        setAccessToken(tokens.accessToken);
        // refresh 는 보통 tenant 클레임을 보존하지만, 쓰던 테넌트를 더는 쓸 수 없으면 서버가 로그인과 같은 규칙으로 다시 고른다
        // (WP-341 후속): 남은 소속 1개 → 그 테넌트 토큰, 그 외 → tenant-less. 새 토큰 기준으로 활성 테넌트를 맞춘다.
        // 직전 탭이 테넌트 변경으로 리로드했다면 1회성 표시가 남아 있다 — 결과에 맞는 안내를 한 번만 보여 준다.
        const tenantChanged = takeTenantChanged();
        const stored = readActiveTenant();
        const claim = tenantClaimOf(tokens.accessToken);

        if (claim !== undefined && claim !== stored?.tenantId) {
          // 보관값과 다른 테넌트(또는 tenant-less) — 멤버십 목록을 한 번 받아, 토큰의 테넌트가 목록에 있으면 그 테넌트로 이어 가고
          // (표시용 이름·슬러그는 목록에서), tenant-less 이거나 목록에 없으면(경합 등) 선택 경로로 보낸다.
          const { data: memberships } = await authApi.memberships();
          if (ignore) return;
          const next = claim == null ? undefined : memberships.find((m) => m.tenantId === claim);
          if (!next) {
            await toSelection(memberships, tenantChanged);
            return;
          }
          writeActiveTenant(next);
          setActiveTenant(next);
        } else {
          // 같은 테넌트(또는 판독 불가 토큰) — 보관된 활성 테넌트를 복원한다.
          setActiveTenant(stored);
        }
        await fetchUserWithRoles();
        if (ignore) return;
        // 테넌트 변경 리로드 후 다른 워크스페이스로 진입했으면 한 번 알린다.
        if (tenantChanged) toast.info(TENANT_SWITCHED_MESSAGE);
      } catch {
        if (ignore) return;
        // refresh 실패(테넌트 정지/만료 포함) → 세션·활성테넌트 정리 후 로그인으로.
        setAccessToken(null);
        localStorage.removeItem(AUTH_FLAG_KEY);
        writeActiveTenant(null);
        setActiveTenant(null);
      } finally {
        if (!ignore) setIsLoading(false);
      }
    };

    initAuth();
    return () => { ignore = true; };
  }, [fetchUserWithRoles]);

  const login = useCallback(async (data: LoginFormData) => {
    // 재로그인 시 이전 다중소속 선택지·세션 안내가 잔류하지 않도록 초기화
    setTenantOptions(null);
    setAuthNotice(null);
    const { data: res } = await authApi.login(data);
    const memberships = res.memberships ?? [];

    if (memberships.length === 0) {
      // 소속 워크스페이스 없음 — 인증 미완료 처리.
      throw new Error('NO_WORKSPACE');
    }

    setAccessToken(res.accessToken);

    if (memberships.length > 1) {
      // 다중소속 — tenant-less 토큰. roles RLS 때문에 user/roles 는 선택 후 로드.
      // hasSession 도 선택 전까지 설정하지 않는다(미선택 채 새로고침 시 로그인으로).
      setTenantOptions(memberships);
      return;
    }

    // 단일소속 — 백엔드가 이미 tenant-scoped 토큰 발급. 활성 테넌트 보관 후 진입.
    const only = memberships[0];
    writeActiveTenant(only);
    setActiveTenant(only);
    localStorage.setItem(AUTH_FLAG_KEY, 'true');
    try {
      await fetchUserWithRoles();
    } catch (e) {
      // user/roles 로드 실패 시 부분 상태(hasSession/activeTenant)를 되돌려 init 과 대칭 유지
      writeActiveTenant(null);
      setActiveTenant(null);
      localStorage.removeItem(AUTH_FLAG_KEY);
      throw e;
    }
  }, [fetchUserWithRoles]);

  const selectTenant = useCallback(async (membership: Membership, redirectTo = '/') => {
    // tenant-scoped 토큰 재발급(refresh 쿠키도 tenant-scoped 로 세팅됨).
    const { data: token } = await authApi.selectTenant(membership.tenantId);
    setAccessToken(token.accessToken);
    writeActiveTenant(membership);
    localStorage.setItem(AUTH_FLAG_KEY, 'true');
    // 캐시(React Query/Context)를 새 테넌트로 깨끗이 초기화하기 위해 전체 리로드 — 알림 탭 이동은 원래 목적지로.
    window.location.assign(redirectTo);
  }, []);

  // WP-48 SSO 완료 — 콜백이 심어 둔 refresh 쿠키로 세션을 받는다. 서버가 SSO 켜진 워크스페이스 1개면 이미 자동 선택했으므로
  // 멤버십 수로 분기: 1개 → 바로 진입, 여러 개 → 선택 카드, 0개 → 세션 정리.
  const completeSsoLogin = useCallback(async (): Promise<'entered' | 'select' | 'none'> => {
    setTenantOptions(null);
    const { data: tokens } = await deduplicatedRefresh();
    setAccessToken(tokens.accessToken);
    const { data: memberships } = await authApi.memberships();
    if (memberships.length === 0) {
      setAccessToken(null);
      return 'none';
    }
    if (memberships.length > 1) {
      setTenantOptions(memberships);
      return 'select';
    }
    const only = memberships[0];
    writeActiveTenant(only);
    setActiveTenant(only);
    localStorage.setItem(AUTH_FLAG_KEY, 'true');
    await fetchUserWithRoles();
    return 'entered';
  }, [fetchUserWithRoles]);

  const signup = useCallback(async (data: SignupFormData) => {
    // confirmPassword는 클라이언트 검증 전용이므로 서버 페이로드에서 제외
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { confirmPassword, ...payload } = data;
    await authApi.signup({
      ...payload,
      email: payload.email || undefined,
    });
    await login({ username: data.username, password: data.password });
  }, [login]);

  const logout = useCallback(async () => {
    try {
      // 서버 logout(토큰 폐기) 전에 이 기기의 푸시 매핑을 지운다 — 토큰이 아직 살아 있어야 인증 호출이 통과한다.
      // 실패는 clearPushOnLogout 내부에서 흡수하지만, 요청 자체가 멈춰버리면(네트워크 hang) 로그아웃 전체가
      // 막혀 사용자가 로그아웃도 못 하게 된다 — 로그아웃은 즉시 끝나야 하는 동작이므로 최대 3초만 기다리고
      // 넘어간다(순서는 유지: 푸시 정리 시도가 먼저).
      await withTimeout(clearPushOnLogout(), 3000);
      await authApi.logout();
    } finally {
      setAccessToken(null);
      localStorage.removeItem(AUTH_FLAG_KEY);
      // WP-139: 빈 AI 대화 추천 저장(사용자별)을 지운다 — 같은 기기의 다음 사용자에게 보이지 않게.
      clearStarterStorage();
      writeActiveTenant(null);
      setActiveTenant(null);
      setTenantOptions(null);
      setAuthNotice(null);
      setUser(null);
      setRoles([]);
    }
  }, []);

  const hasRole = useCallback((roleName: string) => {
    return roles.some(r => r.name === roleName);
  }, [roles]);

  const isAdmin = useMemo(() => {
    return roles.some(r => r.name === 'ADMIN');
  }, [roles]);

  const refreshUser = useCallback(async () => {
    await fetchUserWithRoles();
  }, [fetchUserWithRoles]);

  const ctxValue = useMemo(
    () => ({
      user, roles, isLoading, isAuthenticated, activeTenant, tenantOptions, authNotice,
      login, signup, logout, selectTenant, completeSsoLogin, hasRole, isAdmin, refreshUser,
    }),
    [user, roles, isLoading, isAuthenticated, activeTenant, tenantOptions, authNotice,
      login, signup, logout, selectTenant, completeSsoLogin, hasRole, isAdmin, refreshUser]
  );

  return (
    <AuthContext value={ctxValue}>
      {children}
    </AuthContext>
  );
}
