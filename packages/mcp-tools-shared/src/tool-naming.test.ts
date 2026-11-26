import { describe, expect, it } from 'vitest';
import { buildSharedTools, type SharedToolClient } from './shared-tools.js';
import { TOOL_APPS, toolApps } from './tool-apps.js';
import { toolDefinitionsSize } from './tool-definitions.js';
import { AGENT_TOOL_NAME_MAX_LENGTH, PLUGIN_TOOL_PREFIX, SHARED_TOOL_NAME_MAX_LENGTH, toolNameViolations } from './tool-naming.js';

/**
 * 기본 연결 도구 정의 크기 상한(근사 토큰, 근사식은 tool-definitions.ts estimateTokens·README). 사용자 결정(2026-10-13).
 * 15,000 → 16,000: WP-377 A2A 상태 정렬로 report_agent_work 상태 10종(enum·설명)이 늘어 상향했다(2026-10-14 사용자 승인).
 * 16,000 → 16,500, 앱당 15 → 16: WP-800 대기열 이슈 가져가기 도구(claim_issue)로 늘어 상향했다(2026-10-22 사용자 승인).
 * 16,500 → 16,700, 앱당 16 → 18: WP-887 이슈 관계·외부 링크 도구 2종(add_issue_relation·remove_issue_relation)으로 늘어 상향했다(2026-10-24 사용자 승인).
 * 16,700 → 16,900: 2026-10-25 WP-933 구성요소 인자(list_issues component·create_issue/update_issue components·get_project components, 도구 수는 그대로)와
 *   main 에 먼저 들어온 WP-944 보고자 변경 인자(update_issue reporter)로 늘어 상향했다(2026-10-25 사용자 승인).
 * 16,900 → 17,000: 2026-10-26 WP-888 버전 인자(list_issues fixVersion·affectsVersion, create_issue/update_issue fixVersions·affectsVersions, get_project versions — 도구 수는 그대로)로 늘어 상향했다(2026-10-26 사용자 승인).
 * 17,000 → 17,200, 앱당 18 → 19: 2026-10-27 WP-719 담당 밖 이슈의 멘션에 이슈 챗으로 답하는 도구(add_issue_chat)와 list_issues mentionsMe 로
 *   늘어 상향했다(2026-10-27 사용자 승인).
 * 17,200 → 17,300: 2026-10-31 WP-1238 list_issues 정렬(sort·direction)·수정일·시작일 범위 인자(도구 수는 그대로)로 늘어 상향했다(2026-10-31 사용자 승인).
 * 17,300 → 17,400: 2026-11-11 WP-1494 list_issues fields(+허용 필드 목록)·get_issue_detail comments·history·bodyMaxChars 옵션과,
 *   상한 맞추려 줄였던 설명의 뜻 복원으로 상향했다(2026-11-11 사용자 승인).
 * 17,400 → 17,550: 2026-11-12 WP-1523 본문을 쓰는 도구 9종(create_issue·update_issue·add_comment·update_comment·add_issue_chat·
 *   create_wiki_page·update_wiki_page·add_channel_message·update_channel_message)의 링크 규칙 한 마디(link-rule.ts)로 상향했다(2026-11-12 dh.yang 승인).
 * 17,550 → 17,700: 2026-11-17 WP-1681 휴지통 메일 되살리기 도구 restore_mail 과 list_mail folder 설명(TRASH)으로 상향했다(2026-11-17 dh.yang 승인).
 * 17,700 → 18,000: 2026-11-18 WP-1704 일정 회의록 노트 잇기·끊기 도구 2종(link_event_note·unlink_event_note)과 get_event occurrenceDate·
 *   list_events/get_event note 설명으로 늘었다(직전 17,699 로 여유가 없었다, 증가분 약 295). 기획 WP-1694 가 두 도구의 외부 MCP 노출을 정했다(2026-11-18 dh.yang 승인).
 * 18,000 → 18,300: 2026-11-18 WP-1700 드라이브 최근·별표 도구 2종(list_my_drive_files·star_drive_item)으로 늘었다(직전 18,000 — WP-1742 뒤, 늘어 18,296).
 *   기획 WP-1697 의 네 도구를 둘로 합치고 상한을 올리기로 정했다(2026-11-18 dh.yang 승인).
 * 18,300 → 18,450: 2026-11-19 WP-1766 내 최근·즐겨찾기 노트 도구(list_my_wiki_pages)로 늘었다(직전 18,296, 늘어 18,444). 상한 맞추려 다른 도구 설명을 줄이지 않았다(무인 세션 결정 — 검토 때 dh.yang 확인 요청).
 * 18,450 → 18,550: 2026-11-20 WP-1816 add_issue_chat 에 선택 fileIds(스키마 한 필드)가 늘었다(직전 약 18,42x, 늘어 18,476). 상한 맞추려 다른 도구 설명을 줄이지 않았다(무인 세션 결정 — 검토 때 dh.yang 확인 요청).
 * 18,550 → 19,350: 2026-11-23 WP-1988 워크플로우 도구 6종(실행 get/start/move_issue_workflow·정의 get/validate/update_workflow)으로 늘었다
 *   (직전 18,476, 늘어 19,309). 새 도구 설명을 한 번 줄여 본 뒤의 값이고, 다른 도구 설명은 줄이지 않았다(무인 세션 결정 — 검토 때 dh.yang 확인 요청).
 * 19,350 → 19,400: 2026-11-23 WP-1988 리뷰 후속 — move_issue_workflow 의 runId·update_workflow 의 expectedDraftUpdatedAt(실행·초안 충돌 방지)
 *   입력과 설명 한 구절로 늘었다(직전 19,309, 늘어 19,357). 설명을 줄여 본 뒤의 값이고, 다른 도구 설명은 줄이지 않았다(무인 세션 결정 — 검토 때 dh.yang 확인 요청).
 * 19,400 → 19,450: 2026-11-25 WP-2097 update_issue 에 relateToReleasedParent 인자(스키마 한 필드 + 설명 한 줄)가 늘었다
 *   (직전 19,369, 늘어 19,413). 짧은 설명이지만 한글 1자 = 1토큰 근사라 31 토큰 남던 자리에 못 들어간다. 다른 도구 설명은 줄이지 않았다
 *   (무인 세션 결정 — 검토 때 dh.yang 확인 요청).
 * 19,450 → 19,500: 2026-11-26 WP-2097 리뷰 후속 — 갈라진 뒤 main 에 들어온 WP-2093·WP-2118 의 도구 설명이 이 상한을 이미 넘어섰고
 *   (main 측정 19,454 — 이 브랜치가 손대기 전에도 이 테스트는 빨강), 거기에 리뷰 후속 ②(MCP 옵션 무시 갈래 정리)의 describe 수정이
 *   2 더해져 19,456 이 됐다. 어느 쪽 설명도 줄이지 않고 상한만 올렸다(무인 세션 결정 — 검토 때 dh.yang 확인 요청).
 * 19,500 → 19,550: 2026-11-26 WP-2098 update_issue 에 convertSubtasksToType 인자(스키마 한 필드 + 설명 한 줄)가 늘었다
 *   (브랜치 측정 19,454 → 19,529, 약 +75). 검토자 손 머지에서 WP-2097 리뷰 후속(19,500)과 합쳐 50 단위로 올렸다. 다른 도구 설명은 줄이지 않았다
 *   (무인 세션 결정 — 검토 때 dh.yang 확인 요청).
 * 19,550 유지: 2026-11-26 WP-2113 리뷰 후속 — 브랜치에서는 19,450 → 19,550 으로 올렸고 main 의 19,550(위 WP-2098)과 같은 값이라 상한 줄은 그대로다.
 *   반려 ⑤ 로 뺀 알림 문구 `Status/priority changes notify …` 를 되살렸다(브랜치 측정 19,469, main 설명과 합치면 19,546 — 여유 4).
 *   「결과에 새 version 을 싣는다」는 뜻은 도구 설명에서 빼고(자리가 없어) 프롬프트(issue-agent 부분 수정 안내·결정 사항 규칙)와
 *   결과 JSON 의 `version` 이 담는다. `Unknown labels are created (gray).` 는 create_issue 설명의 `created (gray; createdLabels)`
 *   가 이미 담아 계속 뺀다. 다른 도구 설명은 줄이지 않았다(무인 세션 결정 — 검토 때 dh.yang 확인 요청).
 */
