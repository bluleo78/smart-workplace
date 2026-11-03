// 설정 화면별 가이드 문구 — 한 파일에 모아 문구 리뷰를 한곳에서 한다(WP-399).
// 원칙: 실제 동작을 확인한 사실만 쓰고, 섹션 description 과 같은 말을 반복하지 않는다(왜·언제·주의). 해요체·짧은 문장.
import { accountLabel, isLoginProvider, loginProgram } from '@/lib/agentAccount'
import { workResourceText } from '@/lib/agentRuntimeStatus'
import { MCP_ENDPOINT } from '@/lib/mcpEndpoint'
import {
  buildLaunchAsCommand,
  buildPluginInstallCommands,
  buildSwitchCommand,
  buildTokenFallbackCommand,
  buildWorkLoopLaunchCommand,
  buildWorkLoopStartCommand,
  needsServerUrlSetting,
  PLUGIN_COMMANDS,
  PLUGIN_SKILLS,
} from '@/lib/pluginGuide'
import type { AgentResponse } from '@/types/agent'
import type { AgentTemplate } from '@/types/agentRuntime'
import type { ProjectResponse } from '@/types/project'

import { AGENT_DETAIL_SECTION_IDS, SETTINGS_SECTION_IDS as S } from './sectionIds'
import type { SettingsGuide, SettingsGuideSection, SettingsGuideStep } from './types'

// 여러 화면이 같은 사실을 말하는 문장 — 한 곳에서 고치게 상수로 둔다.
// 「최대 30분」은 workplace-api application.yml app.jwt.access-expiration(1800000ms) 값이다 — 바꾸면 이 문구도 함께 고친다.
const SESSION_REFRESH = '세션이 갱신될 때(최대 30분)'
const TIP_TYPE_IN_USE = '이슈가 하나라도 쓰고 있는 유형은 지울 수 없어요.'
// 프로젝트 설정 「위험 구역」 설명도 같은 문장을 쓴다(WP-857 — 기본 개인 프로젝트는 삭제 버튼 대신 이 안내).
export const DEFAULT_PROJECT_UNDELETABLE = '처음부터 있던 기본 개인 프로젝트는 지울 수 없어요.'
const TIP_FIELD_PLACEMENT = '필드는 모든 이슈의 상세 화면 「커스텀 필드」 묶음에 나와요. 형식은 만든 뒤 바꿀 수 없어요.'

