// 라우터 소스에서 경로를 뽑는 extractRoutes / 패턴 매칭 matchRoute 테스트.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './lib/books.mjs';
import { extractRoutes, matchRoute } from './lib/routes.mjs';

const FIXTURE = `
<Routes>
  <Route path="/login" element={<LoginPage />} />
  <Route path="/wiki/share/:token" element={<WikiShareGate />}>
    <Route index element={<WikiSharePage />} />
    <Route path="pages/:pageId" element={<WikiSharePage />} />
  </Route>
  <Route element={<ProtectedRoute />}>
    <Route element={<AppLayout />}>
      <Route index element={<HomePage />} />
      <Route path="tasks" element={<DesktopOnly><Navigate to="/me/tasks/assigned" replace /></DesktopOnly>} />
      <Route path="admin/*" element={<AdminRedirect />} />
      <Route path="me/tasks/:tab" element={<MyTasksPage />} />
    </Route>
  </Route>
</Routes>
`;

test('extractRoutes joins nested paths', () => {
  const { pages } = extractRoutes(FIXTURE);
  assert.deepEqual(
    new Set(pages.map((p) => p.path)),
    new Set(['/login', '/wiki/share/:token', '/wiki/share/:token/pages/:pageId', '/', '/me/tasks/:tab']),
  );
  assert.equal(pages.find((p) => p.path === '/').element, 'HomePage');
});

test('extractRoutes detects wrapped Navigate and Redirect components', () => {
  const { redirects } = extractRoutes(FIXTURE);
  assert.deepEqual(redirects, ['/tasks', '/admin/*']);
});

test('matchRoute supports double-star suffix', () => {
  assert.equal(matchRoute('/me/**', '/me/tasks/:tab'), true);
  assert.equal(matchRoute('/me/**', '/meeting'), false);
  assert.equal(matchRoute('/me/**', '/me'), true);
  assert.equal(matchRoute('/me', '/me/tasks'), false);
});

test('extractRoutes reads the real web router without throwing', async () => {
  const src = await readFile(path.join(ROOT, 'apps/workplace-web/src/App.tsx'), 'utf-8');
  const { pages, redirects } = extractRoutes(src);
  const paths = pages.map((p) => p.path);
  assert.ok(paths.includes('/settings/agents'));
  assert.ok(redirects.includes('/settings/wiki-sharing'));
  assert.ok(redirects.includes('/profile'));
});

test('extractRoutes rejects non double-quoted path', () => {
  assert.throws(() => extractRoutes(`<Routes><Route path='/a' element={<APage />} /></Routes>`), /Route/);
  assert.throws(() => extractRoutes(`<Routes><Route path={'/a'} element={<APage />} /></Routes>`), /Route/);
  // element 본문 안의 path= 는 라우트 경로가 아니다.
  const { pages } = extractRoutes(`<Routes><Route path="/a" element={<X path={1} />} /></Routes>`);
  assert.deepEqual(pages.map((p) => p.path), ['/a']);
});

test('extractRoutes reads the real admin router', async () => {
  const src = await readFile(path.join(ROOT, 'apps/workplace-admin/src/App.tsx'), 'utf-8');
  const paths = extractRoutes(src).pages.map((p) => p.path);
  for (const p of ['/login', '/', '/tenants/:id']) assert.ok(paths.includes(p), p);
});

test('extractRoutes keeps routes after a string containing a comment opener', () => {
  // 문자열 "admin/*" 의 /* 를 주석 시작으로 보면 뒤의 /** 설명 */ 까지 지워져 /b 가 사라진다.
  const src = [
    '<Routes>',
    '  <Route path="admin/*" element={<A />} />',
    '  /** 설명 */',
    '  <Route path="/b" element={<B />} />',
    '</Routes>',
  ].join('\n');
  assert.deepEqual(extractRoutes(src).pages.map((p) => p.path), ['/admin/*', '/b']);
});

test('extractRoutes ignores line-commented routes', () => {
  const src = ['<Routes>', '  // <Route path="/old" element={<Old />} />', '  <Route path="/new" element={<New />} />', '</Routes>'].join('\n');
  assert.deepEqual(extractRoutes(src).pages.map((p) => p.path), ['/new']);
});

test('extractRoutes reads path after element when another attribute has braces', () => {
  // element 값만 지우고 뒤의 path·handle 속성은 남겨야 한다.
  const src = '<Routes><Route element={<A/>} path="/x" handle={{crumb:1}}></Route></Routes>';
  assert.deepEqual(extractRoutes(src).pages, [{ path: '/x', element: 'A' }]);
});
