package com.workplace.messaging.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.action.ConfirmActionDispatcher;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.messaging.dto.ConfirmProposalRequest;
import com.workplace.messaging.dto.CreateProposalRequest;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.dto.ProjectCandidateDto;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.exception.InvalidDelegationProjectException;
import com.workplace.messaging.exception.NoDelegationCandidateException;
import com.workplace.messaging.exception.ProposalNotDelegatorException;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageCreatedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.MessageActionProposalRepository;
import com.workplace.messaging.repository.MessageRepository;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.repository.ProjectRepository;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 채팅 L3 위임 제안 오케스트레이션 — 제안 메시지(AGENT 작성)+제안 행 생성, 승인 시 이슈 생성, 거부 처리. */
@Service
@RequiredArgsConstructor
public class MessagingProposalService {

  private final MessageRepository messageRepo;
  private final MessageActionProposalRepository proposalRepo;
  private final ProjectRepository projectRepo;
  private final ProjectMemberRepository projectMemberRepo; // Task 1: 프로젝트 멤버십 검증용(후보 계산)
  private final ChannelMemberRepository memberRepo; // Fix 1: 채널 멤버십 검증용
  private final MessageService messageService; // findOneForProposal enrich 재사용
  private final ApplicationEventPublisher publisher;
  private final ObjectMapper objectMapper;
  private final ConfirmActionDispatcher confirmDispatcher; // 공용 액션 디스패처(이슈·일정 생성 위임)

  /**
   * AI 제안 — 채널에 AGENT 작성 카드 메시지 + 제안 행(PENDING) 생성. 프로젝트는 후보(위임자·AI 둘 다 멤버) 중 AI 가 고른 projectKey,
   * 없으면 첫 후보(updated_at 최신순). 후보 0건이면 NoDelegationCandidateException.
   *
   * <p>제안 행을 메시지 publish 전에 INSERT 해 AFTER_COMMIT SSE 가 proposal 을 enrich 한 응답을 전파하도록 한다.
   */
  @Transactional
  public MessageResponse propose(long agentId, long channelId, CreateProposalRequest req) {
    // Fix 1: 채널 멤버십 가드 — AI 에이전트(agentId)와 위임자(proposedByUserId) 모두 채널 멤버여야 한다.
    // 채널 밖 위임자 스푸핑 및 미가입 에이전트 제안을 차단한다(Spec §3.3).
    if (!memberRepo.isMember(channelId, agentId))
      throw new ChannelNotMemberException(channelId, agentId);
    if (!memberRepo.isMember(channelId, req.proposedByUserId()))
      throw new ChannelNotMemberException(channelId, req.proposedByUserId());

    // 일정 제안 — 프로젝트 개념이 없으므로 후보 계산을 건너뛰고 일정 payload 로 분기한다.
    if ("calendar.create_event".equals(req.actionType())) {
      return proposeCalendarEvent(agentId, channelId, req);
    }

    // 후보 계산(위임자·AI 둘 다 멤버인 프로젝트 목록).
    // AI 가 준 projectKey 가 후보에 있으면 그것을, 아니면 첫 후보(updated_at 최신순)를 선택한다.
    var candidates = candidateProjects(req.proposedByUserId(), agentId);
    // 위임자·AI 공유 프로젝트가 없으면 친화적 400 예외 — 사용자에게 "함께하는 프로젝트 없음" 안내.
    if (candidates.isEmpty()) throw new NoDelegationCandidateException();
    var chosen =
        candidates.stream()
            .filter(c -> c.key().equals(req.projectKey()))
            .findFirst()
            .orElse(candidates.get(0)); // 폴백=첫 후보(updated_at 최신순)
    var project =
        projectRepo
            .findByKey(chosen.key())
            .orElseThrow(() -> new IllegalStateException("프로젝트 조회 실패: " + chosen.key()));

    // 카드 fallback 본문 — 마크다운 미지원 클라이언트·접근성용.
    String fallback = "💡 이슈 생성을 제안했어요: **" + req.title() + "** (프로젝트: " + project.name() + ")";
    // AGENT 작성 메시지 INSERT. parentMessageId 는 스레드 미러(인라인이면 null).
    long messageId =
        messageRepo.insert(channelId, agentId, fallback, List.of(), req.parentMessageId());

    // payload JSON 구성 — 승인 시 이슈 생성에 필요한 메타데이터.
    ObjectNode payload = objectMapper.createObjectNode();
    payload.put("title", req.title());
    if (req.body() != null) payload.put("body", req.body());
    payload.put("priority", req.priority() != null ? req.priority() : "MID");
    payload.put("projectId", project.id());
    payload.put("projectKey", project.key());
    payload.put("projectName", project.name());
    // 후보 목록 직렬화 — 카드 노출 및 다음 태스크(confirm override) 검증에 사용.
    ArrayNode arr = payload.putArray("candidates");
    for (var c : candidates) {
      var o = arr.addObject();
      o.put("key", c.key());
      o.put("name", c.name());
    }
    // 제안 행 INSERT(PENDING). proposal enrich fetch 전에 삽입해야 findOneForProposal 이 proposal 을 포함.
    proposalRepo.insert(
        messageId, channelId, req.proposedByUserId(), req.actionType(), payload.toString());

    // proposal enrich 된 응답으로 SSE 전파(AFTER_COMMIT 리스너).
    MessageResponse saved = messageService.findOneForProposal(messageId, agentId);
    publisher.publishEvent(new MessageCreatedEvent(channelId, saved));
    return saved;
  }

