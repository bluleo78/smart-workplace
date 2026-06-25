import { Route, Routes } from 'react-router-dom'

import { AdminLayout } from './components/AdminLayout'
import { ProtectedRoute } from './components/ProtectedRoute'
import AuditPage from './pages/AuditPage'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import OperatorsPage from './pages/OperatorsPage'
import SettingsPage from './pages/SettingsPage'
import TenantDetailPage from './pages/TenantDetailPage'
import TenantListPage from './pages/TenantListPage'

// 운영자 콘솔 라우팅.
// - /login: 공개 로그인
// - 그 외: ProtectedRoute(인증) → AdminLayout(좌측 LNB) 하위
//   - / : 테넌트 목록 / /tenants/:id : 테넌트 상세
//   - /dashboard·/operators·/audit·/settings : 준비중 스텁
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AdminLayout />}>
          <Route path="/" element={<TenantListPage />} />
          <Route path="/tenants/:id" element={<TenantDetailPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/operators" element={<OperatorsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
