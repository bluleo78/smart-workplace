import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildSharedTools, type SharedToolClient } from './shared-tools.js';
import { isToolApp, TOOL_APP_GUIDES, TOOL_APPS, toolApps } from './tool-apps.js';

// 도구 구성 시점에는 클라이언트 메서드를 부르지 않으므로 빈 객체로 충분하다.
const tools = buildSharedTools({} as unknown as SharedToolClient);

// WP-350: 앱 태그는 타입으로 필수이지만(빠뜨리면 typecheck 실패), 런타임에서도 유효한 앱 이름인지 확인한다.
describe('도구 앱 태그 (WP-350)', () => {
  it('모든 공유 도구에 비어 있지 않은 앱 태그가 있고, 앱 이름은 모두 유효하며 중복이 없다', () => {
    for (const t of tools) {
      const apps = toolApps(t);
      expect(apps.length, t.name).toBeGreaterThan(0);
      expect(new Set(apps).size, t.name).toBe(apps.length);
      for (const a of apps) expect(isToolApp(a), `${t.name}:${a}`).toBe(true);
    }
  });

  // 앱을 골랐는데 도구가 하나도 없거나(오타·이름 변경), 읽기 전용으로 연결하면 비는 앱은 안내가 무의미해진다.
  it('모든 앱에 도구가 있고, 읽기 도구도 하나 이상 있다(읽기 전용 연결이 비지 않는다)', () => {
    for (const app of TOOL_APPS) {
      const inApp = tools.filter((t) => toolApps(t).includes(app));
      expect(inApp.length, app).toBeGreaterThan(0);
      expect(inApp.some((t) => t.kind === 'read'), app).toBe(true);
    }
  });

  // 안내(instructions)에 실리는 시작 도구 이름이 실제 도구·앱과 어긋나면 모델에게 없는 도구를 알려 주게 된다(도구 이름 변경 시 여기서 잡힌다).
  it('앱 안내의 시작 도구는 실제로 그 앱에 속한 도구다', () => {
    for (const app of TOOL_APPS) {
      for (const name of TOOL_APP_GUIDES[app].entry) {
        const t = tools.find((x) => x.name === name);
        expect(t, `${app}:${name}`).toBeDefined();
        expect(toolApps(t!), `${app}:${name}`).toContain(app);
      }
    }
  });

  // 도구별 앱 분류를 고정 — 새 도구·분류 변경이 리뷰 가능한 diff 로 드러나게 한다(README 앱 표와 함께 갱신).
  it('도구별 앱 스냅샷', () => {
    const byTool = Object.fromEntries([...tools].sort((a, b) => a.name.localeCompare(b.name)).map((t) => [t.name, toolApps(t).join(',')]));
    expect(byTool).toMatchSnapshot();
  });
});

/**
 * 다른 공유 도구 이름을 가리키는 설명이 **같은 앱 범위에서는 그 도구가 없는** 경우의 명시적 허용 목록. 키는 `도구@앱 -> 언급된 도구`.
 * 모두 "선행 조회"가 아니라 대비·대안 언급이라 그 앱에 없어도 일이 끊기지 않는 것만 올린다. 선행 조회라면 허용하지 말고
 * 언급된 도구의 앱 태그를 넓힌다(search_members 가 그 예). 목록에서 이유 없이 항목을 늘리지 않는다.
 */
