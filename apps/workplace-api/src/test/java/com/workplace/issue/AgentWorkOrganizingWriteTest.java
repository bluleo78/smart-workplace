package com.workplace.issue;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.service.CycleService;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.issue.dto.CreateIssueFieldDefRequest;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.issue.service.IssueFieldDefService;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.PayloadApplicationEvent;
import org.springframework.context.event.AbstractApplicationEventMulticaster;
import org.springframework.context.support.AbstractApplicationContext;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;

/**
 * 정리성 MCP 이슈 쓰기는 AI 작업을 시작하지 않는다(WP-425). 유형·부모·의존성·라벨·담당자·사이클·커스텀 필드, 그리고 제목·본문·상태 없이 우선순위 등만 바꾸는
 * 수정은 이슈를 "정리"할 뿐 그 이슈의 일을 한 것이 아니므로, 수행 도구 헤더가 있어도 작업 행을 만들지도, 시작 전(SUBMITTED) 작업을 잇지도, 일하던 작업을
 * 되돌리지도 않는다. 화면 갱신용 이슈 변경 알림은 그대로 나가야 한다. 제목·본문·상태·코멘트 같은 작업 쓰기는 여전히 시작한다.
 */
class AgentWorkOrganizingWriteTest extends AgentWorkTestSupport {

  @Autowired private ConfigurableApplicationContext context;
  @Autowired private CycleService cycleService;
  @Autowired private IssueFieldDefService fieldDefService;
  @Autowired private IssueTypeRepository typeRepository;

  /** 요청 스레드(Tomcat 워커)에서 발행된 이슈 변경 알림을 모은다 — @RecordApplicationEvents 는 테스트 스레드만 기록한다. */
  private final List<ResourceChangedEvent> issueEvents = new CopyOnWriteArrayList<>();

  private ApplicationListener<ApplicationEvent> listener;

  @BeforeEach
  void listenIssueEvents() {
    listener =
        e -> {
          if (e instanceof PayloadApplicationEvent<?> p
              && p.getPayload() instanceof ResourceChangedEvent ev
              && IssueChangeNotifier.RESOURCE_ISSUE.equals(ev.resource())) {
            issueEvents.add(ev);
          }
        };
    context.addApplicationListener(listener);
  }

  @AfterEach
  void stopListening() {
    // 컨텍스트는 테스트 간 캐시되므로 등록한 리스너를 반드시 뺀다.
    var multicaster =
        context.getBean(
            AbstractApplicationContext.APPLICATION_EVENT_MULTICASTER_BEAN_NAME,
            AbstractApplicationEventMulticaster.class);
    multicaster.removeApplicationListener(listener);
  }

  @Test
  void 우선순위만_바꾸면_작업도_상태도_그대로() {
    assertOk(patch(patToken, Map.of("priority", "HIGH"), TOOL));
    assertThat(activeWork(issueId, humanId)).isEmpty();
    assertThat(issueStatus()).isEqualTo("TODO");
  }

  @Test
  void 라벨_사이클_필드_유형_부모_의존성_담당자_쓰기는_작업을_만들지_않음() {
    var fixture = inTenant(this::seedOrganizingTargets);
    String path = issuePath();

    // 각 쓰기가 실제 변경(알림까지 도달)이었는지 함께 본다 — no-op 으로 조기 반환해 거짓 통과하지 않게.
    assertOrganizing(
        call(
            HttpMethod.PUT,
            path + "/labels",
            patToken,
            Map.of("labelIds", List.of(), "labelNames", List.of("정리")),
            TOOL));
    assertOrganizing(
        call(
            HttpMethod.PUT,
            path + "/cycles",
            patToken,
            Map.of("cycleIds", List.of(fixture.cycleId())),
            TOOL));
    assertOrganizing(
        call(
            HttpMethod.PUT,
            path + "/fields",
            patToken,
            Map.of("values", List.of(Map.of("defId", fixture.fieldDefId(), "value", "메모"))),
            TOOL));
    assertOrganizing(
        call(
            HttpMethod.PATCH,
            path + "/type",
            patToken,
            Map.of("typeId", fixture.bugTypeId()),
            TOOL));
    // 유형을 바꾼 뒤에도 일반 유형이라 에픽 부모를 가질 수 있다.
    assertOrganizing(
        call(
            HttpMethod.PATCH,
            path + "/parent",
            patToken,
            Map.of("parentNumber", fixture.epicNumber()),
            TOOL));
    assertOrganizing(
        call(
            HttpMethod.POST,
            path + "/dependencies",
            patToken,
            Map.of("otherNumber", fixture.otherNumber(), "direction", "blocks"),
            TOOL));
    assertOrganizing(
        call(
            HttpMethod.DELETE,
            path + "/dependencies?otherNumber=" + fixture.otherNumber() + "&direction=blocks",
            patToken,
            null,
            TOOL));
    assertOrganizing(putAssignees(patToken, List.of(humanId, agentId, otherId), TOOL));
  }

