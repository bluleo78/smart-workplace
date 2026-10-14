package com.workplace.home.controller;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.HOME_SESSION;
import static com.workplace.jooq.Tables.TENANT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.fileai.outbound.WorkerRenderClient.RenderResult;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.HomeAttachmentTestSupport;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-250 트랜잭션 원칙(R5) 종단 회귀 — 세션 기본 테넌트(1)가 아닌 <b>테넌트 #2</b> 에 시드해 {@code /view} 를 호출한다.
 *
 * <p>테스트 프로필은 풀 커넥션의 세션 GUC 를 tenant 1 로 박아 두므로 tenant 1 시드로는 "트랜잭션 밖 쿼리" 실수가 가려진다. tenant 2 에서는
 * RLS GUC 가 트랜잭션 시작 때 {@code TenantAwareTransactionManager} 가 주입한 값(2)으로만 보이므로, 도메인 가드(readOnly
 * 트랜잭션)·파일 행 읽기·page_count 쓰기 중 어느 하나라도 트랜잭션 밖이거나 읽기 전용 안에서 쓰면 여기서 실패한다.
 */
class HomeAttachmentViewTenantTest extends HomeAttachmentTestSupport {

  private static final String FIXTURE_TENANT_SLUG = "rls-guard-fixture-tenant";
  private static final byte[] VIEW_PNG = {(byte) 0x89, 'P', 'N', 'G', 9, 9, 9};
  private static final String VIEW = "/api/v1/home/sessions/{sid}/attachments/{fileId}/view";

  private Long tid2;

  /** tenant 2 에서 만든 파일·세션을 지운다(스코프 테이블은 RLS 라 GUC=2 에서만 보인다). 사용자는 상위 정리가 지운다. */
  @AfterEach
  void cleanupTenant2() {
    if (tid2 == null || users.isEmpty()) return;
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            st -> {
              dsl.execute("SELECT set_config('app.tenant_id', '" + tid2 + "', true)");
              dsl.deleteFrom(FILE).where(FILE.UPLOADED_BY.in(users)).execute();
              dsl.deleteFrom(HOME_SESSION).where(HOME_SESSION.USER_ID.in(users)).execute();
            });
  }

  /** 고정 슬러그 fixture 테넌트(app_tenant 는 tenant DELETE 불가 — 1행 재사용). */
  private long ensureFixtureTenant() {
    Long existing =
        dsl.select(TENANT.ID)
            .from(TENANT)
            .where(TENANT.SLUG.eq(FIXTURE_TENANT_SLUG))
            .fetchOne(TENANT.ID);
    if (existing != null) return existing;
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, FIXTURE_TENANT_SLUG)
        .set(TENANT.NAME, "RLS Guard Fixture Tenant")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  private MockHttpServletRequestBuilder asTenant2(long uid, MockHttpServletRequestBuilder req) {
    return req.header(
        "Authorization", "Bearer " + jwtTokenProvider.generateAccessToken(uid, "u" + uid, tid2));
  }

  /** tenant 2 의 file_extraction.page_count 를 자기 트랜잭션(GUC=2)으로 읽는다. */
  private Integer pageCountOf(long fileId) {
    return new TransactionTemplate(txManager)
        .execute(
            st -> {
              dsl.execute("SELECT set_config('app.tenant_id', '" + tid2 + "', true)");
              return dsl.select(FILE_EXTRACTION.PAGE_COUNT)
                  .from(FILE_EXTRACTION)
                  .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                  .fetchOne(FILE_EXTRACTION.PAGE_COUNT);
            });
  }

  @Test
  void tenant2_에서도_view_가_200_이고_page_count_를_지연_채움한다() throws Exception {
    tid2 = ensureFixtureTenant();
    long uid = user();
    TenantContext.set(tid2);
    UUID sid = sessionService.create(uid).id();
    long pdf = upload(uid, "t2.pdf", "application/pdf", "%PDF".getBytes());
    attachmentService.appendUserMessage(uid, sid, "q", List.of(pdf));
    assertThat(pageCountOf(pdf)).as("추출이 쪽수를 아직 못 채운 상태").isNull();
    when(worker.render(anyString(), eq("application/pdf"), eq(1), anyInt()))
        .thenReturn(new RenderResult(VIEW_PNG, "image/png", 4));

    http(asTenant2(uid, get(VIEW, sid, pdf).param("page", "1")))
        .andExpect(status().isOk())
        .andExpect(header().string("X-Page-Count", "4"));

    // 읽기 전용 트랜잭션 안이거나 GUC 없이 쓰면 0행 갱신으로 null 이 남는다.
    assertThat(pageCountOf(pdf)).isEqualTo(4);
  }

  @Test
  void tenant2_에서_남의_세션은_404_이고_워커를_부르지_않는다() throws Exception {
    tid2 = ensureFixtureTenant();
    long uid = user();
    long stranger = user();
    TenantContext.set(tid2);
    UUID sid = sessionService.create(uid).id();
    long pdf = upload(uid, "t2.pdf", "application/pdf", "%PDF".getBytes());
    attachmentService.appendUserMessage(uid, sid, "q", List.of(pdf));

    http(asTenant2(stranger, get(VIEW, sid, pdf).param("page", "1")))
        .andExpect(status().isNotFound());
    verifyNoInteractions(worker);
  }
}
