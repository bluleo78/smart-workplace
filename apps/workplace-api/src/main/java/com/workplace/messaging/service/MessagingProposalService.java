package com.workplace.messaging.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.service.IssueService;
import com.workplace.messaging.dto.CreateProposalRequest;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.exception.ProposalNotDelegatorException;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageCreatedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.MessageActionProposalRepository;
import com.workplace.messaging.repository.MessageRepository;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.PersonalProjectProvisioner;
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
  private final ChannelMemberRepository memberRepo; // Fix 1: 채널 멤버십 검증용
  private final PersonalProjectProvisioner provisioner; // Fix 5: 개인 프로젝트 온디맨드 프로비저닝
  private final MessageService messageService; // findOneForProposal enrich 재사용
  private final ApplicationEventPublisher publisher;
  private final ObjectMapper objectMapper;
  private final IssueService issueService; // Task 4: 승인 시 이슈 생성

  /**
   * AI 제안 — 채널에 AGENT 작성 카드 메시지 + 제안 행(PENDING) 생성. 프로젝트 기본값=위임자 개인 프로젝트.
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

    // Fix 5: 위임자 기본 개인 프로젝트 온디맨드 프로비저닝 — REQUIRES_NEW 로 독립 커밋.
    // HUMAN 최초 위임 시 프로젝트가 아직 없을 수 있으므로 선행 보장 후 조회한다.
    provisioner.ensureDefaultPersonal(req.proposedByUserId());

    // 위임자의 기본 개인 프로젝트 조회 — 없으면 제안 불가(오케스트레이션 전제 조건).
    var project =
        projectRepo
            .findDefaultPersonal(req.proposedByUserId())
            .orElseThrow(
                () -> new IllegalStateException("위임자 개인 프로젝트 없음: " + req.proposedByUserId()));

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
    // 제안 행 INSERT(PENDING). proposal enrich fetch 전에 삽입해야 findOneForProposal 이 proposal 을 포함.
    proposalRepo.insert(
        messageId, channelId, req.proposedByUserId(), req.actionType(), payload.toString());

    // proposal enrich 된 응답으로 SSE 전파(AFTER_COMMIT 리스너).
    MessageResponse saved = messageService.findOneForProposal(messageId, agentId);
    publisher.publishEvent(new MessageCreatedEvent(channelId, saved));
    return saved;
  }

  /**
   * 위임자 승인 — 사람 권한으로 이슈 생성(AGENT 자기담당), 제안 CONFIRMED, 결과 메시지(AGENT 작성) 게시.
   *
   * <p>이슈 생성 시 발행되는 IssueCreated/Assigned 이벤트가 기존 이슈-AI 흐름을 자동 발화한다.
   */
  @Transactional
  public MessageResponse confirm(long callerId, long proposalId) {
    var row =
        proposalRepo
            .findById(proposalId)
            .orElseThrow(() -> new IllegalArgumentException("제안 없음: " + proposalId));
    // 위임자 검증 — 위임자(proposedByUserId)만 승인 가능.
    if (row.proposedByUserId() != callerId) throw new ProposalNotDelegatorException();
    // 멱등 가드 — 이미 처리된 제안은 IllegalStateException.
    if (!"PENDING".equals(row.status()))
      throw new IllegalStateException("이미 처리된 제안: " + row.status());

    // payload 파싱 — 이슈 생성 메타데이터.
    JsonNode p;
    try {
      p = objectMapper.readTree(row.payloadJson());
    } catch (Exception e) {
      throw new IllegalStateException("payload 파싱 실패", e);
    }
    String projectKey = p.path("projectKey").asText();
    String title = p.path("title").asText();
    String priority = p.hasNonNull("priority") ? p.get("priority").asText() : "MID";
    String body = p.hasNonNull("body") ? p.get("body").asText() : null;

    // 담당 AGENT id = 제안 카드 메시지 작성자(AI). findRef 로 회수.
    long agentId =
        messageRepo
            .findRef(row.messageId())
            .map(MessageRepository.MessageRef::authorId)
            .orElseThrow(() -> new IllegalStateException("제안 메시지 없음: " + row.messageId()));

    // 사람(callerId) 권한으로 이슈 생성. assigneeIds=[agentId] — AGENT 가 담당.
    var issue =
        issueService.create(
            callerId,
            projectKey,
            new CreateIssueRequest(title, body, priority, null, List.of(agentId), null, null));
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