// 가이드를 다는 화면 전부 — satisfies 로 값마다 SettingsGuide 모양을 검사하고, 키는 객체 리터럴 그대로 남긴다.
// 섹션별 가이드(WP-1298): 화면 섹션 하나에만 해당하는 알아두기·주의는 그 섹션(sections, id = 화면 SettingsSection id)에 담고,
// 화면 전체에 해당하는 말(여러 섹션에 걸치는 말)만 최상위 tips·caution 에 남긴다. 섹션 순서는 화면 순서이고 도움말 없는 섹션은 넣지 않는다.
// 목록형 화면(agents·agentLocations)은 화면 섹션이 없어 따라갈 대상이 없으므로 예전처럼 한 덩어리로 둔다.
export const settingsGuides = {
  profile: {
    title: '프로필',
    lead: '내 계정 정보가 바뀌었거나 비밀번호를 바꿔야 할 때 이 화면에서 고쳐요.',
    sections: [
      {
        id: S.profileInfo,
        title: '프로필 정보',
        tips: ['로그인 계정은 바꿀 수 없어요. 이름과 이메일만 고칠 수 있어요.', '이메일은 다른 계정이 이미 쓰고 있으면 저장되지 않아요.'],
      },
      {
        id: S.profilePassword,
        // SSO 로만 로그인하던 계정은 화면 제목이 「비밀번호 설정」이지만 가이드 제목은 하나로 둔다 — 아래 알아두기가 두 경우를 함께 설명한다.
        title: '비밀번호 변경',
        tips: [
          '비밀번호는 8자 이상이고 대문자·소문자·숫자를 하나씩 넣어야 해요.',
          'SSO 로만 로그인하던 계정도 비밀번호를 한 번 설정하면 「비밀번호 변경」으로 바뀌고, 그 뒤로는 현재 비밀번호가 있어야 바꿀 수 있어요.',
        ],
      },
    ],
    related: [{ label: '알림 설정', to: '/settings/notifications' }],
  },
  assistant: {
    title: 'AI 비서',
    lead: 'AI 가 같은 걸 매번 다시 묻거나, 답이 내 일하는 방식과 어긋날 때 이 화면에서 조정해요.',
    sections: [
      {
        id: S.assistantPersonal,
        title: '개인 비서',
        tips: ['연결을 해제해도 비서 계정은 남아요. 다시 연결하면 같은 이름의 비서로 돌아와요.'],
        caution: '「연결 해제」는 확인 없이 바로 실행되고 저장한 토큰·API 키를 폐기해요. 다시 쓰려면 토큰이나 키를 새로 넣어야 해요.',
      },
      {
        id: S.assistantSuggestions,
        title: '추천 질문',
        tips: ['추천 질문을 끄면 답 뒤에 후속 질문을 만드는 AI 호출 자체를 하지 않아요.'],
      },
      {
        id: S.assistantMemory,
        title: '메모리',
        tips: [
          '메모리는 대화마다 전부 실리지 않아요. 지금 묻는 내용과 관련 있는 것만 골라 실어요.',
          '꼭 반영돼야 하는 메모리는 고정해 두세요. 고정한 메모리는 매번 먼저 실려요. 범위마다 10개까지예요.',
        ],
      },
    ],
  },
  notifications: {
    title: '알림',
    lead: '알림이 너무 많거나, 받아야 할 알림이 오지 않을 때 이 화면에서 조정해요.',
    sections: [
      {
        // 서버가 푸시를 꺼 두면 화면에 이 섹션이 없다 — 그때는 notificationsGuide() 가 이 섹션을 뺀다.
        id: S.notificationDevice,
        title: '이 기기',
        tips: [
          'DM·멘션은 그 대화를 지금 보고 있으면 푸시를 띄우지 않아요. Safari 와 iPhone·iPad 에서는 그래도 띄워요.',
          '「이 기기」 스위치는 브라우저마다 따로예요. 같은 컴퓨터라도 다른 브라우저에서는 따로 켜야 해요.',
          '로그아웃하면 이 기기로는 푸시가 오지 않아요. 같은 브라우저로 다시 로그인하면 따로 켜지 않아도 다시 받아요.',
        ],
      },
      {
        id: S.notificationTypes,
        title: '알림 종류',
        tips: [
          '항목을 끄면 알림 목록·실시간 표시·푸시 모두 오지 않아요. 사람이 했을 때와 AI가 했을 때를 따로 끌 수 있어요.',
          'AI 담당 작업의 검토 요청·실패는 그 AI 에게 일을 맡긴 사람에게 가요.',
          '채팅(DM·채널 멘션)은 알림 목록에 쌓이지 않고 푸시로만 알려요. 꺼도 메시지와 안 읽음 표시는 채팅에 그대로 있어요.',
        ],
      },
    ],
  },
  sso: {
    title: 'SSO',
    lead: '회사가 이미 쓰는 계정 체계에 맞춰 구성원 접속을 관리하고 싶을 때 이 화면을 써요.',
    // 알아두기가 모두 로그인 동작이라 「SSO 로그인」 섹션에 담는다(「관리자 동의 링크」는 화면 설명으로 충분하다).
    sections: [
      {
        id: S.ssoLogin,
        title: 'SSO 로그인',
        tips: [
          'SSO 로 들어올 사람은 먼저 구성원으로 등록돼 있어야 해요. 처음 로그인할 때 계정을 새로 만들지 않아요.',
          '구성원 아이디가 회사 Microsoft 로그인 주소와 같아야 연결돼요. 대소문자는 가리지 않아요.',
          '다른 회사에서 게스트로 초대된 Microsoft 계정으로는 로그인할 수 없어요.',
          '켜도 비밀번호가 있는 구성원은 지금처럼 비밀번호로도 로그인할 수 있어요.',
          `끄면 SSO 로 로그인해 있던 사람은 ${SESSION_REFRESH} 이 워크스페이스를 더 쓸 수 없어요.`,
        ],
      },
    ],
    related: [{ label: '구성원', to: '/settings/users' }],
  },
  // 설정 › 앱 설정 › 작업 관리(WP-887) — 지금은 이슈 관계 유형만.
  workApp: {
    title: '작업 관리',
    lead: '이슈 사이 관계를 팀이 쓰는 말로 맞추고 싶을 때 이 화면에서 관계 유형을 정해요.',
    sections: [
      {
        id: S.relationTypes,
        title: '이슈 관계 유형',
        tips: [
          '관계 유형은 워크스페이스의 모든 프로젝트에 같이 쓰여요. 다른 프로젝트 이슈와 관계를 걸 때도 같은 유형을 써요.',
          '차단만 블로커 표시·차단 필터·타임라인 화살표에 반영돼요. 다른 유형은 이슈 화면에 보여 주기만 해요.',
          '기본 유형은 이름과 말을 바꾸거나 지울 수 없어요. 차단 말고는 숨길 수 있고, 숨긴 유형은 새로 걸 수 없지만 이미 걸린 관계는 그대로 보여요.',
          '이름과 말은 언제든 바꿀 수 있고 이미 걸린 관계의 표시도 함께 바뀌어요. 방향(있음·없음)은 걸린 관계가 없을 때만 바꿀 수 있어요.',
        ],
        caution: '쓰이는 유형을 지울 때 「관계도 함께 삭제」를 고르면 그 유형으로 걸린 관계와 외부 링크가 모두 사라지고 되돌릴 수 없어요.',
      },
    ],
  },
  roleDetail: {
    title: '역할 상세',
    lead: '새 직무가 생겼거나 한 팀의 접근 범위를 바꿔야 할 때 이 화면을 써요.',
    // 「역할 정보」·「권한 할당」 두 섹션에 걸치는 말이라 최상위에 둔다.
    tips: ['역할 정보와 권한은 저장 버튼이 따로예요. 체크만 바꾸고 나가면 반영되지 않아요.'],
    sections: [
      {
        id: S.rolePermissions,
        title: '권한 할당',
        tips: [
          '권한을 저장하면 이 역할을 가진 구성원 모두에게 바로 적용돼요. 다시 로그인할 필요 없어요.',
          '역할을 여러 개 가진 구성원은 각 역할의 권한을 모두 합쳐서 가져요.',
          '구성원은 역할과 관계없이 구성원 조회(member:read) 권한을 기본으로 가져요.',
          '워크스페이스 관리 화면은 ADMIN 역할이 있어야 열려요. 다른 역할에 같은 권한을 줘도 이 화면들은 보이지 않아요.',
        ],
      },
    ],
    related: [
      { label: '역할', to: '/settings/roles' },
      { label: '구성원', to: '/settings/users' },
    ],
  },
  userDetail: {
    title: '사용자 상세',
    lead: '구성원이 떠나거나 맡은 일이 바뀌었을 때 이 화면에서 로그인과 역할을 조정해요.',
    // 활성 상태·역할 할당 두 섹션에 걸치는 말이라 최상위에 둔다.
    // WP-420: 마지막 활성 ADMIN 은 정지뿐 아니라 다른 관리자가 ADMIN 역할을 빼는 것도 막힌다(409).
    tips: ['마지막 남은 활성 ADMIN 은 비활성화할 수도, ADMIN 역할을 뺄 수도 없어요. 내 ADMIN 역할은 직접 뺄 수 없어요.'],
    sections: [
      {
        id: S.userActive,
        title: '활성 상태',
        tips: [
          // WP-420: 정지하면 발급된 토큰도 다음 요청부터 막히고 열려 있던 실시간 연결(알림·노트 동시 편집)도 끊긴다 — 갱신 대기 없음.
          '비활성화하면 이미 로그인해 있던 사람도 다음 요청부터 바로 막히고, 열려 있던 실시간 연결도 끊겨요.',
          '다시 활성화하면 역할과 참여하던 프로젝트가 그대로라 바로 이어서 쓸 수 있어요.',
          '비활성 구성원은 프로젝트 멤버로 새로 추가할 수 없어요.',
        ],
      },
      {
        id: S.userRoles,
        title: '역할 할당',
        // WP-1075: AI 는 구성원 목록에서 빠지고 에이전트 상세가 역할·활성 상태를 맡는다.
        tips: ['공통 비서·일반 AI 의 역할과 사용 여부는 설정 › 에이전트의 에이전트 상세에서 바꿔요.'],
      },
    ],
    related: [
      { label: '역할', to: '/settings/roles' },
      { label: '에이전트', to: '/settings/agents' },
    ],
  },
  // WP-1281: 에이전트 화면 — 목록 탭·실행 환경 탭·에이전트 상세. 화면 설명 문단을 옮겨 왔다(화면에는 목록·설정과 지금 할 일만).
  agents: {
    title: '에이전트',
    lead: '이슈를 맡기거나 대화에서 부를 AI 구성원을 만들고 관리해요.',
    tips: [
      '공통 비서는 개인 비서를 정하지 않은 구성원 모두가 쓰는 AI 예요. 공통 비서가 없으면 그 구성원들은 AI 를 쓸 수 없어요.',
      '개인 비서는 구성원이 각자 만든 AI 라 주인이 관리해요. 「개인 비서 표시」를 켜야 목록에 보여요.',
      '실행 방식은 셋이에요 — 기본(Works 가 바로 답함), Claude Code(Works 가 작업 공간을 띄움), 외부(직접 띄운 도구가 키로 접속).',
      'AI 구성원의 역할과 사용 여부는 구성원 화면이 아니라 여기 에이전트 상세에서 바꿔요.',
    ],
    related: [
      { label: '구성원', to: '/settings/users' },
      { label: '역할', to: '/settings/roles' },
      { label: 'AI 비서', to: '/settings/assistant' },
    ],
  },
  agentLocations: {
    title: '실행 환경',
    lead: 'AI 를 Works 가 직접 띄우려면 그 AI 가 돌 클러스터를 여기에 실행 환경으로 등록해요.',
    tips: [
      '실행 환경마다 연결 프로그램을 한 번 설치하면 「연결됨」으로 바뀌어요. 그다음부터는 에이전트 상세에서 실행을 시작하고 멈추는 대로 그 클러스터에서 AI 가 돌아요.',
      '최대 AI 수는 이 실행 환경에서 동시에 실행할 수 있는 AI 수예요. 넘으면 실행 시작과 실행 환경 바꾸기가 거절돼요.',
      '새 AI 는 기본 실행 환경을 써요. AI 마다 상세 › 실행 › 작업 설정에서 다른 실행 환경을 고를 수 있어요.',
      '이 실행 환경을 쓰도록 설정된 AI 가 있거나 기본 실행 환경이면 지울 수 없어요.',
      '「설치 대기」가 오래 가면 클러스터에서 Works 주소에 닿지 못하는 경우가 많아요. 설치 안내의 「내부 IP」 칸을 채워 다시 설치하세요.',
    ],
    caution: '토큰을 재발급하면 옛 토큰은 바로 끊겨요. 클러스터의 연결 프로그램이 새 토큰을 쓰도록 바꾸기 전까지 그 실행 환경의 AI 를 관리할 수 없어요.',
    related: [{ label: '에이전트 목록', to: '/settings/agents' }],
  },
  // 에이전트 상세의 공통 부분 — 실행 방식별 문장은 agentDetailGuide() 가 덧붙인다(로딩 중에는 이 공통 부분만).
  agentDetail: {
    title: '에이전트 상세',
    lead: '이 AI 를 쓸 수 있게 할지, 무엇을 맡기고 어떻게 돌릴지 이 화면에서 정해요.',
    tips: [
      '사용을 중지하면 실행 중이던 AI 도 멈춰요. 다시 사용으로 바꿔도 실행은 직접 시작해야 해요.',
      '「맡은 일」은 다른 AI 가 일을 맡길 상대를 고를 때 읽어요. 무엇을 맡고 어떻게 일하는지 적어 두세요.',
      '「지시」는 이 AI 가 이슈를 맡을 때마다 따르는 규칙이에요. 저장하면 다음 이슈부터 따르고, 다른 AI 는 보지 않아요. 프로젝트 저장소의 규칙과 부딪히면 저장소 규칙이 먼저예요.',
      '공통 비서로 지정된 AI 는 지정을 먼저 풀어야 사용 중지나 실행 방식 바꾸기를 할 수 있어요.',
    ],
    caution: '에이전트를 삭제하면 실행을 멈추고 접속 키를 모두 폐기해요. 공통 비서로 지정돼 있으면 지정도 함께 풀려요. 남긴 기록이 있으면 지우지 않고 사용 중지로 바꿔요.',
    related: [
      { label: '에이전트 목록', to: '/settings/agents' },
      { label: '실행 환경', to: '/settings/agents/locations' },
    ],
  },
  projectSettings: {
    title: '프로젝트 설정',
    lead: '새 프로젝트를 시작하거나 팀 구성·작업 방식이 바뀌었을 때 이 화면에서 정리해요.',
    // 기본 정보·멤버·이슈 유형·필드에 걸치는 권한 규칙이라 최상위에 둔다.
    tips: ['이름·설명과 멤버는 소유자와 워크스페이스 관리자만 바꿀 수 있어요. 이슈 유형과 필드를 만들고 고치고 지우는 건 소유자만 할 수 있어요.'],
    sections: [
      {
        id: S.projectMembers,
        title: '멤버',
        tips: ['소유자는 늘 한 명 이상 있어야 해요. 마지막 소유자는 빼거나 역할을 바꿀 수 없어요.'],
        caution: '멤버를 빼면 그 사람이 맡던 이 프로젝트 이슈의 담당자 자리도 함께 비워져요. 다시 추가해도 담당은 돌아오지 않아요.',
      },
      {
        id: S.projectLabels,
        title: '라벨',
        tips: ['라벨은 멤버라면 누구나 만들 수 있어요. 고치거나 지우는 건 만든 사람과 소유자·관리자만 해요. 지운 라벨은 붙어 있던 모든 이슈에서 빠져요.'],
      },
      { id: S.projectIssueTypes, title: '이슈 유형', tips: [TIP_TYPE_IN_USE] },
      { id: S.projectFields, title: '프로젝트 필드', tips: [TIP_FIELD_PLACEMENT] },
    ],
  },
  // 개인 프로젝트 — 사람 멤버가 없고 관리자도 열 수 없어 팀 프로젝트 문구(소유자·관리자 권한, 소유자 최소 1명)가 맞지 않는다.
  personalProjectSettings: {
    title: '개인 프로젝트 설정',
    lead: '내 할 일을 정리하는 방식을 바꾸고 싶을 때 이 화면을 써요.',
    tips: ['개인 프로젝트는 나만 볼 수 있어요. 워크스페이스 관리자도 열 수 없어요.'],
    sections: [
      {
        // 개인 프로젝트의 멤버 섹션은 제목이 「AI 어시스턴트」다 — id 는 팀 프로젝트의 멤버 섹션과 같다.
        id: S.projectMembers,
        title: 'AI 어시스턴트',
        tips: ['사람은 멤버로 넣을 수 없어요. AI 어시스턴트만 추가해 이슈 담당자로 지정할 수 있어요.'],
        caution: 'AI 어시스턴트를 빼면 그 AI 가 맡던 이 프로젝트 이슈의 담당자 자리도 함께 비워져요. 다시 추가해도 담당은 돌아오지 않아요.',
      },
      { id: S.projectIssueTypes, title: '이슈 유형', tips: [TIP_TYPE_IN_USE] },
      { id: S.projectFields, title: '프로젝트 필드', tips: [TIP_FIELD_PLACEMENT] },
      // 위험 구역은 소유자에게만 보인다 — 화면에 없으면 가이드는 이 섹션을 따라가지 않고 그대로 보여 준다.
      { id: S.projectDanger, title: '위험 구역', tips: [DEFAULT_PROJECT_UNDELETABLE] },
    ],
  },
} satisfies Record<string, SettingsGuide>

