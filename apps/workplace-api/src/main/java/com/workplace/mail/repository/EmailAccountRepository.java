package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;

import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailSecurity;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/** email_account jOOQ 리포지토리. 모든 조회/변경은 userId 스코프로 격리한다. */
@Repository
@RequiredArgsConstructor
public class EmailAccountRepository {

  private final DSLContext dsl;

  /** 계정 INSERT — last_tested_at 은 호출 시점(now) 으로 기록(생성 시 연결 테스트를 통과한다). 생성 id 반환. */
  public long insert(long userId, EmailAccountRequest req, String encryptedPassword) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, req.emailAddress())
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, req.displayName())
        .set(EMAIL_ACCOUNT.IMAP_HOST, req.imapHost())
        .set(EMAIL_ACCOUNT.IMAP_PORT, req.imapPort())
        .set(EMAIL_ACCOUNT.IMAP_SECURITY, req.imapSecurity().name())
        .set(EMAIL_ACCOUNT.IMAP_USERNAME, req.imapUsername())
        .set(EMAIL_ACCOUNT.SMTP_HOST, req.smtpHost())
        .set(EMAIL_ACCOUNT.SMTP_PORT, req.smtpPort())
        .set(EMAIL_ACCOUNT.SMTP_SECURITY, req.smtpSecurity().name())
        .set(EMAIL_ACCOUNT.SMTP_USERNAME, req.smtpUsername())
        .set(EMAIL_ACCOUNT.ENCRYPTED_PASSWORD, encryptedPassword)
        .set(EMAIL_ACCOUNT.LAST_TESTED_AT, OffsetDateTime.now())
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  /** 본인 활성 계정 1건 조회(비밀번호 제외 응답). 타인/없음/삭제됨이면 empty. */
  public Optional<EmailAccountResponse> findByIdAndUser(long userId, long id) {
    return dsl.select(
            EMAIL_ACCOUNT.ID,
            EMAIL_ACCOUNT.EMAIL_ADDRESS,
            EMAIL_ACCOUNT.DISPLAY_NAME,
            EMAIL_ACCOUNT.IMAP_HOST,
            EMAIL_ACCOUNT.IMAP_PORT,
            EMAIL_ACCOUNT.IMAP_SECURITY,
            EMAIL_ACCOUNT.IMAP_USERNAME,
            EMAIL_ACCOUNT.SMTP_HOST,
            EMAIL_ACCOUNT.SMTP_PORT,
            EMAIL_ACCOUNT.SMTP_SECURITY,
            EMAIL_ACCOUNT.SMTP_USERNAME,
            EMAIL_ACCOUNT.LAST_TESTED_AT,
            EMAIL_ACCOUNT.CREATED_AT,
            EMAIL_ACCOUNT.UPDATED_AT)
        .from(EMAIL_ACCOUNT)
        .where(EMAIL_ACCOUNT.ID.eq(id))
        .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .fetchOptional(this::toResponse);
  }

  /** 본인 활성 계정 목록(최신순). */
  public List<EmailAccountResponse> listByUser(long userId) {
    return dsl.select(
            EMAIL_ACCOUNT.ID,
            EMAIL_ACCOUNT.EMAIL_ADDRESS,
            EMAIL_ACCOUNT.DISPLAY_NAME,
            EMAIL_ACCOUNT.IMAP_HOST,
            EMAIL_ACCOUNT.IMAP_PORT,
            EMAIL_ACCOUNT.IMAP_SECURITY,
            EMAIL_ACCOUNT.IMAP_USERNAME,
            EMAIL_ACCOUNT.SMTP_HOST,
            EMAIL_ACCOUNT.SMTP_PORT,
            EMAIL_ACCOUNT.SMTP_SECURITY,
            EMAIL_ACCOUNT.SMTP_USERNAME,
            EMAIL_ACCOUNT.LAST_TESTED_AT,
            EMAIL_ACCOUNT.CREATED_AT,
            EMAIL_ACCOUNT.UPDATED_AT)
        .from(EMAIL_ACCOUNT)
        .where(EMAIL_ACCOUNT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .orderBy(EMAIL_ACCOUNT.CREATED_AT.desc(), EMAIL_ACCOUNT.ID.desc())
        .fetch(this::toResponse);
  }

  /** 본인 활성 계정의 암호화된 비밀번호. 수정 시 "비밀번호 유지" 경로와 소유 검증에 사용. */
  public Optional<String> findEncryptedPassword(long userId, long id) {
    return dsl.select(EMAIL_ACCOUNT.ENCRYPTED_PASSWORD)
        .from(EMAIL_ACCOUNT)
        .where(EMAIL_ACCOUNT.ID.eq(id))
        .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .fetchOptional(EMAIL_ACCOUNT.ENCRYPTED_PASSWORD);
  }

  /** 본인 활성 계정 중 같은 이메일 주소 존재 여부(중복 등록 방지). */
  public boolean existsByUserAndAddress(long userId, String emailAddress) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(EMAIL_ACCOUNT)
            .where(EMAIL_ACCOUNT.USER_ID.eq(userId))
            .and(EMAIL_ACCOUNT.EMAIL_ADDRESS.eq(emailAddress))
            .and(EMAIL_ACCOUNT.DISABLED_AT.isNull()));
  }

  /** 본인 활성 계정 중 주어진 id 를 제외하고 같은 이메일 주소 존재 여부(수정 시 중복 방지). */
  public boolean existsByUserAndAddressExcludingId(
      long userId, String emailAddress, long excludeId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(EMAIL_ACCOUNT)
            .where(EMAIL_ACCOUNT.USER_ID.eq(userId))
            .and(EMAIL_ACCOUNT.EMAIL_ADDRESS.eq(emailAddress))
            .and(EMAIL_ACCOUNT.ID.ne(excludeId))
            .and(EMAIL_ACCOUNT.DISABLED_AT.isNull()));
  }

  /** 본인 활성 계정 수정(설정 + 암호화 비밀번호 + updated_at). 영향 행 수 반환. */
  public int update(long userId, long id, EmailAccountRequest req, String encryptedPassword) {
    return dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, req.emailAddress())
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, req.displayName())
        .set(EMAIL_ACCOUNT.IMAP_HOST, req.imapHost())
        .set(EMAIL_ACCOUNT.IMAP_PORT, req.imapPort())
        .set(EMAIL_ACCOUNT.IMAP_SECURITY, req.imapSecurity().name())
        .set(EMAIL_ACCOUNT.IMAP_USERNAME, req.imapUsername())
        .set(EMAIL_ACCOUNT.SMTP_HOST, req.smtpHost())
        .set(EMAIL_ACCOUNT.SMTP_PORT, req.smtpPort())
        .set(EMAIL_ACCOUNT.SMTP_SECURITY, req.smtpSecurity().name())
        .set(EMAIL_ACCOUNT.SMTP_USERNAME, req.smtpUsername())
        .set(EMAIL_ACCOUNT.ENCRYPTED_PASSWORD, encryptedPassword)
        .set(EMAIL_ACCOUNT.LAST_TESTED_AT, OffsetDateTime.now())
        .set(EMAIL_ACCOUNT.UPDATED_AT, OffsetDateTime.now())
        .where(EMAIL_ACCOUNT.ID.eq(id))
        .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .execute();
  }

  /** 본인 활성 계정 soft delete(disabled_at = now). 영향 행 수 반환(없음/타인이면 0). */
  public int softDelete(long userId, long id) {
    return dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.DISABLED_AT, OffsetDateTime.now())
        .where(EMAIL_ACCOUNT.ID.eq(id))
        .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .execute();
  }

  /** jOOQ Record → EmailAccountResponse. security 문자열 → enum, OffsetDateTime → Instant. */
  private EmailAccountResponse toResponse(Record r) {
    OffsetDateTime tested = r.get(EMAIL_ACCOUNT.LAST_TESTED_AT);
    OffsetDateTime created = r.get(EMAIL_ACCOUNT.CREATED_AT);
    OffsetDateTime updated = r.get(EMAIL_ACCOUNT.UPDATED_AT);
    return new EmailAccountResponse(
        r.get(EMAIL_ACCOUNT.ID),
        r.get(EMAIL_ACCOUNT.EMAIL_ADDRESS),
        r.get(EMAIL_ACCOUNT.DISPLAY_NAME),
        r.get(EMAIL_ACCOUNT.IMAP_HOST),
        r.get(EMAIL_ACCOUNT.IMAP_PORT),
        MailSecurity.valueOf(r.get(EMAIL_ACCOUNT.IMAP_SECURITY)),
        r.get(EMAIL_ACCOUNT.IMAP_USERNAME),
        r.get(EMAIL_ACCOUNT.SMTP_HOST),
        r.get(EMAIL_ACCOUNT.SMTP_PORT),
        MailSecurity.valueOf(r.get(EMAIL_ACCOUNT.SMTP_SECURITY)),
        r.get(EMAIL_ACCOUNT.SMTP_USERNAME),
        tested == null ? null : tested.toInstant(),
        created == null ? null : created.toInstant(),
        updated == null ? null : updated.toInstant());
  }
}
