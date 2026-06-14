package com.workplace.platform;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.platform.dto.CreateTenantRequest;
import com.workplace.platform.dto.TenantDetailResponse;
import com.workplace.platform.dto.TenantMemberResponse;
import com.workplace.platform.dto.TenantSummaryResponse;
import com.workplace.platform.exception.PlatformTenantNotFoundException;
import com.workplace.platform.service.PlatformTenantService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 운영자 콘솔 테넌트 서비스 통합 테스트.
 *
 * <p>⚠️ 클래스 레벨 {@code @Transactional} 필수: createTenantWithOwner 가 자체 트랜잭션(별도 빈)을 가지므로, 테스트 트랜잭션이
 * 없으면 공유 test DB(5435)에 tenant/membership 행이 실제 커밋되어 #95 드리프트/오염 flake 를 유발한다. 테스트 트랜잭션이 있으면
 * REQUIRED 전파로 repo 메서드가 합류해 롤백된다(Task 5 는 cross-connection 가시성을 검증하지 않는다 — 그건 Task 6).
 */
@Transactional
class PlatformTenantServiceTest extends IntegrationTestBase {

  @Autowired PlatformTenantService service;
  @Autowired DSLContext dsl;

  /** HUMAN 사용자 시드 — ownerUserId 용 실제 유저. id 반환. */
  private long createHumanUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  private String uniqueSlug() {
    return "t-" + UUID.randomUUID().toString().substring(0, 8);
  }

  @Test
  void createTenant_createsActiveTenantWithOwnerMembership() {
    long owner = createHumanUser("owner");
    TenantDetailResponse detail =
        service.createTenant(new CreateTenantRequest("Acme", uniqueSlug(), owner));

    assertThat(detail.name()).isEqualTo("Acme");
    assertThat(detail.status()).isEqualTo("ACTIVE");
    assertThat(detail.memberCount()).isEqualTo(1L);

    // OWNER 멤버십이 실제로 부여됐는지 확인.
    List<TenantMemberResponse> members = service.getMembers(detail.id());
    assertThat(members).hasSize(1);
    assertThat(members.get(0).userId()).isEqualTo(owner);
    assertThat(members.get(0).role()).isEqualTo("OWNER");
  }

  @Test
  void createTenant_nonexistentOwner_throws() {
    assertThatThrownBy(
            () -> service.createTenant(new CreateTenantRequest("X", uniqueSlug(), 9_999_999L)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void createTenant_duplicateSlug_throws() {
    long owner = createHumanUser("owner");
    String slug = uniqueSlug();
    service.createTenant(new CreateTenantRequest("First", slug, owner));

    assertThatThrownBy(() -> service.createTenant(new CreateTenantRequest("Second", slug, owner)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void listTenants_includesCreatedTenantWithMemberCount() {
    long owner = createHumanUser("owner");
    TenantDetailResponse detail =
        service.createTenant(new CreateTenantRequest("Listed", uniqueSlug(), owner));

    List<TenantSummaryResponse> all = service.listTenants();
    TenantSummaryResponse found =
        all.stream().filter(t -> t.id().equals(detail.id())).findFirst().orElseThrow();
    assertThat(found.memberCount()).isEqualTo(1L);
    assertThat(found.name()).isEqualTo("Listed");
  }

  @Test
  void suspendThenActivate_togglesStatus() {
    long owner = createHumanUser("owner");
    TenantDetailResponse detail =
        service.createTenant(new CreateTenantRequest("Toggle", uniqueSlug(), owner));

    service.suspend(detail.id());
    assertThat(service.getTenant(detail.id()).status()).isEqualTo("SUSPENDED");

    service.activate(detail.id());
    assertThat(service.getTenant(detail.id()).status()).isEqualTo("ACTIVE");
  }

  @Test
  void findMembers_returnsOwnerWithEmailAndRole() {
    long owner = createHumanUser("owner");
    TenantDetailResponse detail =
        service.createTenant(new CreateTenantRequest("Members", uniqueSlug(), owner));

    List<TenantMemberResponse> members = service.getMembers(detail.id());
    assertThat(members).hasSize(1);
    TenantMemberResponse m = members.get(0);
    assertThat(m.role()).isEqualTo("OWNER");
    assertThat(m.email()).isNotBlank();
    assertThat(m.status()).isEqualTo("ACTIVE");
  }

  @Test
  void getTenant_unknownId_throwsNotFound() {
    assertThatThrownBy(() -> service.getTenant(9_999_999L))
        .isInstanceOf(PlatformTenantNotFoundException.class);
  }

  @Test
  void suspend_unknownId_throwsNotFound() {
    assertThatThrownBy(() -> service.suspend(9_999_999L))
        .isInstanceOf(PlatformTenantNotFoundException.class);
  }
}