  @Test
  void 정리성_쓰기는_SUBMITTED_를_잇지_않음() {
    assertOk(putAssignees(jwtToken, List.of(humanId), null));
    makeExternal(agentId);
    assertOk(putAssignees(jwtToken, List.of(humanId, agentId), null));
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("SUBMITTED");

    assertOk(patch(akToken, Map.of("priority", "HIGH"), TOOL));
    assertThat(activeWork(issueId, agentId).orElseThrow().state()).isEqualTo("SUBMITTED");
    assertThat(issueStatus()).isEqualTo("TODO");
  }

  @Test
  void 일하던_작업도_정리성_쓰기로는_되돌리지_않음() {
    seedActive(issueId, humanId, "PAUSED");
    assertOk(putLabels("정리"));
    assertThat(activeWork(issueId, humanId).orElseThrow().state()).isEqualTo("PAUSED");
  }

  @Test
  void 정리성_쓰기도_이슈_변경_알림은_낸다() {
    assertOk(putLabels("정리"));
    assertThat(issueEvents)
        .filteredOn(e -> e.ids().contains(issueId))
        .singleElement()
        .satisfies(e -> assertThat(e.op()).isEqualTo(ResourceChangedEvent.OP_UPDATED));
  }

  @Test
  void 코멘트는_여전히_작업을_시작() {
    assertOk(postComment(patToken, "메모", TOOL));
    assertThat(activeWork(issueId, humanId).orElseThrow().state()).isEqualTo("WORKING");
    assertThat(issueStatus()).isEqualTo("IN_PROGRESS");
  }

  @Test
  void 본문_수정은_여전히_작업을_시작() {
    assertOk(patch(patToken, Map.of("body", "수정"), TOOL));
    assertThat(activeWork(issueId, humanId).orElseThrow().state()).isEqualTo("WORKING");
  }

  @Test
  void 본문과_우선순위를_함께_바꾸면_작업_쓰기() {
    assertOk(patch(patToken, Map.of("body", "x", "priority", "HIGH"), TOOL));
    assertThat(activeWork(issueId, humanId).orElseThrow().state()).isEqualTo("WORKING");
  }

  /** 라벨 이름 하나로 이슈 라벨을 교체한다(없으면 즉석 생성) — 도구 헤더 PAT. */
  private ResponseEntity<String> putLabels(String name) {
    return call(
        HttpMethod.PUT,
        issuePath() + "/labels",
        patToken,
        Map.of("labelIds", List.of(), "labelNames", List.of(name)),
        TOOL);
  }

  /** 쓰기가 성공했고, 이 이슈 변경 알림을 냈고(실제 변경), 그래도 작업은 없고 상태는 할 일인지. */
  private void assertOrganizing(ResponseEntity<String> res) {
    assertOk(res);
    assertThat(issueEvents).as(res.getBody()).anyMatch(e -> e.ids().contains(issueId));
    issueEvents.clear();
    assertThat(activeCount(issueId)).isZero();
    assertThat(issueStatus()).isEqualTo("TODO");
  }

  /** 정리성 쓰기 대상 — 사이클·텍스트 필드·BUG 유형·에픽 부모·의존성 상대 이슈를 사람 소유자로 만든다. */
  private Targets seedOrganizingTargets() {
    long cycleId =
        cycleService
            .create(humanId, projectKey, new CreateCycleRequest("스프린트", null, null, null, null))
            .id();
    long fieldDefId =
        fieldDefService
            .create(humanId, projectKey, new CreateIssueFieldDefRequest("메모", "TEXT", null))
            .id();
    long bugTypeId = typeRepository.findByProjectAndName(projectId, "BUG").orElseThrow().id();
    long epicTypeId = typeRepository.findByProjectAndName(projectId, "EPIC").orElseThrow().id();
    int epicNumber =
        issueService
            .create(
                humanId,
                projectKey,
                new CreateIssueRequest("에픽", "본문", "MID", null, List.of(), epicTypeId, null, null))
            .number();
    int otherNumber =
        issueService
            .create(
                humanId,
                projectKey,
                new CreateIssueRequest("상대", "본문", "MID", null, List.of(), null, null, null))
            .number();
    return new Targets(cycleId, fieldDefId, bugTypeId, epicNumber, otherNumber);
  }

  private record Targets(
      long cycleId, long fieldDefId, long bugTypeId, int epicNumber, int otherNumber) {}
}