/** 가이드가 있는 화면 키. */
export type SettingsGuideKey = keyof typeof settingsGuides

/**
 * 프로젝트 설정 가이드 고르기 — 개인 프로젝트는 멤버·관리자 규칙이 달라 전용 가이드를 쓴다.
 * 유형을 알기 전(로딩·실패)엔 undefined — 팀 가이드가 먼저 보였다 바뀌지 않게.
 */
export function projectSettingsGuide(project: Pick<ProjectResponse, 'type'> | undefined): SettingsGuide | undefined {
  if (!project) return undefined
  return project.type === 'PERSONAL' ? settingsGuides.personalProjectSettings : settingsGuides.projectSettings
}

/**
 * 알림 가이드 고르기(WP-1298) — 서버가 푸시를 꺼 두면 화면에 「이 기기」 섹션이 없으니 그 도움말(푸시 스위치·로그아웃)도 뺀다.
 * 푸시 설정을 아직 모르면(로딩·실패) 전체 가이드 그대로 — 열어 둔 가이드가 로딩 뒤 줄어들 수는 있어도 없는 단추를 설명하지는 않는다.
 */
export function notificationsGuide(pushDisabled: boolean): SettingsGuide {
  const g = settingsGuides.notifications
  return pushDisabled ? { ...g, sections: g.sections.filter((s) => s.id !== S.notificationDevice) } : g
}


