package com.workplace.notify.service;

import com.workplace.global.dto.UserSummary;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.security.PermissionChecker;
import com.workplace.global.service.UserMentionHydrator;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.outbound.AgentWorkNoticeEvent;
import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.dto.NotificationSettingItem;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.outbound.NotificationChangeNotifier;
import com.workplace.notify.push.InboxPushRequestedEvent;
import com.workplace.notify.push.PushCategory;
import com.workplace.notify.push.PushContentRepository;
import com.workplace.notify.repository.NotificationRepository;
import com.workplace.user.dto.UserKind;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 알림 생성·조회·읽음. 생성 시 수신자 후보에서 actor 본인 제외 + 중복 제거 후 persist 하고, 같은 수신자 집합에 SSE("notify.created")로
 * fan-out 한다. 모든 조회/변경은 recipientId 스코프(타 사용자 알림 접근 불가). insert 후 InboxPushRequestedEvent 발행 → 커밋 후
 * 푸시.
 *
 * <p>모든 생성 경로는 「수신자 확정 → 알림 설정 필터({@link #allowed}) → insert → SSE·푸시」 순서다(WP-913). 설정으로 걸러진 사람에게는
 * 인박스 행·SSE notify.created·웹 푸시 셋 다 없다 — 푸시는 insert 된 수신자에게만 나가므로 필터를 insert 앞 한 곳에 두면 세 채널이 함께
 * 따른다.
 */
@Service
@RequiredArgsConstructor
public class NotificationService {

  private final NotificationRepository repo;
  private final SseRegistry registry;
  private final IssueWatcherRepository watcherRepo;
  private final ApplicationEventPublisher publisher;
  private final NotificationChangeNotifier changeNotifier;
  private final PermissionChecker permissionChecker;
  private final NotificationSettingService settings;
  private final UserMentionHydrator mentionHydrator;
  private final PushContentRepository issueInfo;

  /**
   * 이슈 알림 한 건의 내용(수신자 빼고). statusName(이슈 상태 이름, WP-869)과 agentWorkState(AI 작업 상태, WP-913)는 둘 다
   * String 이라 위치 인자로 넘기면 자리가 뒤바뀌어도 컴파일된다 — 이름 있는 칸으로 묶어 생성·푸시 경로가 같은 값을 그대로 나르게 한다.
   */
  private record IssueNotice(
      NotificationType type,
      Long actorId,
      long issueId,
      Long commentId,
      String statusName,
      String agentWorkState) {

    /** 상태 이름·AI 작업 상태 없는 알림. */
    static IssueNotice of(NotificationType type, Long actorId, long issueId, Long commentId) {
      return new IssueNotice(type, actorId, issueId, commentId, null, null);
    }

    IssueNotice withStatusName(String statusName) {
      return new IssueNotice(type, actorId, issueId, commentId, statusName, agentWorkState);
    }

    IssueNotice withAgentWorkState(String agentWorkState) {
      return new IssueNotice(type, actorId, issueId, commentId, statusName, agentWorkState);
    }
  }

  /** 수신자 확정(actor 제외·중복 제거) → batch insert → SSE fan-out. 빈 수신자면 no-op. */
  @Transactional
  public void createAndFanOut(
      NotificationType type, List<Long> recipientIds, Long actorId, long issueId, Long commentId) {
    create(IssueNotice.of(type, actorId, issueId, commentId), recipientIds);
  }

  /** 생성 + 종류 기본 분류로 푸시. */
  private void create(IssueNotice n, List<Long> recipientIds) {
    List<Long> recipients = insertAndFanOut(n, recipientIds);
    if (recipients.isEmpty()) return;
    publishPush(n, PushCategory.of(n.type()), recipients);
  }

  /**
   * 이슈 챗 AI 질문 알림(WP-452). 수신자 = 이슈의 사람 관계자(보고자 ∪ 담당자 ∪ 워처, HUMAN) ∪ 질문 글에서 멘션된 사람·AI(WP-720) — 작성자
   * 제외·중복 제거로 한 사람에 AI_QUESTION 1건만 만든다. 받을지는 멘션 여부와 무관하게 「답변 필요」 한 줄(ISSUE_AI_NEEDS_INPUT)이
   * 정한다(WP-913). 푸시는 멘션된 사람만 MENTION, 나머지는 ISSUE 분류로 나눠 보낸다 — 서비스워커가 「나를 부른 질문」을 멘션으로 표시·억제하게.
   *
   * <p>관계자 조회(RLS 대상)는 이 트랜잭션 안에서 실행 — createWithWatchersAndFanOut 과 같은 이유(@Async 워커 스레드에서 GUC 주입 후
   * 조회).
   *
   * @param mentionedIds 질문 글에서 멘션된 사용자 id(사람·AI)
   */
  @Transactional
  public void createAiQuestionAndFanOut(long issueId, List<Long> mentionedIds, Long actorId) {
    aiQuestion(issueId, mentionedIds, actorId, null);
  }

  /**
   * AI_QUESTION 생성 본체. agentWorkState 는 AI 작업 상태로 생긴 「답변 필요」(권한 필요·막힘·글 없는 답변 필요, WP-913)의 원인 상태이고,
   * 이슈 챗 질문 글로 생긴 것이면 null 이다. 알림 행과 푸시에 함께 실어 인박스·푸시가 같은 상태별 문구를 쓰게 한다.
   */
  private void aiQuestion(
      long issueId, List<Long> mentionedIds, Long actorId, String agentWorkState) {
    IssueNotice n =
        IssueNotice.of(NotificationType.AI_QUESTION, actorId, issueId, null)
            .withAgentWorkState(agentWorkState);
    List<Long> ids = new ArrayList<>(repo.findHumanStakeholderIds(issueId));
    ids.addAll(mentionedIds);
    List<Long> recipients = insertAndFanOut(n, ids);
    if (recipients.isEmpty()) return;
    Set<Long> mentioned = new HashSet<>(mentionedIds);
    List<Long> toMention = recipients.stream().filter(mentioned::contains).toList();
    List<Long> toIssue = recipients.stream().filter(id -> !mentioned.contains(id)).toList();
    if (!toMention.isEmpty()) publishPush(n, PushCategory.MENTION, toMention);
    if (!toIssue.isEmpty()) publishPush(n, PushCategory.ISSUE, toIssue);
  }

  /**
   * AI 작업 상태 알림(WP-913) — AI 작업자가 보고한 상태가 그 값으로 바뀐 순간 issue 모듈이 낸 이벤트를 커밋 뒤 받아 만든다. 작업자가 AI 인지는 발행
   * 쪽(issue)이 이미 판정했다 — 사람이 자기 도구로 보고한 작업은 state 가 없다(글의 멘션만 온다).
   *
   * <ul>
   *   <li>REVIEW → AI_REVIEW_REQUESTED, FAILED·REJECTED → AI_WORK_FAILED: 받는 사람은 한 명 —
   *       delegateCandidates (그 AI 를 담당자로 지정한 사람, 보고자 순)에서 작업자 본인이 아니고 사람(HUMAN)이며 이슈를 볼 수 있는 첫 사람.
   *   <li>AUTH_REQUIRED·BLOCKED·INPUT_REQUIRED → 「답변 필요」 AI_QUESTION, 수신자는 이슈 챗 질문과 같은 규칙.
   *   <li>그 밖의 상태 → 알림 없음.
   * </ul>
   *
   * <p>알림 설정 필터는 대체 수신자를 고른 <b>뒤</b> 건다 — 할당자가 이 알림을 꺼 두었으면 아무도 받지 않는다. 개인 설정이 다른 사람(보고자)에게 가는 대체
   * 경로를 열면 「끈 알림이 남에게 넘어가는」 셈이 되기 때문이다.
   *
   * <p>보고 글의 멘션(WP-1009)도 같은 보고의 알림으로 함께 만든다 — <b>보고 하나 = 사람당 1건</b>. 답변 필요는 멘션된 사람까지 AI_QUESTION
   * 하나로 합치고(이슈 챗 질문과 같은 규칙), 검토 요청·실패는 그 알림의 대리인을 빼고 나머지 멘션된 사람에게 ISSUE_CHAT_MENTION 을 만든다. 상태 알림이
   * 없으면(state null) 멘션된 사람에게만 ISSUE_CHAT_MENTION. 대리인은 설정 필터 <b>전</b>에 뺀다 — 그 상태 알림을 꺼 둔 사람에게 같은
   * 보고가 멘션 알림으로 새어 들어가지 않게(코멘트 알림 createCommentedAndFanOut 과 같은 규칙).
   *
   * @param state 알릴 상태 변화(없으면 null — 멘션만)
   * @param delegateCandidates [AI 담당 행의 assigned_by, 보고자] 순서(null 제외)
   * @param mentionedIds 보고 글에서 멘션된 사용자 id — 사람·AI 모두 받는다(WP-720, 다른 AI 에게 넘긴 일을 그 AI 가 알림으로 받아
   *     깨어난다). 열람 권한은 생성 경로가 거른다
   */
  @Transactional
  public void createAgentWorkNoticeAndFanOut(
      long issueId,
      long workerId,
      String state,
      List<Long> delegateCandidates,
      List<Long> mentionedIds) {
    List<Long> mentioned = mentionHydrator.filterExistingUserIds(mentionedIds);
    Long delegate = null;
    if (state != null) {
      switch (state) {
        case AgentWorkNoticeEvent.REVIEW ->
            delegate =
                notifyDelegate(
                    NotificationType.AI_REVIEW_REQUESTED,
                    issueId,
                    workerId,
                    state,
                    delegateCandidates);
        case AgentWorkNoticeEvent.FAILED, AgentWorkNoticeEvent.REJECTED ->
            delegate =
                notifyDelegate(
                    NotificationType.AI_WORK_FAILED, issueId, workerId, state, delegateCandidates);
        case AgentWorkNoticeEvent.AUTH_REQUIRED,
            AgentWorkNoticeEvent.BLOCKED,
            AgentWorkNoticeEvent.INPUT_REQUIRED -> {
          // 멘션된 사람까지 「답변 필요」 하나로 — 남은 멘션 알림이 없다.
          aiQuestion(issueId, mentioned, workerId, state);
          return;
        }
        default -> {
          // CANCELED·COMPLETED 등 — 상태 알림 없음(완료는 이슈 상태 변경 알림이 맡는다).
        }
      }
    }
    Long notified = delegate;
    List<Long> rest = mentioned.stream().filter(id -> !id.equals(notified)).toList();
    if (!rest.isEmpty()) {
      create(IssueNotice.of(NotificationType.ISSUE_CHAT_MENTION, workerId, issueId, null), rest);
    }
  }

  /**
   * 검토 요청·실패 — 대체 규칙으로 고른 한 사람에게만 만들고, 설정 필터는 그 뒤 건다. 대리인은 firstReachableDelegate 가 이미 사람·이슈 열람 가능을
   * 확인했고 작업자는 AI(이벤트 계약)라, 열람·종류를 다시 조회하지 않고 설정 판정부터 한다. 고른 대리인을 돌려준다(없으면 null) — 설정으로 받지 않았어도 같은
   * 보고의 멘션 알림에서 뺀다.
   */
  private Long notifyDelegate(
      NotificationType type, long issueId, long workerId, String state, List<Long> candidates) {
    Long delegate = firstReachableDelegate(issueId, workerId, candidates);
    if (delegate == null) return null;
    IssueNotice n = IssueNotice.of(type, workerId, issueId, null).withAgentWorkState(state);
    List<Long> recipients =
        deliver(n, List.of(delegate), Map.of(delegate, UserKind.HUMAN, workerId, UserKind.AGENT));
    if (!recipients.isEmpty()) publishPush(n, PushCategory.ISSUE, recipients);
    return delegate;
  }

  /**
   * 후보 순서대로 작업자 본인이 아니고 사람(HUMAN)이며 이슈를 볼 수 있는 첫 사람. 없으면 null. filterHumanIds 는 id 순으로 돌려주므로 순서는 후보
   * 목록을 따라가며 집합으로만 확인한다.
   */
  private Long firstReachableDelegate(long issueId, long workerId, List<Long> candidates) {
    List<Long> others =
        candidates.stream().filter(Objects::nonNull).filter(id -> id != workerId).toList();
    if (others.isEmpty()) return null;
    Set<Long> humans = new HashSet<>(repo.filterHumanIds(others));
    Set<Long> readable =
        new HashSet<>(
            repo.filterCanReadIssue(issueId, others.stream().filter(humans::contains).toList()));
    return others.stream().filter(readable::contains).findFirst().orElse(null);
  }

  /**
   * 수신자 확정(null·actor 제외, 중복 제거, 이슈의 프로젝트를 볼 수 없는 사람 제외) → 알림 설정 필터 → batch insert → SSE fan-out.
   * 실제 insert 한 수신자를 돌려준다(빈 목록이면 아무것도 안 함).
   *
   * <p>조회 권한 필터(WP-501)는 여기 한 곳에서 건다 — 보고자·워처·멘션 등 어느 경로로 들어온 수신자든, 프로젝트에서 빠졌거나 처음부터 볼 수 없는 사람에게 알림
   * 행과 웹 푸시(이슈 제목 포함)를 만들지 않는다. 알림 설정 필터(WP-913)도 그 뒤에 건다.
   */
  private List<Long> insertAndFanOut(IssueNotice n, List<Long> recipientIds) {
    List<Long> candidates =
        recipientIds.stream()
            .filter(Objects::nonNull)
            .distinct()
            .filter(id -> !id.equals(n.actorId()))
            .toList();
    if (candidates.isEmpty()) return candidates;
    Set<Long> readable = new HashSet<>(repo.filterCanReadIssue(n.issueId(), candidates));
    // 후보 순서를 유지한다(푸시 묶음·테스트가 수신자 순서에 기대지 않지만 결정적으로 두려고).
    return deliver(n, candidates.stream().filter(readable::contains).toList(), Map.of());
  }

  /**
   * 수신자가 확정된(actor 제외·열람 가능) 뒤의 생성 — 알림 설정 필터 → batch insert → SSE fan-out. knownKinds 는 호출자가 이미 아는
   * 사용자 종류(설정 판정이 다시 조회하지 않게).
   */
  private List<Long> deliver(
      IssueNotice n, List<Long> readableRecipients, Map<Long, String> knownKinds) {
    List<Long> recipients = allowed(readableRecipients, n.type(), n.actorId(), knownKinds);
    if (recipients.isEmpty()) return recipients;
    repo.insertBatch(
        recipients,
        n.type(),
        n.actorId(),
        n.issueId(),
        n.commentId(),
        n.statusName(),
        n.agentWorkState());
    // 페이로드는 경량(클라가 수신 즉시 쿼리 invalidate). 상세는 REST 재조회. 이슈 키는 외부 AI 가 맡은 프로젝트의 알림에만 깨어나도록 거르는
    // 데 쓴다(WP-720).
    registry.fanOut(recipients, "notify.created", issuePayload(n));
    return recipients;
  }

  /** 이슈 알림 SSE 페이로드 — 종류·이슈 id 에 이슈 키(이슈가 사라졌으면 키 없이). 프로젝트는 키의 앞부분이다. */
  private Map<String, Object> issuePayload(IssueNotice n) {
    Map<String, Object> payload = new HashMap<>();
    payload.put("type", n.type().name());
    payload.put("issueId", n.issueId());
    issueInfo
        .findIssue(n.issueId())
        .ifPresent(i -> payload.put("issueKey", i.projectKey() + "-" + i.number()));
    return payload;
  }

  /**
   * 그 알림을 받겠다고 설정한 수신자만(순서 유지). 알림 종류 → 설정 줄, 행위자 kind → 칸은 NotificationSettingService 가 정하고, AGENT
   * 수신자는 설정과 무관하게 남는다. 모든 생성 경로가 이 한 메서드로 걸러 경로마다 규칙이 갈라지지 않게 한다.
   */
  private List<Long> allowed(
      List<Long> recipients, NotificationType type, Long actorId, Map<Long, String> knownKinds) {
    if (recipients.isEmpty()) return recipients;
    return settings.filterRecipients(
        recipients, NotificationSettingItem.of(type), actorId, knownKinds);
  }

  /** 단건 경로(캘린더·노트·리마인더)용 — 그 한 사람이 이 알림을 받겠다고 설정했는지. */
  private boolean allowedOne(long recipientId, NotificationType type, Long actorId) {
    return !allowed(List.of(recipientId), type, actorId, Map.of()).isEmpty();
  }

  /** 이슈 알림 푸시. 테넌트가 없으면(비정상 경로) 푸시만 건너뛴다 — 푸시 때문에 인박스 insert 가 롤백되면 안 되므로 require() 금지. */
  private void publishPush(IssueNotice n, PushCategory category, List<Long> recipients) {
    Long tenantId = TenantContext.get();
    if (tenantId == null) return;
    publisher.publishEvent(
        new InboxPushRequestedEvent(
            tenantId,
            n.type(),
            category,
            recipients,
            n.actorId(),
            n.issueId(),
            null,
            null,
            null,
            n.statusName(),
            n.agentWorkState()));
  }

  /** 이슈 밖 알림(일정·노트·리마인더) 푸시 — eventId·wikiPageId 중 해당하는 것만 싣는다. 테넌트 없으면 건너뛴다(위와 같은 이유). */
  private void publishPush(
      NotificationType type,
      PushCategory category,
      List<Long> recipients,
      Long actorId,
      Long eventId,
      Long wikiPageId) {
    Long tenantId = TenantContext.get();
    if (tenantId == null) return;
    publisher.publishEvent(
        new InboxPushRequestedEvent(
            tenantId, type, category, recipients, actorId, null, eventId, wikiPageId, null));
  }

  /**
   * 워처 조회 + 알림 생성 + fan-out 을 단일 트랜잭션 안에서 수행한다.
   *
   * <p>NotificationDispatcher 의 @Async AFTER_COMMIT 핸들러가 이 메서드를 호출하면, 이 메서드가 시작하는 트랜잭션 doBegin 시점에
   * TenantContext 가 워커 스레드에 복원(TaskDecorator 에 의해)되어 TenantAwareTransactionManager 가
   * GUC(app.tenant_id) 를 올바르게 주입한다. 결과적으로 RLS 보호 테이블(issue_watcher)의 조회가 올바른 테넌트 스코프에서 실행된다.
   *
   * <p>assignees 는 이벤트 페이로드(같은 트랜잭션에서 확정된 값), 워처는 이 트랜잭션 내 조회.
   */
  @Transactional
  public void createWithWatchersAndFanOut(
      NotificationType type,
      long issueId,
      List<UserSummary> assignees,
      Long actorId,
      Long commentId) {
    createWithWatchersAndFanOut(type, issueId, assignees, actorId, commentId, null);
  }

  /**
   * {@link #createWithWatchersAndFanOut(NotificationType, long, List, Long, Long)} + 상태 이름(WP-869).
   * 상태 변경 알림은 새 상태 이름을 알림 행·푸시에 실어 「상태를 '검토 중'으로 변경했습니다」로 보이게 한다(조사는 받침에 맞춘다).
   */
  @Transactional
  public void createWithWatchersAndFanOut(
      NotificationType type,
      long issueId,
      List<UserSummary> assignees,
      Long actorId,
      Long commentId,
      String statusName) {
    create(
        IssueNotice.of(type, actorId, issueId, commentId).withStatusName(statusName),
        assigneesAndWatchers(issueId, assignees));
  }

  /**
   * 코멘트 알림(WP-650) — 본문에서 멘션된 사람·AI 에게 ISSUE_COMMENT_MENTION(푸시 MENTION), 나머지 담당자 ∪ 워처에게 COMMENTED.
   * 멘션된 사람은 COMMENTED 에서 빼 한 사람에 1건만 만든다. 볼 수 없는 사람·작성자 제외·알림 설정 필터는 insertAndFanOut 이 그대로 건다. 워처
   * 구독은 하지 않는다(이슈 챗 멘션과 같음).
   *
   * @param mentionedIds 코멘트 본문의 멘션 토큰 id(존재 미검증 — 여기서 있는 사용자만 남긴다. 사람·AI 모두 받는다, WP-720)
   */
  @Transactional
  public void createCommentedAndFanOut(
      long issueId,
      List<UserSummary> assignees,
      List<Long> mentionedIds,
      Long actorId,
      Long commentId) {
    List<Long> mentionCandidates = mentionHydrator.filterExistingUserIds(mentionedIds);
    IssueNotice mention =
        IssueNotice.of(NotificationType.ISSUE_COMMENT_MENTION, actorId, issueId, commentId);
    List<Long> mentioned = insertAndFanOut(mention, mentionCandidates);
    if (!mentioned.isEmpty()) publishPush(mention, PushCategory.MENTION, mentioned);
    List<Long> others = new ArrayList<>(assigneesAndWatchers(issueId, assignees));
    // 실제로 멘션 알림을 받은 사람이 아니라 설정 필터 전 멘션 후보를 뺀다 — 「나를 멘션」을 끈 담당자에게 같은 코멘트가 COMMENTED 로 새어 들어가지
    // 않게(그 코멘트는 그 사람에게 멘션 알림이고, 끈 이상 아무 알림도 오지 않아야 한다). 작성자·볼 수 없는 사람은 어차피 COMMENTED 에서도 빠진다.
    others.removeAll(mentionCandidates);
    create(IssueNotice.of(NotificationType.COMMENTED, actorId, issueId, commentId), others);
  }

  /** 담당자(이벤트 페이로드) ∪ 워처. 트랜잭션 내에서 조회 — TenantAwareTransactionManager 가 GUC 를 주입한 후이므로 RLS 정책 통과. */
  private List<Long> assigneesAndWatchers(long issueId, List<UserSummary> assignees) {
    List<Long> ids = new ArrayList<>();
    if (assignees != null) assignees.forEach(u -> ids.add(u.id()));
    ids.addAll(watcherRepo.findUserIdsByIssue(issueId));
    return ids;
  }

  /**
   * 캘린더 참석자 알림 — 초대(CALENDAR_INVITED) 또는 RSVP 변경(CALENDAR_RSVP_CHANGED). actor==recipient 이면 자기 자신
   * 알림 스킵. insert 후 동일 수신자에게 SSE fan-out.
   */
  @Transactional
  public void createEventNotificationAndFanOut(
      long recipientId, NotificationType type, long actorId, long eventId) {
    // 본인 행위 → 자기 자신에게 알림 없음
    if (actorId == recipientId) return;
    if (!allowedOne(recipientId, type, actorId)) return;
    repo.insertEventNotification(recipientId, type, actorId, eventId);
    registry.fanOut(
        List.of(recipientId), "notify.created", Map.of("type", type.name(), "eventId", eventId));
    publishPush(type, PushCategory.of(type), List.of(recipientId), actorId, eventId, null);
  }

  /**
   * 노트 공유 알림(WP-579) — WIKI_SHARED(새로 지정된 사람)·WIKI_SHARE_ACCESS_REQUESTED(공유한
   * 사람)·WIKI_SHARE_ACCESS_APPROVED (요청자) 한 건. actor==recipient 면 자기 자신 알림은 만들지 않는다. insert 후 SSE
   * fan-out 과 푸시 이벤트를 낸다.
   *
   * @param message 공유한 사람이 덧붙인 메시지(WIKI_SHARED 만, 없으면 null)
   */
  @Transactional
  public void createWikiShareNotificationAndFanOut(
      long recipientId, NotificationType type, long actorId, long pageId, String message) {
    if (actorId == recipientId) return;
    if (!allowedOne(recipientId, type, actorId)) return;
    repo.insertWikiShareNotification(recipientId, type, actorId, pageId, message);
    registry.fanOut(
        List.of(recipientId), "notify.created", Map.of("type", type.name(), "wikiPageId", pageId));
    publishPush(type, PushCategory.of(type), List.of(recipientId), actorId, null, pageId);
  }

  /**
   * 일정 변경·취소 알림(WP-712) — 주최자가 시간·장소를 바꿨거나 일정을 지웠을 때 참석자에게. 알림 행에 그때의 제목·시작 시각을 남긴다(취소는 가리킬 일정이 없어
   * eventId=null). 행위자 본인은 받지 않는다. insert 후 SSE fan-out·푸시.
   */
  @Transactional
  public void createEventNoticesAndFanOut(
      List<Long> recipientIds,
      NotificationType type,
      long actorId,
      Long eventId,
      String eventTitle,
      OffsetDateTime eventStartsAt) {
    List<Long> recipients =
        allowed(
            recipientIds.stream().filter(id -> id != actorId).distinct().toList(),
            type,
            actorId,
            Map.of());
    if (recipients.isEmpty()) return;
    for (long recipientId : recipients) {
      repo.insertEventNotice(recipientId, type, actorId, eventId, eventTitle, eventStartsAt);
    }
    // eventId 가 null 일 수 있어 Map.of 대신 type 만 싣는다 — 클라는 수신 즉시 목록을 다시 읽는다.
    registry.fanOut(recipients, "notify.created", Map.of("type", type.name()));
    Long tenantId = TenantContext.get();
    if (tenantId == null) return;
    publisher.publishEvent(
        new InboxPushRequestedEvent(
            tenantId,
            type,
            PushCategory.of(type),
            recipients,
            actorId,
            null,
            eventId,
            null,
            eventId == null ? eventTitle : null));
  }

  /**
   * 캘린더 리마인더 알림 — 수신자=일정 소유자 1인, actor 없음. insert 후 동일 수신자에게 SSE fan-out. (이슈 경로와 분리 — issue_id 없는
   * 알림을 안전히 생성하고 Map.of NPE 회피)
   */
  @Transactional
  public void createReminderAndFanOut(long recipientId, long eventId) {
    // 행위자 없음 → 「사람이」 칸으로 판정.
    if (!allowedOne(recipientId, NotificationType.REMINDER, null)) return;
    repo.insertReminder(recipientId, eventId);
    registry.fanOut(
        List.of(recipientId), "notify.created", Map.of("type", "REMINDER", "eventId", eventId));
    publishPush(
        NotificationType.REMINDER,
        PushCategory.CALENDAR,
        List.of(recipientId),
        null,
        eventId,
        null);
  }

  @Transactional(readOnly = true)
  public List<NotificationResponse> listRecent(long recipientId, int limit, long offset) {
    // 지금 볼 수 없는 프로젝트의 이슈 알림은 빼고 준다(WP-491) — 프로젝트에서 빠진 뒤에도 예전 알림이 바뀐 제목을 보여 주던 문제.
    return repo.listRecent(recipientId, isAdmin(recipientId), limit, offset);
  }

  @Transactional(readOnly = true)
  public long countUnread(long recipientId) {
    return repo.countUnread(recipientId, isAdmin(recipientId));
  }

  /** ADMIN 은 비개인 프로젝트를 모두 볼 수 있다(ProjectAccessGuard 와 같은 우회 규칙). */
  private boolean isAdmin(long userId) {
    return permissionChecker.userHasRole(userId, "ADMIN");
  }

  /** 단건 읽음. 실제로 바뀐 경우(>0)에만 다른 탭·기기에 resource.changed 를 발행한다. */
  @Transactional
  public int markRead(long recipientId, long id) {
    int n = repo.markRead(recipientId, id);
    if (n > 0) changeNotifier.read(recipientId, List.of(id));
    return n;
  }

  /** 한 이슈의 내 알림을 모두 읽음으로 — AI 가 그 이슈를 처리한 뒤 한 번에 읽음 처리한다(WP-720). 바뀐 것이 있을 때만 다른 탭·기기에 알린다. */
  @Transactional
  public int markReadByIssue(long recipientId, long issueId) {
    List<Long> ids = repo.markReadByIssue(recipientId, issueId);
    if (!ids.isEmpty()) changeNotifier.read(recipientId, ids);
    return ids.size();
  }

  /** 전체 읽음. 읽을 것이 있었을 때(>0)만 발행하며, 대상 id 는 알 수 없어 빈 목록으로 보낸다. */
  @Transactional
  public int markAllRead(long recipientId) {
    int n = repo.markAllRead(recipientId);
    if (n > 0) changeNotifier.read(recipientId, List.of());
    return n;
  }
}
