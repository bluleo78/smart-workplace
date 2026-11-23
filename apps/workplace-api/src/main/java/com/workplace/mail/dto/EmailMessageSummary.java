package com.workplace.mail.dto;

import java.time.Instant;

/** 메일 목록 한 행(본문 제외, 미리보기 snippet 포함). */
public record EmailMessageSummary(
    long id,
    long accountId,
    String threadId,
    String fromAddress,
    String fromName,
    String subject,
    String snippet,
    Instant receivedAt,
    boolean seen,
    boolean flagged, // WP-1741: 별표(서버 플래그 — IMAP \Flagged, Graph flag)
    boolean hasAttachment,
    String aiCategory, // WP-1341: 유효 분류(직접 바꾼 분류 > 개인 비서 분류 > 공용 분류)
    Boolean aiNeedsReply, // 회신필요 = aiNeedsReply && !seen (WP-146 단일 술어)
    boolean categoryPending, // WP-186·WP-1347: 분류가 없음(시도 여부 무관) → "분류 전" 배지
    boolean categoryFailed, // WP-1347: 분류 재시도를 모두 소진한 최종 실패 → 배지 title 만 달라진다
    // WP-1325: 보낸 사람이 이 워크스페이스 구성원이 아님(외부 메일) — 목록 API 만 채운다. 판정할 수 없으면(주소 없음·다른 경로) null.
    Boolean externalSender,
    // WP-1341: 사용자가 직접 바꾼 분류(aiCategory 가 내 분류) — 목록 배지 「내가 정한 분류」 표시
    boolean categoryByMe,
    // WP-1742: 메일의 원래 메일함 표시 이름(받은편지함·보낸편지함·보관·사용자 메일함 이름) — 별표 모아 보기 목록만 채우고 그 밖은 null.
    String folderName,
    // WP-1742: 원래 메일함 id(email_folder.id) — 화면이 이름이 아니라 id 로 「지금 메일함」을 판정한다. 앱 발송 기록처럼 서버 메일함이 아니면
    // null. 별표 모아 보기 목록만 채우고 그 밖은 null.
    Long folderId,
    // WP-1742: 원래 메일함 역할(INBOX·SENT·ARCHIVE·USER 등) — 받은·보낸편지함은 email_folder.role 이 비어 있어 판정해 채운다.
    // 별표 모아 보기 목록만.
    String folderRole,
    // WP-2029: 기밀로 보낸 메일(보낸 사본). 목록·상세의 「기밀」 배지는 WP-2030 이 이 값으로 그린다.
    boolean confidential) {

  /** 외부 메일 판정을 붙인 복사본(WP-1325) — 목록 조회 뒤 한 번의 일괄 조회로 채운다. */
  public EmailMessageSummary withExternalSender(Boolean external) {
    return new EmailMessageSummary(
        id,
        accountId,
        threadId,
        fromAddress,
        fromName,
        subject,
        snippet,
        receivedAt,
        seen,
        flagged,
        hasAttachment,
        aiCategory,
        aiNeedsReply,
        categoryPending,
        categoryFailed,
        external,
        categoryByMe,
        folderName,
        folderId,
        folderRole,
        confidential);
  }

  /**
   * 원래 메일함(표시 이름·id·역할)을 붙인 복사본(WP-1742) — 별표 모아 보기처럼 여러 메일함을 한 목록에 섞을 때만 쓴다. 이름은 배지 표시용, id·역할은
   * 화면의 작업 판정(옮기기 대상·AI 배지)용.
   */
  public EmailMessageSummary withFolder(String name, Long boxId, String role) {
    return new EmailMessageSummary(
        id,
        accountId,
        threadId,
        fromAddress,
        fromName,
        subject,
        snippet,
        receivedAt,
        seen,
        flagged,
        hasAttachment,
        aiCategory,
        aiNeedsReply,
        categoryPending,
        categoryFailed,
        externalSender,
        categoryByMe,
        name,
        boxId,
        role,
        confidential);
  }
}
