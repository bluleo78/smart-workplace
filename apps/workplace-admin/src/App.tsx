import { Route, Routes } from 'react-router-dom'

import { ProtectedRoute } from './components/ProtectedRoute'
import LoginPage from './pages/LoginPage'

// 운영자 콘솔 라우팅.
// - /login: 공개 로그인
// - 그 외: ProtectedRoute 하위(인증 필요). TenantListPage 등 실제 화면은 Task 3 에서.
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<div data-testid="admin-home">admin</div>} />
      </Route>
    </Routes>
  )
}
