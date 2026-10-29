package com.workplace.messaging.service;

import com.workplace.messaging.repository.ChannelMemberGroupRepository;
import com.workplace.messaging.repository.ChannelRepository;
import java.util.Collection;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 채널 멤버 부서를 사람 행으로 맞춘다(WP-1058) — 「부서로 들어와야 하는 사람」(멤버 부서와 하위 부서의 활성 사람 구성원 − 개인 제외)과 channel_member
 * 를 맞춘다. 없는 사람은 direct=false·MEMBER 로 넣고, 부서로만 들어와 있던(direct=false·MEMBER) 사람 중 이제 걸리지 않는 사람은 뺀다.
 * 직접 멤버와 ADMIN/OWNER 행은 건드리지 않는다.
 *
 * <p>알리지 않는다 — 바뀐 사람({@link Diff})만 돌려주고, 호출자가 바뀐 것이 있을 때 초대·내보내기와 같은 경로(roster 이벤트·채널 멤버십 변경 알림)로
 * 알린다. 커밋 직전 리스너처럼 SSE 를 낼 수 없는 호출자가 있어서다. 맞추기는 멱등이라 같은 채널을 여러 번 불러도 된다. 호출자의 쓰기 트랜잭션 안에서 불러야 한다.
 */
@Component
@RequiredArgsConstructor
public class ChannelMemberGroupSync {

  private final ChannelRepository channelRepo;
  private final ChannelMemberGroupRepository groups;

  /**
   * 맞춘 결과 — 넣은 사람과 뺀 사람.
   *
   * @param added 부서로 새로 들어온 사람 id
   * @param removed 부서로만 들어와 있다가 빠진 사람 id
   */
  public record Diff(List<Long> added, List<Long> removed) {
    static final Diff NONE = new Diff(List.of(), List.of());

    /** 사람 행이 하나라도 바뀌었는가. */
    public boolean changed() {
      return !added.isEmpty() || !removed.isEmpty();
    }
  }

  /**
   * 채널 하나를 맞춘다 — 빼기와 넣기 모두. 보관된 채널에는 사람을 새로 넣지 않는다(읽기 전용 — 초대와 같다). 빼기는 보관돼도 한다(접근 정리). 보관을 풀면
   * {@code ChannelMemberGroupService#onChannelArchived} 가 다시 맞춘다.
   */
  public Diff reconcile(long channelId) {
    // 채널이 지워졌으면(같은 트랜잭션에서 하드 삭제) 맞출 행이 없다 — 부서 행·사람 행 모두 CASCADE 로 사라졌다.
    // 채널 행을 잠가 초대·내보내기·부서 추가와 줄 세운다(WP-1186).
    return channelRepo
        .lockState(channelId)
        .map(
            state -> {
              // 빼기를 먼저 — 부서 행이 하나도 남지 않았어도 돈다(마지막 부서를 뺀 경우).
              List<Long> removed = groups.deleteUncovered(channelId);
              List<Long> added =
                  state.archived() ? List.of() : groups.insertMissing(channelId, null);
              return new Diff(added, removed);
            })
        .orElse(Diff.NONE);
  }

  /**
   * 부서 구성원이 늘었을 때 — 넣기만 한다(늘었을 뿐 걸리지 않게 된 사람은 없다). onlyUserIds 가 있으면 그 사람만 본다(null 이면 부서 트리 전원).
   * 보관된 채널·지워진 채널이면 아무것도 하지 않는다.
   */
  public Diff addGrown(long channelId, Collection<Long> onlyUserIds) {
    return channelRepo
        .lockState(channelId)
        .filter(state -> !state.archived())
        .map(state -> new Diff(groups.insertMissing(channelId, onlyUserIds), List.of()))
        .orElse(Diff.NONE);
  }
}
