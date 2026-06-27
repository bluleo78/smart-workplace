package com.workplace.mail.dto;

import java.time.Instant;

/**
 * 본문 적재 대상. imapUid 로 IMAP 재조회, folderName 으로 폴더 오픈. bodyFetchedAt!=null 이면 이미 적재됨.
 *
 * <p>providerMessageId: Graph 계정의 메시지 ID(provider_message_id 컬럼). IMAP 계정은 null.
 *
 * <p>contentId: email_content.id — 본문 적재 시 contentRepo.updateBody 의 대상. 0 이면 content 행 미연결(legacy
 * 또는 content_id IS NULL) — 로더가 false 반환해 재시도 가능 상태로 남겨야 한다.
 *
 * <p>bodyFetchedAt: V97 이후 email_message.fetched_at(per-envelope) 기준. 이 envelope 의 본문/첨부 적재가 완료된 경우
 * non-null → MailBodyFetcher 멱등 가드 동작. content.body_fetched_at 이 설정되어도 이 값이 null 이면 재적재 대상(두 번째 수신자
 * envelope 첨부 누락 방지).
 */
public record BodyTarget(
    long messageId,
    long accountId,
    long imapUid,
    String folderName,
    Instant bodyFetchedAt,
    String providerMessageId,
    long contentId) {}
