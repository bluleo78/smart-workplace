import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import marketplace from '../../public/claude/marketplace.json';
import {
  buildLaunchAsCommand,
  buildPluginInstallCommands,
  buildSwitchCommand,
  buildTokenFallbackCommand,
  buildWorkLoopLaunchCommand,
  buildWorkLoopStartCommand,
  marketplaceUrl,
  needsServerUrlSetting,
  PLUGIN_COMMANDS,
  PLUGIN_DEFAULT_SERVER_URL,
  PLUGIN_SKILLS,
} from './pluginGuide';

describe('pluginGuide', () => {
  it('목록 주소는 접속한 웹 origin 의 /claude/marketplace.json', () => {
    expect(marketplaceUrl('https://genia-works.iacloud.kr')).toBe('https://genia-works.iacloud.kr/claude/marketplace.json');
  });
  it('설치 명령 두 줄 — 목록 등록 후 설치', () => {
    expect(buildPluginInstallCommands('https://x.test')).toBe(
      '/plugin marketplace add https://x.test/claude/marketplace.json\n/plugin install genia-works@genia-works',
    );
  });
  it('전환·실행 명령은 아이디만 담고 키를 담지 않는다', () => {
    expect(buildSwitchCommand('ai-dev')).toBe(`${PLUGIN_COMMANDS.as} ai-dev`);
    expect(buildLaunchAsCommand('ai-dev')).toBe('GENIA_WORKS_AS=ai-dev claude');
    expect(buildTokenFallbackCommand()).toBe('GENIA_WORKS_TOKEN=<발급한 키> claude');
  });
  it('목록 파일 — 플러그인 하나, git-subdir https 주소·태그 고정', () => {
    expect(marketplace.name).toBe('genia-works');
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0]).toMatchObject({
      name: 'genia-works',
      source: {
        source: 'git-subdir',
        url: 'https://github.com/bluleo78/smart-workplace.git',
        path: 'plugins/genia-works',
        ref: 'genia-works--v0.1.10',
      },
    });
  });
});

describe('work-loop 명령', () => {
  it('시작 명령은 권한을 묻지 않는 모드로 그 AI 로 띄운다', () => {
    expect(buildWorkLoopLaunchCommand('ai-dev')).toBe('GENIA_WORKS_AS=ai-dev claude --permission-mode bypassPermissions');
  });
  it('반복 명령은 프로젝트 키 자리를 기본으로 둔다', () => {
    expect(buildWorkLoopStartCommand()).toBe('/loop /genia-works:work-loop <프로젝트 키>');
    expect(buildWorkLoopStartCommand('WP')).toBe('/loop /genia-works:work-loop WP');
  });
});

describe('플러그인 파일과의 일치', () => {
  const pluginFile = (rel: string) => readFileSync(new URL(`../../../../plugins/genia-works/${rel}`, import.meta.url), 'utf8');
  it('PLUGIN_COMMANDS 는 mod(hooks/lib.js)의 COMMANDS 와 같다', () => {
    // lib.js 는 별도 ESM 패키지라 가져오지 않고 COMMANDS 객체 리터럴을 읽어 낸다.
    const literal = /export const COMMANDS = (\{[^}]*\})/.exec(pluginFile('hooks/lib.js'))?.[1] ?? '';
    const commands = Function(`return (${literal})`)();
    expect(PLUGIN_COMMANDS).toEqual(commands);
  });
  it('PLUGIN_SKILLS 는 plugins/genia-works/skills/ 의 폴더 이름과 맞는다', () => {
    const dirs = readdirSync(new URL('../../../../plugins/genia-works/skills/', import.meta.url));
    expect(dirs).toContain(PLUGIN_SKILLS.workOn.replace('/genia-works:', ''));
    expect(dirs).toContain(PLUGIN_SKILLS.workLoop.replace('/genia-works:', ''));
  });
  it('목록 파일의 ref 는 genia-works--v + plugin.json 버전이다', () => {
    const { version } = JSON.parse(pluginFile('.claude-plugin/plugin.json'));
    expect((marketplace.plugins[0].source as { ref: string }).ref).toBe(`genia-works--v${version}`);
  });
});

describe('needsServerUrlSetting', () => {
  it('기본 주소(끝의 / 유무 무관)면 바꿀 필요가 없다', () => {
    expect(needsServerUrlSetting('https://genia-works.iacloud.kr/mcp')).toBe(false);
    expect(needsServerUrlSetting('https://genia-works.iacloud.kr/mcp/')).toBe(false);
  });
  it('다른 배포(로컬·스테이징·compose)나 범위를 좁힌 주소면 바꿔야 한다', () => {
    expect(needsServerUrlSetting('http://localhost:6090/mcp')).toBe(true);
    expect(needsServerUrlSetting('https://staging.example.test/mcp')).toBe(true);
    expect(needsServerUrlSetting('https://genia-works.iacloud.kr/mcp/readonly')).toBe(true);
  });
});

describe('PLUGIN_DEFAULT_SERVER_URL', () => {
  it('plugin.json 의 server_url 기본값과 같다(어긋나면 안내가 틀어진다)', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../../../plugins/genia-works/.claude-plugin/plugin.json', import.meta.url), 'utf8'),
    );
    expect(manifest.userConfig.server_url.default).toBe(PLUGIN_DEFAULT_SERVER_URL);
  });
});
