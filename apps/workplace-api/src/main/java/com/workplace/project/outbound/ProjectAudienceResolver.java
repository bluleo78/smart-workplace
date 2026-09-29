package com.workplace.project.outbound;

import com.workplace.global.realtime.AudienceResolver;
import com.workplace.project.repository.ProjectMemberRepository;
import java.util.Collection;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * PROJECT scope 수신자 = 프로젝트 멤버 전원 (WP-59). 이슈 목록·보드·설정 화면은 멤버라면 누구나 보고 있을 수 있으므로 watcher 가 아니라 멤버
 * 기준이다(생성 직후 watcher 는 reporter·담당자뿐).
 */
@Component
@RequiredArgsConstructor
public class ProjectAudienceResolver implements AudienceResolver {

  public static final String SCOPE = "PROJECT";

  private final ProjectMemberRepository memberRepository;

  @Override
  public String scopeType() {
    return SCOPE;
  }

  @Override
  public Collection<Long> resolve(long projectId) {
    return memberRepository.findUserIdsByProject(projectId);
  }
}
