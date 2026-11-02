package com.workplace.wiki.dto;

import java.util.UUID;

/**
 * 「편집」(잠금 얻기, WP-1308) 응답 — 잠금 상태와 요청자의 임시 저장본(없으면 null).
 *
 * @param token 이 편집 세션의 표지 — 편집 중 신호·취소·저장 때 돌려준다. 같은 사람이 다른 창에서 다시 「편집」하면 새 표지가 나와 이 표지는 더 쓰이지 않는다
 * @param lock 얻은 잠금(mine=true)
 * @param draft 남아 있던 내 임시 저장본 — 있으면 화면이 「이어 고치기 / 새로 시작」을 묻는다
 */
public record WikiHtmlLockAcquired(UUID token, WikiHtmlLockStatus lock, WikiHtmlDraftInfo draft) {}
