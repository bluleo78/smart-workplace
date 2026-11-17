package com.workplace.auth.oauth.repository;

import static com.workplace.jooq.Tables.OAUTH_CLIENT;
import static com.workplace.jooq.Tables.OAUTH_CONNECTION;
import static com.workplace.jooq.Tables.TENANT;

import com.workplace.jooq.tables.records.OauthConnectionRecord;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.SelectOnConditionStep;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * oauth_connection 테이블 jOOQ 리포지토리(WP-1685). 연결 = (사용자, 워크스페이스, 클라이언트) 한 벌. 같은 조합의 살아 있는(revoked_at
 * IS NULL) 연결은 부분 unique 인덱스로 하나만 존재한다.
 */
@Repository
@RequiredArgsConstructor
public class OAuthConnectionRepository {

  /** last_used_at 을 다시 쓰는 최소 간격(WP-1685 리뷰 F6) — {@link #touchLastUsed} 의 SQL 조건과 같은 값. */
  public static final Duration LAST_USED_TOUCH_INTERVAL = Duration.ofMinutes(1);

  private final DSLContext dsl;

  /** 연결 한 건. */
  public record ConnectionRow(
      long id,
      long userId,
      long tenantId,
      long clientPk,
      OffsetDateTime createdAt,
      OffsetDateTime lastUsedAt,
      OffsetDateTime revokedAt) {}

  /** findOrCreateActive 결과 — created 는 이번 호출이 새로 만들었는지(감사·알림 분기용). */
  public record Created(ConnectionRow row, boolean created) {}

  /** 「연결된 앱」 목록 한 줄 — 클라이언트·워크스페이스 이름을 조인해 화면이 추가 조회 없이 그린다. */
  public record ListedConnection(
      long id,
      String clientName,
      String clientKind,
      List<String> redirectUris,
      long tenantId,
      String tenantName,
      OffsetDateTime createdAt,
      OffsetDateTime lastUsedAt) {

    /** DCR(앱이 스스로 등록)이라 「확인되지 않은 앱」인지. */
    public boolean unverified() {
      return OAuthClientRepository.KIND_DCR.equals(clientKind);
    }
  }

  private ConnectionRow map(OauthConnectionRecord r) {
    return new ConnectionRow(
        r.getId(),
        r.getUserId(),
        r.getTenantId(),
        r.getClientPk(),
        r.getCreatedAt(),
        r.getLastUsedAt(),
        r.getRevokedAt());
  }

  /**
   * 살아 있는 연결을 찾고 없으면 만든다. 부분 unique 인덱스에 대한 {@code ON CONFLICT DO NOTHING} 으로 동시 요청도 하나로 수렴한다 —
   * 충돌하면 상대 트랜잭션 커밋을 기다린 뒤 0행이 되고, 이어서 살아 있는 행을 읽는다(READ COMMITTED 라 커밋된 행이 보인다).
   */
  public Created findOrCreateActive(long userId, long tenantId, long clientPk) {
    // 충돌한 상대가 그 사이 폐기돼 SELECT 가 비는 극히 드문 경합 — 한 번만 더 시도한다(무한 재귀 방지).
    for (int attempt = 0; attempt < 2; attempt++) {
      OauthConnectionRecord inserted =
          dsl.insertInto(OAUTH_CONNECTION)
              .set(OAUTH_CONNECTION.USER_ID, userId)
              .set(OAUTH_CONNECTION.TENANT_ID, tenantId)
              .set(OAUTH_CONNECTION.CLIENT_PK, clientPk)
              .onConflict(
                  OAUTH_CONNECTION.USER_ID, OAUTH_CONNECTION.TENANT_ID, OAUTH_CONNECTION.CLIENT_PK)
              .where(OAUTH_CONNECTION.REVOKED_AT.isNull())
              .doNothing()
              .returning()
              .fetchOne();
      if (inserted != null) {
        return new Created(map(inserted), true);
      }
      OauthConnectionRecord existing =
          dsl.selectFrom(OAUTH_CONNECTION)
              .where(OAUTH_CONNECTION.USER_ID.eq(userId))
              .and(OAUTH_CONNECTION.TENANT_ID.eq(tenantId))
              .and(OAUTH_CONNECTION.CLIENT_PK.eq(clientPk))
              .and(OAUTH_CONNECTION.REVOKED_AT.isNull())
              .fetchOne();
      if (existing != null) {
        return new Created(map(existing), false);
      }
    }
    throw new IllegalStateException("OAuth 연결을 만들거나 찾지 못했습니다(경합 반복)");
  }

