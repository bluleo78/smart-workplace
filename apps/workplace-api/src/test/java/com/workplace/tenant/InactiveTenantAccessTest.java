package com.workplace.tenant;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantStatusChecker;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 비활성(정지·삭제·영구 삭제 중) 테넌트는 이미 발급된 액세스 토큰으로도 즉시 접근이 막혀야 한다(WP-341).
 *
 * <p>JWT 는 인증을 세우지 않아 401, collab 내부 저장은 "없음"과 같은 404. 클래스 레벨 {@code @Transactional} 이라 테스트에서 바꾼
 * 테넌트 상태·시드는 롤백되고, MockMvc 요청(같은 스레드)도 이 트랜잭션에 합류해 미커밋 상태를 본다. 테스트 프로파일의 캐시 TTL 은 0 이지만 운영과 같은
 * 순서(상태 변경 → invalidate)를 그대로 밟는다.
 */
@Transactional
class InactiveTenantAccessTest extends IntegrationTestBase {
  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired TenantStatusChecker checker;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;

  /** 기존 토큰: ACTIVE 에서 200 이던 /me 가 테넌트가 비활성으로 바뀐 직후 같은 토큰으로 401 이 된다. */
  @ParameterizedTest
  @ValueSource(strings = {"SUSPENDED", "DELETED", "PURGING"})
  void existingToken_rejected_afterTenantDeactivated(String status) throws Exception {
    // 새 테넌트 + 사람 + ACTIVE 멤버십 시드 후, AuthService 와 같은 방식으로 tenant 클레임 토큰을 발급한다.
    long tenantId =
        dsl.insertInto(TENANT)
            .set(TENANT.SLUG, "inactive-access-" + System.nanoTime())
            .set(TENANT.NAME, "비활성 접근 테스트")
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();
    long userId = TestFixtures.createHuman(dsl);
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userId)
        .set(MEMBERSHIP.TENANT_ID, tenantId)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    String token = jwt.generateAccessToken(userId, "human-" + userId, tenantId);

    // 1) ACTIVE — 정상 인증
    mvc.perform(get("/api/v1/auth/me").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk());

    // 2) 운영자 전환과 같은 순서: 상태 변경 → 캐시 무효화
    dsl.update(TENANT).set(TENANT.STATUS, status).where(TENANT.ID.eq(tenantId)).execute();
    checker.invalidate(tenantId);

    // 3) 같은(아직 만료되지 않은) 토큰 → 인증이 세워지지 않아 401
    mvc.perform(get("/api/v1/auth/me").header("Authorization", "Bearer " + token))
        .andExpect(status().isUnauthorized());
  }

  /** collab 내부 저장: 삭제된 테넌트의 X-Tenant-Id 로는 실제 페이지라도 "없음"(404)으로 거부한다. */
  @Test
  void collabStore_rejected_forDeletedTenant() throws Exception {
    // 테넌트 1 에 실제 페이지를 만든다(ACTIVE 일 때 로드가 200 이어야 거부가 의미 있다).
    long userId = withMembership(TestFixtures.createHuman(dsl));
    long spaceId = spaceService.ensurePersonalSpace(userId).id();
    var created = pageService.create(userId, spaceId, new CreatePageRequest(null, "페이지"));
    pageService.save(
        userId, created.id(), new SavePageRequest(null, "본문", created.version(), false));
    long pageId = created.id();

    mvc.perform(
            get("/internal/wiki/pages/{id}/doc", pageId)
                .header("Authorization", "Internal test-token")
                .header("X-Tenant-Id", "1"))
        .andExpect(status().isOk());

    // 테넌트 1 을 삭제 상태로(테스트 트랜잭션 롤백으로 원복)
    dsl.update(TENANT).set(TENANT.STATUS, "DELETED").where(TENANT.ID.eq(1L)).execute();
    checker.invalidate(1L);

    mvc.perform(
            put("/internal/wiki/pages/{id}/doc", pageId)
                .header("Authorization", "Internal test-token")
                .header("X-Tenant-Id", "1")
                .contentType(APPLICATION_JSON)
                .content("{\"state\":\"AQ==\",\"body\":\"x\",\"editorIds\":[]}"))
        .andExpect(status().isNotFound());
  }
}
