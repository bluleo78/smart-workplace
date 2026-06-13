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
    issueTypeService.seedSystemTypes(row.id());
    return ProjectResponse.from(row);
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

  /** HUMAN 사용자가 기본 개인 프로젝트가 없으면 1개 생성. 레이스/제약위반을 외부 트랜잭션과 격리하기 위해 REQUIRES_NEW. AGENT 는 만들지 않음. */
  @Transactional(propagation = Propagation.REQUIRES_NEW)
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
      // REQUIRES_NEW 서브 트랜잭션만 롤백되고 외부 list() 트랜잭션은 유효 — 이미 존재로 간주하고 무시
    }
  }
}
