package com.workplace.auth.service;

import com.workplace.auth.dto.AiAgentCredentialRow;
import com.workplace.auth.exception.AssistantLimitWaitingException;
import com.workplace.auth.exception.HomeAssistantNotConfiguredException;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.repository.AssistantConfigRepository.ConfigRow;
import com.workplace.auth.repository.AssistantLimitWaitRepository;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 홈을 담당할 비서를 caller 기준으로 해석한다. 개인 비서(토큰 있으면) → 공용 비서(토큰 있으면) → 미설정 예외. 해석된 AGENT 의 assistant_config
 * 를 디폴트와 병합해 AssistantSpec 으로 만든다.
 */
@Service
@RequiredArgsConstructor
public class AssistantResolver {

  private final PersonalAssistantRepository personalRepo;
  private final WorkspaceAssistantRepository workspaceRepo;
  private final AssistantConfigRepository configRepo;
  private final AiAgentCredentialService credentialService;
  private final SuggestionModelPolicy suggestionModelPolicy;
  private final AssistantLimitWaitRepository waitRepo;

  /**
   * 개인 → 공용 순으로 해석해 예외로 돌려준다 — 직접 요청(채팅·초안 등)용. 없으면 미설정 예외, 대기 중이면 {@link
   * AssistantLimitWaitingException}(503 즉답).
   */
  @Transactional(readOnly = true)
  public AssistantSpec resolve(long callerId) {
    AssistantResolution r = resolution(callerId);
    r.throwIfWaiting();
    return r.readySpec()
        .orElseThrow(
            () -> new HomeAssistantNotConfiguredException("홈 비서가 아직 설정되지 않았어요. 관리자에게 문의해주세요."));
  }

  /**
   * 개인 비서(토큰 보유) → 공용 비서(토큰 보유) 순의 해석 결과(WP-2108). 서버가 부를 수 있는 활성 자격이 있는 첫 후보를 고르고, <b>그 후보가 사용 한도
   * 대기 중이면 WAITING</b> 을 돌려준다 — 다음 후보로 넘어가지 않는다(개인이 쉬는 동안 공통 비서로 몰래 바꿔 부르지 않는다).
   */
  @Transactional(readOnly = true)
  public AssistantResolution resolution(long callerId) {
    return resolveCandidate(personalCandidate(callerId).or(this::workspaceCandidate));
  }

  /** 개인 비서만의 해석 결과 — 공통 비서로 폴백하지 않는다. 대기 중이면 WAITING. */
  @Transactional(readOnly = true)
  public AssistantResolution personalResolution(long callerId) {
    return resolveCandidate(personalCandidate(callerId));
  }

  /** 공용 비서만의 해석 결과. 대기 중이면 WAITING. */
  @Transactional(readOnly = true)
  public AssistantResolution workspaceResolution() {
    return resolveCandidate(workspaceCandidate());
  }

  /** 프로젝트 비서의 해석 결과 — 개인 프로젝트는 소유자 기준 {@link #resolution}, 팀·공개는 {@link #workspaceResolution}. */
  @Transactional(readOnly = true)
  public AssistantResolution projectResolution(boolean personal, Long ownerId) {
    return personal ? resolution(ownerId) : workspaceResolution();
  }

  /**
   * 개인 비서(토큰 보유) → 공용 비서(토큰 보유) 순으로 해석. 둘 다 없거나 고른 비서가 한도 대기 중이면 empty(예외 없음 — 호출 측이 skip/4xx 분기).
   *
   * <p>이슈 요약처럼 caller 신원이 있는 PERSONAL 프로젝트에서 사용한다.
   */
  @Transactional(readOnly = true)
  public Optional<AssistantSpec> resolveOrEmpty(long callerId) {
    return resolution(callerId).readySpec();
  }

  /**
   * caller 의 개인 비서(토큰 보유)만 해석. 없으면(또는 한도 대기 중이면) empty(공통 비서로 폴백하지 않음).
   *
   * <p>메일 개인 요약(T2)처럼, 공통 비서로 폴백하면 객관적 요약과 동일 결과를 사람별로 중복 저장하게 되는 경우에 쓴다. 개인 비서가 실제로 있을 때만 개인 산출물을
   * 만든다.
   */
  @Transactional(readOnly = true)
  public Optional<AssistantSpec> resolvePersonalOrEmpty(long callerId) {
    return personalResolution(callerId).readySpec();
  }

  /**
   * 테넌트 공용 비서(토큰 보유)만 해석. 없으면(또는 한도 대기 중이면) empty(예외 없음).
   *
   * <p>이슈 요약처럼 특정 소유자가 없는 TEAM 프로젝트에서 사용한다.
   */
  @Transactional(readOnly = true)
  public Optional<AssistantSpec> resolveWorkspaceOrEmpty() {
    return workspaceResolution().readySpec();
  }

