import { Route, Routes } from 'react-router-dom'

// 임시 최소 App — 라우팅/페이지는 후속 태스크에서 채운다.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<div>workplace-admin</div>} />
    </Routes>
  )
}