/**
 * 에이전트 상세 가이드 고르기(WP-1281) — 화면에서 뺀 「무엇인지·왜·언제」 설명을 화면 섹션별로 묶고, 실행 방식에 맞춰 고른다.
 * Works 실행 방식의 자원·계정 조건은 방식 정의(template, 서버 agent-templates/*.yaml)에서 가져와 정의가 바뀌어도 문장이 따라간다.
 * 접속 키 교체 규칙(30일·만료 7일 전·하루 안 만료면 바로)은 서버 ManagedKeyChain·RolloutPolicy 값이다 — 바꾸면 이 문구도 함께 고친다.
 * 내용이 없는 섹션은 뺀다. 개인 비서는 역할 할당·코드 저장소·위험 구역이 화면에 없어 가이드에도 없다.
 */
export function agentDetailGuide(
  agent: Pick<AgentResponse, 'runMode' | 'type' | 'username'>,
  template: AgentTemplate | null,
): SettingsGuide {
  const ids = AGENT_DETAIL_SECTION_IDS
  const personal = agent.type === 'PERSONAL'
  const works = agent.runMode === 'WORKSPACE' && template != null
  const external = agent.runMode === 'EXTERNAL'

  const status: string[] = ['사용을 중지하면 실행 중이던 AI 도 멈춰요. 다시 사용으로 바꿔도 실행은 직접 시작해야 해요.']
  if (works)
    status.push('「쉴 때」는 하던 이슈를 마치고 다음 일을 기다릴 때예요. 「지금 적용」을 누르면 작업 공간을 새 설정으로 다시 띄우고, 하던 이슈를 이어 받아요.')
  if (agent.type === 'WORKSPACE') status.push('공통 비서로 지정된 AI 는 지정을 먼저 풀어야 사용을 중지할 수 있어요.')

  const run: string[] = []
  let runCaution: string | undefined
  if (personal) {
    run.push('개인 비서는 기본 방식으로만 돌아요. 관리자는 AI 계정 연결을 끊거나 남은 키를 폐기해 정리만 할 수 있어요.')
  } else if (agent.runMode === 'SERVER') {
    run.push(
      '기본 방식의 AI 계정은 Claude 구독이나 OpenAI 호환 연결을 쓸 수 있어요. 연결해야 이 AI 가 답할 수 있어요.',
      '공통 비서는 개인 비서를 정하지 않은 구성원 모두가 쓰는 AI 예요. 지정하면 모델·생각의 깊이·추천 질문 모델을 여기서 정해요.',
      '공통 비서로 지정할 때 저장된 AI 계정으로 모델을 먼저 확인해요. 확인하지 못하면 한 번 더 묻고 지정해요. 지정을 풀면 개인 비서를 정하지 않은 구성원은 AI 를 쓰지 못해요.',
    )
    if (agent.type === 'WORKSPACE') run.push('공통 비서는 기본 방식으로만 돌아요. 다른 방식으로 바꾸려면 공통 비서 지정을 먼저 풀어 주세요.')
  } else if (works) {
    const title = template.card.title
    run.push('실행 중에는 실행 방식을 바꿀 수 없어요. 먼저 실행을 멈춰 주세요.')
    if (template.account === 'anthropic')
      run.push(`${title} 는 Anthropic(Claude) 계정만 쓸 수 있어요. 실행 중에 연결을 끊으면 다시 시작할 때부터 일하지 못해요.`)
    else if (template.account && isLoginProvider(template.account)) {
      const label = accountLabel(template.account)
      run.push(
        `${title} 는 ${label} 정보로 일해요. 내 컴퓨터에서 ${loginProgram(template.account)} 에 이 AI 전용 계정으로 로그인한 뒤, 그 로그인 정보를 「${label} 연결」에 넣어 주세요.`,
        '로그인 갱신은 AI 가 일하는 곳에서 스스로 해요. 같은 로그인을 내 컴퓨터나 다른 AI 에서도 쓰면 갱신할 때 한쪽이 로그아웃되니 나눠 쓰지 마세요.',
        `실행 방식을 ${title} 가 아닌 방식으로 바꾸면 ${label} 연결은 해제돼요.`,
      )
    }
    if (template.requires.includes('repo'))
      run.push(
        '「저장소 연결」에는 이 AI 가 맡는 프로젝트 저장소의 호스트마다 토큰을 붙여 넣어요. 토큰은 AI 마다, 호스트마다 따로 저장하고 저장한 뒤에는 다시 보이지 않아요. 연결이 빠진 호스트가 있으면 실행을 시작할 수 없어요.',
        'GitHub 토큰은 GitHub › Settings › Developer settings › Fine-grained personal access tokens 에서 만들어요. 대상 저장소를 고르고 Contents 와 Pull requests 를 Read and write 로 주세요.',
        'GitLab 토큰은 GitLab › Preferences › Access tokens 에서 만드는 Personal access token 이에요. api 와 write_repository 범위를 체크하세요.',
        '실행 중에 연결을 바꾸거나 끊으면 다음에 다시 시작할 때부터 적용돼요.',
      )
    if (template.config.some((f) => f.key === 'queue'))
      run.push('대기열 라벨을 적으면 맡긴 이슈 말고도 그 라벨이 붙은 담당자 없는 이슈를 가져가 처리해요.')
    run.push('실행 환경을 바꾸면 쉴 때를 기다리지 않고 바로 옮겨 가요.')
    const resource = workResourceText(template)
    if (resource) run.push(`${title} 는 ${resource} 를 써요.`)
    run.push(
      '접속 키는 Works 가 30일짜리로 만들어 넘기고, 만료 7일 전부터 새 키로 바꿔요. 새 키는 쉴 때 적용되고, 옛 키가 하루 안에 만료되면 일하는 중이어도 바로 바꿔요. 직접 발급할 필요가 없어요.',
      '예전에 직접 발급한 키가 남아 있으면 이제 쓰지 않으니 폐기하세요.',
    )
  } else if (external) {
    run.push(
      `이 AI 로 바꾼 세션만 이 AI 로 일하고, 다른 세션은 내 계정 그대로예요. ${PLUGIN_COMMANDS.logout} 하면 내 계정으로 돌아와요.`,
      '자동으로 이슈 처리를 띄우면 할당된 이슈를 하나씩 가져와 구현·검증한 뒤 이슈 브랜치를 push 해 GitHub PR 을 만들고, 검토자가 머지하면 검토 대기로 올려요. main 에 직접 push 하거나 배포하지는 않아요.',
      'PR 을 만들려면 이 AI 가 도는 컴퓨터에 gh 와 GitHub 토큰(GH_TOKEN)이 있어야 해요. 없으면 그 이슈를 「인증 필요」로 멈추고 알려 줘요.',
      `자동 처리는 Claude Code 가 열려 있는 동안만 돌고 7일 뒤 다시 띄워야 해요. 이슈 하나만 맡길 때는 「${PLUGIN_SKILLS.workOn} 이슈키」를 쓰세요.`,
    )
    runCaution = '자동 처리는 권한을 묻지 않는 모드라 이 AI 전용 터미널에서만 쓰세요.'
  }

  const repos: string[] = ['「코드 저장소」에는 이 AI 가 멤버이고 저장소가 연결된 프로젝트가 나와요. 프로젝트 설정 › 멤버에서 이 AI 를 넣거나 빼요.']
  if (external) repos.push('외부 AI 는 Works 가 코드를 받아 주지 않아요. 도구를 띄운 컴퓨터에서 GitHub 에 로그인해 두세요.')

  const sections: SettingsGuideSection[] = [
    { id: ids.status, title: '상태', tips: status },
    ...(personal
      ? [{ id: ids.profile, title: '기본 정보', tips: ['개인 비서는 구성원이 만든 AI 라 이름·아바타·맡은 일·지시를 주인이 정해요.'] }]
      : [
          { id: ids.profile, title: '기본 정보', tips: ['이름과 아바타는 목록·담당자 고르기·채팅에 이 AI 의 모습으로 보여요.'] },
          { id: ids.roles, title: '역할 할당', tips: ['AI 에게는 관리자 역할이나 관리 권한이 든 역할을 줄 수 없어요. 이미 가진 역할은 화면에 남아 뺄 수 있어요.'] },
        ]),
    {
      id: ids.work,
      title: '맡은 일과 지시',
      tips: [
        '「맡은 일」은 다른 AI 가 일을 맡길 상대를 고를 때 읽어요. 무엇을 맡고 어떻게 일하는지 적어 두세요.',
        '「지시」는 이 AI 가 이슈를 맡을 때마다 따르는 규칙이에요. 저장하면 다음 이슈부터 따르고, 다른 AI 는 보지 않아요. 프로젝트 저장소의 규칙과 부딪히면 저장소 규칙이 먼저예요.',
      ],
    },
    {
      id: ids.run,
      title: '실행',
      ...(external ? { stepsTitle: '연결 방법', steps: externalConnectSteps(agent.username) } : {}),
      tips: run,
      caution: runCaution,
    },
    ...(!personal && agent.runMode !== 'SERVER' ? [{ id: ids.repos, title: '코드 저장소', tips: repos }] : []),
    ...(!personal ? [{ id: ids.danger, title: '위험 구역', caution: settingsGuides.agentDetail.caution }] : []),
  ]

  return {
    title: settingsGuides.agentDetail.title,
    lead: settingsGuides.agentDetail.lead,
    sections,
    related: settingsGuides.agentDetail.related,
  }
}