  /**
   * 위임자 승인(하위호환) — 기존 이슈 확인 호출부(테스트 포함)가 사용하는 시그니처. projectKey 문자열만 전달한다.
   *
   * <p>내부 구현은 {@link #confirmWithBody(long, long, ConfirmProposalRequest)} 에 위임한다.
   *
   * <p>설계 주의: {@code confirmWithBody} 와 이름이 다른 이유 — {@code confirm(String)} 과 {@code
   * confirm(ConfirmProposalRequest)} 가 동명 오버로드로 공존하면 기존 테스트의 null 리터럴 호출이 모호해져 컴파일 에러가 발생한다. 따라서
   * full-body 메서드는 {@code confirmWithBody} 라는 별도 이름으로 선언하고, String 시그니처를 유지해 기존 테스트를 무수정으로 통과시킨다.
   *
   * @param projectKeyOverride 위임자가 카드 드롭다운으로 선택한 override 키. null 이면 제안 저장값 사용.
   */
  // Task 4 주의: 이 @Transactional 은 실효 없음 — 같은 클래스 내 self-invocation 은 Spring 프록시를 우회하므로
  // 실제 트랜잭션 경계는 confirmWithBody 의 @Transactional 이 제공한다. 문서 목적으로만 남겨둔다.
  @Transactional
  public MessageResponse confirm(long callerId, long proposalId, String projectKeyOverride) {
    return confirmWithBody(
        callerId,
        proposalId,
        new ConfirmProposalRequest(projectKeyOverride, null, null, null, null));
  }

