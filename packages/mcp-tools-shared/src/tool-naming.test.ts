import { describe, expect, it } from 'vitest';
import { buildSharedTools, type SharedToolClient } from './shared-tools.js';
import { TOOL_APPS, toolApps } from './tool-apps.js';
import { toolDefinitionsSize } from './tool-definitions.js';
import { TOOL_NAME_MAX_LENGTH, toolNameViolations } from './tool-naming.js';

/** 기본 연결 도구 정의 크기 상한(근사 토큰, 근사식은 tool-definitions.ts estimateTokens·README). 사용자 결정(2026-10-13). */
const DEFINITION_TOKEN_CAP = 15_000;
/** 앱당 도구 수 상한. 사용자 결정(2026-10-13). */
const APP_TOOL_CAP = 15;

// 도구 구성 시점에는 클라이언트 메서드를 부르지 않으므로 빈 객체로 충분하다.
const tools = buildSharedTools({} as unknown as SharedToolClient);
const names = tools.map((t) => t.name);

/**
 * 명명 규칙(README "도구 명명 규칙", WP-347)을 아직 따르지 않는 기존 공유 도구 이름.
 * WP-360 이 `get_channel_messages` 를 뺀 나머지를 바꿨고, 마지막 하나도 WP-352 가 `list_channel_messages` 로 바꾸면서 배열이 **비었다** —
 * 지금은 이 테스트가 규칙을 전면 강제한다. 새 예외는 여기에 이유와 바꿀 이슈를 주석으로 적어 넣는다(메커니즘은 유지).
 * `get_` 이 여러 건을 돌려주는 도구는 기계로 가릴 수 없어 손으로 적는다(규칙: 여러 건은 `list_`, 한 건만 `get_`).
 */
const SHARED_NAMING_EXCEPTIONS: string[] = [];

describe('공유 도구 명명 규칙 (WP-347)', () => {
  it('예외 목록 밖의 공유 도구 이름은 규칙(snake_case·46자 이하·edit_/save_/set_ 금지)을 지킨다', () => {
    const violations = names
      .filter((n) => !SHARED_NAMING_EXCEPTIONS.includes(n))
      .map((n) => ({ name: n, violations: toolNameViolations(n) }))
      .filter((v) => v.violations.length > 0);
    expect(violations).toEqual([]);
  });

  // 이름을 바꾸고 예외 항목을 지우지 않으면, 같은 옛 이름으로 도구가 다시 생겨도 예외로 가려진다.
  it('예외 목록의 이름은 모두 실제 공유 도구다(바뀐 이름이 남아 있으면 실패)', () => {
    const stale = SHARED_NAMING_EXCEPTIONS.filter((n) => !names.includes(n));
    expect(stale).toEqual([]);
  });

});

/**
 * 외부 MCP 노출 상한(README "도구 수와 정의 크기", WP-340 웨이브 5). 개수(예전 85개) 대신 클라이언트가 실제로 싣는 양과 앱 단위로 잰다.
 * 외부 MCP 클라이언트는 연결한 서버의 도구 정의를 매 대화에 전부 싣기 때문에 개수보다 크기가 비용이고, 앱 선택 연결(/mcp/x/{apps})이 실을 양은 앱당 개수가 정한다.
 */
describe('외부 MCP 노출 상한 (WP-340 웨이브 5)', () => {
  // workplace-mcp 기본 연결(/mcp)이 내보내는 것 — destructive 를 뺀 공유 도구 전부.
  const exposed = tools.filter((t) => t.kind !== 'destructive');

  it(`기본 연결(/mcp)의 도구 정의(tools/list)는 근사 ${DEFINITION_TOKEN_CAP} 토큰 이하다`, () => {
    // 실패하면 도구별 크기(perTool)를 보고 큰 설명부터 줄인다 — 상한을 올리지 않는다.
    const size = toolDefinitionsSize(exposed);
    expect(size.tokens, JSON.stringify(size.perTool.slice(0, 10))).toBeLessThanOrEqual(DEFINITION_TOKEN_CAP);
  });

  it(`앱마다 도구는 ${APP_TOOL_CAP}개 이하다(여러 앱에 속한 도구는 각 앱에서 센다)`, () => {
    const over = TOOL_APPS.map((app) => ({ app, count: exposed.filter((t) => toolApps(t).includes(app)).length })).filter(
      (a) => a.count > APP_TOOL_CAP,
    );
    expect(over).toEqual([]);
  });
});

describe('toolNameViolations', () => {
  it('규칙을 지키는 이름은 위반이 없다', () => {
    for (const n of ['list_issues', 'get_issue_detail', 'mark_all_notifications_read', 'move_drive_file', 'propose_delete_event', 'show_my_tasks']) {
      expect(toolNameViolations(n), n).toEqual([]);
    }
  });

  it('snake_case 가 아닌 이름을 잡는다', () => {
    for (const n of ['listIssues', 'List_issues', 'list-issues', 'list__issues', '_list_issues', 'list_issues_', '1_list', '']) {
      expect(toolNameViolations(n), n).not.toEqual([]);
    }
  });

  it(`${TOOL_NAME_MAX_LENGTH}자 경계: 46자는 통과, 47자는 위반`, () => {
    const at = 'a'.repeat(TOOL_NAME_MAX_LENGTH);
    expect(toolNameViolations(at)).toEqual([]);
    expect(toolNameViolations(`${at}a`)).toHaveLength(1);
  });

  it('edit_·save_·set_ 접두를 잡고, propose_ 뒤의 원 도구명에도 적용한다', () => {
    for (const n of ['edit_comment', 'save_draft', 'set_role', 'propose_set_member_role', 'propose_edit_comment']) {
      expect(toolNameViolations(n), n).toHaveLength(1);
    }
    // 접두가 아니라 토큰 중간에 있으면 위반이 아니다.
    expect(toolNameViolations('update_asset_name')).toEqual([]);
    expect(toolNameViolations('reset_password')).toEqual([]);
  });
});
