package com.workplace.auth.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.permission.repository.PermissionRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.tenant.repository.MembershipRepository;
import java.util.Set;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class PersonalAssistantServiceTest extends IntegrationTestBase {

  // V44 가 시드하는 기본 테넌트(id=1, ACTIVE). 개인비서 생성은 active 테넌트 컨텍스트를 요구한다.
  private static final Long TENANT_ID = 1L;

  @Autowired PersonalAssistantService service;
  @Autowired PersonalAssistantRepository personalRepo;
  @Autowired AiAgentCredentialRepository credentialRepo;
  @Autowired MembershipRepository membershipRepository;
  @Autowired PermissionRepository permissionRepository;
  @Autowired DSLContext dsl;

  private static final String TOKEN = "sk-ant-oat-" + "x".repeat(40);

  @BeforeEach
  void setTenant() {
    // 개인비서 등록은 인증된 본인 요청이라 active 테넌트가 항상 존재한다 — 테스트에서도 시뮬레이트.
    TenantContext.set(TENANT_ID);
  }

  @AfterEach
  void clearTenant() {
    // ThreadLocal 누수 방지 — 공유 스레드에 테넌트가 남으면 후속 테스트 클래스에 오염된다.
    TenantContext.clear();
  }

  @Test
  void 최초_토큰등록시_개인AGENT_자동생성_그리고_상태조회() {
    long human = TestFixtures.createHuman(dsl);
    service.registerToken(human, TOKEN, "내 토큰");

    Long agentId = personalRepo.findAgentId(human).orElseThrow();
    assertThat(credentialRepo.findActive(agentId)).isPresent();

    var status = service.getStatus(human);
    assertThat(status.configured()).isTrue();
    assertThat(status.model()).isEqualTo(AssistantDefaults.MODEL); // config 없음 → 디폴트 표시
  }

  @Test
  void 최초_개인비서_생성시_현재테넌트_멤버십_프로비저닝() {
    // 신규 개인비서(이전 FK 없음·결정적 username 미존재)는 현재 active 테넌트에 단일 멤버십을 갖는다 — 콜백 RLS 해석용.
    long human = TestFixtures.createHuman(dsl);
    service.registerToken(human, TOKEN, "내 토큰");

    long agentId = personalRepo.findAgentId(human).orElseThrow();
    assertThat(membershipRepository.hasActiveMembership(agentId, TENANT_ID)).isTrue();
  }

  @Test
  void 개인비서_생성시_AGENT_역할_자동부여하여_이슈챗_핵심권한_보유() {
    // #278: 개인 비서는 생성 시 기본 AGENT 역할을 받아, on-behalf 호출이 project:read·issue:write 게이트를 통과해야 한다.
    long human = TestFixtures.createHuman(dsl);
    service.registerToken(human, TOKEN, "t");
    long agentId = personalRepo.findAgentId(human).orElseThrow();

    // TenantContext=1 인 @Transactional 테스트라 GUC=1 → 에이전트의 user_role(tenant1)이 보인다.
    Set<String> codes = permissionRepository.findPermissionCodesByUserId(agentId);
    assertThat(codes).contains("project:read", "issue:write");
    // 파괴적 관리 권한은 제외(최소권한): 프로젝트 삭제·멤버관리·스키마변경.
    assertThat(codes).doesNotContain("project:manage");
  }

  @Test
  void 설정변경_후_상태에_반영() {
    long human = TestFixtures.createHuman(dsl);
    service.registerToken(human, TOKEN, "t");
    service.updateSettings(human, "claude-opus-4-8", "DEEP");

    var status = service.getStatus(human);
    assertThat(status.model()).isEqualTo("claude-opus-4-8");
    assertThat(status.thinkingDepth()).isEqualTo("DEEP");
  }

  @Test
  void 해제하면_토큰revoke_그리고_FK_null() {
    long human = TestFixtures.createHuman(dsl);
    service.registerToken(human, TOKEN, "t");
    Long agentId = personalRepo.findAgentId(human).orElseThrow();

    service.disable(human);

    assertThat(personalRepo.findAgentId(human)).isEmpty();
    assertThat(credentialRepo.findActive(agentId)).isEmpty();
  }

  @Test
  void 미설정이면_configured_false() {
    long human = TestFixtures.createHuman(dsl);
    assertThat(service.getStatus(human).configured()).isFalse();
  }

  @Test
  void 이름변경_후_상태에_반영_그리고_기본이름_프리필() {
    long human = TestFixtures.createHuman(dsl);
    service.registerToken(human, TOKEN, "t");
    // 프로비저닝 직후 기본 이름은 "개인 비서" — 프로필 프리필용으로 status.name 에 노출된다.
    assertThat(service.getStatus(human).name()).isEqualTo("개인 비서");

    service.updateName(human, "나만의 비서");

    assertThat(service.getStatus(human).name()).isEqualTo("나만의 비서");
  }

  @Test
  void 미설정이면_이름변경_예외() {
    long human = TestFixtures.createHuman(dsl);
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.updateName(human, "x"))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void 해제후_재등록하면_기존_개인AGENT_재사용_그리고_unique충돌_없음() {
    // disable 은 FK 를 NULL 로 비우되 개인 AGENT row(결정적 username)는 보존한다.
    // 재등록 시 그 row 를 재사용해야 username unique 충돌(500) 없이 동작한다.
    long human = TestFixtures.createHuman(dsl);
    service.registerToken(human, TOKEN, "t1");
    long first = personalRepo.findAgentId(human).orElseThrow();

    service.disable(human);
    assertThat(personalRepo.findAgentId(human)).isEmpty();

    service.registerToken(human, TOKEN, "t2"); // 여기서 새 AGENT 를 INSERT 하면 username 충돌
    long second = personalRepo.findAgentId(human).orElseThrow();

    assertThat(second).isEqualTo(first); // 동일 AGENT 재사용
    assertThat(credentialRepo.findActive(second)).isPresent();
  }
}