const CROSS_REF_ALLOWED: Record<string, string> = {
  // 이슈 작업 안내 — project 앱 연결만 골라도 프로젝트 조회는 되고, create/update_issue 는 이슈 앱의 몫이다(분류 표 참조).
  'get_project@project -> create_issue': '프로젝트 정보를 어디에 쓰는지 알리는 안내(이슈 앱의 도구)',
  'get_project@project -> update_issue': '프로젝트 정보를 어디에 쓰는지 알리는 안내(이슈 앱의 도구)',
  // 구성원 연락처 vs 외부 연락처 — 서로 "이쪽이 아니라 저쪽" 이라는 대비 언급(식별자 혼동 방지).
  'get_member_contact@member -> get_external_contact': '구성원용이 아니라 외부 연락처용이라는 대비 언급',
  'get_external_contact@contacts -> get_member_contact': '외부 연락처용이 아니라 구성원용이라는 대비 언급',
  // search_members 를 다른 앱에 실으면서 따라온 것 — 설명의 "get_member 등 사람을 가리키는 도구" 는 username 을 쓰는 곳의 예시일 뿐 필수 후속 조회가 아니다.
  'search_members@calendar -> get_member': 'username 을 쓰는 도구의 예시 언급',
  'search_members@project -> get_member': 'username 을 쓰는 도구의 예시 언급',
  'search_members@messaging -> get_member': 'username 을 쓰는 도구의 예시 언급',
  'search_members@contacts -> get_member': 'username 을 쓰는 도구의 예시 언급',
  // 첨부 읽기는 이슈 첨부·드라이브 파일 두 갈래 — 각 갈래의 id 출처를 모두 적었을 뿐, 한쪽 앱만 골라도 자기 갈래는 닫힌다.
  'read_attachment@drive -> get_issue_detail': '이슈 첨부 갈래의 id 출처(드라이브 갈래에는 불필요)',
  'read_attachment@issue -> list_drive_items': '드라이브 갈래의 id 출처(이슈 갈래에는 불필요)',
  'read_attachment@issue -> search_drive': '드라이브 갈래의 id 출처(이슈 갈래에는 불필요)',
  'read_attachment@issue -> search_drive_content': '드라이브 갈래의 id 출처(이슈 갈래에는 불필요)',
};

/** 도구의 설명과 입력 스키마의 필드 설명(JSON Schema 변환 결과)을 합친 텍스트 — 도구 이름 언급을 찾는 대상. */
function describedText(t: (typeof tools)[number]): string {
  let schema = '';
  try {
    schema = JSON.stringify(z.toJSONSchema(t.inputSchema, { io: 'input', unrepresentable: 'any' }));
  } catch {
    // 변환할 수 없는 스키마는 설명만 본다.
  }
  return `${t.description}\n${schema}`;
}

// WP-350: 앱만 골라 연결해도 도구 설명이 "~로 확인하세요" 하고 가리키는 도구가 같이 실려야 한다(search_members 가 member 앱에만 있어
// calendar·project·messaging·contacts 연결에서 빠졌던 문제의 재발 방지). 설명·입력 필드 설명에 나온 다른 공유 도구는 같은 앱 범위에도 있어야 한다.
describe('도구 설명이 가리키는 도구는 같은 앱 범위에 실린다 (WP-350)', () => {
  const found: string[] = [];
  for (const t of tools) {
    const text = describedText(t);
    for (const ref of tools) {
      if (ref.name === t.name) continue;
      // 이름 일부만 겹치는 경우(list_mail ⊂ list_mail_accounts)를 막으려고 도구 이름 문자([a-z0-9_])가 이어지지 않을 때만 언급으로 본다.
      if (!new RegExp(`(?<![a-z0-9_])${ref.name}(?![a-z0-9_])`).test(text)) continue;
      for (const app of toolApps(t)) {
        if (!toolApps(ref).includes(app)) found.push(`${t.name}@${app} -> ${ref.name}`);
      }
    }
  }

  it('설명에서 언급한 다른 공유 도구는 같은 앱에도 속한다(예외는 CROSS_REF_ALLOWED 에 이유와 함께)', () => {
    expect(found.filter((k) => !(k in CROSS_REF_ALLOWED))).toEqual([]);
  });

  // 도구 설명을 고치거나 앱 태그를 넓혀 해소됐는데 예외가 남으면 나중에 같은 문제가 가려진다 — 목록을 항상 실제 상태와 맞춘다.
  it('허용 목록의 항목은 모두 실제로 해당한다(해소됐으면 지운다)', () => {
    expect(Object.keys(CROSS_REF_ALLOWED).filter((k) => !found.includes(k))).toEqual([]);
  });
});
