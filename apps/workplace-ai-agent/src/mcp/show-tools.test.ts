import { describe, expect, it } from 'vitest';
import { buildTools } from './tools.js';

// client 는 show_ 핸들러가 호출하지 않으므로(displayed) 빈 스텁으로 충분.
const stubClient = {} as unknown as Parameters<typeof buildTools>[0];

describe('assistant 프로필 show_* 도구(#460 Layer2)', () => {
  const names = buildTools(stubClient, 1, 'assistant').map((t) => t.name);

  it.each([
    'show_calendar', 'show_event', 'show_channels', 'show_wiki', 'show_wiki_page',
    'show_contacts', 'show_contact', 'show_projects', 'show_project', 'show_drive',
  ])('%s 노출', (n) => {
    expect(names).toContain(n);
  });

  it('기존 show_ 도구 유지(회귀 방지)', () => {
    expect(names).toEqual(expect.arrayContaining(['show_mail_list', 'show_issue_list']));
  });

  it('show_ 핸들러는 데이터를 반환하지 않는다(displayed)', async () => {
    const tool = buildTools(stubClient, 1, 'assistant').find((t) => t.name === 'show_calendar')!;
    const out = await tool.handler({ params: {} });
    expect(JSON.parse(out)).toEqual({ displayed: true });
  });
});