  /**
   * 프로젝트에 붙는 비서 — 개인 프로젝트는 소유자 기준 {@link #resolveOrEmpty}(개인 비서 → 공용 비서 폴백), 팀·공개 프로젝트는 {@link
   * #resolveWorkspaceOrEmpty}(공용 비서). 이슈 AI 요약·분류·질문 선택지 추출(WP-1569)이 같은 규칙을 한 곳에서 쓴다. auth 가
   * project 를 import 하지 않도록 프로젝트 행 대신 유형과 소유자만 받는다.
   *
   * @param personal 개인 프로젝트인가(ProjectRow.isPersonal)
   * @param ownerId 프로젝트 소유자 — 개인 프로젝트일 때만 쓴다
   */
  @Transactional(readOnly = true)
  public Optional<AssistantSpec> resolveForProject(boolean personal, Long ownerId) {
    return personal ? resolveOrEmpty(ownerId) : resolveWorkspaceOrEmpty();
  }

  /**
   * caller 의 비서(개인 → 공용 후보)가 지금 사용 한도 대기 중인가 — {@link #resolution} 의 waiting 판정과 같지만 사양(설정·추천 모델)을
   * 만들지 않아 가볍다. 후보가 없으면 false.
   */
  @Transactional(readOnly = true)
  public boolean isWaiting(long callerId) {
    return personalCandidate(callerId)
        .or(this::workspaceCandidate)
        .map(row -> waitRepo.findActiveUntil(row.id()).isPresent())
        .orElse(false);
  }

  /** 비서가 있는가 — <b>대기를 보지 않는다</b>(설정·가용성 판단용: 한도에 걸려 쉬는 중에도 비서는 「있다」). caller 기준 개인 → 공용. */
  @Transactional(readOnly = true)
  public boolean hasAssistant(long callerId) {
    return personalCandidate(callerId).or(this::workspaceCandidate).isPresent();
  }

  /** 개인 비서가 있는가 — 대기를 보지 않는다. */
  @Transactional(readOnly = true)
  public boolean hasPersonalAssistant(long callerId) {
    return personalCandidate(callerId).isPresent();
  }

  /** 공용 비서가 있는가 — 대기를 보지 않는다. */
  @Transactional(readOnly = true)
  public boolean hasWorkspaceAssistant() {
    return workspaceCandidate().isPresent();
  }

  private Optional<AiAgentCredentialRow> personalCandidate(long callerId) {
    return pickWithActiveToken(personalRepo.findAgentId(callerId));
  }

  private Optional<AiAgentCredentialRow> workspaceCandidate() {
    return pickWithActiveToken(workspaceRepo.findAgentId());
  }

  /** 고른 후보를 해석 결과로 — 후보 없음 none, 자격이 대기 중이면 waiting, 아니면 ready. */
  private AssistantResolution resolveCandidate(Optional<AiAgentCredentialRow> candidate) {
    if (candidate.isEmpty()) return AssistantResolution.none();
    AiAgentCredentialRow row = candidate.get();
    return waitRepo
        .findActiveUntil(row.id())
        .map(until -> AssistantResolution.waiting(row.id(), until))
        .orElseGet(() -> AssistantResolution.ready(buildSpec(row)));
  }

  /**
   * 후보 AGENT 에 서버가 부를 수 있는 active 자격증명이 있을 때만 통과 — 로그인 정보 계정(genia·chatgpt)은 「토큰 없음」으로
   * 본다(WP-1296·1297). 그 활성 행을 돌려줘 buildSpec 이 provider 를 다시 조회하지 않게 한다(행의 userId 가 곧 AGENT id).
   */
  private Optional<AiAgentCredentialRow> pickWithActiveToken(Optional<Long> candidate) {
    return candidate.flatMap(credentialService::findServerUsableActive);
  }

  /**
   * config 를 디폴트와 병합. WP-139: 추천 모델은 연결 제공자(활성 자격증명의 provider)로 해석해 싣는다(호출부는 그대로 ai-agent 에 넘긴다).
   */
  private AssistantSpec buildSpec(AiAgentCredentialRow active) {
    long agentId = active.userId();
    ConfigRow c = configRepo.find(agentId).orElse(new ConfigRow(null, null, null, null));
    String provider = active.provider();
    return new AssistantSpec(
        agentId,
        c.model() != null ? c.model() : AssistantDefaults.MODEL,
        c.thinkingDepth() != null ? c.thinkingDepth() : AssistantDefaults.THINKING_DEPTH,
        c.maxTurns() != null ? c.maxTurns() : AssistantDefaults.MAX_TURNS,
        suggestionModelPolicy.requestModel(c.suggestionModel(), provider),
        active.id());
  }
}
