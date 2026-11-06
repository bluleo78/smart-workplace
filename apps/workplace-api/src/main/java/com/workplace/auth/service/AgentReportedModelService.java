package com.workplace.auth.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.AiAgentCredentialRow;
import com.workplace.auth.dto.ModelOption;
import com.workplace.auth.repository.AgentReportedModelRepository;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.global.tenant.TenantContext;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 로그인 계정 모델 목록 보고 서비스(WP-1297). ChatGPT 로그인은 refresh token 이 1회용이라 Works 서버가 저장된 로그인으로 모델 목록을 조회하면
 * Pod 안 프로그램의 로그인이 풀린다 — 그래서 목록은 Pod 가 자기 AI 키로 보고하고, 서버는 보고를 저장해 두었다가 모델 목록 조회가 그대로 돌려준다.
 *
 * <p>보고는 보고 당시의 활성 연결 행 id 와 함께 저장한다. 조회는 지금 활성 행이 그 행일 때만 쓴다 — 연결을 다른 계정으로 바꾸면 옛 계정의 목록이 새 계정에 섞이지
 * 않는다(목록이 비어 보이다가 Pod 가 다시 보고하면 채워진다).
 *
 * <p>평문 로그인 정보는 다루지 않는다 — 활성 연결의 id·provider 만 본다.
 */
@Slf4j
@Service
@Transactional
@RequiredArgsConstructor
public class AgentReportedModelService {

  /**
   * 저장 형식 — 응답 계약({@link ModelOption})이 바뀌어도 이미 저장된 JSON 이 깨지지 않게 저장용 레코드를 따로 둔다(지원 단계는 소문자 그대로).
   */
  private record Stored(String id, String label, List<String> efforts) {}

  private static final TypeReference<List<Stored>> STORED_LIST = new TypeReference<>() {};

  private final AgentReportedModelRepository repo;
  private final AiAgentCredentialRepository credentials;
  private final ObjectMapper objectMapper;

  /**
   * 보고를 저장한다. 활성 연결이 로그인 계정(genia·chatgpt)이고 Pod 가 보고한 로그인 version 이 그 연결 id 와 같을 때만 저장하고, 아니면(연결
   * 없음·서버 실행 계정·테넌트 미정·옛 로그인의 Pod) 아무것도 저장하지 않는다 — 관리자가 연결을 바꾸는 사이에 옛 Pod 가 보고해도 옛 계정의 목록이 새 연결로
   * 저장되지 않는다. 오류로 올리지 않고 조용히 무시한다.
   *
   * @param loginVersion Pod 가 받은 로그인 정보의 version(= 연결 id)
   */
  public void report(long agentUserId, long loginVersion, List<ModelOption> models) {
    if (TenantContext.get() == null) return;
    // 활성 연결 한 행만 읽는다 — 복호화하지 않는다(id·provider 만 본다).
    Optional<AiAgentCredentialRow> active = credentials.findActive(agentUserId);
    if (active.isEmpty()
        || !AgentProviders.isLogin(active.get().provider())
        || active.get().id() != loginVersion) {
      return;
    }
    repo.upsert(agentUserId, loginVersion, toJson(dedupe(models)));
  }

  /**
   * 그 연결 행 때 보고한 모델 목록 — 보고가 없거나 다른 연결 행 때의 것이면 빈 목록. efforts 는 모델 목록 응답 계약({@link ModelOption})대로
   * 대문자로 돌려준다.
   */
  @Transactional(readOnly = true)
  public List<ModelOption> findFor(long agentUserId, long credentialId) {
    Optional<String> json = repo.find(agentUserId, credentialId);
    if (json.isEmpty()) return List.of();
    try {
      return objectMapper.readValue(json.get(), STORED_LIST).stream()
          .map(
              s ->
                  ModelOption.withLabelFallback(
                      s.id(),
                      s.label(),
                      s.efforts() == null
                          ? null
                          : s.efforts().stream().map(e -> e.toUpperCase(Locale.ROOT)).toList()))
          .toList();
    } catch (JsonProcessingException e) {
      // 저장 때 우리가 만든 JSON 이라 오지 않는다 — 와도 드롭다운 전체가 막히지 않게 빈 목록으로.
      log.warn("보고된 모델 목록을 읽지 못해 빈 목록으로 대체: agent={}", agentUserId);
      return List.of();
    }
  }

  /** 같은 id 가 거듭 오면 앞의 것만 남기고, 이름이 없으면 id 로 채운다(순서 유지). */
  private static List<ModelOption> dedupe(List<ModelOption> models) {
    Map<String, ModelOption> byId = new LinkedHashMap<>();
    for (ModelOption m : models) {
      byId.putIfAbsent(m.id(), ModelOption.withLabelFallback(m.id(), m.label(), m.efforts()));
    }
    return List.copyOf(byId.values());
  }

  private String toJson(List<ModelOption> models) {
    try {
      return objectMapper.writeValueAsString(
          models.stream().map(m -> new Stored(m.id(), m.label(), m.efforts())).toList());
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("모델 목록을 저장 형식으로 바꾸지 못했습니다", e);
    }
  }
}
