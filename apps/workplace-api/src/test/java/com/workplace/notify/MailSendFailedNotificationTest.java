package com.workplace.notify;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.notify.dto.NotificationActor;
import com.workplace.notify.dto.NotificationSettingItem;
import com.workplace.notify.dto.NotificationSettingsResponse.AppSettings;
import com.workplace.notify.dto.NotificationSettingsResponse.ItemSettings;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.dto.UpdateNotificationSettingsRequest;
import com.workplace.notify.dto.UpdateNotificationSettingsRequest.CellChange;
import com.workplace.notify.push.InboxPushRequestedEvent;
import com.workplace.notify.push.PushCategory;
import com.workplace.notify.push.PushContentService;
import com.workplace.notify.push.PushMessage;
import com.workplace.notify.service.NotificationService;
import com.workplace.notify.service.NotificationSettingService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * 「메일을 보내지 못함」 계정 알림(WP-1786) — 보낼 대기열의 발송이 실패하거나(unknown=false) 발송 중에 멈춰 결과를 모를 때(unknown=true) 보낸
 * 본인에게 행위자 없이 메일 제목·임시보관 id 를 실어 보낸다. 웹은 type·mailDraftId·mailSendUnknown 으로 문구와 클릭 대상(그 임시보관 쓰기
 * 창)을 고른다. 내 메일이 안 나간 것을 알리는 계정 알림이라 알림 설정을 모두 꺼도 들어가야 한다.
 */
