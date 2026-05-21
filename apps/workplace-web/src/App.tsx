import { Route, Routes } from 'react-router-dom'

import { AppLayout } from './components/layout/AppLayout'
import { PageErrorBoundary } from './components/PageErrorBoundary'
import HomePage from './pages/HomePage'
import NotFoundPage from './pages/NotFoundPage'

// v1 골격 라우트.
// 인증·관리자·이슈 등 도메인 라우트는 후속 티켓에서 확장.
export default function App() {
  return (
    <PageErrorBoundary>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </PageErrorBoundary>
  )
}
