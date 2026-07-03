// apps/workplace-web/src/components/home/widgets/widgetPreviewFixtures.ts
// 위젯 추가 모달의 라이브 프리뷰용 고정 목데이터 — 17개 위젯(카탈로그 9 + 시스템 8) 대상.
// 실제 API 호출 없이 각 위젯 컴포넌트를 그대로 렌더하기 위한 previewData 소스(#브레인스토밍 2026-07-03).
// 예외 1종: quick_actions 는 데이터 없는 순수 버튼 행이라 undefined 유지(QuickActionsBody 가 무시).
import type { PriorityItem } from '@/api/priorityItems'
import type { SynthesisPreviewData } from '@/components/home/synthesis/SynthesisLayer'
import type { CalendarEvent, IssueDueMarker } from '@/types/calendar'
import type { ContactSummary } from '@/types/contact'
import type { ConversationSummaryItem, MailSummary, MailSummaryItem, MessagingSummary } from '@/types/dashboard'
import type { DriveSpace } from '@/types/drive'
import type { ActivityPage } from '@/types/home'
import type { IssueSearchResponse } from '@/types/issue'
import type { EmailMessageSummary } from '@/types/mailMessage'
import type { ChannelResponse } from '@/types/messaging'
import type { NotificationResponse } from '@/types/notification'
import type { ProjectResponse } from '@/types/project'
import type { WikiSpace } from '@/types/wiki'

const now = '2026-07-03T09:00:00Z'

const sampleIssues: IssueSearchResponse = {
  items: [
    { id: 1, projectKey: 'SW', number: 101, title: '로그인 세션 만료 버그 수정', status: 'IN_PROGRESS', priority: 'HIGH' },
    { id: 2, projectKey: 'SW', number: 102, title: '대시보드 위젯 프리뷰 추가', status: 'TODO', priority: 'MID' },
    { id: 3, projectKey: 'SW', number: 103, title: '알림 설정 화면 정리', status: 'TODO', priority: 'LOW' },
  ] as unknown as IssueSearchResponse['items'],
  nextCursor: null,
  hasMore: false,
}

const sampleMails: EmailMessageSummary[] = [
  {
    id: 1, accountId: 1, threadId: 't1', fromAddress: 'lead@example.com', fromName: '김리드',
    subject: '이번 주 스프린트 리뷰 일정 안내', snippet: '금요일 오후 2시에 진행 예정입니다...',
    receivedAt: now, seen: false, hasAttachment: false, aiCategory: null, aiNeedsReply: true, needsReplyDoneAt: null,
  },
  {
    id: 2, accountId: 1, threadId: 't2', fromAddress: 'hr@example.com', fromName: '인사팀',
    subject: '7월 급여명세서 발송', snippet: '첨부된 명세서를 확인해 주세요.',
    receivedAt: now, seen: true, hasAttachment: true, aiCategory: null, aiNeedsReply: false, needsReplyDoneAt: null,
  },
]

const sampleEvents: CalendarEvent[] = [
  {
    id: 1, title: '주간 스탠드업', description: null, startsAt: '2026-07-03T00:00:00Z', endsAt: '2026-07-03T00:30:00Z',
    allDay: false, location: null, color: null, calendarId: 1, calendarName: '내 캘린더', effectiveColor: '#7c5cff',
    reminderMinutes: null, recurrenceRule: null, createdAt: now, updatedAt: now,
  },
  {
    id: 2, title: '분기 목표 리뷰', description: null, startsAt: '2026-07-03T05:00:00Z', endsAt: '2026-07-03T06:00:00Z',
    allDay: false, location: null, color: null, calendarId: 1, calendarName: '내 캘린더', effectiveColor: '#7c5cff',
    reminderMinutes: null, recurrenceRule: null, createdAt: now, updatedAt: now,
  },
]