  /**
   * 연결 + 그 클라이언트의 client_id(문자열)·표시 이름 — 토큰 엔드포인트가 요청 client_id 를 대조하고, 감사가 클라이언트 이름을 다시 조회하지 않고 남길
   * 때 쓴다.
   */
  public record ConnectionWithClient(ConnectionRow row, String clientId, String clientName) {}

  /**
   * 연결 단건(폐기된 것도 포함)과 그 클라이언트의 client_id·이름. 토큰 엔드포인트는 client_id 를 문자열로만 대조하고(CIMD 문서를 다시 가져오지
   * 않는다), 끊기·재사용 감지 때는 폐기된 연결이라도 사용자·테넌트를 알아야 감사를 남길 수 있어 revoked_at 으로 거르지 않는다.
   */
  public Optional<ConnectionWithClient> findWithClientId(long id) {
    return selectWithClient().where(OAUTH_CONNECTION.ID.eq(id)).fetchOptional(this::mapWithClient);
  }

  /**
   * {@link #findWithClientId} 와 같되 연결 행을 {@code SELECT … FOR UPDATE} 로 잠근다(WP-1685 리뷰 D5.1). 토큰
   * 발급(code 교환·refresh 회전)과 재사용 처리(연결 토큰 모두 폐기)가 같은 연결에서 동시에 돌면, 폐기 UPDATE 가 아직 커밋되지 않은 발급 토큰을 놓쳐
   * 탈취 의심 뒤에도 새 토큰이 살아남을 수 있다 — 두 쪽 모두 트랜잭션 첫머리에서 이 잠금을 잡아 연결 단위로 줄을 세운다. 잠금은 연결 행에만 건다(클라이언트 행은
   * 잠그지 않는다).
   */
  public Optional<ConnectionWithClient> lockWithClientId(long id) {
    return selectWithClient()
        .where(OAUTH_CONNECTION.ID.eq(id))
        .forUpdate()
        .of(OAUTH_CONNECTION)
        .fetchOptional(this::mapWithClient);
  }

  /**
   * 사용자의 살아 있는 연결을 모두 잠가 읽는다(클라이언트 id·이름 포함) — 비밀번호 변경으로 연결을 한꺼번에 끊을 때(WP-1685 리뷰 F5) 발급 중인 토큰
   * 트랜잭션과 줄을 세우려는 것이다.
   */
  public List<ConnectionWithClient> lockActiveByUser(long userId) {
    return selectWithClient()
        .where(OAUTH_CONNECTION.USER_ID.eq(userId))
        .and(OAUTH_CONNECTION.REVOKED_AT.isNull())
        .orderBy(OAUTH_CONNECTION.ID)
        .forUpdate()
        .of(OAUTH_CONNECTION)
        .fetch(this::mapWithClient);
  }

  /** 연결 + 클라이언트 id·이름 조회의 공통 SELECT … JOIN. */
  private SelectOnConditionStep<Record> selectWithClient() {
    return dsl.select(OAUTH_CONNECTION.asterisk(), OAUTH_CLIENT.CLIENT_ID, OAUTH_CLIENT.CLIENT_NAME)
        .from(OAUTH_CONNECTION)
        .join(OAUTH_CLIENT)
        .on(OAUTH_CLIENT.ID.eq(OAUTH_CONNECTION.CLIENT_PK));
  }

  private ConnectionWithClient mapWithClient(Record r) {
    return new ConnectionWithClient(
        map(r.into(OAUTH_CONNECTION)),
        r.get(OAUTH_CLIENT.CLIENT_ID),
        r.get(OAUTH_CLIENT.CLIENT_NAME));
  }