  /**
   * 위임자 승인(편집 override 포함) — 컨트롤러가 직접 호출한다. 사람 권한으로 이슈/일정 생성, 제안 CONFIRMED, 결과 메시지(AGENT 작성) 게시.
   *
   * <p>이슈 생성 시 발행되는 IssueCreated/Assigned 이벤트가 기존 이슈-AI 흐름을 자동 발화한다. body 에 편집
   * override(title·startsAt·endsAt·location) 포함 가능 — Task 5 에서 actionType 분기(일정) 추가.
   *
   * <p>Task 5 주의: 일정 분기 구현 시 이 메서드 {@code confirmWithBody} 를 편집한다({@code confirm} 이 아님).
   *
   * @param body 승인 요청(편집 override 포함). null 이면 모든 필드 null 처리.
   */
  @Transactional
  public MessageResponse confirmWithBody(
      long callerId, long proposalId, ConfirmProposalRequest body) {
    // body 에서 이슈용 projectKey override 추출. null body 또는 null projectKey 이면 제안 저장값 사용.
    String projectKeyOverride = body == null ? null : body.projectKey();
    var row =
        proposalRepo
            .findById(proposalId)
            .orElseThrow(() -> new IllegalArgumentException("제안 없음: " + proposalId));
    // 위임자 검증 — 위임자(proposedByUserId)만 승인 가능.
    if (row.proposedByUserId() != callerId) throw new ProposalNotDelegatorException();
    // 멱등 가드 — 이미 처리된 제안은 IllegalStateException.
    if (!"PENDING".equals(row.status()))
      throw new IllegalStateException("이미 처리된 제안: " + row.status());

    // payload 파싱 — 이슈/일정 생성 메타데이터.
    JsonNode p;
    try {
      p = objectMapper.readTree(row.payloadJson());
    } catch (Exception e) {
      throw new IllegalStateException("payload 파싱 실패", e);
    }

    // 일정 제안 — 프로젝트 후보 검증 없이 공용 디스패처로 분기.
    if ("calendar.create_event".equals(row.actionType())) {
      return confirmCalendarEvent(callerId, row, p, body);
    }

    // 담당 AGENT id = 제안 카드 메시지 작성자(AI). override 검증(candidateProjects)에 필요하므로 projectKey 결정 전 회수.
    long agentId =
        messageRepo
            .findRef(row.messageId())
            .map(MessageRepository.MessageRef::authorId)
            .orElseThrow(() -> new IllegalStateException("제안 메시지 없음: " + row.messageId()));

    // 유효 projectKey 결정 — override 있으면 그것, 없으면 payload 저장값.
    // 왜: 두 경로 일관 검증 — override 경로뿐 아니라 저장값도 propose→confirm 사이에 스테일될 수 있으므로
    // 둘 다 후보 재계산으로 검증해 도메인 에러(InvalidDelegationProjectException)를 일관되게 발생시킨다.
    String projectKey =
        (projectKeyOverride != null && !projectKeyOverride.isBlank())
            ? projectKeyOverride
            : p.path("projectKey").asText();
    if (candidateProjects(row.proposedByUserId(), agentId).stream()
        .noneMatch(c -> c.key().equals(projectKey)))
      throw new InvalidDelegationProjectException(projectKey);

    String title = p.path("title").asText();
    String priority = p.hasNonNull("priority") ? p.get("priority").asText() : "MID";
    // 이슈 본문 — payload 저장값 사용(body 파라미터는 일정 override 용, 이슈 본문은 항상 제안 저장값).
    String issueBody = p.hasNonNull("body") ? p.get("body").asText() : null;

    // #540: 이슈 생성을 공용 ConfirmActionDispatcher(issue.create)로 통일.
    // candidateProjects 검증(위)은 채팅 위임 고유 가드이므로 유지하고, 실행만 디스패처로 위임한다.
    // confirmWithBody 가 @Transactional 이므로 디스패처는 동일 tx 안에서 실행돼 RLS GUC 주입 보장.
    ObjectNode issueParams = objectMapper.createObjectNode();
    issueParams.put("projectKey", projectKey);
    issueParams.put("title", title);
    if (issueBody != null) issueParams.put("body", issueBody);
    issueParams.put("priority", priority);
    issueParams.set("assigneeIds", objectMapper.valueToTree(List.of(agentId)));
    var issue = (IssueResponse) confirmDispatcher.confirm(callerId, "issue.create", issueParams);
    String issueKey = issue.projectKey() + "-" + issue.number();

    // Fix 2: 동시 이중-confirm 방어 — updateStatus 는 WHERE status='PENDING' 조건을 갖는다.
    // false(=0행 갱신) 이면 경쟁자가 먼저 CONFIRM 한 것 → 롤백으로 이미 생성된 이슈까지 되돌린다.
    if (!proposalRepo.updateStatus(proposalId, "CONFIRMED", issueKey, callerId)) {
      throw new IllegalStateException("제안이 이미 처리되었습니다: " + proposalId);
    }

    // 결과 메시지 삽입(AGENT 작성, 같은 스레드에 미러).
    Long parentMessageId =
        messageRepo
            .findRef(row.messageId())
            .map(MessageRepository.MessageRef::parentMessageId)
            .orElse(null);
    String url = "/projects/" + issue.projectKey() + "/issues/" + issue.number();
    String resultBody =
        "✅ **" + issueKey + "** 「" + title + "」 만들었어요. 제가 맡았습니다 → [이슈 보기](" + url + ")";
    long resultMsgId =
        messageRepo.insert(row.channelId(), agentId, resultBody, List.of(), parentMessageId);

    // 결과 메시지 SSE 전파(AFTER_COMMIT).
    MessageResponse resultMsg = messageService.findOneForProposal(resultMsgId, agentId);
    publisher.publishEvent(new MessageCreatedEvent(row.channelId(), resultMsg));

    // 갱신된 카드(CONFIRMED proposal 포함)를 HTTP 응답으로 반환 — 웹이 채널 쿼리 invalidate.
    return messageService.findOneForProposal(row.messageId(), agentId);
  }

