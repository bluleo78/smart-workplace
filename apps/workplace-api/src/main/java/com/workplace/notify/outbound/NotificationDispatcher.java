package com.workplace.notify.outbound;

import com.workplace.auth.outbound.OAuthConnectionCreatedEvent;
import com.workplace.auth.outbound.PersonalAssistantCredentialRevokedEvent;
import com.workplace.calendar.outbound.CalendarAttendeeEvents.CalendarAttendeeInvitedEvent;
import com.workplace.calendar.outbound.CalendarAttendeeEvents.CalendarEventNoticeEvent;
import com.workplace.calendar.outbound.CalendarAttendeeEvents.CalendarRsvpChangedEvent;
import com.workplace.calendar.outbound.CalendarReminderEvents.CalendarReminderDueEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.MentionParser;
import com.workplace.issue.outbound.AgentWorkNoticeEvent;
import com.workplace.issue.outbound.AgentsResumedByChatReply;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssuePriorityChangedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueReporterChangedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowNodeWakeEvent;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowTurnEscalate;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowTurnRemind;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowVisitLimitReached;
import com.workplace.mail.outbound.MailSendFailedEvent;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.service.NotificationService;
import com.workplace.wiki.outbound.WikiShareNotifyEvents.WikiShareAccessApprovedEvent;
import com.workplace.wiki.outbound.WikiShareNotifyEvents.WikiShareAccessRequestedEvent;
import com.workplace.wiki.outbound.WikiShareNotifyEvents.WikiSharedWithPeopleEvent;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 이슈 도메인 이벤트 → 알림 생성. AFTER_COMMIT 에서만 동작(롤백 시 알림 없음), @Async("notifyEventExecutor")로 호출 스레드와 분리해
 * 알림 처리가 이슈 API 응답을 지연시키지 않는다.
 *
 * <p>워처 조회(issue_watcher, RLS 보호)는 NotificationService.createWithWatchersAndFanOut 내부에서 트랜잭션 개시 후
 * 실행되어, TenantContextTaskDecorator 가 워커 스레드에 복원한 TenantContext 를 TenantAwareTransactionManager 가
 * GUC 로 주입한 뒤 조회한다. 핸들러 예외는 도메인 트랜잭션에 영향 없도록 자체 로깅(전파 안 함).
 *
 * <p>예외: 메일 발송 실패({@link MailSendFailedEvent}, WP-1786)는 상태 전환과 알림을 한 트랜잭션에 묶어야 해 동기·같은 트랜잭션으로 받는다.
 *
 * <p>"AI 담당자 활동"은 별도 트리거가 아니라 actor.kind=="AGENT" 인 활동 — actorId 를 그대로 실어 프론트가 AI 배지로 구분한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class NotificationDispatcher {

  private final NotificationService service;

  /** 배정: 새로 추가된 담당자에게(added). */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueAssigned(IssueAssignedEvent e) {
    try {
      List<Long> recipients = e.added().stream().map(UserSummary::id).toList();
      service.createAndFanOut(
          NotificationType.ASSIGNED, recipients, actorId(e.actor()), e.issueId(), null);
    } catch (Exception ex) {
      log.warn("[notify] assigned 알림 실패 issueId={}: {}", e.issueId(), ex.getMessage());
    }
  }

  /**
   * 워크플로우 노드 깨우기(WP-1986): 노드 AI 에게 ASSIGNED — 외부 AI 는 이 알림으로 깨어난다. 받는 사람 확정(이미 ASSIGNED 를 받은 사람
   * 제외, 행위자 예외, 실행 방식 판정)은 {@link NotificationService#createWorkflowWakeAndFanOut} 이 한 곳에서 트랜잭션 안에
   * 한다. 여기서는 후보·이미 알림 받은 사람·행위자를 그대로 넘긴다.
   */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onWorkflowNodeWake(WorkflowNodeWakeEvent e) {
    try {
      service.createWorkflowWakeAndFanOut(
          e.issueId(), e.agentIds(), e.alreadyNotifiedIds(), e.actorId());
    } catch (Exception ex) {
      log.warn("[notify] 워크플로우 깨우기 알림 실패 issueId={}: {}", e.issueId(), ex.getMessage());
    }
  }

  /** 보고자 변경(WP-944): 새 보고자에게 REPORTER_ASSIGNED. 스스로 넘겨받은 경우(행위자=새 보고자)는 서비스가 행위자를 걸러 보내지 않는다. */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueReporterChanged(IssueReporterChangedEvent e) {
    try {
      service.createAndFanOut(
          NotificationType.REPORTER_ASSIGNED,
          List.of(e.to().id()),
          actorId(e.actor()),
          e.issueId(),
          null);
    } catch (Exception ex) {
      log.warn("[notify] 보고자 지정 알림 실패 issueId={}: {}", e.issueId(), ex.getMessage());
    }
  }

  /** 일정 초대 → 피초대자(HUMAN)에게 CALENDAR_INVITED 알림. */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCalendarAttendeeInvited(CalendarAttendeeInvitedEvent e) {
    try {
      service.createEventNotificationAndFanOut(
          e.recipientId(), NotificationType.CALENDAR_INVITED, e.actorId(), e.eventId());
    } catch (Exception ex) {
      log.warn(
          "[notify] 초대 알림 실패 eventId={} recipientId={}: {}",
          e.eventId(),
          e.recipientId(),
          ex.getMessage());
    }
  }

  /** RSVP 변경 → 주최자에게 CALENDAR_RSVP_CHANGED 알림. */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCalendarRsvpChanged(CalendarRsvpChangedEvent e) {
    try {
      service.createEventNotificationAndFanOut(
          e.recipientId(), NotificationType.CALENDAR_RSVP_CHANGED, e.actorId(), e.eventId());
    } catch (Exception ex) {
      log.warn(
          "[notify] RSVP 알림 실패 eventId={} recipientId={}: {}",
          e.eventId(),
          e.recipientId(),
          ex.getMessage());
    }
  }

  /** 일정 시간·장소 변경·취소 → 참석자에게 CALENDAR_EVENT_UPDATED / CALENDAR_EVENT_CANCELED 알림(WP-712). */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCalendarEventNotice(CalendarEventNoticeEvent e) {
    try {
      service.createEventNoticesAndFanOut(
          e.recipientIds(),
          e.canceled()
              ? NotificationType.CALENDAR_EVENT_CANCELED
              : NotificationType.CALENDAR_EVENT_UPDATED,
          e.actorId(),
          e.eventId(),
          e.title(),
          e.startsAt());
    } catch (Exception ex) {
      log.warn(
          "[notify] 일정 변경·취소 알림 실패 eventId={} canceled={}: {}",
          e.eventId(),
          e.canceled(),
          ex.getMessage());
    }
  }

  /** 캘린더 리마인더 발화 → 일정 소유자에게 알림. actor/issue 없음. */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCalendarReminderDue(CalendarReminderDueEvent e) {
    try {
      service.createReminderAndFanOut(e.ownerId(), e.eventId());
    } catch (Exception ex) {
      log.warn("[notify] reminder 알림 실패 eventId={}: {}", e.eventId(), ex.getMessage());
    }
  }

  /**
   * 코멘트: 본문에서 멘션된 사람은 코멘트 멘션(WP-650), 나머지 담당자 ∪ 워처는 COMMENTED. 워처 조회·사람 거르기는 service 트랜잭션 내에서 실행 —
   * GUC 주입 후 RLS 통과.
   *
   * <p>기존에는 watcherRepo.findUserIdsByIssue() 를 @Async 핸들러에서 직접 호출해 트랜잭션 밖 bare jOOQ 조회가 발생했다.
   * TenantContext 도 없어 RLS 가 issue_watcher 를 0행 반환(fail-closed). 수정:
   * service.createWithWatchersAndFanOut 에서 단일 트랜잭션으로 조회+insert+fan-out.
   */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueCommented(IssueCommentedEvent e) {
    try {
      service.createCommentedAndFanOut(
          e.issueId(),
          e.assignees(),
          MentionParser.parse(e.commentBody()),
          actorId(e.actor()),
          e.commentId());
    } catch (Exception ex) {
      log.warn("[notify] commented 알림 실패 issueId={}: {}", e.issueId(), ex.getMessage());
    }
  }

  /**
   * 상태변경: 담당자 ∪ 워처. 워처 조회는 service 트랜잭션 내에서 실행 — GUC 주입 후 RLS 통과.
   *
   * @see #onIssueCommented
   */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssueStatusChanged(IssueStatusChangedEvent e) {
    try {
      service.createWithWatchersAndFanOut(
          NotificationType.STATUS_CHANGED,
          e.issueId(),
          e.assignees(),
          actorId(e.actor()),
          null,
          // WP-869: 새 상태 이름을 알림에 남긴다(인박스·푸시 문구 「상태를 '<이름>'으로/로 변경했습니다」 — 조사는 받침에 맞춘다)
          e.newStatusName());
    } catch (Exception ex) {
      log.warn("[notify] status_changed 알림 실패 issueId={}: {}", e.issueId(), ex.getMessage());
    }
  }

  /**
   * 우선순위 변경: 담당자 ∪ 워처. 상태 변경과 대칭적으로 모든 변경에 알림(임계치 조건 없음, #613). 워처 조회는 service 트랜잭션 내에서 실행 — GUC 주입
   * 후 RLS 통과.
   *
   * @see #onIssueCommented
   */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onIssuePriorityChanged(IssuePriorityChangedEvent e) {
    try {
      service.createWithWatchersAndFanOut(
          NotificationType.PRIORITY_CHANGED, e.issueId(), e.assignees(), actorId(e.actor()), null);
    } catch (Exception ex) {
      log.warn("[notify] priority_changed 알림 실패 issueId={}: {}", e.issueId(), ex.getMessage());
    }
  }

  /**
   * 이슈 챗 글 → 알림(WP-452). 글 경로(origin)로 가른다.
   *
   * <ul>
   *   <li>REPORT(AI 진행 보고) — 여기서는 알림 없음. 글의 멘션은 보고 쪽 AgentWorkNoticeEvent 가 상태 알림과 함께 사람당 1건으로
   *       만든다(WP-1009, {@link #onAgentWorkNotice}).
   *   <li>REPORT_QUESTION(AI 답변 필요 질문) — 이슈의 사람 관계자 ∪ 멘션된 사람에게 AI_QUESTION 1건씩. 관계자 조회는 서비스 트랜잭션
   *       안(RLS).
   *   <li>USER(화면 글·AI 채팅 답글) — 멘션된 사람에게 ISSUE_CHAT_MENTION. 작성자 본인은 서비스가 뺀다.
   * </ul>
   *
   * <p>멘션은 사람과 AI 가 같은 알림을 받는다(WP-720) — 외부 AI 는 이 알림(SSE notify.created)으로 깨어난다. 서버 AI 의 멘션 호출은
   * ChatEventDispatcher 가 따로 맡는다.
   */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onChatMessageCreated(ChatMessageCreatedEvent e) {
    try {
      if (e.origin() == null) return;
      List<Long> mentioned =
          e.mentions() == null
              ? List.of()
              : e.mentions().stream().map(UserSummary::id).distinct().toList();
      switch (e.origin()) {
        case REPORT_QUESTION ->
            service.createAiQuestionAndFanOut(e.issueId(), mentioned, actorId(e.actor()));
        case USER -> {
          if (!mentioned.isEmpty())
            service.createAndFanOut(
                NotificationType.ISSUE_CHAT_MENTION,
                mentioned,
                actorId(e.actor()),
                e.issueId(),
                null);
        }
        case REPORT -> {
          // AI 진행 보고 — 멘션 알림은 AgentWorkNoticeEvent 가 상태 알림과 함께 만든다(WP-1009).
        }
      }
    } catch (Exception ex) {
      log.warn(
          "[notify] 이슈 챗 알림 실패 issueId={} messageId={}: {}",
          e.issueId(),
          e.messageId(),
          ex.getMessage());
    }
  }

  /**
   * 사람의 챗 글로 답변 필요에서 되돌린 AI → ISSUE_CHAT_MENTION(WP-1067). 질문에 멘션 없이 답해도 외부 AI 가 이 알림(SSE
   * notify.created)으로 바로 깨어나게 한다. 멘션된 AI 는 발행 쪽이 이미 뺐다(멘션 알림과 1건으로). 종류는 이슈 챗 멘션과 같다 — 받는 쪽은 AI
   * 뿐이고, 플러그인은 종류와 무관하게 이슈 알림이면 깨어난다.
   */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onAgentsResumedByChatReply(AgentsResumedByChatReply e) {
    try {
      service.createAndFanOut(
          NotificationType.ISSUE_CHAT_MENTION, e.workerIds(), e.actorId(), e.issueId(), null);
    } catch (Exception ex) {
      log.warn("[notify] 답변 받은 AI 알림 실패 issueId={}: {}", e.issueId(), ex.getMessage());
    }
  }

  /**
   * AI 작업 상태 알림(WP-913) — 검토 요청·실패는 그 AI 를 맡긴 사람(없거나 못 보면 보고자)에게, 권한 필요·차단됨·글 없는 답변 필요는 「답변 필요」
   * AI_QUESTION 으로. 판정·수신자 계산은 서비스 트랜잭션 안(RLS).
   */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onAgentWorkNotice(AgentWorkNoticeEvent e) {
    try {
      service.createAgentWorkNoticeAndFanOut(
          e.issueId(), e.workerId(), e.state(), e.delegateCandidates(), e.mentionedIds());
    } catch (Exception ex) {
      log.warn(
          "[notify] AI 작업 보고 알림 실패 issueId={} state={} mentions={}: {}",
          e.issueId(),
          e.state(),
          e.mentionedIds().size(),
          ex.getMessage());
    }
  }

  /**
   * 워크플로우 되돌림 한도(WP-1985, 설계 §10) → 이슈 프로젝트의 활성 사람 OWNER(행위자 제외)에게 WORKFLOW_VISIT_LIMIT. 실행 서비스가 이동
   * 트랜잭션 안에서 내므로 커밋 뒤에만 받는다(롤백된 이동은 알리지 않음). 비동기 스레드라 이벤트에 실린 테넌트를 다시 세워 RLS 가 통하게 하고, 실패는 로그만
   * 남긴다(이미 커밋된 이동을 되돌리지 않는다).
   */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onWorkflowVisitLimitReached(WorkflowVisitLimitReached e) {
    try {
      TenantContext.runAs(
          e.tenantId(), () -> service.createWorkflowVisitLimitAndFanOut(e.issueId(), e.actorId()));
    } catch (Exception ex) {
      log.warn(
          "[notify] 워크플로우 되돌림 한도 알림 실패 issueId={} runId={} node={}: {}",
          e.issueId(),
          e.runId(),
          e.nodeKey(),
          ex.getMessage());
    }
  }

  /**
   * 워크플로우 기다림 타이머(WP-1987): 담당에게 다시 알림(REMIND).
   *
   * <p>예외적으로 동기 {@code @EventListener} — 타이머가 방문별 세이브포인트 안에서 표시 이벤트와 함께 알림을 만들어야, 알림이 실패하면 그 방문의
   * 표시도 되돌아가 다음 poll 에서 다시 시도한다. 그래서 AFTER_COMMIT·@Async 로 바꾸지 말고, 예외를 삼키지 않고 전파한다. (아래 ESCALATE 도
   * 같다)
   */
  @EventListener
  public void onWorkflowTurnRemind(WorkflowTurnRemind e) {
    service.createWorkflowTurnAndFanOut(
        NotificationType.WORKFLOW_TURN_REMIND, e.issueId(), e.assigneeIds());
  }

  /**
   * 워크플로우 기다림 타이머(WP-1987): 프로젝트 관리자에게 알림(ESCALATE) — 동기·예외 전파인 이유는 {@link #onWorkflowTurnRemind}.
   * 관리자가 없으면 알림만 생략한다.
   */
  @EventListener
  public void onWorkflowTurnEscalate(WorkflowTurnEscalate e) {
    List<Long> managers = service.workflowManagerIds(e.issueId());
    if (managers.isEmpty()) return;
    service.createWorkflowTurnAndFanOut(
        NotificationType.WORKFLOW_TURN_ESCALATE, e.issueId(), managers);
  }

  /**
   * 노트 공유(WP-579) → 새로 지정된 사람마다 WIKI_SHARED. 목록에 공유한 사람 본인이 섞여 있어도(서비스가 걸러 주지 않는다) 서비스가 actor 와 같은
   * 수신자는 뺀다. 커밋 뒤 비동기 스레드라 이벤트에 실린 테넌트를 다시 세워 RLS 가 통하게 한다.
   */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onWikiSharedWithPeople(WikiSharedWithPeopleEvent e) {
    runWikiShareNotify(
        e.tenantId(),
        "노트 공유 알림",
        e.pageId(),
        () -> {
          for (Long recipientId : e.recipientIds().stream().distinct().toList()) {
            service.createWikiShareNotificationAndFanOut(
                recipientId, NotificationType.WIKI_SHARED, e.actorId(), e.pageId(), e.message());
          }
        });
  }

  /** 접근 요청(WP-579) → 공유를 만든 사람에게 WIKI_SHARE_ACCESS_REQUESTED. */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onWikiShareAccessRequested(WikiShareAccessRequestedEvent e) {
    runWikiShareNotify(
        e.tenantId(),
        "노트 접근 요청 알림",
        e.pageId(),
        () ->
            service.createWikiShareNotificationAndFanOut(
                e.sharerId(),
                NotificationType.WIKI_SHARE_ACCESS_REQUESTED,
                e.requesterId(),
                e.pageId(),
                null));
  }

  /** 접근 승인(WP-579) → 요청자에게 WIKI_SHARE_ACCESS_APPROVED. */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onWikiShareAccessApproved(WikiShareAccessApprovedEvent e) {
    runWikiShareNotify(
        e.tenantId(),
        "노트 접근 승인 알림",
        e.pageId(),
        () ->
            service.createWikiShareNotificationAndFanOut(
                e.requesterId(),
                NotificationType.WIKI_SHARE_ACCESS_APPROVED,
                e.approverId(),
                e.pageId(),
                null));
  }

  /** 관리자가 개인 비서 연결을 회수함(WP-1170) → 주인에게 PERSONAL_ASSISTANT_REVOKED(「다시 연결해 주세요」). */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onPersonalAssistantCredentialRevoked(PersonalAssistantCredentialRevokedEvent e) {
    try {
      TenantContext.runAs(
          e.tenantId(),
          () -> service.createPersonalAssistantRevokedAndFanOut(e.ownerId(), e.actorId()));
    } catch (Exception ex) {
      // 알림 실패로 이미 커밋된 회수를 되돌리지 않는다 — 로그만 남긴다.
      log.warn("[notify] 개인 비서 연결 회수 알림 실패 ownerId={}: {}", e.ownerId(), ex.getMessage());
    }
  }

  /**
   * OAuth 로 앱이 새로 연결됨(WP-1686) → 연결한 본인에게 OAUTH_APP_CONNECTED(「새 앱 연결」). 연결한 워크스페이스(이벤트의 tenantId)의
   * 인박스에 넣는다 — 커밋 뒤 비동기 스레드라 그 테넌트를 다시 세워 RLS 가 통하게 한다.
   */
  @Async("notifyEventExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onOAuthConnectionCreated(OAuthConnectionCreatedEvent e) {
    try {
      TenantContext.runAs(
          e.tenantId(), () -> service.createOAuthAppConnectedAndFanOut(e.userId(), e.clientName()));
    } catch (Exception ex) {
      // 알림 실패로 이미 커밋된 연결을 되돌리지 않는다 — 로그만 남긴다.
      log.warn("[notify] 새 앱 연결 알림 실패 userId={}: {}", e.userId(), ex.getMessage());
    }
  }

  /**
   * 보낼 대기열 메일 발송 실패(WP-1786) → 보낸 본인에게 MAIL_SEND_FAILED. 다른 리스너와 달리 <b>동기
   * {@code @EventListener}</b> 로 발행한 트랜잭션(임시보관을 FAILED 로 돌린 트랜잭션)에 그대로 합류한다 — 상태 전환과 알림을 한 번에
   * 커밋·롤백해 「실패로 바뀌었는데 알림이 없는」 경우를 막으려는 것이다(AFTER_COMMIT·비동기면 커밋 뒤 알림 insert 가 실패할 때 알림이 영영 빠진다). 같은
   * 이유로 예외를 삼키지 않는다 — 알림이 실패하면 상태 전환도 롤백되고, 행은 SENDING 에 남아 멈춤 정리가 다음 회차에 다시 시도한다. 발행한 스레드가 이미 테넌트
   * 문맥·트랜잭션을 세워 두었으므로 테넌트를 다시 세우지 않는다.
   */
  @EventListener
  public void onMailSendFailed(MailSendFailedEvent e) {
    service.createMailSendFailedAndFanOut(e.userId(), e.draftId(), e.subject(), e.unknown());
  }

  /**
   * 노트 공유 알림 리스너 공통 뼈대(WP-579) — 커밋 뒤 비동기 스레드라 이벤트에 실린 테넌트를 다시 세워 RLS 가 통하게 하고, 실패는 로그만 남긴다(알림 실패로
   * 이미 커밋된 공유 변경을 되돌리지 않는다).
   */
  private void runWikiShareNotify(long tenantId, String what, long pageId, Runnable work) {
    try {
      TenantContext.runAs(tenantId, work);
    } catch (Exception ex) {
      log.warn("[notify] {} 실패 pageId={}: {}", what, pageId, ex.getMessage());
    }
  }

  private static Long actorId(UserSummary actor) {
    return actor == null ? null : actor.id();
  }
}
