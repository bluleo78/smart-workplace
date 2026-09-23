package com.workplace.home.service;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.HOME_SESSION;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PERMISSION;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.ROLE_PERMISSION;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.dto.HomeProposalOutcome;
import com.workplace.home.dto.HomeProposalResponse;
import com.workplace.home.exception.HomeProposalAlreadyResolvedException;
import com.workplace.home.exception.HomeProposalNotFoundException;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * 홈 AI 채팅 확인카드 영속·승인·거부 통합 테스트(#843).
 *
 * <p>무엇을·왜: 승인 결과(성공·실패·거절)가 제안 행과 대화 이력(ACTION_*)에 남아야 다음 턴 AI 가 알 수 있다. 특히 실패 경로는 실행 트랜잭션이 롤백된 뒤
 * 별도 트랜잭션에서 기록되므로, 테스트 트랜잭션에 감싸면(합류) 그 경계를 검증할 수 없다 — 픽스처를 커밋하고 주변 트랜잭션 없이 호출한다. 세션 디폴트 GUC(=1)와 다른
 * 테넌트에서 돌려, 기록 트랜잭션이 GUC 를 제대로 주입받는지(비-트랜잭션 쓰기 = RLS 거부)도 함께 고정한다.
 */
class HomeProposalServiceTest extends IntegrationTestBase {

  /** 다른 가드 테스트와 겹치지 않는 고정 슬러그(프로세스 병렬 실행). */
  private static final String FIXTURE_TENANT_SLUG = "rls-guard-home-proposal-tenant";

  @Autowired private DSLContext dsl;
  @Autowired private ObjectMapper om;
  @Autowired private HomeProposalService proposalService;
  @Autowired private HomeSessionService sessionService;
  @Autowired private ProjectService projectService;

  private Long tid2;
  private Long roleId;
  private final List<Long> userIds = new ArrayList<>();
  private long owner;
  private UUID sid;

  @BeforeEach
  void setUp() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              tid2 = ensureFixtureTenant();
              setGuc(tid2);
              roleId =
                  dsl.insertInto(ROLE)
                      .set(ROLE.NAME, "hp-role-" + UUID.randomUUID().toString().substring(0, 8))
                      .returning(ROLE.ID)
                      .fetchOne()
                      .getId();
              for (String code : new String[] {"calendar:read", "calendar:write"}) {
                Long permId =
                    dsl.select(PERMISSION.ID)
                        .from(PERMISSION)
                        .where(PERMISSION.CODE.eq(code))
                        .fetchOne(PERMISSION.ID);
                dsl.insertInto(ROLE_PERMISSION)
                    .set(ROLE_PERMISSION.ROLE_ID, roleId)
                    .set(ROLE_PERMISSION.PERMISSION_ID, permId)
                    .execute();
              }
              return null;
            });
    owner = seedUser();
    // 승인은 컨트롤러(요청 스레드)에서만 호출된다 — 실패 사유 산출(ApiErrorDescriber)이 요청 컨텍스트를 요구하므로 흉내 낸다.
    RequestContextHolder.setRequestAttributes(
        new ServletRequestAttributes(new MockHttpServletRequest()));
    TenantContext.set(tid2);
    sid = sessionService.create(owner).id();
  }

  @Test
  @DisplayName("승인 성공 — DONE 으로 전이하고 '승인 완료' 결과를 대화 이력에 남긴다")
  void confirm_success_recordsDoneAndHistory() throws Exception {
    HomeProposalResponse p = record("calendar.create_event", "내일 10시 회의", createEventParams());

    HomeProposalOutcome out = proposalService.confirm(owner, p.id());

    assertThat(out.proposal().status()).isEqualTo("DONE");
    assertThat(out.message().role()).isEqualTo("ACTION_DONE");
    // 후속 요청("방금 만든 일정 옮겨줘")을 위해 생성된 일정 id 가 결과에 실린다.
    assertThat(out.message().content()).startsWith("승인 완료: 내일 10시 회의 (id: ");
    assertThat(countEvents()).isEqualTo(1);
    assertThat(history()).extracting(HomeMessageResponse::role).containsExactly("ACTION_DONE");
    assertThat(proposalService.listPending(owner, sid)).isEmpty();
  }

  @Test
  @DisplayName("이슈 승인 성공 — 결과에 내부 숫자 id 가 아니라 이슈 키(ABC-1)를 남긴다(AI 이슈 도구는 키 기준)")
  void confirm_issue_recordsIssueKey() throws Exception {
    String key = "HP" + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 4);
    projectService.create(owner, new CreateProjectRequest(key, "확인카드 이슈", null));
    HomeProposalResponse p =
        record(
            "issue.create",
            "로그인 버그 이슈",
            om.readTree("{\"projectKey\":\"" + key + "\",\"title\":\"로그인 버그\"}"));

    HomeProposalOutcome out = proposalService.confirm(owner, p.id());

    assertThat(out.proposal().status()).isEqualTo("DONE");
    assertThat(out.message().content()).isEqualTo("승인 완료: 로그인 버그 이슈 (key: " + key + "-1)");
  }

  @Test
  @DisplayName("승인 실패 — 실행은 롤백되고 FAILED + 사유가 제안 행과 대화 이력에 남는다(200 결과)")
  void confirm_domainFailure_recordsFailedWithReason() throws Exception {
    HomeProposalResponse p =
        record("calendar.delete_event", "회의 삭제", om.readTree("{\"id\":987654321}"));

    HomeProposalOutcome out = proposalService.confirm(owner, p.id());

    assertThat(out.proposal().status()).isEqualTo("FAILED");
    assertThat(out.proposal().errorMessage()).isNotBlank();
    assertThat(out.message().role()).isEqualTo("ACTION_FAILED");
    assertThat(out.message().content())
        .isEqualTo("승인 실패: 회의 삭제 — 사유: " + out.proposal().errorMessage());
    assertThat(history()).extracting(HomeMessageResponse::role).containsExactly("ACTION_FAILED");
  }

  @Test
  @DisplayName("파라미터 해석 실패도 영문 원문이 아닌 한국어 사유로 기록된다")
  void confirm_badParams_recordsKoreanReason() throws Exception {
    HomeProposalResponse p =
        record(
            "calendar.delete_event",
            "반복 일정 삭제",
            om.readTree("{\"id\":1,\"scope\":\"EVERYTHING\"}"));

    HomeProposalOutcome out = proposalService.confirm(owner, p.id());

    assertThat(out.proposal().status()).isEqualTo("FAILED");
    assertThat(out.proposal().errorMessage()).startsWith("scope 는 ").doesNotContain("No enum");
  }

  @Test
  @DisplayName("이미 처리된 카드를 다시 승인하면 409 이고 이력에 아무것도 추가되지 않는다")
  void confirm_twice_conflictsWithoutExtraHistory() throws Exception {
    HomeProposalResponse p = record("calendar.create_event", "회의", createEventParams());
    proposalService.confirm(owner, p.id());

    assertThatThrownBy(() -> proposalService.confirm(owner, p.id()))
        .isInstanceOf(HomeProposalAlreadyResolvedException.class);
    assertThat(countEvents()).isEqualTo(1);
    assertThat(history()).hasSize(1);
  }

  @Test
  @DisplayName("실패한 카드도 종결 상태 — 재승인은 409 (같은 파라미터 재시도는 반드시 재실패하므로 AI 재제안으로 유도)")
  void confirm_afterFailure_conflicts() throws Exception {
    HomeProposalResponse p =
        record("calendar.delete_event", "회의 삭제", om.readTree("{\"id\":987654321}"));
    proposalService.confirm(owner, p.id());

    assertThatThrownBy(() -> proposalService.confirm(owner, p.id()))
        .isInstanceOf(HomeProposalAlreadyResolvedException.class);
  }

  @Test
  @DisplayName("다른 사용자의 카드는 존재를 드러내지 않고 404 — 실행·기록 모두 없음")
  void confirm_othersProposal_notFound() throws Exception {
    HomeProposalResponse p = record("calendar.create_event", "회의", createEventParams());
    long intruder = seedUser();

    assertThatThrownBy(() -> proposalService.confirm(intruder, p.id()))
        .isInstanceOf(HomeProposalNotFoundException.class);
    assertThatThrownBy(() -> proposalService.reject(intruder, p.id()))
        .isInstanceOf(HomeProposalNotFoundException.class);
    assertThat(countEvents()).isZero();
    assertThat(proposalService.listPending(owner, sid)).hasSize(1);
  }

  @Test
  @DisplayName("거부 — REJECTED + '사용자가 거절' 이력, 실행 없음")
  void reject_recordsRejected() throws Exception {
    HomeProposalResponse p = record("calendar.create_event", "회의", createEventParams());

    HomeProposalOutcome out = proposalService.reject(owner, p.id());

    assertThat(out.proposal().status()).isEqualTo("REJECTED");
    assertThat(out.message().role()).isEqualTo("ACTION_REJECTED");
    assertThat(out.message().content()).isEqualTo("사용자가 거절: 회의");
    assertThat(countEvents()).isZero();
  }

  @Test
  @DisplayName("새 질문 시 만료 — 미처리 카드는 복원 목록에서 빠지고 승인할 수 없다")
  void expirePending_hidesAndBlocksConfirm() throws Exception {
    HomeProposalResponse p = record("calendar.create_event", "회의", createEventParams());

    proposalService.expirePending(owner, sid);

    assertThat(proposalService.listPending(owner, sid)).isEmpty();
    assertThatThrownBy(() -> proposalService.confirm(owner, p.id()))
        .isInstanceOf(HomeProposalAlreadyResolvedException.class);
    assertThat(countEvents()).isZero();
  }

  // ── 헬퍼 ──────────────────────────────────────────────────────────────

  private HomeProposalResponse record(String actionType, String summary, JsonNode params) {
    JsonNode actions =
        om.createArrayNode()
            .add(
                om.createObjectNode()
                    .put("actionType", actionType)
                    .put("summary", summary)
                    .set("params", params));
    return proposalService.record(owner, sid, actions).get(0);
  }

  private JsonNode createEventParams() throws Exception {
    return om.readTree(
        "{\"title\":\"확인카드 회의\",\"startsAt\":\"2026-06-26T01:00:00Z\","
            + "\"endsAt\":\"2026-06-26T02:00:00Z\",\"allDay\":false}");
  }

  private List<HomeMessageResponse> history() {
    return sessionService.getMessages(owner, sid);
  }

  private int countEvents() {
    return new TransactionTemplate(txManager)
        .execute(
            status -> {
              setGuc(tid2);
              return dsl.selectCount()
                  .from(CALENDAR_EVENT)
                  .where(CALENDAR_EVENT.OWNER_ID.eq(owner))
                  .fetchOne(0, Integer.class);
            });
  }

  /** 전역 USER 삽입 + fixture 테넌트 역할 부여(커밋). */
  private long seedUser() {
    long uid = TestFixtures.createHuman(dsl);
    userIds.add(uid);
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              setGuc(tid2);
              dsl.insertInto(USER_ROLE)
                  .set(USER_ROLE.USER_ID, uid)
                  .set(USER_ROLE.ROLE_ID, roleId)
                  .execute();
              return null;
            });
    return uid;
  }

  private long ensureFixtureTenant() {
    Long existing =
        dsl.select(TENANT.ID)
            .from(TENANT)
            .where(TENANT.SLUG.eq(FIXTURE_TENANT_SLUG))
            .fetchOne(TENANT.ID);
    if (existing != null) {
      return existing;
    }
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, FIXTURE_TENANT_SLUG)
        .set(TENANT.NAME, "RLS Guard Home Proposal Tenant")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  /** 커밋된 세션(제안·메시지 CASCADE)·일정·캘린더·역할을 fixture 테넌트 GUC 로 회수. fixture 테넌트만 영구 잔존(V46). */
  @AfterEach
  void cleanup() {
    RequestContextHolder.resetRequestAttributes();
    TenantContext.clear();
    cleanupInTenant(
        tid2,
        () -> {
          dsl.deleteFrom(HOME_SESSION).where(HOME_SESSION.USER_ID.in(userIds)).execute();
          // 이슈는 project FK 가 CASCADE 가 아니라 먼저 지운다(멤버·시퀀스는 CASCADE).
          dsl.deleteFrom(ISSUE)
              .where(
                  ISSUE.PROJECT_ID.in(
                      dsl.select(PROJECT.ID).from(PROJECT).where(PROJECT.OWNER_ID.in(userIds))))
              .execute();
          dsl.deleteFrom(PROJECT).where(PROJECT.OWNER_ID.in(userIds)).execute();
          dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.in(userIds)).execute();
          dsl.deleteFrom(CALENDAR).where(CALENDAR.OWNER_ID.in(userIds)).execute();
          dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(userIds)).execute();
          dsl.deleteFrom(ROLE_PERMISSION).where(ROLE_PERMISSION.ROLE_ID.eq(roleId)).execute();
          dsl.deleteFrom(ROLE).where(ROLE.ID.eq(roleId)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
        });
    userIds.clear();
  }
}
