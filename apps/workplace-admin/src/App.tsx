import { Route, Routes } from 'react-router-dom'

import { AdminLayout } from './components/AdminLayout'
import { ProtectedRoute } from './components/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import TenantListPage from './pages/TenantListPage'

// 운영자 콘솔 라우팅.
// - /login: 공개 로그인
// - 그 외: ProtectedRoute(인증) → AdminLayout(공통 헤더) 하위
//   - / : 테넌트 목록
//   - /tenants/:id : 테넌트 상세(Task 4 — 지금은 placeholder)
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AdminLayout />}>
          <Route path="/" element={<TenantListPage />} />
          <Route
            path="/tenants/:id"
            element={<div data-testid="tenant-detail-placeholder">tenant detail</div>}
          />
        </Route>
      </Route>
    </Routes>
  )
}
