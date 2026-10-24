package com.workplace.notify.service;

import static com.workplace.notify.dto.NotificationActor.AGENT;
import static com.workplace.notify.dto.NotificationActor.HUMAN;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.notify.dto.NotificationApp;
import com.workplace.notify.dto.NotificationSettingItem;
import com.workplace.notify.repository.NotificationSettingRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link NotificationSettingService#filterRecipients} 판정 — 행위자 kind 로 열 선택, 칸 없는 열은 하나뿐인 칸으로,
 * 기본값·저장값·앱 스위치, AGENT 수신자는 항상 통과, 입력 순서 유지. 알림 생성 경로(후속 태스크)가 이 판정 하나에 기대므로 여기서 규칙을 고정한다.
 */
@Transactional
class NotificationSettingServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired NotificationSettingService service;
  @Autowired NotificationSettingRepository repo;

  long humanActor;
  long agentActor;
  long a;
  long b;
  long ai;

  @BeforeEach
  void setUp() {
    humanActor = TestFixtures.createHuman(dsl);
    agentActor = TestFixtures.createAgentNoToken(dsl);
    a = TestFixtures.createHuman(dsl);
    b = TestFixtures.createHuman(dsl);
    ai = TestFixtures.createAgentNoToken(dsl);
  }

  @Test
  void defaults_pickColumnByActorKind() {
    // 할당: 사람이 켬 / AI가 끔
    assertThat(
            service.filterRecipients(
                List.of(a, b), NotificationSettingItem.ISSUE_ASSIGNED, humanActor))
        .containsExactly(a, b);
    assertThat(
            service.filterRecipients(
                List.of(a, b), NotificationSettingItem.ISSUE_ASSIGNED, agentActor))
        .isEmpty();
    // 상태 변경: 사람이 끔
    assertThat(
            service.filterRecipients(
                List.of(a), NotificationSettingItem.ISSUE_STATUS_CHANGED, humanActor))
        .isEmpty();
  }

  @Test
  void agentRecipients_alwaysPass_andOrderKept() {
    repo.upsertApp(ai, NotificationApp.ISSUE, false);
    assertThat(
            service.filterRecipients(
                List.of(b, ai, a), NotificationSettingItem.ISSUE_ASSIGNED, agentActor))
        .containsExactly(ai);
    assertThat(
            service.filterRecipients(
                List.of(b, ai, a), NotificationSettingItem.ISSUE_ASSIGNED, humanActor))
        .containsExactly(b, ai, a);
  }

  @Test
  void storedValueOverridesDefault_andAppOffWins() {
    repo.upsertCell(a, NotificationSettingItem.ISSUE_ASSIGNED, AGENT, true);
    assertThat(
            service.filterRecipients(
                List.of(a, b), NotificationSettingItem.ISSUE_ASSIGNED, agentActor))
        .containsExactly(a);

    repo.upsertApp(a, NotificationApp.ISSUE, false);
    assertThat(
            service.filterRecipients(
                List.of(a, b), NotificationSettingItem.ISSUE_ASSIGNED, agentActor))
        .isEmpty();
    // 다른 앱 스위치는 영향 없음
    assertThat(service.filterRecipients(List.of(a), NotificationSettingItem.CHAT_DM, humanActor))
        .containsExactly(a);
  }

  @Test
  void missingColumn_fallsBackToTheOnlyColumn() {
    // 리마인더(행위자 없음) → 「사람이」 칸
    repo.upsertCell(a, NotificationSettingItem.CALENDAR_REMINDER, HUMAN, false);
    assertThat(
            service.filterRecipients(
                List.of(a, b), NotificationSettingItem.CALENDAR_REMINDER, null))
        .containsExactly(b);
    // AI 전용 항목을 사람이 일으켜도 「AI가」 칸으로 판정
    repo.upsertCell(b, NotificationSettingItem.ISSUE_AI_NEEDS_INPUT, AGENT, false);
    assertThat(
            service.filterRecipients(
                List.of(a, b), NotificationSettingItem.ISSUE_AI_NEEDS_INPUT, humanActor))
        .containsExactly(a);
  }

  @Test
  void emptyRecipients() {
    assertThat(service.filterRecipients(List.of(), NotificationSettingItem.CHAT_DM, humanActor))
        .isEmpty();
  }
}
