package com.workplace.project.service;

import com.workplace.issue.service.IssueTypeService;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.exception.ProjectConflictException;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.user.dto.UserKind;
import com.workplace.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 개인 프로젝트(PERSONAL) 생성/지연 프로비저닝 전담 빈. 기본 개인 프로젝트 프로비저닝은 제약위반/레이스를 외부 트랜잭션과 격리해야 하므로 별도 빈으로 분리하여
 * REQUIRES_NEW 서브 트랜잭션에서 수행한다.
 */
@Service
@RequiredArgsConstructor
public class PersonalProjectProvisioner {

  private final ProjectRepository projectRepository;
  private final ProjectMemberRepository memberRepository;
  private final ProjectIssueSequenceRepository sequenceRepository;
  private final IssueTypeService issueTypeService;
  private final UserRepository userRepository;

  /** 개인 프로젝트 생성 — key 자동 생성, 호출자만 OWNER. 기본/추가 공용. 별도 propagation 없이 호출자 트랜잭션에 합류. */
  public ProjectResponse createPersonal(
      Long callerId, String name, String description, boolean isDefault) {
    String key = generateUniquePersonalKey(callerId);
    ProjectRow row =
        projectRepository.insert(key, name, description, callerId, "PERSONAL", isDefault);
    memberRepository.insert(row.id(), callerId, "OWNER");
    sequenceRepository.initialize(row.id());
    // PERSONAL 프로젝트 — EPIC 제외 5종 시드.
    issueTypeService.seedSystemTypes(row.id(), false);
    // 생성자는 항상 OWNER — viewerIsMember=true
    return ProjectResponse.from(row, true);
  }

  /** "P" + base36(userId) 기반, 충돌 시 접미사 부여. VARCHAR(10) 한도 준수. */
  private String generateUniquePersonalKey(Long userId) {
    String base = ("P" + Long.toString(userId, 36)).toUpperCase();
    if (base.length() > 10) base = base.substring(0, 10);
    if (!projectRepository.existsByKey(base)) return base;
    for (int i = 1; i < 1000; i++) {
      String suffix = Integer.toString(i, 36).toUpperCase();
      int keep = Math.min(base.length(), 10 - suffix.length());
      String cand = base.substring(0, keep) + suffix;
      if (!projectRepository.existsByKey(cand)) return cand;
    }
    throw new ProjectConflictException("개인 프로젝트 key 생성 실패");
  }

  /**
   * 기본 개인 프로젝트 지연 프로비저닝의 실제 로직(일반 propagation — 호출자 트랜잭션에 합류). HUMAN 사용자가 기본 개인 프로젝트가 없으면 1개 생성,
   * AGENT 는 만들지 않음. 호출자 트랜잭션과 함께 커밋/롤백되므로 통합 테스트는 이 메서드를 직접 호출해 롤백으로 격리한다. 외부 트랜잭션과 격리된 독립 커밋이
   * 필요하면(예: readOnly 인 list()) {@link #ensureDefaultPersonalInNewTx(Long)} 를 호출한다.
   */
  public void ensureDefaultPersonal(Long callerId) {
    var user =
        userRepository
            .findById(callerId)
            .orElseThrow(() -> new IllegalStateException("caller user 없음: " + callerId));
    if (!UserKind.HUMAN.equals(user.kind())) return;
    if (projectRepository.findDefaultPersonal(callerId).isPresent()) return;
    try {
      createPersonal(callerId, "개인 작업", null, true);
    } catch (org.springframework.dao.DuplicateKeyException e) {
      // 동시 생성 레이스 — 이미 존재로 간주하고 무시
    }
  }

  /**
   * {@link #ensureDefaultPersonal(Long)} 을 REQUIRES_NEW 서브 트랜잭션으로 감싼 변형. 레이스/제약위반을 외부 트랜잭션과 격리하고,
   * 외부가 readOnly(예: list())여도 별도 커밋으로 기본 프로젝트를 보장한다. 별도 서브 트랜잭션에서 커밋되므로 통합 테스트의 @Transactional
   * 롤백으로는 격리되지 않는다 — 테스트는 일반 메서드 {@link #ensureDefaultPersonal(Long)} 를 호출한다.
   */
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void ensureDefaultPersonalInNewTx(Long callerId) {
    ensureDefaultPersonal(callerId);
  }
}