const DEFINITION_TOKEN_CAP = 19_550;
/**
 * 앱당 도구 수 상한. 사용자 결정(2026-10-13). 15 → 16: WP-800(2026-10-22 사용자 승인). 16 → 18: WP-887 관계 도구 2종(2026-10-24 사용자 승인).
 * 18 → 19: WP-719 add_issue_chat(2026-10-27 사용자 승인).
 * 19 → 22: 2026-11-23 WP-1988 워크플로우 도구 6종 중 이슈 앱 실행 3종(get/start/move_issue_workflow)으로 이슈 앱이 22개가 됐다.
 *   상한 맞추려 다른 도구를 합치지 않았다(무인 세션 결정 — 검토 때 dh.yang 확인 요청).
 */
const APP_TOOL_CAP = 22;

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
  it(`예외 목록 밖의 공유 도구 이름은 규칙(snake_case·${SHARED_TOOL_NAME_MAX_LENGTH}자 이하·edit_/save_/set_ 금지)을 지킨다`, () => {
    const violations = names
      .filter((n) => !SHARED_NAMING_EXCEPTIONS.includes(n))
      .map((n) => ({ name: n, violations: toolNameViolations(n, SHARED_TOOL_NAME_MAX_LENGTH) }))
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
    for (const n of ['list_issues', 'get_issue_detail', 'mark_all_notifications_read', 'move_drive_item', 'propose_delete_event', 'show_my_tasks']) {
      expect(toolNameViolations(n, AGENT_TOOL_NAME_MAX_LENGTH), n).toEqual([]);
    }
  });

  it('snake_case 가 아닌 이름을 잡는다', () => {
    for (const n of ['listIssues', 'List_issues', 'list-issues', 'list__issues', '_list_issues', 'list_issues_', '1_list', '']) {
      expect(toolNameViolations(n, AGENT_TOOL_NAME_MAX_LENGTH), n).not.toEqual([]);
    }
  });

  it(`ai-agent 전용 상한 ${AGENT_TOOL_NAME_MAX_LENGTH}자 경계: 46자는 통과, 47자는 위반`, () => {
    const at = 'a'.repeat(AGENT_TOOL_NAME_MAX_LENGTH);
    expect(toolNameViolations(at, AGENT_TOOL_NAME_MAX_LENGTH)).toEqual([]);
    expect(toolNameViolations(`${at}a`, AGENT_TOOL_NAME_MAX_LENGTH)).toHaveLength(1);
  });

  it('공유 도구 상한은 플러그인 접두를 붙여 API 상한 64자에 딱 맞는 27자다', () => {
    expect(SHARED_TOOL_NAME_MAX_LENGTH).toBe(27);
    const at = 'a'.repeat(SHARED_TOOL_NAME_MAX_LENGTH);
    expect(`${PLUGIN_TOOL_PREFIX}${at}`).toHaveLength(64);
    expect(toolNameViolations(at, SHARED_TOOL_NAME_MAX_LENGTH)).toEqual([]);
    expect(toolNameViolations(`${at}a`, SHARED_TOOL_NAME_MAX_LENGTH)).toEqual(['27자 초과(28자)']);
  });

  it('edit_·save_·set_ 접두를 잡고, propose_ 뒤의 원 도구명에도 적용한다', () => {
    for (const n of ['edit_comment', 'save_draft', 'set_role', 'propose_set_member_role', 'propose_edit_comment']) {
      expect(toolNameViolations(n, AGENT_TOOL_NAME_MAX_LENGTH), n).toHaveLength(1);
    }
    // 접두가 아니라 토큰 중간에 있으면 위반이 아니다.
    expect(toolNameViolations('update_asset_name', AGENT_TOOL_NAME_MAX_LENGTH)).toEqual([]);
    expect(toolNameViolations('reset_password', AGENT_TOOL_NAME_MAX_LENGTH)).toEqual([]);
  });
});
