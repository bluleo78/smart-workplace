package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.AgentRuntimeProjectResponse;
import com.workplace.agentruntime.dto.AgentRuntimeSummaryResponse;
import com.workplace.agentruntime.dto.AgentTemplate;
import com.workplace.agentruntime.exception.AgentWorkspaceRequiredException;
import com.workplace.agentruntime.repository.AgentLocationRepository;
import com.workplace.agentruntime.repository.AgentRuntimeProjectRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.global.tenant.TenantContext;
import com.workplace.user.service.WorkspaceMemberGuard;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 실행 조회 서비스(WP-1254·1255) — AI 목록의 실행 상태 요약과, AI 가 작업 공간에서 맡을 프로젝트. 읽기만 한다. 관리자 화면용 조회의 관리자 권한은
 * 컨트롤러({@code @RequireAdmin})가, AI 자신의 조회({@link #myProjects})의 AI 인증은 컨트롤러가 책임진다.
 */
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class AgentRuntimeSummaryService {

  private final AgentRuntimeSettingRepository settings;
  private final AgentLocationRepository locations;
  private final AgentRuntimeProjectRepository projects;
  private final AgentTemplateRegistry registry;
  private final WorkspaceMemberGuard memberGuard;

  /**
   * 이 워크스페이스에서 실행 설정 행이 있는 모든 AI 의 실행 상태 요약 — AI id 순. 설정 전체 1회 + 위치 전체 1회로 읽고(AI 마다 다시 읽지 않는다),
   * 템플릿 제목은 메모리의 레지스트리에서 붙인다. 실행 위치 이름은 기본 위치가 아닐 때만 싣는다 — 목록에서는 「기본이 아닌 곳에서 돈다」만 눈에 띄면 된다.
   */
  public List<AgentRuntimeSummaryResponse> summaries() {
    List<Row> rows = settings.findAll();
    if (rows.isEmpty()) return List.of();
    // 기본 위치는 이름을 비우므로 기본이 아닌 위치만 이름 맵에 담는다 — 지정 위치가 기본이거나 미지정이면 맵에 없어 null.
    Map<Long, String> nonDefaultNames =
        locations.findAll().stream()
            .filter(l -> !l.isDefault())
            .collect(
                Collectors.toMap(
                    AgentLocationRepository.Row::id, AgentLocationRepository.Row::name));
    return rows.stream()
        .map(
            r ->
                new AgentRuntimeSummaryResponse(
                    r.agentUserId(),
                    r.templateName(),
                    registry
                        .find(r.templateName())
                        .map(AgentTemplate::card)
                        .map(AgentTemplate.Card::title)
                        .orElse(null),
                    AgentRuntimeStatusResolver.resolve(
                        r.desired(), r.generation(), r.observedGeneration(), r.phase()),
                    r.agentState(),
                    r.agentIssueKey(),
                    r.agentNextCheckAt(),
                    r.locationId() == null ? null : nonDefaultNames.get(r.locationId()),
                    r.observedMessage()))
        .toList();
  }

  /**
   * AI 가 작업 공간에서 맡을 프로젝트 — 실제 멤버이고 연결된 저장소가 있는 프로젝트(프로젝트 키 순). 이 워크스페이스 구성원이 아니면 404(실행 설정 API 와 같은
   * 가드), AI 가 아니어도 404 다(사람에게는 맡을 프로젝트라는 것이 없다 — 실행 설정 조회가 사람에게 404 인 것과 맞춘다). 실행 설정이 아직 없어도
   * 돌려준다(설정을 저장하기 전 화면이 쓴다).
   */
  public List<AgentRuntimeProjectResponse> projects(long agentId) {
    memberGuard.requireAgent(agentId);
    return projects.findMemberProjectsWithRepository(agentId);
  }

  /**
   * AI 자신이 맡을 프로젝트(WP-1275) — {@link #projects} 와 같은 기준을 AI 키로 바로 돌려준다. 작업 공간 엔트리포인트·start-agent·알림
   * 감시가 프로젝트 목록 전체를 쪽마다 받아 거르지 않게 한다. 워크스페이스가 정해지지 않은 키 인증(여러 워크스페이스에 속한 AI 가 밝히지 않음)이면 400 — 빈
   * 목록이면 「맡은 프로젝트 없음」과 구분되지 않는다.
   */
  public List<AgentRuntimeProjectResponse> myProjects(long agentUserId) {
    if (TenantContext.get() == null) throw new AgentWorkspaceRequiredException();
    return projects.findMemberProjectsWithRepository(agentUserId);
  }
}