  /**
   * 일정 제안 승인 — payload + 편집 override 로 params 를 만들어 ConfirmActionDispatcher 에 위임(사람
   * 권한·calendar:write). 생성된 일정 id 로 result_issue_key="event:{id}" 기록 + 결과 메시지(일정 보기 링크) 게시.
   */
  private MessageResponse confirmCalendarEvent(
      long callerId,
      MessageActionProposalRepository.ProposalRow row,
      JsonNode payload,
      ConfirmProposalRequest body) {
    // payload → params(ObjectNode). 편집 override(있으면)로 덮어쓴다.
    ObjectNode params = (ObjectNode) payload.deepCopy();
    // 충돌 목록은 카드 노출용 — CalendarEventRequest 에 없는 필드라 unknown-property 오류 방지를 위해 제거.
    params.remove("conflicts");
    if (body != null) {
      if (body.title() != null && !body.title().isBlank()) params.put("title", body.title());
      if (body.startsAt() != null) params.put("startsAt", body.startsAt().toString());
      if (body.endsAt() != null) params.put("endsAt", body.endsAt().toString());
      if (body.location() != null) params.put("location", body.location());
    }

    // 공용 디스패처 — 권한검사(calendar:write) + 매핑·검증 + CalendarEventService.create.
    Object result = confirmDispatcher.confirm(callerId, "calendar.create_event", params);
    var event = (CalendarEventResponse) result;

    // 동시 이중-confirm 방어 — updateStatus 는 WHERE status='PENDING' 조건을 갖는다.
    // 0행 갱신이면 경쟁자가 먼저 처리 → 롤백으로 이미 생성된 일정까지 되돌린다.
    if (!proposalRepo.updateStatus(row.id(), "CONFIRMED", "event:" + event.id(), callerId)) {
      throw new IllegalStateException("제안이 이미 처리되었습니다: " + row.id());
    }

    // 결과 메시지(AGENT 작성, 같은 스레드에 미러).
    long agentId =
        messageRepo
            .findRef(row.messageId())
            .map(MessageRepository.MessageRef::authorId)
            .orElseThrow(() -> new IllegalStateException("제안 메시지 없음: " + row.messageId()));
    Long parentMessageId =
        messageRepo
            .findRef(row.messageId())
            .map(MessageRepository.MessageRef::parentMessageId)
            .orElse(null);
    String resultBody =
        "✅ 「"
            + params.path("title").asText()
            + "」 일정 만들었어요 → [일정 보기](/calendar?event="
            + event.id()
            + ")";
    long resultMsgId =
        messageRepo.insert(row.channelId(), agentId, resultBody, List.of(), parentMessageId);
    MessageResponse resultMsg = messageService.findOneForProposal(resultMsgId, agentId);
    publisher.publishEvent(new MessageCreatedEvent(row.channelId(), resultMsg));

    // 갱신된 카드(CONFIRMED proposal 포함)를 HTTP 응답으로 반환.
    return messageService.findOneForProposal(row.messageId(), agentId);
  }

