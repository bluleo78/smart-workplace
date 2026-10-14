import { describe, expect, it } from 'vitest';

import marketplace from '../../public/claude/marketplace.json';
import {
  buildLaunchAsCommand,
  buildPluginInstallCommands,
  buildSwitchCommand,
  buildTokenFallbackCommand,
  marketplaceUrl,
  PLUGIN_COMMANDS,
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
        ref: 'genia-works--v0.1.0',
      },
    });
  });
});
