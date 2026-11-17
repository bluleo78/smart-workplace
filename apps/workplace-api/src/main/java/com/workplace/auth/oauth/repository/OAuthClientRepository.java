package com.workplace.auth.oauth.repository;

import static com.workplace.jooq.Tables.OAUTH_CLIENT;
import static com.workplace.jooq.Tables.OAUTH_CONNECTION;

import com.workplace.jooq.tables.records.OauthClientRecord;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * oauth_client 테이블 jOOQ 리포지토리(WP-1685). 클라이언트 등록부 — CIMD(메타데이터 문서 URL) 캐시와 DCR(동적 등록) 행을 한 표에 둔다.
 * 비-RLS 글로벌 테이블이라 테넌트 GUC 없이 조회된다.
 */
@Repository
@RequiredArgsConstructor
public class OAuthClientRepository {

  /** kind — 동적 등록(RFC 7591) 행. 앱이 스스로 등록해 동의 화면에 「확인되지 않은 앱」으로 보인다. */
  public static final String KIND_DCR = "DCR";

  /** kind — CIMD(클라이언트 ID 메타데이터 문서 URL) 캐시 행. */
  public static final String KIND_CIMD = "CIMD";

  private final DSLContext dsl;

  /**
   * 클라이언트 한 건(조회 결과). redirectUris 는 등록된 순서를 유지한다. logoUri 는 지금 읽는 곳이 없지만 동의 화면(WP-1686)이 앱 로고로 보여
   * 줄 값이라 저장·조회한다.
   */
  public record ClientRow(
      long id,
      String clientId,
      String kind,
      String clientName,
      List<String> redirectUris,
      String logoUri,
      String clientUri,
      OffsetDateTime fetchedAt,
      OffsetDateTime createdAt) {}

  /** jOOQ 레코드 → ClientRow. text[] 는 String[] 로 오므로 불변 List 로 감싼다. */
  private ClientRow map(OauthClientRecord r) {
    return new ClientRow(
        r.getId(),
        r.getClientId(),
        r.getKind(),
        r.getClientName(),
        List.of(r.getRedirectUris()),
        r.getLogoUri(),
        r.getClientUri(),
        r.getFetchedAt(),
        r.getCreatedAt());
  }

  /** client_id(CIMD 는 문서 URL, DCR 은 swc_…)로 조회. */
  public Optional<ClientRow> findByClientId(String clientId) {
    return dsl.selectFrom(OAUTH_CLIENT)
        .where(OAUTH_CLIENT.CLIENT_ID.eq(clientId))
        .fetchOptional(this::map);
  }

  /** DCR(RFC 7591) 등록 — 새 행을 넣고 반환한다. client_id 는 호출 측이 발급한다(swc_ 접두사). */
  public ClientRow insertDcr(String clientId, String clientName, List<String> redirectUris) {
    return map(
        dsl.insertInto(OAUTH_CLIENT)
            .set(OAUTH_CLIENT.CLIENT_ID, clientId)
            .set(OAUTH_CLIENT.KIND, KIND_DCR)
            .set(OAUTH_CLIENT.CLIENT_NAME, clientName)
            .set(OAUTH_CLIENT.REDIRECT_URIS, redirectUris.toArray(String[]::new))
            .returning()
            .fetchOne());
  }

  /**
   * CIMD 캐시 저장 — 같은 client_id 가 있으면 메타데이터와 fetched_at 을 갱신한다(동시 첫 조회가 겹쳐도 한 행으로 수렴). 문서에서 사라진
   * logo/client_uri 는 null 로 덮어써 오래된 값이 남지 않게 한다. id·created_at 은 유지된다.
   */
  public ClientRow upsertCimd(
      String clientId,
      String clientName,
      List<String> redirectUris,
      String logoUri,
      String clientUri,
      OffsetDateTime fetchedAt) {
    String[] uris = redirectUris.toArray(String[]::new);
    return map(
        dsl.insertInto(OAUTH_CLIENT)
            .set(OAUTH_CLIENT.CLIENT_ID, clientId)
            .set(OAUTH_CLIENT.KIND, KIND_CIMD)
            .set(OAUTH_CLIENT.CLIENT_NAME, clientName)
            .set(OAUTH_CLIENT.REDIRECT_URIS, uris)
            .set(OAUTH_CLIENT.LOGO_URI, logoUri)
            .set(OAUTH_CLIENT.CLIENT_URI, clientUri)
            .set(OAUTH_CLIENT.FETCHED_AT, fetchedAt)
            .onConflict(OAUTH_CLIENT.CLIENT_ID)
            .doUpdate()
            .set(OAUTH_CLIENT.CLIENT_NAME, clientName)
            .set(OAUTH_CLIENT.REDIRECT_URIS, uris)
            .set(OAUTH_CLIENT.LOGO_URI, logoUri)
            .set(OAUTH_CLIENT.CLIENT_URI, clientUri)
            .set(OAUTH_CLIENT.FETCHED_AT, fetchedAt)
            .returning()
            .fetchOne());
  }

  /**
   * 한 번도 연결되지 않은 DCR 행 중 {@code cutoff} 이전에 만든 것을 지운다 — 공개 등록 엔드포인트로 쌓이는 쓰레기 행 정리용. 연결이 하나라도
   * 있으면(폐기된 것 포함) 남긴다. CIMD 는 캐시라 대상이 아니다. 반환은 지운 행 수.
   */
  public int deleteUnusedDcrOlderThan(OffsetDateTime cutoff) {
    return dsl.deleteFrom(OAUTH_CLIENT)
        .where(OAUTH_CLIENT.KIND.eq(KIND_DCR))
        .and(OAUTH_CLIENT.CREATED_AT.lt(cutoff))
        .andNotExists(
            dsl.selectOne()
                .from(OAUTH_CONNECTION)
                .where(OAUTH_CONNECTION.CLIENT_PK.eq(OAUTH_CLIENT.ID)))
        .execute();
  }
}