/**
 * 외부 AI 연결 방법(WP-1281) — 예전엔 상세 화면 「연결 방법」 ①~⑤ 였다. 화면에는 ① 키 발급만 두고 ②부터는 가이드 단계로 옮겼다.
 * 명령은 플러그인 안내(lib/pluginGuide)가 만든 것을 그대로 쓴다. 서버 주소 단계는 기본 주소 배포에서도 그려 번호가 건너뛰지 않게 한다.
 */
function externalConnectSteps(username: string): SettingsGuideStep[] {
  const customServer = needsServerUrlSetting(MCP_ENDPOINT)
  return [
    { title: '① 키 발급', body: '화면의 「접속 키」에서 키를 발급해요. 키는 발급할 때 한 번만 보여요.' },
    {
      title: '② genia-works 플러그인 설치',
      body: '컴퓨터마다 한 번만 해요. 이미 설치했으면 건너뛰세요.',
      commands: [{ command: buildPluginInstallCommands(), testId: 'plugin-install-command' }],
    },
    customServer
      ? {
          title: '③ 서버 주소',
          body: '이 서버는 기본 주소가 아니에요. 첫 명령으로 플러그인 설정을 열고, 서버 주소를 그 아래 주소로 바꾸세요.',
          commands: [
            { command: '/plugin configure genia-works@genia-works', testId: 'plugin-configure-command' },
            { label: '서버 주소', command: MCP_ENDPOINT, testId: 'plugin-server-url' },
          ],
        }
      : { title: '③ 서버 주소', body: '이 서버는 기본 주소라 그대로 두면 돼요.' },
    {
      title: '④ 이 AI 로 로그인',
      body: `아래 명령에서 「새 AI 추가」를 고르고 ①에서 발급한 키를 붙여 넣으세요. 이름은 이 AI 의 아이디 ${username} 로 넣으면 그다음 명령을 그대로 쓸 수 있어요.`,
      copyValue: { label: '아이디 복사', value: username, testId: 'agent-username-copy' },
      commands: [
        { command: PLUGIN_COMMANDS.login, testId: 'agent-login-command' },
        { label: '지금 세션에서 이 AI 로 바꾸기', command: buildSwitchCommand(username), testId: 'agent-switch-command' },
        { label: '처음부터 이 AI 로 띄우기', command: buildLaunchAsCommand(username), testId: 'agent-launch-as-command' },
      ],
    },
    {
      title: '⑤ 자동으로 이슈 처리',
      commands: [
        { label: '이 AI 전용 터미널에서 띄우기', command: buildWorkLoopLaunchCommand(username), testId: 'agent-work-loop-launch-command' },
        { label: 'Claude Code 안에서 시작하기', command: buildWorkLoopStartCommand(), testId: 'agent-work-loop-start-command' },
      ],
    },
    {
      title: '다른 방법 (Windows 등 플러그인 전환을 쓸 수 없을 때)',
      body: '키를 직접 넘겨 띄워요. 셸 기록에 키가 남을 수 있어요.',
      commands: [{ command: buildTokenFallbackCommand(), testId: 'agent-fallback-command' }],
      collapsed: true,
    },
  ]
}
