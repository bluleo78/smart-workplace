package com.workplace.chat.service;

import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.outbound.ChatThreadChangeNotifier;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.chat.repository.IssueStakeholderLookup;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 이슈 토크(chat thread) 읽기·쓰기 접근 판정 (WP-213).
 *
 * <p>쓰기 권한은 이슈 댓글과 같은 규칙 — 프로젝트 멤버/ADMIN, 또는 OPEN 프로젝트에서 이슈 reporter 본인 ({@link
 * ProjectAccessGuard#canWriteContent}). 규칙이 두 곳에서 따로 진화하지 않도록 chat 모듈이 project 의 가드를 직접 쓴다 — chat 은
 * project 서비스를 import 하지 않는 원칙의 의도된 예외다. 스레드 멤버가 아니어도 쓰기 권한이 있으면 메시지를 보내는 순간 대화에 자동 참여한다(댓글을 달면 자동
 * 구독되는 것과 같은 흐름).
 *
 * <p>읽기 권한은 {@link ChatThreadService#getOrCreate} 와 같다 — 프로젝트 멤버이거나 OPEN 프로젝트.
 */
@Component
@RequiredArgsConstructor
public class ChatThreadAccess {

  private final ChatThreadMemberRepository memberRepo;
  private final ChatThreadContextResolver contextResolver;
  private final IssueStakeholderLookup lookup;
  private final ProjectAccessGuard accessGuard;
  private final ChatThreadChangeNotifier notifier;

  /** 스레드 멤버이거나 쓰기 권한이 있으면 true. 참여(INSERT)는 하지 않는다 — 읽기 전용 트랜잭션에서도 호출 가능. */
  public boolean canWrite(long threadId, long userId) {
    if (memberRepo.isMember(threadId, userId)) return true;
    var ctx = contextResolver.resolve(threadId);
    return ctx != null && accessGuard.canWriteContent(ctx.projectId(), ctx.reporterId(), userId);
  }

  /** 쓰기 권한 확인만(참여 없음). 타이핑 알림·첨부 선업로드처럼 "아직 보내지 않은" 단계용. 없으면 ChatThreadNotMemberException(403). */
  public void ensureCanWrite(long threadId, long userId) {
    if (!canWrite(threadId, userId)) throw new ChatThreadNotMemberException(threadId, userId);
  }

  /**
   * 메시지 전송 진입. 멤버면 통과, 아니면 쓰기 권한 확인 후 대화에 자동 참여시키고 멤버 변경을 알린다(이슈 화면 멤버 수·목록 갱신). 쓰기 트랜잭션 안에서 호출해야
   * 하며, 이후 같은 트랜잭션의 멤버십 검사(드라이브 링크 등)가 새 멤버 row 를 본다.
   */
  public void ensureMemberOrJoin(long threadId, long userId) {
    if (memberRepo.isMember(threadId, userId)) return;
    var ctx = contextResolver.resolve(threadId);
    if (ctx == null || !accessGuard.canWriteContent(ctx.projectId(), ctx.reporterId(), userId)) {
      throw new ChatThreadNotMemberException(threadId, userId);
    }
    memberRepo.insertIgnoreConflict(threadId, List.of(userId));
    notifier.membersChanged(
        ctx.projectId(), ctx.projectKey(), ctx.issueNumber(), threadId, userId, Set.of());
  }

  /** 읽기 권한 — 스레드 멤버, 프로젝트 멤버, 또는 OPEN 프로젝트. 없으면 ChatThreadNotMemberException(403). */
  public void ensureCanRead(long threadId, long userId) {
    if (memberRepo.isMember(threadId, userId)) return;
    var ctx = contextResolver.resolve(threadId);
    if (ctx == null
        || !(lookup.isProjectMember(ctx.projectId(), userId)
            || lookup.isOpenProject(ctx.projectId()))) {
      throw new ChatThreadNotMemberException(threadId, userId);
    }
  }
}
