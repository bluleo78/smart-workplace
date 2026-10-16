package com.workplace.tenant;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.TENANT_CANARY;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.security.AgentTenantResolver;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import jakarta.servlet.FilterChain;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.Transactional;

/**
 * #220 헤드라인 "에이전트 격리 검증": AI 에이전트 Internal 콜백이 RLS 로 실제 격리됨을 REAL DATA 로 증명한다.
 *
 * <p>TenantContext 단언만으로는 부족하다(빈 결과가 잘못된 이유로 나와도 통과처럼 보임). 그래서 실제 JwtAuthenticationFilter 빈을
 * MockHttpServletRequest 로 구동해 Internal 토큰+X-On-Behalf-Of 로 active-tenant 를 해석시킨 뒤, 그 해석된 테넌트로 GUC
 * 를 트랜잭션-로컬 설정하고 비특권 app_tenant 커넥션에서 tenant_canary 를 조회해 "내 테넌트 행 present + 타 테넌트 행 excluded" 를
 * 동시에 단언한다. RlsIsolationTest/IssueDomainRlsTest 의 app_tenant + set_config('app.tenant_id', ...,
 * true) 카나리아 패턴을 그대로 미러한다.
 *
 * <p>트랜잭션 미묘함: 각 테스트가 @Transactional 이라 트랜잭션은 필터 실행보다 먼저 시작된다. 따라서 필터 내부의 중첩 @Transactional 조회는 같은
 * 트랜잭션에 합류할 뿐 GUC 가 재주입되지 않는다. 그래서 격리 증명은 "필터가 해석한 테넌트를 캡처한 뒤" 같은 트랜잭션에서 set_config(...,true)
 * (트랜잭션-로컬)로 GUC 를 직접 세팅하고 카나리아를 조회하는 방식으로 한다. 모든 시드 행(tenant/agent user/membership/canary)은 롤백되어
 * 공유 DB 를 오염시키지 않는다.
 */
class AgentCallbackTenantIsolationTest extends IntegrationTestBase {

  /** 운영 application-test.yml 의 workplace.ai-agent.internal-token 값. */
  private static final String INTERNAL_TOKEN = "test-token";

  @Autowired private JwtAuthenticationFilter filter;
  @Autowired private ApiKeyAuthenticationFilter apiKeyFilter;
  @Autowired private AgentApiKeyRepository agentKeys;
  @Autowired private DSLContext dsl;
  @Autowired private MembershipRepository membershipRepository;

  // 이 테스트는 필터의 테넌트 해석("멤버십 없으면 tenant-less" 등)을 밑바닥부터 검증하며
  // TenantContext.get() == null 을 단언한다. IntegrationTestBase 의 기본 테넌트(1) 주입을 opt-out 한다.
  @Override
  protected Long defaultTenantId() {
    return null;
  }

  /** 풀링 스레드로 active-tenant ThreadLocal 이 새지 않도록 매 테스트 후 정리. */
  @AfterEach
  void clearTenant() {
    TenantContext.clear();
    // 필터를 직접 구동하면 인증 컨텍스트가 같은 스레드의 다음 테스트로 샐 수 있다(WP-420 인증 단언 추가).
    SecurityContextHolder.clearContext();
  }

