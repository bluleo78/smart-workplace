// 메일함 화면 컨텍스트 builder(WP-54). messageId 는 숫자 id(get_mail 인자) — RFC Message-ID 문자열이 아니다.
// WP-379: app 은 홈 채팅 메모리 범위 선택용(서버로 보내는 screenContext 에선 빠진다).
import type { AiScreenContext } from '@/types/aiScreenContext';

import { buildFacts, buildRefs, clip, fmtKst, LIMITS, withListState } from '../common';

/** 메일함 화면 입력 — 선택된 메일은 목록 행 요약에서 뽑은 값. */
export interface MailContextInput {
  accountId: number;
  accountEmail: string | null;
  /**
   * INBOX·SENT 는 list_mail 의 folder 인자 그대로. DRAFTS(WP-577)는 앱 서버 임시보관함이라 IMAP 폴더도 MCP 도구 인자도 아니다
   * — 이름표만 「임시보관함」으로 두고 refs 에 folder 를 싣지 않는다(AI 가 없는 폴더로 list_mail 을 부르지 않게).
   */
  folder: 'INBOX' | 'SENT' | 'DRAFTS';
  /**
   * WP-961 서버 메일함(보관·내 메일함) 보기의 경로 이름(예: 「내 메일함 › 프로젝트」). 있으면 folder 대신 이 이름을 쓰고 refs 에 folder 를 싣지 않는다
   * — list_mail 은 서버 메일함 인자가 없어 INBOX 를 실으면 AI 가 받은편지함을 읽는다.
   */
  serverFolder?: string | null;
  q: string;
  category: string | null;
  needsReply: boolean;
  /** 목록 로딩 전에는 undefined — 0건으로 오인시키지 않도록 scope.count 를 싣지 않는다. */
  count?: number;
  selected: {
    id: number;
    subject: string | null;
    fromName: string | null;
    fromAddress: string;
    receivedAt: string;
    aiCategory: string | null;
    aiNeedsReply: boolean | null;
  } | null;
}

/** 메일함 화면 → AI 화면 컨텍스트. scope=계정·폴더·필터, focus=열린 메일. */
export function buildMailContext(input: MailContextInput): AiScreenContext {
  const folderLabel = input.serverFolder
    ? input.serverFolder
    : input.folder === 'SENT' ? '보낸편지함' : input.folder === 'DRAFTS' ? '임시보관함' : '받은편지함';
  const scope = withListState(
    {
      label: clip(input.accountEmail ? `${input.accountEmail} · ${folderLabel}` : folderLabel, LIMITS.label),
      refs: buildRefs({ accountId: input.accountId, folder: input.folder === 'DRAFTS' || input.serverFolder ? null : input.folder }),
      facts: buildFacts([['검색어', input.q], ['분류', input.category], ['답장 필요만', input.needsReply]]),
    },
    { count: input.count },
  );

  const ctx: AiScreenContext = { view: '메일함', app: 'MAIL', scope };
  const s = input.selected;
  if (s) {
    ctx.focus = {
      type: '메일',
      label: clip(s.subject?.trim() || '(제목 없음)', LIMITS.label),
      refs: buildRefs({ messageId: s.id }),
      facts: buildFacts([
        // 주소가 비면 '이름 <>' 대신 이름만 — 둘 다 비면 buildFacts 가 항목을 뺀다.
        ['보낸이', s.fromName && s.fromAddress ? `${s.fromName} <${s.fromAddress}>` : s.fromName || s.fromAddress],
        ['수신', fmtKst(s.receivedAt)],
        ['AI 분류', s.aiCategory],
        ['답장 필요', s.aiNeedsReply === true],
      ]),
    };
  }
  return ctx;
}
