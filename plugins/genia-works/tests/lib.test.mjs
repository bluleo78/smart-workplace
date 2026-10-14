// mod 순수 함수 테스트 — $ 없이 node --test 로 돈다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKeyList, identityLabel, isKeyPath, toolTargets, END_CLEARS, applyMaskedInput, maskOf, initializeBody, validName, validKey, findManualRegistrations, sameServer } from '../hooks/lib.js';

test('parseKeyList: 탭 구분 줄을 이름·등록일로', () => {
  assert.deepEqual(parseKeyList('ai-dev\t10-14\nai-review\t10-12\n'), [
    { name: 'ai-dev', added: '10-14' },
    { name: 'ai-review', added: '10-12' },
  ]);
  assert.deepEqual(parseKeyList(''), []);
});

test('identityLabel: 세션 선택 > GENIA_WORKS_AS > 환경변수 토큰 > 내 토큰', () => {
  assert.equal(identityLabel({ selected: 'ai-rev', as: 'ai-dev', hasEnvToken: true }), 'genia-works: ai-rev');
  assert.equal(identityLabel({ selected: 'me', as: 'ai-dev', hasEnvToken: true }), 'genia-works: 환경변수 토큰');
  assert.equal(identityLabel({ selected: 'me', as: 'ai-dev', hasEnvToken: false }), 'genia-works: 내 토큰');
  assert.equal(identityLabel({ as: 'ai-dev', hasEnvToken: false }), 'genia-works: ai-dev');
  assert.equal(identityLabel({ hasEnvToken: false }), 'genia-works: 내 토큰');
});

test('identityLabel: 고른 이름의 키가 없으면 안내 문구', () => {
  assert.equal(
    identityLabel({ selected: 'ghost', hasEnvToken: false, keyMissing: true }),
    'genia-works: ghost 키가 없습니다 — /genia-works:login',
  );
  assert.equal(identityLabel({ selected: 'ai-dev', hasEnvToken: false, keyMissing: false }), 'genia-works: ai-dev');
});

test('isKeyPath: 키 저장소 경로가 든 입력만', () => {
  assert.equal(isKeyPath('cat ~/.genia-works/keys/ai-dev'), true);
  assert.equal(isKeyPath('{"file_path":"/Users/a/.genia-works/keys/x"}'), true);
  assert.equal(isKeyPath('ls ~/.genia-works'), true);
  assert.equal(isKeyPath('grep genia-works README.md'), false);
});

test('END_CLEARS: clear·resume 에서는 선택을 지우지 않는다', () => {
  assert.equal(END_CLEARS.has('prompt_input_exit'), true);
  assert.equal(END_CLEARS.has('other'), true);
  assert.equal(END_CLEARS.has('clear'), false);
  assert.equal(END_CLEARS.has('resume'), false);
});

test('isKeyPath: 셸 연산자 뒤 경로도 잡고, 비슷한 이름은 놓아 준다', () => {
  assert.equal(isKeyPath('cd ~/.genia-works;cat keys/*'), true);
  assert.equal(isKeyPath('ls ~/.genia-works|x'), true);
  assert.equal(isKeyPath('cat ~/.genia-works>x'), true);
  assert.equal(isKeyPath('echo $(ls ~/.genia-works)'), true);
  assert.equal(isKeyPath('curl https://genia-works.iacloud.kr/mcp'), false);
  assert.equal(isKeyPath('ls ~/.genia-works-x'), false);
  assert.equal(isKeyPath('/p/plugins/genia-works/scripts/gw-keys list'), false);
});

test('toolTargets: 경로·명령 필드의 문자열만', () => {
  assert.deepEqual(
    toolTargets({ tool: 'Edit', file_path: '/a/README.md', new_string: '~/.genia-works/keys', old_string: 'x' }),
    ['/a/README.md'],
  );
  assert.deepEqual(toolTargets({ tool: 'Bash', command: 'ls', glob: '*.md', path: 3 }), ['*.md', 'ls']);
  assert.deepEqual(toolTargets(null), []);
});

test('applyMaskedInput: 치기·붙여넣기·지우기·전체 바꾸기', () => {
  // 빈 필드에 붙여넣기
  assert.equal(applyMaskedInput('', '', 'ak_FAKE_ABC'), 'ak_FAKE_ABC');
  // ●●● 뒤에 한 글자 치기
  assert.equal(applyMaskedInput('ak_', '●●●', '●●●F'), 'ak_F');
  // 끝에서 하나 지우기
  assert.equal(applyMaskedInput('ak_F', '●●●●', '●●●'), 'ak_');
  // 전부 지우기
  assert.equal(applyMaskedInput('ak_F', '●●●●', ''), '');
  // 전체 선택 후 새로 붙여넣기(● 없이 새 글자만)
  assert.equal(applyMaskedInput('ak_OLD', '●●●●●●', 'ak_NEW'), 'ak_NEW');
  // 중간에 끼워 치기(커서 이동) — 위치를 알 수 없으니 ● 이 아닌 글자를 그 자리에 넣는다
  assert.equal(applyMaskedInput('ak_', '●●●', '●X●●'), 'aXk_');
  assert.equal(maskOf('ak_F'), '●●●●');
});

