// WP-1683 안 쓰는 Playwright 브라우저 정리(browser-prune) 테스트 — 임시 폴더에 가짜 브라우저 폴더(.links·가짜 playwright-core·브라우저 폴더)와
// 홈(<홈>/<AI>/repos/<키>/pnpm-lock.yaml)을 만들어, 정리 규칙대로 지울 것만 지우고 남길 것은 남기는지 본다.
// 기본(Pod) 모드는 저장소 버전 기준으로 임시 설치·브라우저 폴더까지 지우고, 호스트 모드(--host)는 STALE 기록·옛 표시만 치운다(사람이 npx 로 받은 것을 지키려고).
// 이 컴퓨터의 실제 브라우저 폴더(~/.cache/ms-playwright)는 건드리지 않는다 — 늘 --dir 로 임시 폴더를 주고, gw_browsers_dir 는 출력만 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, '..', 'scripts');
const prune = join(scripts, 'browser-prune');
const gwLib = join(scripts, 'gw-lib.sh');

/** 버전 → 가짜 revision(1.60.0 → 1600, 1.61.0 → 1610) — 버전마다 다른 브라우저 폴더 이름을 만든다. */
const rev = (v) => v.split('.').join('');

/**
 * 테스트 하나의 격리 환경 — <root>/pw(브라우저 폴더)와 <root>/home(AI 홈).
 * core: 가짜 playwright-core 폴더, link: 설치 기록, dir: 다 받은 브라우저 폴더, repo: 홈의 저장소(Playwright 버전), install: .genia-installs 설치 한 벌.
 */
