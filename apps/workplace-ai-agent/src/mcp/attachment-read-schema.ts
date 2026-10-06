// 첨부 추출 텍스트 구간 읽기 공통 계약 — 이슈 챗 read_attachment_text(tools.ts)와 메인 채팅 read_chat_attachment
// (home-attachment-tool.ts)가 같은 기본 길이·범위 검증을 쓴다. tools.ts 가 home-attachment-tool.ts 를 import 하므로
// 순환 import(모듈 평가 시점 TDZ)를 피하려고 의존이 없는 별도 모듈에 둔다.
import { z } from 'zod';

// limit 미지정 시 기본 구간 길이. 서버 기본(32000)보다 작게 — 컨텍스트가 작은 모델이 한 번에 너무 많이 받지 않게 한다.
// 더 필요하면 모델이 limit 을 최대 32000 까지 직접 지정하거나 nextOffset 으로 이어 읽는다.
export const READ_ATTACHMENT_DEFAULT_LIMIT = 12000;

// limit 상한 32000 은 서버 계약(WP-242)과 같다 — 넘기면 서버가 400 이므로 스키마에서 먼저 막는다.
// 선택 인자는 nullish — 모델이 안 쓰는 인자를 null 로 채워 보내는 경우가 있어 null 도 "미지정" 으로 받는다.
export const readRangeShape = {
  offset: z.number().int().min(0).nullish(),
  limit: z.number().int().min(1).max(32000).nullish(),
};