  /** ACTIVE 테넌트 1행 삽입(글로벌/RLS 비대상 테이블 → 직접 insert) 후 생성 id 반환. */
  private Long seedTenant(String label) {
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, "agent-iso-" + label + "-" + System.nanoTime())
        .set(TENANT.NAME, "AGENT-ISO-" + label)
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼(true=transaction-local). */
  private void setGuc(String value) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + value + "', true)");
  }

  /** 해당 테넌트 GUC 하에서 카나리아 행 1건 삽입(RLS WITH CHECK 통과). */
  private void seedCanary(Long tenantId, String val) {
    setGuc(String.valueOf(tenantId));
    dsl.insertInto(TENANT_CANARY)
        .set(TENANT_CANARY.TENANT_ID, tenantId)
        .set(TENANT_CANARY.VAL, val)
        .execute();
  }

  /** Internal 토큰 + X-On-Behalf-Of(+선택적 tenant 헤더)로 필터를 구동, 체인 내부에서 해석된 테넌트를 캡처해 반환. */
  private Long driveFilterAndCaptureTenant(Long agentId, String tenantHeader) throws Exception {
    // 필터의 finally 가 TenantContext.clear() 하므로 doFilter 가 반환된 뒤엔 null 이다 — 체인 람다 안에서 캡처한다. doFilter
    // 는 인증
    // 분기 밖이라 fail-closed(미해석) 케이스에서도 항상 실행되어 null 을 캡처한다.
    return driveFilter(agentId, tenantHeader).tenantId();
  }

  /** 체인 안에서 본 테넌트와 인증(없으면 null). WP-420: 테넌트뿐 아니라 인증이 세워졌는지도 단언한다. */
  private record FilterOutcome(Long tenantId, Authentication authentication) {}

  private FilterOutcome driveFilter(Long agentId, String tenantHeader) throws Exception {
    SecurityContextHolder.clearContext();
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("Authorization", "Internal " + INTERNAL_TOKEN);
    request.addHeader("X-On-Behalf-Of", String.valueOf(agentId));
    if (tenantHeader != null) {
      request.addHeader(AgentTenantResolver.TENANT_HEADER, tenantHeader);
    }
    AtomicReference<FilterOutcome> captured = new AtomicReference<>();
    FilterChain chain =
        (req, res) ->
            captured.set(
                new FilterOutcome(
                    TenantContext.get(), SecurityContextHolder.getContext().getAuthentication()));
    filter.doFilter(request, new MockHttpServletResponse(), chain);
    return captured.get();
  }

  /** 단일 멤버십 에이전트: tenant 헤더 없이 콜백 → 자신의 유일한 멤버십 테넌트로 해석되고, 그 테넌트의 카나리아만 보인다(타 테넌트 행 배제). */
  @Test
  @Transactional
  void agentCallback_singleMembership_seesOnlyOwnTenant() throws Exception {
    Long tenantA = seedTenant("A");
    Long tenantB = seedTenant("B");
    Long agentId = createAgentUser("agent-single");
    membershipRepository.create(agentId, tenantA, "ACTIVE");

    seedCanary(tenantA, "A-row");
    seedCanary(tenantB, "B-row");

    // tenant 헤더 없음 → 단일 멤버십(tenantA) 자동 선택
    Long resolved = driveFilterAndCaptureTenant(agentId, null);
    assertThat(resolved).isEqualTo(tenantA);

    // 해석된 테넌트로 GUC 세팅 후 카나리아 조회 → A-row present AND B-row excluded
    setGuc(String.valueOf(resolved));
    assertThat(dsl.select(TENANT_CANARY.VAL).from(TENANT_CANARY).fetch(TENANT_CANARY.VAL))
        .containsExactly("A-row");
  }

  /**
   * 비멤버 테넌트 위조: tenantA 멤버 에이전트가 X-On-Behalf-Of-Tenant 로 tenantB(비멤버)를 요청 → 해석 실패(null). 권한 테넌트가
   * 없으므로 GUC 를 미설정 상태로 두면 어떤 테넌트 행도 보이지 않는다(fail-closed, 0행).
   */
  @Test
  @Transactional
  void agentCallback_explicitTenant_notMember_failsClosed() throws Exception {
    Long tenantA = seedTenant("A");
    Long tenantB = seedTenant("B");
    Long agentId = createAgentUser("agent-forge");
    membershipRepository.create(agentId, tenantA, "ACTIVE");

    seedCanary(tenantA, "A-row");
    seedCanary(tenantB, "B-row");

    // 비멤버 tenantB 를 명시 → 헤더 불신뢰 → fail-closed(null)
    FilterOutcome outcome = driveFilter(agentId, String.valueOf(tenantB));
    Long resolved = outcome.tenantId();
    assertThat(resolved).isNull();
    // WP-420: 명시한 테넌트를 해석하지 못하면 테넌트 없는 인증으로 넘어가지 않고 인증 자체를 세우지 않는다(→ 401).
    assertThat(outcome.authentication()).isNull();

    // 해석 실패 → 권한 테넌트 없음. GUC 를 빈 문자열(미설정 모델)로 두면 RLS 가 모든 행 차단.
    setGuc("");
    assertThat(dsl.fetchCount(TENANT_CANARY)).isZero();
  }

  /**
   * 다중 멤버십 에이전트: tenantA·tenantB 양쪽 멤버. X-On-Behalf-Of-Tenant 로 tenantB 를 명시 → 멤버십에 있으므로 채택되고,
   * tenantB 의 카나리아만 보인다(tenantA 행 배제).
   */
  @Test
  @Transactional
  void agentCallback_explicitTenant_member_seesThatTenant() throws Exception {
    Long tenantA = seedTenant("A");
    Long tenantB = seedTenant("B");
    Long agentId = createAgentUser("agent-multi");
    membershipRepository.create(agentId, tenantA, "ACTIVE");
    membershipRepository.create(agentId, tenantB, "ACTIVE");

    seedCanary(tenantA, "A-row");
    seedCanary(tenantB, "B-row");

    // 멤버인 tenantB 를 명시 → 채택
    Long resolved = driveFilterAndCaptureTenant(agentId, String.valueOf(tenantB));
    assertThat(resolved).isEqualTo(tenantB);

    setGuc(String.valueOf(resolved));
    assertThat(dsl.select(TENANT_CANARY.VAL).from(TENANT_CANARY).fetch(TENANT_CANARY.VAL))
        .containsExactly("B-row");
  }

  /**
   * WP-420: A 는 ACTIVE, B 는 정지(SUSPENDED)인 사용자가 X-On-Behalf-Of-Tenant 로 B 를 명시 → B 로 해석되지 않고, A 로
   * 갈아타거나 테넌트 없는 인증으로 넘어가지도 않는다 — 인증 자체를 세우지 않는다(401).
   */
  @Test
  @Transactional
  void agentCallback_explicitTenant_suspendedMembership_rejected() throws Exception {
    Long tenantA = seedTenant("A");
    Long tenantB = seedTenant("B");
    Long userId = createAgentUser("agent-suspended");
    membershipRepository.create(userId, tenantA, "ACTIVE");
    membershipRepository.create(userId, tenantB, "SUSPENDED");

    FilterOutcome outcome = driveFilter(userId, String.valueOf(tenantB));

    assertThat(outcome.tenantId()).isNull();
    assertThat(outcome.authentication()).isNull();
  }

  /**
   * WP-420 유지 케이스: 헤더 없이 ACTIVE 멤버십이 0개인 개인 비서 AGENT(처음 만든 테넌트가 정지·삭제됨, V163)는 테넌트 없는 인증으로 남는다 —
   * 주인의 다른 워크스페이스에서 자기 LLM 자격(전역 테이블)을 꺼내야 하기 때문. 단 다른 테넌트에 남은 역할(ADMIN)이 있어도 GUC 가 비어 RLS 가 막으므로
   * 권한은 하나도 붙지 않는다.
   */
  @Test
  @Transactional
  void agentCallback_noActiveMembership_noHeader_tenantlessWithoutAuthorities() throws Exception {
    Long agentId = createAgentUser("agent-orphan");
    // 테넌트 1 멤버십은 정지 상태 — ACTIVE 멤버십 0개. 그 테넌트의 ADMIN 역할은 남아 있다.
    membershipRepository.create(agentId, 1L, "SUSPENDED");
    setGuc("1");
    Long adminRole = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, agentId)
        .set(USER_ROLE.ROLE_ID, adminRole)
        .execute();
    // 운영과 같이 테넌트 없는 요청은 GUC 가 비어 있다(테스트 트랜잭션은 필터의 중첩 트랜잭션이 GUC 를 다시 넣지 않으므로 직접 비운다).
    setGuc("");

    FilterOutcome outcome = driveFilter(agentId, null);

    assertThat(outcome.tenantId()).isNull();
    assertThat(outcome.authentication()).isNotNull();
    assertThat(outcome.authentication().getAuthorities()).isEmpty();
  }

  /** AGENT 에 ak_ 키를 실제로 발급(해시 저장)하고 평문을 돌려준다. */
  private String issueApiKey(Long agentId) throws Exception {
    String key = "ak_wp420" + UUID.randomUUID().toString().replace("-", "");
    String hash =
        HexFormat.of()
            .formatHex(
                MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8)));
    agentKeys.insert(agentId, key.substring(0, 12), hash, "wp420", agentId);
    return key;
  }

  /** 실제 ApiKeyAuthenticationFilter 빈을 ak_ 키(+선택적 테넌트 헤더)로 구동해 체인 안의 테넌트·인증을 캡처한다. */
  private FilterOutcome driveApiKeyFilter(String key, String tenantHeader) throws Exception {
    SecurityContextHolder.clearContext();
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("Authorization", "Bearer " + key);
    if (tenantHeader != null) {
      request.addHeader(AgentTenantResolver.TENANT_HEADER, tenantHeader);
    }
    AtomicReference<FilterOutcome> captured = new AtomicReference<>();
    FilterChain chain =
        (req, res) ->
            captured.set(
                new FilterOutcome(
                    TenantContext.get(), SecurityContextHolder.getContext().getAuthentication()));
    apiKeyFilter.doFilter(request, new MockHttpServletResponse(), chain);
    return captured.get();
  }

  /**
   * WP-420: ak_ 키 경로도 Internal 과 같다 — A ACTIVE·B SUSPENDED 인 AGENT 가 헤더로 B 를 명시하면 테넌트 없는 인증으로 넘어가지
   * 않고 인증을 세우지 않는다(401). 대조로 같은 키가 A 를 명시하면 정상 인증된다.
   */
  @Test
  @Transactional
  void apiKey_explicitTenant_suspendedMembership_rejected() throws Exception {
    Long tenantA = seedTenant("A");
    Long tenantB = seedTenant("B");
    Long agentId = createAgentUser("agent-ak-suspended");
    membershipRepository.create(agentId, tenantA, "ACTIVE");
    membershipRepository.create(agentId, tenantB, "SUSPENDED");
    String key = issueApiKey(agentId);

    FilterOutcome rejected = driveApiKeyFilter(key, String.valueOf(tenantB));
    assertThat(rejected.tenantId()).isNull();
    assertThat(rejected.authentication()).isNull();

    FilterOutcome accepted = driveApiKeyFilter(key, String.valueOf(tenantA));
    assertThat(accepted.tenantId()).isEqualTo(tenantA);
    assertThat(accepted.authentication()).isNotNull();
  }

  /** WP-420 유지 케이스(ak_): 헤더 없이 다중 ACTIVE 멤버십이면 기존대로 테넌트 없는 인증(ROLE_AGENT 마커 외 권한 없음)으로 둔다. */
  @Test
  @Transactional
  void apiKey_noHeader_multipleMemberships_staysTenantless() throws Exception {
    Long tenantA = seedTenant("A");
    Long tenantB = seedTenant("B");
    Long agentId = createAgentUser("agent-ak-multi");
    membershipRepository.create(agentId, tenantA, "ACTIVE");
    membershipRepository.create(agentId, tenantB, "ACTIVE");
    String key = issueApiKey(agentId);
    setGuc("");

    FilterOutcome outcome = driveApiKeyFilter(key, null);

    assertThat(outcome.tenantId()).isNull();
    assertThat(outcome.authentication()).isNotNull();
    assertThat(outcome.authentication().getAuthorities())
        .extracting(Object::toString)
        .containsExactly("ROLE_AGENT");
  }
}
