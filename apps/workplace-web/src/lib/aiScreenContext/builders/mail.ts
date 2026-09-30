// 메일함 화면 컨텍스트 builder(WP-54). messageId 는 숫자 id(get_mail 인자) — RFC Message-ID 문자열이 아니다.
import type { AiScreenContext } from '@/types/aiScreenContext';

import { buildFacts, buildRefs, clip, fmtKst, LIMITS } from '../common';

/** 메일함 화면 입력 — 선택된 메일은 목록 행 요약에서 뽑은 값. */
export interface MailContextInput {
  accountId: number;
  accountEmail: string | null;
  folder: 'INBOX' | 'SENT';
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
  const folderLabel = input.folder === 'SENT' ? '보낸편지함' : '받은편지함';
  const scope: NonNullable<AiScreenContext['scope']> = {
    label: clip(input.accountEmail ? `${input.accountEmail} · ${folderLabel}` : folderLabel, LIMITS.label),
    refs: buildRefs({ accountId: input.accountId, folder: input.folder }),
  };
  const facts = buildFacts([['검색어', input.q], ['분류', input.category], ['답장 필요만', input.needsReply]]);
  if (facts) scope.facts = facts;
  if (input.count != null) scope.count = input.count;

  const ctx: AiScreenContext = { view: '메일함', scope };
  const s = input.selected;
  if (s) {
    ctx.focus = {
      type: '메일',
      label: clip(s.subject?.trim() || '(제목 없음)', LIMITS.label),
      refs: buildRefs({ messageId: s.id }),
      facts: buildFacts([
        ['보낸이', s.fromName ? `${s.fromName} <${s.fromAddress}>` : s.fromAddress],
        ['수신', fmtKst(s.receivedAt)],
        ['AI 분류', s.aiCategory],
        ['답장 필요', s.aiNeedsReply === true],
      ]),
    };
  }
  return ctx;
}
