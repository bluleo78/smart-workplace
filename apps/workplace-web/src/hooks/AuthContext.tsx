import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { authApi } from '../api/auth';
import { setAccessToken } from '../api/client';
import { usersApi } from '../api/users';
import type { LoginFormData, SignupFormData } from '../lib/validations/auth';
import type { Membership, UserResponse } from '../types/auth';
import type { RoleResponse } from '../types/role';
import { AuthContext } from './auth-context-value';

const AUTH_FLAG_KEY = 'hasSession';
const ACTIVE_TENANT_KEY = 'activeTenant';

// 활성 테넌트는 표시 식별자 용도로 localStorage 에 보관(login 단일 자동선택/select-tenant 시점에만 기록).
// 데이터 격리는 서버 JWT+RLS 가 강제하므로 이 값은 화면 표시용 cosmetic 이다.
function readActiveTenant(): Membership | null {
  try {
    const raw = localStorage.getItem(ACTIVE_TENANT_KEY);
    return raw ? (JSON.parse(raw) as Membership) : null;
  } catch {
    return null;
  }
}
function writeActiveTenant(m: Membership | null) {
  if (m) localStorage.setItem(ACTIVE_TENANT_KEY, JSON.stringify(m));
  else localStorage.removeItem(ACTIVE_TENANT_KEY);
}

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
    };
    setUser(userResponse);
    setRoles(userDetail.roles);
    return userDetail;
  }, []);

  useEffect(() => {
    let ignore = false;

    const initAuth = async () => {
      if (!localStorage.getItem(AUTH_FLAG_KEY)) {
        setIsLoading(false);
        return;
      }

      try {
        const { data: tokens } = await deduplicatedRefresh();
        if (ignore) return;
        setAccessToken(tokens.accessToken);
        // refresh 는 tenant 클레임을 보존하므로, 보관된 활성 테넌트를 복원한다.
        setActiveTenant(readActiveTenant());
        await fetchUserWithRoles();
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
    // 재로그인 시 이전 다중소속 선택지가 잔류하지 않도록 초기화
    setTenantOptions(null);
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

  const selectTenant = useCallback(async (membership: Membership) => {
    // tenant-scoped 토큰 재발급(refresh 쿠키도 tenant-scoped 로 세팅됨).
    const { data: token } = await authApi.selectTenant(membership.tenantId);
    setAccessToken(token.accessToken);
    writeActiveTenant(membership);
    localStorage.setItem(AUTH_FLAG_KEY, 'true');
    // 캐시(React Query/Context)를 새 테넌트로 깨끗이 초기화하기 위해 루트로 전체 리로드.
    window.location.assign('/');
  }, []);

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
      await authApi.logout();
    } finally {
      setAccessToken(null);
      localStorage.removeItem(AUTH_FLAG_KEY);
      writeActiveTenant(null);
      setActiveTenant(null);
      setTenantOptions(null);
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
      user, roles, isLoading, isAuthenticated, activeTenant, tenantOptions,
      login, signup, logout, selectTenant, hasRole, isAdmin, refreshUser,
    }),
    [user, roles, isLoading, isAuthenticated, activeTenant, tenantOptions,
      login, signup, logout, selectTenant, hasRole, isAdmin, refreshUser]
  );

  return (
    <AuthContext value={ctxValue}>
      {children}
    </AuthContext>
  );
}