test('initializeBody: MCP initialize 요청', () => {
  const b = JSON.parse(initializeBody());
  assert.equal(b.method, 'initialize');
  assert.equal(b.jsonrpc, '2.0');
  assert.ok(b.params.protocolVersion);
});

test('validName', () => {
  assert.equal(validName('ai-dev'), true);
  assert.equal(validName('dh.yang@iacloud.kr'), true);
  for (const bad of ['', '.', '..', '../x', 'a b', 'a/b', 'me']) assert.equal(validName(bad), false, bad);
});

test('applyMaskedInput: 다시 그리기 전에 연달아 온 입력(필드에 평문이 남음)', () => {
  assert.equal(applyMaskedInput('ak_F', '●●●●', '●●●FG'), 'ak_FG');
  assert.equal(applyMaskedInput('ak_FAKE', '●●●●●●●', '●●●FAKE_ABC'), 'ak_FAKE_ABC');
  // 가운데에 평문이 남은 채 앞에 끼워 치기
  assert.equal(applyMaskedInput('ak_FAKE', '●●●●●●●', '●X●●F●●●'), 'aXk_FAKE');
  // 평문이 남은 채 끝에서 지우기
  assert.equal(applyMaskedInput('ak_FAKE', '●●●●●●●', '●●●FAK'), 'ak_FAK');
});

test('validKey', () => {
  assert.equal(validKey('ak_FAKE_ab-1'), true);
  for (const bad of ['', 'ak_', 'swp_x', 'ak_a b', 'ak_a"b', 'xak_abc']) assert.equal(validKey(bad), false, bad);
});

test('applyMaskedInput: 새로 친 글자가 그 자리의 실제 글자와 같아도 ● 가 남지 않는다', () => {
  assert.equal(applyMaskedInput('ak_AA', '●●●●●', '●●●●A●'), 'ak_AAA');
  assert.equal(applyMaskedInput('ak_FAKE_ABC', maskOf('ak_FAKE_ABC'), 'a' + maskOf('ak_FAKE_ABC')), 'aak_FAKE_ABC');
  // 반복되는 글자 한가운데에 끼워 치기
  assert.equal(applyMaskedInput('ak_AAA', '●●●●●●', '●●●●A●●'), 'ak_AAAA');
});

test('applyMaskedInput: 임의의 한 번 편집 뒤에도 ● 가 없고 길이가 필드와 같다', () => {
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const alpha = 'AaBb01_-k';
  const str = (n) => Array.from({ length: n }, () => alpha[rnd(alpha.length)]).join('');
  for (let i = 0; i < 2000; i++) {
    const real = 'ak_' + str(1 + rnd(10));
    const m = maskOf(real);
    const at = rnd(m.length + 1);
    let typed;
    const kind = rnd(3);
    if (kind === 0) typed = m.slice(0, at) + str(1) + m.slice(at); // 한 글자 끼워 치기
    else if (kind === 1) typed = m.slice(0, at) + str(1 + rnd(5)) + m.slice(at); // 붙여넣기
    else typed = m.slice(0, Math.max(0, m.length - 1)); // 끝에서 지우기
    const out = applyMaskedInput(real, m, typed);
    assert.ok(!out.includes('●'), `${real} ${typed} -> ${out}`);
    assert.equal(out.length, typed.length, `${real} ${typed} -> ${out}`);
  }
});

test('sameServer: origin 과 경로(끝 / 제외)가 같을 때만 같은 서버', () => {
  assert.equal(sameServer('https://genia-works.iacloud.kr/mcp', 'https://genia-works.iacloud.kr/mcp/'), true);
  assert.equal(sameServer('https://genia-works.iacloud.kr/mcp/x/issue', 'https://genia-works.iacloud.kr/mcp'), false);
  assert.equal(sameServer('https://genia-works.iacloud.kr/mcp/readonly', 'https://genia-works.iacloud.kr/mcp'), false);
  assert.equal(sameServer('https://genia-works.iacloud.kr/mcpfoo', 'https://genia-works.iacloud.kr/mcp'), false);
  assert.equal(sameServer('http://localhost:6190/mcp', 'https://genia-works.iacloud.kr/mcp'), false);
  assert.equal(sameServer('not a url', 'https://genia-works.iacloud.kr/mcp'), false);
});

test('findManualRegistrations: 사용자·로컬 범위에서 같은 서버만', () => {
  const cfg = {
    mcpServers: {
      'genia-works': { type: 'http', url: 'https://genia-works.iacloud.kr/mcp', headers: { Authorization: 'Bearer swp_FAKE_OLD' } },
      other: { type: 'http', url: 'https://example.com/mcp' },
    },
    projects: { '/repo': { mcpServers: { gw: { type: 'http', url: 'https://genia-works.iacloud.kr/mcp/' }, ro: { type: 'http', url: 'https://genia-works.iacloud.kr/mcp/readonly' } } } },
  };
  const found = findManualRegistrations(cfg, '/repo', 'https://genia-works.iacloud.kr/mcp');
  assert.deepEqual(found.map((f) => [f.scope, f.name]), [['user', 'genia-works'], ['local', 'gw']]);
});