  /**
   * 일정 생성 제안 — 프로젝트 후보 없이 일정 payload(title·시간·장소·conflicts)로 카드 메시지 + 제안 행(PENDING)을 만든다. 충돌 정보는
   * ai-agent 가 listEvents 로 결정적으로 계산해 req.conflicts() 로 전달한다(여기서 재계산하지 않음).
   */
  private MessageResponse proposeCalendarEvent(
      long agentId, long channelId, CreateProposalRequest req) {
    // 카드 fallback 본문 — 마크다운 미지원 클라이언트·접근성용.
    String fallback = "💡 일정 생성을 제안했어요: **" + req.title() + "**";
    long messageId =
        messageRepo.insert(channelId, agentId, fallback, List.of(), req.parentMessageId());

    // payload JSON — 승인 시 일정 생성에 필요한 필드. 이슈 전용 필드(projectKey 등)는 넣지 않는다.
    // ISO_OFFSET_DATE_TIME 로 직렬화해 초 단위를 포함한 전체 형식("T10:00:00+09:00")을 보존한다.
    DateTimeFormatter isoFmt = DateTimeFormatter.ISO_OFFSET_DATE_TIME;
    ObjectNode payload = objectMapper.createObjectNode();
    payload.put("title", req.title());
    if (req.startsAt() != null) payload.put("startsAt", isoFmt.format(req.startsAt()));
    if (req.endsAt() != null) payload.put("endsAt", isoFmt.format(req.endsAt()));
    payload.put("allDay", req.allDay() != null && req.allDay());
    if (req.location() != null) payload.put("location", req.location());
    if (req.reminderMinutes() != null) payload.put("reminderMinutes", req.reminderMinutes());
    if (req.recurrenceRule() != null) payload.put("recurrenceRule", req.recurrenceRule());
    // 충돌 목록 직렬화(카드 노출용). ai-agent 가 보낸 그대로 운반.
    if (req.conflicts() != null && !req.conflicts().isEmpty()) {
      ArrayNode arr = payload.putArray("conflicts");
      for (var c : req.conflicts()) {
        var o = arr.addObject();
        o.put("id", c.id());
        o.put("title", c.title());
        o.put("startsAt", c.startsAt());
        o.put("endsAt", c.endsAt());
      }
    }

    proposalRepo.insert(
        messageId, channelId, req.proposedByUserId(), req.actionType(), payload.toString());

    MessageResponse saved = messageService.findOneForProposal(messageId, agentId);
    publisher.publishEvent(new MessageCreatedEvent(channelId, saved));
    return saved;
  }

  /**
   * L3 위임 후보 프로젝트 = 위임자가 속한 프로젝트(개인·팀 모두) 중 AI(agentId)도 멤버인 것.
   *
   * <p>개인 프로젝트도 AI 가 명시적으로 멤버로 추가된 경우에만 후보가 된다(개인 자동 포함 없음). AGENT 멤버십은 사용자 명시
   * 액션(ProjectService.addMember)으로만 생성 — 자동추가 절대 없음(#418 정책 통일).
   */
  @Transactional(readOnly = true)
  public List<ProjectCandidateDto> candidateProjects(long delegatorId, long agentId) {
    List<ProjectCandidateDto> out = new ArrayList<>();
    // 위임자가 속한 프로젝트(개인·팀 공통)를 순회하며 AI 멤버 여부만 확인.
    for (var p : projectRepo.findAllForUser(delegatorId, false, 0, 500)) {
      if (projectMemberRepo.isMember(p.id(), agentId)) {
        out.add(new ProjectCandidateDto(p.key(), p.name()));
      }
    }
    return out;
  }

  /** 위임자 거부 — 제안 REJECTED, 결과 메시지 없음. 갱신된 카드 메시지 반환. */
  @Transactional
  public MessageResponse reject(long callerId, long proposalId) {
    var row =
        proposalRepo
            .findById(proposalId)
            .orElseThrow(() -> new IllegalArgumentException("제안 없음: " + proposalId));
    // 위임자 검증.
    if (row.proposedByUserId() != callerId) throw new ProposalNotDelegatorException();
    // 멱등 가드.
    if (!"PENDING".equals(row.status()))
      throw new IllegalStateException("이미 처리된 제안: " + row.status());
    // Fix 2(reject): 동시 이중-reject 방어 — updateStatus false 이면 이미 처리됨.
    if (!proposalRepo.updateStatus(proposalId, "REJECTED", null, callerId)) {
      throw new IllegalStateException("제안이 이미 처리되었습니다: " + proposalId);
    }
    // 갱신된 카드(REJECTED proposal 포함) 반환 — 결과 메시지 없음.
    return messageService.findOneForProposal(row.messageId(), callerId);
  }
}