function setup(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gw-bprune-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pw = join(root, 'pw');
  const home = join(root, 'home');
  mkdirSync(join(pw, '.links'), { recursive: true });
  mkdirSync(home, { recursive: true });
  const core = (path, version, r = rev(version)) => {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'playwright-core', version }));
    writeFileSync(
      join(path, 'browsers.json'),
      JSON.stringify({ browsers: [{ name: 'chromium', revision: r }, { name: 'chromium-headless-shell', revision: r }, { name: 'ffmpeg', revision: '1011' }] }),
    );
    return path;
  };
  // Playwright 는 설치 기록 파일에 core 경로만(줄바꿈 없이) 적는다.
  const link = (name, target, ageSec = 0) => {
    const p = join(pw, '.links', name);
    writeFileSync(p, target);
    if (ageSec) {
      const at = new Date(Date.now() - ageSec * 1000);
      utimesSync(p, at, at);
    }
    return p;
  };
  const dir = (name) => {
    mkdirSync(join(pw, name), { recursive: true });
    writeFileSync(join(pw, name, 'INSTALLATION_COMPLETE'), '');
  };
  const repo = (ai, key, version) => {
    const r = join(home, ai, 'repos', key);
    mkdirSync(r, { recursive: true });
    writeFileSync(join(r, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\n\npackages:\n\n  '@playwright/test@${version}':\n    resolution: {}\n`);
  };
  const install = (version) => {
    const c = core(join(pw, '.genia-installs', version, 'node_modules', 'playwright-core'), version);
    link(`gi-${version}`, c);
    dir(`chromium-${rev(version)}`);
    dir(`chromium_headless_shell-${rev(version)}`);
    return c;
  };
  const has = (...p) => existsSync(join(pw, ...p));
  const run = (args, extra = {}) =>
    spawnSync(prune, args, { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: join(root, 'user'), ...extra } });
  const pod = (extra) => run(['--dir', pw, home], extra);
  const host = (extra) => run(['--host', '--dir', pw, home], extra);
  return { root, pw, home, core, link, dir, repo, install, has, run, pod, host };
}

const lines = (s) => s.split('\n').filter(Boolean).sort();

test('dropsStaleLinksAndTheirBrowsers', (t) => {
  const s = setup(t);
  s.repo('ai1', 'WP', '1.60.0');
  s.link('A', join(s.root, 'gone', 'node_modules', 'playwright-core'));
  s.install('1.60.0');
  s.dir('chromium-1500');
  s.dir('ffmpeg-1011');
  const r = s.pod();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.has('.links', 'A'), false);
  assert.equal(s.has('chromium-1500'), false);
  for (const n of ['chromium-1600', 'chromium_headless_shell-1600', 'ffmpeg-1011', join('.links', 'gi-1.60.0')]) assert.ok(s.has(n), n);
  assert.deepEqual(lines(r.stdout), ['removed chromium-1500', 'removed-link A']);
});

test('keepsVersionsOfEveryRepoUnderHome', (t) => {
  // 같은 AI 의 다른 저장소뿐 아니라 호스트에선 다른 AI 의 저장소(<홈>/*/repos/*)가 쓰는 버전도 지킨다.
  const s = setup(t);
  s.repo('ai1', 'AA', '1.60.0');
  s.repo('ai2', 'BB', '1.61.0');
  for (const v of ['1.59.0', '1.60.0', '1.61.0']) s.install(v);
  const r = s.pod();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.has('.links', 'gi-1.59.0'), false);
  assert.equal(s.has('.genia-installs', '1.59.0'), false);
  assert.equal(s.has('chromium-1590'), false);
  assert.equal(s.has('chromium_headless_shell-1590'), false);
  for (const v of ['1.60.0', '1.61.0']) {
    assert.ok(s.has('.links', `gi-${v}`), v);
    assert.ok(s.has('.genia-installs', v, 'node_modules', 'playwright-core', 'browsers.json'), v);
    assert.ok(s.has(`chromium-${rev(v)}`), v);
    assert.ok(s.has(`chromium_headless_shell-${rev(v)}`), v);
  }
  assert.deepEqual(lines(r.stdout), ['removed chromium-1590', 'removed chromium_headless_shell-1590', 'removed-install 1.59.0', 'removed-link gi-1.59.0']);
});

test('npxInstallsFollowRepoVersionsButKeepNewestCli', (t) => {
  const s = setup(t);
  s.repo('ai1', 'WP', '1.60.0');
  const npx = join(s.root, 'npm', '_npx');
  s.link('h1', s.core(join(npx, 'h1', 'node_modules', 'playwright-core'), '1.58.0'));
  s.link('h2', s.core(join(npx, 'h2', 'node_modules', 'playwright-core'), '1.60.0'));
  // playwright-cli 가 품은 core — 저장소 버전과 상관없이 가장 최근 것 하나만 남는다(호스트의 화면 탐색용).
  s.link('c1', s.core(join(npx, 'c1', 'node_modules', '@playwright', 'cli', 'node_modules', 'playwright-core'), '1.57.0', '1700'), 3600);
  s.link('c2', s.core(join(npx, 'c2', 'node_modules', '@playwright', 'cli', 'node_modules', 'playwright-core'), '1.57.1', '1710'));
  for (const n of ['chromium-1580', 'chromium-1600', 'chromium-1700', 'chromium-1710']) s.dir(n);
  const r = s.pod();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.has('.links', 'h1'), false);
  assert.equal(s.has('.links', 'c1'), false);
  // 링크만 지우고 npx 캐시 폴더는 건드리지 않는다(npm 이 관리한다).
  assert.ok(existsSync(join(npx, 'h1', 'node_modules', 'playwright-core', 'package.json')));
  assert.ok(existsSync(join(npx, 'c1', 'node_modules', '@playwright', 'cli')));
  for (const n of [join('.links', 'h2'), join('.links', 'c2'), 'chromium-1600', 'chromium-1710']) assert.ok(s.has(n), n);
  assert.equal(s.has('chromium-1580'), false);
  assert.equal(s.has('chromium-1700'), false);
});

test('keepsBrowsersOfValidNonTemporaryLinks', (t) => {
  // 사람이 node_modules 로 설치한 프로젝트·이미지의 playwright-cli core 는 임시 설치가 아니다 — 저장소 버전이 아니어도 브라우저가 남는다.
  const s = setup(t);
  s.repo('ai1', 'WP', '1.60.0');
  s.link('proj', s.core(join(s.root, 'proj', 'node_modules', 'playwright-core'), '1.57.0'));
  s.link('genia-playwright-cli', s.core(join(s.root, 'clicore'), '1.58.0', '1700'));
  for (const n of ['chromium-1570', 'chromium_headless_shell-1570', 'chromium-1700', 'chromium-1500']) s.dir(n);
  const r = s.pod();
  assert.equal(r.status, 0, r.stderr);
  for (const n of ['chromium-1570', 'chromium_headless_shell-1570', 'chromium-1700', join('.links', 'proj'), join('.links', 'genia-playwright-cli')]) {
    assert.ok(s.has(n), n);
  }
  assert.equal(s.has('chromium-1500'), false);
});

test('neverTouchesSymlinksOrNonBrowserEntries', (t) => {
  // 이미지가 /ms-playwright 에 건 심볼릭 링크와 브라우저 이름 규칙에 맞지 않는 것(daemon·b·설정 파일 등)은 아무도 쓰지 않아도 둔다.
  const s = setup(t);
  s.repo('ai1', 'WP', '1.60.0');
  s.install('1.60.0');
  mkdirSync(join(s.root, 'base', 'chromium-1223'), { recursive: true });
  symlinkSync(join(s.root, 'base', 'chromium-1223'), join(s.pw, 'chromium-1223'));
  for (const n of ['daemon', 'b', 'chromium-notes', 'chromium-12a']) mkdirSync(join(s.pw, n));
  writeFileSync(join(s.pw, 'cli-update-check.json'), '{}');
  const r = s.pod();
  assert.equal(r.status, 0, r.stderr);
  for (const n of ['chromium-1223', 'daemon', 'b', 'chromium-notes', 'chromium-12a', 'cli-update-check.json']) assert.ok(s.has(n), n);
  assert.ok(existsSync(join(s.root, 'base', 'chromium-1223')));
  assert.equal(r.stdout, '');
});

test('removesLegacyMarkers', (t) => {
  const s = setup(t);
  s.repo('ai1', 'WP', '1.60.0');
  s.install('1.60.0');
  writeFileSync(join(s.pw, '.genia-chromium-1.59.1'), '');
  writeFileSync(join(s.pw, '.genia-chromium-1.60.0'), '');
  const r = s.pod();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.has('.genia-chromium-1.59.1'), false);
  assert.equal(s.has('.genia-chromium-1.60.0'), false);
  assert.deepEqual(lines(r.stdout), ['removed-marker .genia-chromium-1.59.1', 'removed-marker .genia-chromium-1.60.0']);
});

test('skipsWhileInstallLockIsFresh', (t) => {
  // Playwright 가 설치 중이면(__dirlock 이 10분 안에 바뀜) 두 모드 모두 아무것도 지우지 않는다 — 받는 중인 폴더를 지우지 않게.
  const s = setup(t);
  s.repo('ai1', 'WP', '1.60.0');
  s.install('1.60.0');
  s.dir('chromium-1500');
  s.link('A', join(s.root, 'gone'));
  writeFileSync(join(s.pw, '.genia-chromium-1.59.1'), '');
  mkdirSync(join(s.pw, '__dirlock'));
  for (const r of [s.pod(), s.host()]) {
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /설치 중/);
    assert.equal(r.stdout, '');
  }
  assert.ok(s.has('chromium-1500') && s.has('.links', 'A') && s.has('.genia-chromium-1.59.1'));
  const old = new Date(Date.now() - 11 * 60 * 1000);
  utimesSync(join(s.pw, '__dirlock'), old, old);
  const r = s.pod();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.has('chromium-1500'), false);
});

test('skipsWithoutAnyValidLink', (t) => {
  // 유효한 설치 기록이 하나도 없으면 「쓰는 것」을 알 수 없다 — STALE 기록만 치우고 브라우저 폴더는 두고 종료 3.
  const s = setup(t);
  s.repo('ai1', 'WP', '1.60.0');
  s.link('A', join(s.root, 'gone-a'));
  s.link('B', join(s.root, 'gone-b'));
  s.dir('chromium-1500');
  s.dir('chromium-1600');
  const r = s.pod();
  assert.equal(r.status, 3);
  assert.match(r.stderr, /유효한 설치 기록 없음/);
  assert.equal(s.has('.links', 'A'), false);
  assert.equal(s.has('.links', 'B'), false);
  assert.ok(s.has('chromium-1500') && s.has('chromium-1600'));
});

test('continuesWhenAFolderCannotBeRemoved', (t) => {
  if (process.getuid?.() === 0) return t.skip('root 는 권한과 상관없이 지운다');
  const s = setup(t);
  s.repo('ai1', 'WP', '1.60.0');
  s.install('1.60.0');
  s.dir('chromium-1400');
  s.dir('chromium-1500');
  const locked = join(s.pw, 'chromium-1500', 'sub');
  mkdirSync(locked);
  writeFileSync(join(locked, 'f'), 'x');
  chmodSync(locked, 0o500);
  let r;
  try {
    r = s.pod();
  } finally {
    // 바로 되돌린다 — setup 의 t.after(임시 폴더 지우기)가 먼저 돌아 권한 때문에 실패하지 않게.
    chmodSync(locked, 0o700);
  }
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /지우지 못했습니다.*chromium-1500/);
  assert.equal(s.has('chromium-1400'), false);
  assert.ok(s.has('chromium-1500'));
  assert.deepEqual(lines(r.stdout), ['removed chromium-1400']);
});

test('hostModeOnlyDropsStaleLinksAndMarkers', (t) => {
  // 같은 폴더를 두 모드로 정리해 차이를 고정한다(WP-1683 결정). 호스트에서는 사람이 npx 로 쓴 Playwright 의 브라우저를 지우지 않게
  // STALE 기록과 옛 표시만 치우고, 임시 설치 기록·.genia-installs·브라우저 폴더는 그대로 둔다(뒤의 정리는 Playwright 자신의 GC 가 한다).
  const build = (s) => {
    s.repo('ai1', 'WP', '1.60.0');
    s.install('1.60.0');
    s.install('1.59.0'); // 저장소가 더는 쓰지 않는 버전
    s.link('stale', join(s.root, 'gone'));
    s.link('npx-old', s.core(join(s.root, 'npm', '_npx', 'h1', 'node_modules', 'playwright-core'), '1.58.0'));
    s.dir('chromium-1580');
    s.dir('chromium-1500'); // 아무 기록도 쓰지 않는 폴더
    writeFileSync(join(s.pw, '.genia-chromium-1.59.0'), '');
  };
  const h = setup(t);
  build(h);
  const hr = h.host();
  assert.equal(hr.status, 0, hr.stderr);
  assert.deepEqual(lines(hr.stdout), ['removed-link stale', 'removed-marker .genia-chromium-1.59.0']);
  for (const n of [
    join('.links', 'npx-old'),
    join('.links', 'gi-1.59.0'),
    join('.genia-installs', '1.59.0', 'node_modules', 'playwright-core', 'browsers.json'),
    'chromium-1590',
    'chromium_headless_shell-1590',
    'chromium-1580',
    'chromium-1500',
    'chromium-1600',
  ]) {
    assert.ok(h.has(n), `호스트 모드가 ${n} 를 지웠습니다`);
  }

  const p = setup(t);
  build(p);
  const pr = p.pod();
  assert.equal(pr.status, 0, pr.stderr);
  assert.deepEqual(lines(pr.stdout), [
    'removed chromium-1500',
    'removed chromium-1580',
    'removed chromium-1590',
    'removed chromium_headless_shell-1590',
    'removed-install 1.59.0',
    'removed-link gi-1.59.0',
    'removed-link npx-old',
    'removed-link stale',
    'removed-marker .genia-chromium-1.59.0',
  ]);
  assert.ok(p.has('chromium-1600') && p.has('chromium_headless_shell-1600'));
});

test('hostModeWithoutValidLinksStillSucceeds', (t) => {
  // 호스트 모드는 「쓰는 것」을 계산하지 않으므로 유효한 기록이 없어도 건너뛰지 않는다(종료 0).
  const s = setup(t);
  s.link('A', join(s.root, 'gone'));
  s.dir('chromium-1500');
  const r = s.host();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), ['removed-link A']);
  assert.ok(s.has('chromium-1500'));
});

test('usageAndMissingFolders', (t) => {
  const s = setup(t);
  assert.equal(s.run([]).status, 2);
  assert.equal(s.run(['--dir', s.pw, join(s.root, 'no-home')]).status, 2);
  assert.equal(s.run(['--bogus', s.home]).status, 2);
  const r = s.run(['--dir', join(s.root, 'no-pw'), s.home]);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /브라우저 폴더 없음/);
  // PLAYWRIGHT_BROWSERS_PATH=0(브라우저를 패키지 안에 둠)이면 정리할 폴더가 없다.
  const z = s.run([s.home], { PLAYWRIGHT_BROWSERS_PATH: '0' });
  assert.equal(z.status, 3);
  assert.match(z.stderr, /브라우저 폴더 없음/);
});

test('defaultsBrowsersDir', (t) => {
  const s = setup(t);
  const call = (extra) => spawnSync('sh', ['-c', '. "$1" && gw_browsers_dir', 'sh', gwLib], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: join(s.root, 'user'), ...extra } });
  assert.equal(call({ PLAYWRIGHT_BROWSERS_PATH: '/x' }).stdout, '/x\n');
  const zero = call({ PLAYWRIGHT_BROWSERS_PATH: '0' });
  assert.deepEqual([zero.status, zero.stdout], [1, '']);
  if (process.platform === 'darwin') {
    assert.equal(call({}).stdout, `${join(s.root, 'user', 'Library', 'Caches', 'ms-playwright')}\n`);
  } else {
    assert.equal(call({ XDG_CACHE_HOME: '/c' }).stdout, '/c/ms-playwright\n');
    assert.equal(call({}).stdout, `${join(s.root, 'user', '.cache', 'ms-playwright')}\n`);
  }
});

test('gwPlaywrightVersionReadsLockThenPackageJson', (t) => {
  const s = setup(t);
  const call = (d) => spawnSync('sh', ['-c', '. "$1" && gw_playwright_version "$2"', 'sh', gwLib, d], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: s.root } });
  const lock = join(s.root, 'a');
  mkdirSync(lock);
  writeFileSync(join(lock, 'pnpm-lock.yaml'), "importers:\n  .:\n    devDependencies:\n      '@playwright/test':\n        specifier: ^1.58.0\n\npackages:\n\n  playwright-core@1.58.2:\n    resolution: {}\n  '@playwright/test@1.58.2':\n    resolution: {}\n");
  assert.equal(call(lock).stdout, '1.58.2\n');
  const pkg = join(s.root, 'b');
  mkdirSync(pkg);
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ devDependencies: { '@playwright/test': '^1.57.0' } }));
  assert.equal(call(pkg).stdout, '1.57.0\n');
  const none = join(s.root, 'c');
  mkdirSync(none);
  const r = call(none);
  assert.deepEqual([r.status, r.stdout], [1, '']);
});

test('gwPlaywrightVersionRejectsRangeWithoutPatch', (t) => {
  // ^1.50 처럼 패치 자리가 없는 범위를 「1.50」 으로 읽으면 npm 이 1.50.1 을 받아, 받은 버전과 지키는 버전이 어긋난다(코드 리뷰).
  // x.y.z 세 자리가 아니면 「못 읽음」(1) — 그 저장소의 브라우저는 받지 않는 기존 경로로 간다.
  const s = setup(t);
  const call = (d) => spawnSync('sh', ['-c', '. "$1" && gw_playwright_version "$2"', 'sh', gwLib, d], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: s.root } });
  for (const [name, spec] of [['short', '^1.50'], ['major', '1'], ['four', '1.50.1.2'], ['dots', '1..2']]) {
    const d = join(s.root, name);
    mkdirSync(d);
    writeFileSync(join(d, 'package.json'), JSON.stringify({ devDependencies: { '@playwright/test': spec } }));
    const r = call(d);
    assert.deepEqual([r.status, r.stdout], [1, ''], spec);
  }
});

test('keepsGeniaInstallByFolderNameNotPackageVersion', (t) => {
  // .genia-installs/<버전> 은 이미지가 그 버전 이름으로 받은 폴더다 — 지키기는 폴더 이름으로 본다.
  // 안의 package.json 버전이 폴더 이름과 달라도(npm 이 범위를 풀어 다른 패치를 받은 등) 저장소 버전과 폴더 이름이 같으면 남긴다.
  const s = setup(t);
  s.repo('ai1', 'WP', '1.60.0');
  const c = s.core(join(s.pw, '.genia-installs', '1.60.0', 'node_modules', 'playwright-core'), '1.60.1', '1600');
  s.link('gi-1.60.0', c);
  s.dir('chromium-1600');
  s.dir('chromium_headless_shell-1600');
  const r = s.pod();
  assert.equal(r.status, 0, r.stderr);
  for (const n of [join('.links', 'gi-1.60.0'), join('.genia-installs', '1.60.0'), 'chromium-1600', 'chromium_headless_shell-1600']) assert.ok(s.has(n), n);
  assert.deepEqual(lines(r.stdout), []);
});