const sampleActivity: ActivityPage = {
  items: [
    { id: 1, issueId: 1, projectKey: 'SW', issueNumber: 101, issueTitle: '로그인 세션 만료 버그 수정', actorId: 1, actorName: '김리드', actorKind: 'HUMAN', eventType: 'STATUS_CHANGED', createdAt: now },
    { id: 2, issueId: 2, projectKey: 'SW', issueNumber: 102, issueTitle: '대시보드 위젯 프리뷰 추가', actorId: 2, actorName: 'AI 비서', actorKind: 'AGENT', eventType: 'CREATED', createdAt: now },
  ],
  nextCursor: null,
}

const sampleWikiSpaces: WikiSpace[] = [
  { id: 1, type: 'TEAM', name: '제품팀 노트', ownerId: 1, role: 'EDITOR', createdAt: now },
  { id: 2, type: 'PERSONAL', name: '개인 노트', ownerId: 1, role: 'OWNER', createdAt: now },
]

const sampleContacts: ContactSummary[] = [
  { type: 'MEMBER', id: 1, name: '김리드', email: 'lead@example.com', title: 'PM', organization: '제품팀', isFavorite: true },
  { type: 'EXTERNAL', id: 2, name: '박협력', email: 'partner@example.com', title: '대표', organization: '협력사', isFavorite: false },
]

const sampleProjects: ProjectResponse[] = [
  { id: 1, key: 'SW', name: 'Smart Workplace', description: null, ownerId: 1, type: 'TEAM', isDefault: true, createdAt: now, updatedAt: now, issueTotal: 42, issueDone: 20, memberCount: 5, memberNames: ['김리드', '박팀원'], viewerIsMember: true },
]

const sampleDriveSpaces: DriveSpace[] = [
  { id: 1, type: 'TEAM', name: '제품팀 드라이브', ownerId: 1, role: 'EDITOR', archived: false, createdAt: now },
]

const sampleChannels: ChannelResponse[] = [
  { id: 1, kind: 'CHANNEL', name: '# 제품-일반', visibility: 'PUBLIC', member: true, role: 'MEMBER', archived: false, memberCount: 12, unreadCount: 3, hasUnreadThreads: false, lastReadMessageId: 100, createdAt: now },
]

const sampleConversations: ConversationSummaryItem[] = [
  { kind: 'DM', conversationId: 1, label: '김리드', lastAuthorName: '김리드', lastMessagePreview: '검토 끝나면 알려주세요', lastMessageAt: now, unreadCount: 1, mentioned: false, needsReply: true, newThreadReplyCount: 0, aiReason: null },
  { kind: 'CHANNEL', conversationId: 2, label: '# 제품-일반', lastAuthorName: '박팀원', lastMessagePreview: '배포 완료했습니다', lastMessageAt: now, unreadCount: 0, mentioned: true, needsReply: false, newThreadReplyCount: 2, aiReason: null },
]

const sampleMailSummary: MailSummaryItem[] = [
  { id: 1, accountId: 1, subject: '이번 주 스프린트 리뷰 일정 안내', fromAddress: 'lead@example.com', fromName: '김리드', snippet: '금요일 오후 2시에 진행 예정입니다...', receivedAt: now, seen: false, hasAttachment: false, aiCategory: null, aiNeedsReply: true, needsReplyDoneAt: null },
]

// notifications: '내 차례'(ASSIGNED 1건) + '업데이트'(COMMENTED 1건) 구분을 위해 서로 다른 이슈로 배치.
const sampleNotifications: NotificationResponse[] = [
  {
    id: 1, type: 'ASSIGNED', actorId: 1, actorName: '김리드', actorKind: 'HUMAN',
    issueId: 1, projectKey: 'SW', issueNumber: 101, issueTitle: '로그인 세션 만료 버그 수정',
    commentId: null, eventId: null, eventTitle: null, eventStartsAt: null, read: false, createdAt: now,
  },
  {
    id: 2, type: 'COMMENTED', actorId: 2, actorName: '박팀원', actorKind: 'HUMAN',
    issueId: 2, projectKey: 'SW', issueNumber: 102, issueTitle: '대시보드 위젯 프리뷰 추가',
    commentId: 10, eventId: null, eventTitle: null, eventStartsAt: null, read: false, createdAt: now,
  },
  {
    id: 3, type: 'STATUS_CHANGED', actorId: 3, actorName: 'AI 비서', actorKind: 'AGENT',
    issueId: 3, projectKey: 'SW', issueNumber: 103, issueTitle: '알림 설정 화면 정리',
    commentId: null, eventId: null, eventTitle: null, eventStartsAt: null, read: false, createdAt: now,
  },
]