  /** 내 연결이고 살아 있을 때만 폐기한다. 폐기했으면 true(남의 것·이미 폐기·없음은 false). */
  public boolean revoke(long id, long userId) {
    return dsl.update(OAUTH_CONNECTION)
            .set(OAUTH_CONNECTION.REVOKED_AT, OffsetDateTime.now())
            .where(OAUTH_CONNECTION.ID.eq(id))
            .and(OAUTH_CONNECTION.USER_ID.eq(userId))
            .and(OAUTH_CONNECTION.REVOKED_AT.isNull())
            .execute()
        > 0;
  }

  /**
   * last_used_at 을 갱신할 때가 됐는지 — 기록이 없거나 {@link #LAST_USED_TOUCH_INTERVAL} 보다 오래됐을 때. 호출 측이 이미 읽어 둔
   * 값으로 미리 걸러 갱신이 필요 없는 대부분의 요청에서 UPDATE 왕복을 건너뛴다. 경합(동시 요청)은 {@link #touchLastUsed} 의 SQL 조건이 최종으로
   * 막는다.
   */
  public static boolean isLastUsedTouchDue(OffsetDateTime lastUsedAt, OffsetDateTime now) {
    return lastUsedAt == null || lastUsedAt.isBefore(now.minus(LAST_USED_TOUCH_INTERVAL));
  }

  /**
   * 마지막 사용 시각을 now 로 갱신(인증·토큰 갱신 성공 시). 인증 필터가 요청마다 부르므로 1분에 한 번만 실제로 쓴다(WP-1685 리뷰 F6) — 기록이 없거나
   * 1분보다 오래됐을 때만 UPDATE 가 행을 바꿔, 잦은 요청이 같은 행을 계속 덮어쓰며 잠금·WAL 을 만들지 않게 한다. 「연결된 앱」 화면에 보일 값이라 분 단위
   * 정밀도면 충분하다. 시각은 DB 시계 하나로 비교·기록한다.
   */
  public void touchLastUsed(long id) {
    dsl.update(OAUTH_CONNECTION)
        .set(OAUTH_CONNECTION.LAST_USED_AT, DSL.currentOffsetDateTime())
        .where(OAUTH_CONNECTION.ID.eq(id))
        .and(
            OAUTH_CONNECTION
                .LAST_USED_AT
                .isNull()
                .or(
                    DSL.condition(
                        "{0} < now() - interval '1 minute'", OAUTH_CONNECTION.LAST_USED_AT)))
        .execute();
  }

  /** 사용자의 살아 있는 연결 목록(최근 생성 순) — 클라이언트·워크스페이스 이름 조인. */
  public List<ListedConnection> listActiveByUser(long userId) {
    return dsl.select(
            OAUTH_CONNECTION.ID,
            OAUTH_CLIENT.CLIENT_NAME,
            OAUTH_CLIENT.KIND,
            OAUTH_CLIENT.REDIRECT_URIS,
            OAUTH_CONNECTION.TENANT_ID,
            TENANT.NAME,
            OAUTH_CONNECTION.CREATED_AT,
            OAUTH_CONNECTION.LAST_USED_AT)
        .from(OAUTH_CONNECTION)
        .join(OAUTH_CLIENT)
        .on(OAUTH_CLIENT.ID.eq(OAUTH_CONNECTION.CLIENT_PK))
        .join(TENANT)
        .on(TENANT.ID.eq(OAUTH_CONNECTION.TENANT_ID))
        .where(OAUTH_CONNECTION.USER_ID.eq(userId))
        .and(OAUTH_CONNECTION.REVOKED_AT.isNull())
        .orderBy(OAUTH_CONNECTION.CREATED_AT.desc(), OAUTH_CONNECTION.ID.desc())
        .fetch(
            r ->
                new ListedConnection(
                    r.get(OAUTH_CONNECTION.ID),
                    r.get(OAUTH_CLIENT.CLIENT_NAME),
                    r.get(OAUTH_CLIENT.KIND),
                    List.of(r.get(OAUTH_CLIENT.REDIRECT_URIS)),
                    r.get(OAUTH_CONNECTION.TENANT_ID),
                    r.get(TENANT.NAME),
                    r.get(OAUTH_CONNECTION.CREATED_AT),
                    r.get(OAUTH_CONNECTION.LAST_USED_AT)));
  }
}