@Transactional
@RecordApplicationEvents
class MailSendFailedNotificationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired NotificationService service;
  @Autowired NotificationSettingService settingService;
  @Autowired PushContentService pushContent;
  @Autowired ApplicationEvents events;

  private long user;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    user = TestFixtures.createHuman(dsl);
    TestFixtures.ensureActiveMember(dsl, user, 1L);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  /** 실패 알림 — 행위자 없이 message=메일 제목, mailDraftId=임시보관 id, mailSendUnknown=false. */
  @Test
  void 실패_알림은_제목과_임시보관_id_를_싣고_unknown_이_아니다() {
    service.createMailSendFailedAndFanOut(user, 4242L, "분기 보고", false);

    assertThat(service.listRecent(user, 10, 0))
        .singleElement()
        .satisfies(
            n -> {
              assertThat(n.type()).isEqualTo("MAIL_SEND_FAILED");
              assertThat(n.message()).isEqualTo("분기 보고");
              assertThat(n.mailDraftId()).isEqualTo(4242L);
              assertThat(n.mailSendUnknown()).isFalse();
              assertThat(n.actorId()).isNull();
              // 변형은 전용 칸(mail_send_unknown)에 담아 AI 작업 상태 칸은 비어 있다
              assertThat(n.agentWorkState()).isNull();
            });
  }

  /** 확인하지 못함 알림 — 같은 유형이지만 mailSendUnknown=true 로 웹이 「보냈는지 확인하지 못함」 문구를 고른다. */
  @Test
  void 확인하지_못함_알림은_mailSendUnknown_이_true() {
    service.createMailSendFailedAndFanOut(user, 77L, "계약서", true);

    assertThat(service.listRecent(user, 10, 0))
        .singleElement()
        .satisfies(
            n -> {
              assertThat(n.type()).isEqualTo("MAIL_SEND_FAILED");
              assertThat(n.message()).isEqualTo("계약서");
              assertThat(n.mailDraftId()).isEqualTo(77L);
              assertThat(n.mailSendUnknown()).isTrue();
            });
  }

  /** 제목이 비었거나 공백뿐이면 「(제목 없음)」 — 빈 제목이 빈 알림 줄로 보이지 않게. */
  @Test
  void 빈_제목은_제목_없음으로_싣는다() {
    service.createMailSendFailedAndFanOut(user, 1L, "  ", false);
    service.createMailSendFailedAndFanOut(user, 2L, null, true);

    assertThat(service.listRecent(user, 10, 0))
        .extracting(n -> n.message())
        .containsOnly("(제목 없음)");
  }

  /** 다른 알림 유형은 mailDraftId 가 없고 mailSendUnknown 은 false 다. */
  @Test
  void 다른_유형은_mailDraftId_가_null() {
    service.createOAuthAppConnectedAndFanOut(user, "Claude");

    assertThat(service.listRecent(user, 10, 0))
        .singleElement()
        .satisfies(
            n -> {
              assertThat(n.mailDraftId()).isNull();
              assertThat(n.mailSendUnknown()).isFalse();
            });
  }

  /** 푸시 요청에 제목(eventTitle 칸)·변형·임시보관 id 가 실린다 — 푸시 문구·이동 주소가 이 값으로 만들어진다. */
  @Test
  void 푸시_요청에_제목과_변형과_임시보관_id_가_실린다() {
    service.createMailSendFailedAndFanOut(user, 4242L, "분기 보고", true);

    assertThat(events.stream(InboxPushRequestedEvent.class))
        .singleElement()
        .satisfies(
            e -> {
              assertThat(e.tenantId()).isEqualTo(1L);
              assertThat(e.type()).isEqualTo(NotificationType.MAIL_SEND_FAILED);
              assertThat(e.category()).isEqualTo(PushCategory.MENTION);
              assertThat(e.recipientIds()).containsExactly(user);
              assertThat(e.actorId()).isNull();
              assertThat(e.eventTitle()).isEqualTo("분기 보고");
              assertThat(e.mailSendUnknown()).isTrue();
              assertThat(e.agentWorkState()).isNull();
              assertThat(e.mailDraftId()).isEqualTo(4242L);
            });
  }

  /** 푸시 문구 — 실패는 「메일을 보내지 못함」, 모름은 「보냈는지 확인하지 못함」, 본문은 제목, 누르면 그 임시보관 쓰기 창. */
  @Test
  void 푸시_문구는_변형별로_다르고_임시보관_쓰기_창으로_간다() {
    PushMessage failed = pushContent.forInbox(mailEvent("분기 보고", false, 4242L));
    PushMessage unknown = pushContent.forInbox(mailEvent("분기 보고", true, 4242L));

    assertThat(failed.title()).isEqualTo("메일을 보내지 못함");
    assertThat(failed.body()).isEqualTo("분기 보고");
    assertThat(failed.url()).isEqualTo("/mail/compose?draftId=4242");
    assertThat(failed.tag()).isEqualTo("mail-send-failed-4242");
    assertThat(failed.category()).isEqualTo(PushCategory.MENTION);
    assertThat(unknown.title()).isEqualTo("보냈는지 확인하지 못함");
    assertThat(unknown.body()).isEqualTo("분기 보고 — 보낸편지함을 확인해 주세요");
  }

  /** 앱 스위치와 모든 칸을 꺼도 들어간다 — 설정 판정을 거치지 않는 계정 알림이다(설정 줄 없음). */
  @Test
  void 알림_설정을_모두_꺼도_들어가고_설정_줄이_없다() {
    Map<com.workplace.notify.dto.NotificationApp, Boolean> apps = new HashMap<>();
    List<CellChange> cells = new ArrayList<>();
    for (AppSettings app : settingService.get(user).apps()) {
      apps.put(app.app(), false);
      for (ItemSettings item : app.items()) {
        if (item.human() != null) {
          cells.add(new CellChange(item.item(), NotificationActor.HUMAN, false));
        }
        if (item.agent() != null) {
          cells.add(new CellChange(item.item(), NotificationActor.AGENT, false));
        }
      }
    }
    settingService.update(user, new UpdateNotificationSettingsRequest(apps, cells));

    service.createMailSendFailedAndFanOut(user, 1L, "x", false);

    assertThat(service.listRecent(user, 10, 0)).hasSize(1);
    assertThatThrownBy(() -> NotificationSettingItem.of(NotificationType.MAIL_SEND_FAILED))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /** NotificationService 가 내는 모양 그대로의 푸시 이벤트 — 행위자·이슈·일정·노트 없이 제목·변형·임시보관 id 만. */
  private InboxPushRequestedEvent mailEvent(String subject, boolean unknown, long draftId) {
    return new InboxPushRequestedEvent(
        1L,
        NotificationType.MAIL_SEND_FAILED,
        PushCategory.MENTION,
        List.of(user),
        null,
        null,
        null,
        null,
        subject,
        null,
        null,
        draftId,
        unknown);
  }
}
