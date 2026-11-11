// Anthropic 워크스페이스 ID 입력 규칙(WP-1496) — Claude 토큰을 넣는 세 곳(개인 비서·AI 별 연결 창·계정 창)이 같이 쓴다.
// 워크스페이스를 지정하지 않고 만든 API 키(사용자 키)는 호출마다 anthropic-workspace-id 헤더가 있어야 동작해서, 토큰과 함께 ID 를 받는다.
// 칸은 늘 선택이다 — 키 접두로 필수 여부를 정하지 않고, 필요한 키인지는 서버가 등록 때 모델 조회로 시험해 알려 준다.
import { type RefObject, useRef, useState } from 'react';

import { apiErrorResponse } from './api-error';

/** 워크스페이스 ID 최대 길이 — 서버 검증(1~128자)과 같다. */
export const WORKSPACE_ID_MAX = 128;

/**
 * 보이는 ASCII(0x21~0x7E)가 아닌 문자 — 공백·줄바꿈·제어 문자·비 ASCII(전각 문자·U+200D 등). 헤더 값에 실을 수 없어
 * 서버(AnthropicKeys)·ai-agent 도 같은 규칙으로 거절한다.
 */
const INVALID_CHAR = /[^\x21-\x7E]/;

/**
 * 다듬은 워크스페이스 ID 의 형식 오류 문구 — 맞으면(빈 값 포함) null.
 * 빈 값은 「안 넣음」이라 오류가 아니다. 앞뒤 공백은 제출 때 다듬으므로 여기 오는 값은 이미 trim 된 값이다.
 */
export function workspaceIdError(trimmed: string): string | null {
  if (trimmed.length === 0) return null;
  if (INVALID_CHAR.test(trimmed)) return '워크스페이스 ID 는 공백 없이 영문·숫자·기호로만 입력하세요';
  if (trimmed.length > WORKSPACE_ID_MAX) return `워크스페이스 ID 는 ${WORKSPACE_ID_MAX}자 이하로 입력하세요`;
  return null;
}

/** 요청 본문에 덧붙일 워크스페이스 ID 조각 — 다듬어서 비었으면 키를 아예 싣지 않는다. */
export function workspaceIdPart(trimmed: string): { workspaceId?: string } {
  return trimmed.length > 0 ? { workspaceId: trimmed } : {};
}

/**
 * 서버가 「이 키는 워크스페이스 ID 가 필요하다」고 거절했을 때의 안내 문구 — ErrorResponse.errors.workspaceId.
 * 그런 거절이 아니면 null 이라, 부르는 쪽은 기존 오류 토스트(handleApiError)로 넘긴다.
 */
export function workspaceIdErrorFromApi(error: unknown): string | null {
  const message = apiErrorResponse(error)?.errors?.workspaceId;
  return typeof message === 'string' && message.length > 0 ? message : null;
}

/** useAnthropicWorkspaceId 가 돌려주는 것 — 칸에 펼쳐 넣을 props 와 제출 단계별 도우미. */
export interface AnthropicWorkspaceIdState {
  /** AnthropicWorkspaceIdField 에 그대로 펼쳐 넣는 props — 값·바뀜(안내 지움)·안내 문구·초점 ref. */
  fieldProps: {
    value: string;
    onChange: (value: string) => void;
    error: string | null;
    inputRef: RefObject<HTMLInputElement | null>;
  };
  /** 제출 전 형식 검사 — 결과(오류 또는 지움)를 칸 아래 안내에 반영하고, 보내도 되면 true. */
  validate: () => boolean;
  /** 요청 본문에 펼쳐 넣을 조각 — 다듬어서 비었으면 키를 싣지 않는다. */
  part: () => { workspaceId?: string };
  /** 서버가 「워크스페이스 ID 가 필요하다」고 거절했으면 안내를 띄우고 칸에 초점을 옮긴 뒤 true — 아니면 false(부르는 쪽이 기존 처리). */
  absorbApiError: (error: unknown) => boolean;
  /** 값과 안내를 비운다 — 폼 초기화·원문 지우기 때. */
  reset: () => void;
}

/**
 * Claude 토큰을 넣는 세 곳(개인 비서·AI 별 연결 창·계정 창)이 똑같이 되풀이하던 워크스페이스 ID 칸 상태(WP-1496)를 한데 모은 훅.
 * 값·안내 문구·초점 ref 를 쥐고, 제출 전 형식 검사 → 본문 조각 → 서버 거절 흡수 → 초기화를 같은 규칙으로 처리한다.
 * 언제 이 단계를 거칠지(예: 계정 창은 토큰을 보낼 때만)는 부르는 쪽이 정한다.
 */
export function useAnthropicWorkspaceId(): AnthropicWorkspaceIdState {
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  return {
    fieldProps: {
      value,
      // 다시 고치기 시작하면 앞선 안내(형식 오류·서버 거절)는 지금 값의 안내가 아니라 지운다.
      onChange: (next) => {
        setValue(next);
        setMessage(null);
      },
      error: message,
      inputRef,
    },
    validate: () => {
      // 공백·제어 문자 없음, 128자 이하 — 틀리면 칸 아래에 알리고 보내지 않는다. 맞으면 지난 안내를 지운다.
      const formatError = workspaceIdError(value.trim());
      setMessage(formatError);
      return formatError === null;
    },
    part: () => workspaceIdPart(value.trim()),
    absorbApiError: (error) => {
      // 입력한 토큰은 두고 ID 칸에서 바로 고치게 한다.
      const needWorkspace = workspaceIdErrorFromApi(error);
      if (!needWorkspace) return false;
      setMessage(needWorkspace);
      inputRef.current?.focus();
      return true;
    },
    reset: () => {
      setValue('');
      setMessage(null);
    },
  };
}