// synthesis 전용 — dueDate 는 "오늘" 여부와 무관하게 항상 지난 날짜로 고정해 실제 조회 시점과
// 무관하게 "마감 지남"으로 '지금 신경 쓸 일' 목록에 안정적으로 나타나게 한다.
const sampleDues: IssueDueMarker[] = [
  { issueId: 1, projectKey: 'SW', number: 101, title: '로그인 세션 만료 버그 수정', dueDate: '2026-07-01' },
]

const sampleMailSummaryData: MailSummary = {
  unreadCount: 1,
  needsReplyCount: 1,
  classificationActive: true,
  recent: sampleMailSummary,
}

const sampleMessagingSummaryData: MessagingSummary = {
  unreadConversationCount: 1,
  needsReplyCount: 1,
  aiAttentionCount: 0,
  attentionCount: 2,
  recent: sampleConversations,
}

const samplePriorityItems: PriorityItem[] = [
  { sourceType: 'issue', sourceId: '1', title: '로그인 세션 만료 버그 수정', deepLink: '/projects/SW/issues/101', importanceScore: 80, urgencyScore: 90, reason: '마감 임박' },
  { sourceType: 'mail', sourceId: '1', title: '이번 주 스프린트 리뷰 일정 안내', deepLink: '/mail', importanceScore: 60, urgencyScore: 40, reason: '회신 대기' },
]

// synthesis: SynthesisLayer 가 합성하는 6개 하위 신호(마감·멘션·메일·일정·메시징·AI우선순위)를
// 그대로 미러링 — 위 개별 위젯 픽스처를 재사용해 다른 프리뷰와 일관된 이야기(SW-101 등)를 유지한다.
const sampleSynthesis: SynthesisPreviewData = {
  dues: sampleDues,
  notifications: sampleNotifications,
  mail: sampleMailSummaryData,
  events: sampleEvents,
  messaging: sampleMessagingSummaryData,
  priorityItems: samplePriorityItems,
}

/** 위젯 type/key → 프리뷰용 목데이터. AddWidgetModal 프리뷰 패널이 previewData prop 으로 그대로 주입한다. */
export const widgetPreviewFixtures: Record<string, unknown> = {
  // 카탈로그 위젯 9종
  issue_list: sampleIssues,
  mail_list: sampleMails,
  calendar: sampleEvents,
  activity: sampleActivity,
  wiki: sampleWikiSpaces,
  contacts: sampleContacts,
  projects: sampleProjects,
  drive: sampleDriveSpaces,
  channels: sampleChannels,
  // 시스템 위젯 8종
  // my_tasks: MyTasksBody 가 소비하는 useMyIssues/useWatchedIssues 응답(IssueSearchResponse)과 동일 형태.
  my_tasks: { assigned: sampleIssues, watched: sampleIssues },
  calendar_today: sampleEvents,
  // notifications: groupNotifications() 원본 입력(NotificationResponse[]) — ASSIGNED 1건('내 차례') + 그 외 2건('업데이트').
  notifications: sampleNotifications,
  recent_chats: sampleConversations,
  unread_mail: sampleMailSummary,
  synthesis: sampleSynthesis,
  // quick_actions: QuickActions 는 데이터 없는 순수 버튼 행 — 프리뷰/실사용 렌더가 동일해 전용
  // 목데이터가 불필요하다(QuickActionsBody 가 previewData 를 무시).
  quick_actions: undefined,
  priority_quadrant: samplePriorityItems,
}
