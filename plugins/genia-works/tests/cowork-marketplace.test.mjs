// WP-1688 Cowork 마켓플레이스 설치 테스트 — 저장소 루트 마니페스트·커넥터 플러그인이
// 계획대로인지를 워크트리 루트의 실제 파일에서 읽어 순수 검사한다(외부 명령 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 이 테스트 파일은 plugins/genia-works/tests/ 안에 있으므로 워크트리 루트는 두 단위 위다.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** JSON 파일을 읽어 파싱한다 — 파싱 실패는 그대로 테스트 실패로 드러난다. */
function readJson(rel) {
  return JSON.parse(readFileSync(join(root, rel), 'utf8'));
}

test('루트 .claude-plugin/marketplace.json: 두 플러그인 항목과 실제 존재하는 source 폴더', () => {
  const mp = readJson('.claude-plugin/marketplace.json');
  assert.ok(Array.isArray(mp.plugins), 'plugins 배열이 있어야 한다');
  const names = mp.plugins.map((p) => p.name);
  assert.ok(names.includes('genia-works'), `genia-works 항목 필요: ${names}`);
  assert.ok(names.includes('genia-works-connector'), `genia-works-connector 항목 필요: ${names}`);
  for (const p of mp.plugins) {
    assert.equal(typeof p.source, 'string', `${p.name}: source 는 상대 경로 문자열`);
    assert.ok(p.source.startsWith('./'), `${p.name}: source 는 ./ 로 시작하는 상대 경로`);
    const dir = resolve(root, p.source);
    assert.ok(existsSync(dir) && statSync(dir).isDirectory(), `${p.name}: source 폴더가 없다 — ${p.source}`);
  }
});

test('커넥터 .mcp.json: headers·인증 없이 고정 MCP 주소만 쓴다(OAuth 연결용)', () => {
  // 원시 텍스트를 한 번만 읽어 파싱과 "문자열로 남지 않았는지" 검사를 함께 한다(중첩 객체에 숨는 것을 막는다).
  const raw = readFileSync(join(root, 'plugins/genia-works-connector/.mcp.json'), 'utf8');
  const server = JSON.parse(raw).mcpServers['genia-works'];
  assert.ok(server, 'mcpServers.genia-works 항목 필요');
  assert.equal(server.url, 'https://genia-works.iacloud.kr/mcp');
  assert.equal(server.headers, undefined, 'headers 를 붙이면 OAuth 대신 오류가 난다');
  assert.ok(!/authorization/i.test(raw), 'Authorization 문자열 금지');
  assert.ok(!/token/i.test(raw), 'token 문자열 금지');
  assert.ok(!/user_config/.test(raw), 'user_config 금지');
});

test('기존 genia-works/.mcp.json: PAT/user_config.token Authorization 헤더를 그대로 유지한다', () => {
  const mcp = readJson('plugins/genia-works/.mcp.json');
  const server = mcp.mcpServers['genia-works'];
  assert.ok(server, 'mcpServers.genia-works 항목 필요');
  const auth = server.headers?.Authorization;
  assert.ok(typeof auth === 'string' && auth.length > 0, 'Authorization 헤더 필요(Claude Code 플러그인 유지)');
  assert.match(auth, /user_config\.token|GENIA_WORKS_TOKEN/, 'PAT/user_config.token 방식 유지');
});

test('커넥터 plugin.json: name 확인, 토큰(userConfig)을 요구하지 않는다', () => {
  const plugin = readJson('plugins/genia-works-connector/.claude-plugin/plugin.json');
  assert.equal(plugin.name, 'genia-works-connector');
  assert.equal(plugin.userConfig, undefined, 'OAuth 로 연결하므로 userConfig(토큰) 없음');
  assert.ok(plugin.description, 'description 필요');
  assert.equal(plugin.homepage, 'https://genia-works.iacloud.kr');
  assert.equal(plugin.repository, 'https://github.com/bluleo78/smart-workplace');
});
