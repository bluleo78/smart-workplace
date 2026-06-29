package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.jooq.impl.DSL.val;

import com.workplace.mail.dto.AiAccountRef;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSecurity;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

// GraphTokenService 에서 사용하는 OAuth 토큰 DTO — 암호문 그대로 반환(복호화는 서비스 담당)

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
        .set(EMAIL_ACCOUNT.AI_ENABLED, req.aiEnabled()) // AI 비서 활성화 여부
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
            EMAIL_ACCOUNT.UPDATED_AT,
            EMAIL_ACCOUNT.AI_ENABLED,
            EMAIL_ACCOUNT.LAST_SYNCED_AT,
            EMAIL_ACCOUNT.PROVIDER) // V90: 공급자 필드
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
            EMAIL_ACCOUNT.UPDATED_AT,
            EMAIL_ACCOUNT.AI_ENABLED,
            EMAIL_ACCOUNT.LAST_SYNCED_AT,
            EMAIL_ACCOUNT.PROVIDER) // V90: 공급자 필드
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

  /**
   * AI 분류가 활성화된 본인 계정 존재 여부(#474).
   *
   * <p>홈 위젯이 "분류 활성" 배지를 표시할지 판단하는 데 쓰인다. ai_enabled=true 이면서 비활성(disabled_at)되지 않은 계정이 하나라도 있으면
   * true.
   */
  public boolean existsAiEnabledAccount(long userId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(EMAIL_ACCOUNT)
            .where(EMAIL_ACCOUNT.USER_ID.eq(userId))
            .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
            .and(EMAIL_ACCOUNT.AI_ENABLED.isTrue()));
  }

  /** 테넌트 범위(RLS GUC) 내 AI 활성 계정의 (userId, accountId) 목록 — 선제 요약 스케줄러용. */
  public List<AiAccountRef> listAiEnabledAccounts() {
    return dsl.select(EMAIL_ACCOUNT.USER_ID, EMAIL_ACCOUNT.ID)
        .from(EMAIL_ACCOUNT)
        .where(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .and(EMAIL_ACCOUNT.AI_ENABLED.isTrue())
        .fetch(r -> new AiAccountRef(r.get(EMAIL_ACCOUNT.USER_ID), r.get(EMAIL_ACCOUNT.ID)));
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
        .set(EMAIL_ACCOUNT.AI_ENABLED, req.aiEnabled()) // AI 비서 활성화 여부
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

  /**
   * jOOQ Record → EmailAccountResponse. security 문자열 → enum, OffsetDateTime → Instant. provider: DB
   * 값 → MailProvider enum. null 또는 미인식 값이면 IMAP 폴백(기존 행 안전).
   */
  private EmailAccountResponse toResponse(Record r) {
    OffsetDateTime tested = r.get(EMAIL_ACCOUNT.LAST_TESTED_AT);
    OffsetDateTime created = r.get(EMAIL_ACCOUNT.CREATED_AT);
    OffsetDateTime updated = r.get(EMAIL_ACCOUNT.UPDATED_AT);
    // provider: V90 이후 NOT NULL DEFAULT 'IMAP'. null 이면 기존 행 폴백.
    String providerStr = r.get(EMAIL_ACCOUNT.PROVIDER);
    MailProvider provider;
    try {
      provider = providerStr != null ? MailProvider.valueOf(providerStr) : MailProvider.IMAP;
    } catch (IllegalArgumentException e) {
      provider = MailProvider.IMAP; // 미인식 값은 IMAP 폴백
    }
    // imap_security / smtp_security: V90 이후 nullable. IMAP 계정만 값 존재.
    String imapSec = r.get(EMAIL_ACCOUNT.IMAP_SECURITY);
    String smtpSec = r.get(EMAIL_ACCOUNT.SMTP_SECURITY);
    Integer imapPort = r.get(EMAIL_ACCOUNT.IMAP_PORT);
    Integer smtpPort = r.get(EMAIL_ACCOUNT.SMTP_PORT);
    return new EmailAccountResponse(
        r.get(EMAIL_ACCOUNT.ID),
        r.get(EMAIL_ACCOUNT.EMAIL_ADDRESS),
        r.get(EMAIL_ACCOUNT.DISPLAY_NAME),
        r.get(EMAIL_ACCOUNT.IMAP_HOST),
        imapPort, // M365 계정은 null, IMAP 계정은 항상 non-null
        imapSec != null ? MailSecurity.valueOf(imapSec) : null,
        r.get(EMAIL_ACCOUNT.IMAP_USERNAME),
        r.get(EMAIL_ACCOUNT.SMTP_HOST),
        smtpPort, // M365 계정은 null, IMAP 계정은 항상 non-null
        smtpSec != null ? MailSecurity.valueOf(smtpSec) : null,
        r.get(EMAIL_ACCOUNT.SMTP_USERNAME),
        tested == null ? null : tested.toInstant(),
        created == null ? null : created.toInstant(),
        updated == null ? null : updated.toInstant(),
        Boolean.TRUE.equals(r.get(EMAIL_ACCOUNT.AI_ENABLED)),
        r.get(EMAIL_ACCOUNT.LAST_SYNCED_AT) == null
            ? null
            : r.get(EMAIL_ACCOUNT.LAST_SYNCED_AT).toInstant(),
        provider);
  }

  /**
   * M365 Graph 계정을 upsert 한다.
   *
   * <p>동일 (userId, email)의 활성(disabled_at IS NULL) 행이 있으면 그 행을 Graph 계정으로 전환(UPDATE)하고, 없으면 INSERT
   * 한다. IMAP 관련 컬럼(imap/smtp host·port·security·username·encrypted_password)은 M365 계정에서 NULL 로
   * 소거한다.
   *
   * <p>⚠️ @Transactional 컨텍스트 + TenantContext.set() 선행 필수 — GUC 미주입 시 FORCE RLS fail-closed.
   *
   * @param userId 계정 소유자
   * @param emailAddress M365 계정 이메일 주소
   * @param encRefreshToken 암호화된 refresh_token
   * @param encAccessToken 암호화된 access_token
   * @param expiresAt access_token 만료 시각
   * @return 생성 또는 갱신된 account ID
   */
  /**
   * 사용자의 모든 활성 메일 계정에 ai_enabled 를 일괄 설정한다.
   *
   * <p>전역 "개인 비서 사용" 토글이 단일 PATCH 로 모든 계정을 동시 변경할 때 사용한다. 반드시 @Transactional 컨텍스트(RLS GUC 주입) 안에서 호출해야
   * 한다.
   *
   * @param userId 계정 소유자
   * @param aiEnabled 설정할 값
   * @return 영향받은 행 수
   */
  public int updateAiEnabledForAll(long userId, boolean aiEnabled) {
    return dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.AI_ENABLED, aiEnabled)
        .set(EMAIL_ACCOUNT.UPDATED_AT, OffsetDateTime.now())
        .where(EMAIL_ACCOUNT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .execute();
  }

  /**
   * 사용자의 활성 계정 중 하나 이상이 ai_enabled=true 인지 확인한다.
   *
   * <p>M365 신규 계정 upsert 시 전역 설정을 상속하기 위해 사용한다.
   *
   * @param userId 계정 소유자
   * @return ai_enabled=true 인 활성 계정이 하나 이상 있으면 true
   */
  public boolean isAnyAiEnabled(long userId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(EMAIL_ACCOUNT)
            .where(EMAIL_ACCOUNT.USER_ID.eq(userId))
            .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
            .and(EMAIL_ACCOUNT.AI_ENABLED.isTrue()));
  }

  public long upsertGraphAccount(
      long userId,
      String emailAddress,
      String encRefreshToken,
      String encAccessToken,
      OffsetDateTime expiresAt,
      boolean aiEnabled) {
    // INSERT ... ON CONFLICT ... DO UPDATE — 단일 원자 쿼리로 TOCTOU 경쟁 제거.
    //
    // 충돌 타깃: 부분 인덱스 uq_email_account_user_addr ON (tenant_id, user_id, email_address)
    //   WHERE disabled_at IS NULL
    // 비활성(disabled_at NOT NULL) 동명 행은 인덱스 밖이므로 충돌 없이 새 활성 행 INSERT — 의도된 동작.
    // DO UPDATE: 기존 활성 IMAP 행을 Graph 계정으로 전환(IMAP 컬럼 소거, OAuth 토큰 채움).
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, emailAddress)
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, emailAddress) // 표시 이름 기본값: 이메일 주소
        .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
        .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encRefreshToken)
        .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encAccessToken)
        .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, expiresAt)
        .set(EMAIL_ACCOUNT.LAST_TESTED_AT, OffsetDateTime.now()) // OAuth 콜백 성공 = 연결 확인
        .set(EMAIL_ACCOUNT.AI_ENABLED, aiEnabled) // 전역 ai_enabled 설정 상속
        .onConflict(EMAIL_ACCOUNT.TENANT_ID, EMAIL_ACCOUNT.USER_ID, EMAIL_ACCOUNT.EMAIL_ADDRESS)
        .where(EMAIL_ACCOUNT.DISABLED_AT.isNull()) // 부분 인덱스 술어와 일치
        .doUpdate()
        // 기존 활성 IMAP → Graph 전환: provider 변경 + IMAP 컬럼 소거 + 토큰 갱신
        .set(EMAIL_ACCOUNT.PROVIDER, val("M365_GRAPH"))
        .setNull(EMAIL_ACCOUNT.IMAP_HOST)
        .setNull(EMAIL_ACCOUNT.IMAP_PORT)
        .setNull(EMAIL_ACCOUNT.IMAP_SECURITY)
        .setNull(EMAIL_ACCOUNT.IMAP_USERNAME)
        .setNull(EMAIL_ACCOUNT.SMTP_HOST)
        .setNull(EMAIL_ACCOUNT.SMTP_PORT)
        .setNull(EMAIL_ACCOUNT.SMTP_SECURITY)
        .setNull(EMAIL_ACCOUNT.SMTP_USERNAME)
        .setNull(EMAIL_ACCOUNT.ENCRYPTED_PASSWORD)
        .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, val(encRefreshToken))
        .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, val(encAccessToken))
        .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, val(expiresAt))
        .set(EMAIL_ACCOUNT.LAST_TESTED_AT, val(OffsetDateTime.now())) // 재연결 시에도 갱신
        .set(EMAIL_ACCOUNT.UPDATED_AT, val(OffsetDateTime.now()))
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 본인 활성 계정 중 이메일 주소로 첫 번째 계정을 조회한다.
   *
   * <p>OAuth 콜백 후 생성 확인 등에 사용한다. RLS GUC 주입을 위해 @Transactional 컨텍스트에서 호출해야 한다.
   *
   * @param userId 계정 소유자
   * @param emailAddress 이메일 주소
   * @return 활성 계정(없으면 empty)
   */
  public Optional<EmailAccountResponse> findFirstByUserAndEmail(long userId, String emailAddress) {
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
            EMAIL_ACCOUNT.UPDATED_AT,
            EMAIL_ACCOUNT.AI_ENABLED,
            EMAIL_ACCOUNT.LAST_SYNCED_AT,
            EMAIL_ACCOUNT.PROVIDER)
        .from(EMAIL_ACCOUNT)
        .where(EMAIL_ACCOUNT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.EMAIL_ADDRESS.eq(emailAddress))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .limit(1)
        .fetchOptional(this::toResponse);
  }

  /** 동기화 성공 시 마지막 동기화 시각을 기록한다. 반드시 호출자가 트랜잭션 안에서 실행(RLS GUC). */
  public void updateLastSyncedAt(long accountId, OffsetDateTime when) {
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.LAST_SYNCED_AT, when)
        .where(EMAIL_ACCOUNT.ID.eq(accountId))
        .execute();
  }

  /** 현재 테넌트(RLS 컨텍스트)의 활성 계정 목록 — 스케줄러 자동 동기화 대상. */
  @org.springframework.transaction.annotation.Transactional(readOnly = true)
  public List<ActiveAccount> findActiveForSync() {
    return dsl.select(EMAIL_ACCOUNT.ID, EMAIL_ACCOUNT.USER_ID)
        .from(EMAIL_ACCOUNT)
        .where(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .fetch(r -> new ActiveAccount(r.get(EMAIL_ACCOUNT.ID), r.get(EMAIL_ACCOUNT.USER_ID)));
  }

  /** 자동 동기화 대상 계정 식별자. */
  public record ActiveAccount(long accountId, long userId) {}

  /**
   * OAuth 토큰 레코드 — 암호화 상태 그대로 반환한다. 복호화는 GraphTokenService 책임.
   *
   * @param refreshToken 암호화된 refresh_token
   * @param accessToken 암호화된 access_token(없으면 null)
   * @param expiresAt access_token 만료 시각(없으면 null)
   */
  public record OAuthTokens(String refreshToken, String accessToken, OffsetDateTime expiresAt) {}

  /**
   * M365 Graph 계정의 OAuth 토큰을 조회한다(userId 소유 검증 포함).
   *
   * <p>RLS GUC 주입을 위해 반드시 @Transactional 컨텍스트 안에서 호출해야 한다(호출자 GraphTokenService 의 책임).
   *
   * @param userId 계정 소유자
   * @param accountId 메일 계정 ID
   * @return 암호화된 토큰 레코드(없거나 타인 소유이면 empty)
   */
  public Optional<OAuthTokens> findOAuthTokens(long userId, long accountId) {
    return dsl.select(
            EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN,
            EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN,
            EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT)
        .from(EMAIL_ACCOUNT)
        .where(EMAIL_ACCOUNT.ID.eq(accountId))
        .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .fetchOptional(
            r ->
                new OAuthTokens(
                    r.get(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN),
                    r.get(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN),
                    r.get(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT)));
  }

  /**
   * M365 계정의 OAuth 토큰을 갱신·저장한다(AAD refresh_token 회전 대응).
   *
   * <p>반드시 @Transactional 컨텍스트 안에서 호출해야 한다 — RLS GUC 미주입 시 fail-closed(#444/#492 패턴).
   *
   * @param accountId 메일 계정 ID
   * @param encRefresh 암호화된 새 refresh_token
   * @param encAccess 암호화된 새 access_token
   * @param expiresAt 새 access_token 만료 시각
   */
  public void updateOAuthTokens(
      long accountId, String encRefresh, String encAccess, OffsetDateTime expiresAt) {
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encRefresh)
        .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encAccess)
        .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, expiresAt)
        .set(EMAIL_ACCOUNT.UPDATED_AT, OffsetDateTime.now())
        .where(EMAIL_ACCOUNT.ID.eq(accountId))
        .execute();
  }
}
