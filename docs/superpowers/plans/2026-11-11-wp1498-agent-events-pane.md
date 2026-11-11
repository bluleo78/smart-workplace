# WP-1498 — 「알림」 탭(감시 창 events)이 늘 비어 있는 문제

## 원인

`agent-events run` 은 gw-events 줄·poke/open/sweep 결과·`wake - reconnect` 를 모두 `<AI 폴더>/state/events.log` 에만 쓰고
표준 출력에는 아무것도 내지 않는다. 감시 창(tmux 창 `events`)이 곧 AI 작업 화면의 「알림」 탭이라 탭이 늘 비어 있었다.

## 방안

- `do_run` 시작에 `show_log` 를 부른다.
  - 안내 두 줄: 「알림 감시 — 받은 알림과 칸 깨우기 기록」, `(<AI 이름> · 기록 파일 state/events.log · 최근 줄은 시각을 몰라 --:--:--)`.
  - 최근 기록 10줄을 `--:--:-- <줄>` 로 보인다(쓴 시각을 모르므로 지금 시각을 붙이지 않는다).
  - 크기(바이트)를 한 번 재어 그 스냅샷으로 최근 10줄(`head -c | tail -n 10 | sed`)과 따라가기 시작점을 함께 정한다(따로 세면 그 사이 줄이 두 번 나온다).
  - 따라가기(`tail -c +<마지막 줄 시작> -F`)는 마지막 줄을 한 번 더 읽고 버린 뒤 표시 파일을 만들고, run 은 그 표시(늦어도 5초)를 기다린 뒤 gw-events 루프에 들어간다.
    기록을 넘기는 것은 그 루프뿐이라, tail 이 넘긴 뒤의 새 파일에 옛 시작점을 써 줄을 숨기는 경합이 없다. 이후 줄은 `HH:MM:SS <줄>`.
  - 크기를 못 읽으면 전체를 쏟지 않고 `tail -n 0 -F`(지금 끝부터).
- 따라가기는 run 마다 한 번만(gw-events 를 다시 띄우는 루프 밖) — 쉬는 동안(5분·backoff)에도 계속 보인다.
- tail 과 읽는 하위 셸은 run 의 직접 자식이라 기존 `kill_children_on_exit`(EXIT 에서 `pkill -P $$`)가 끝낸다 — 창을 닫거나 다시 띄워도 고아가 남지 않는다.
- 기록 파일 모양·SSE 하나·tail/poke/open/sweep·재시작 대기는 그대로. 키는 기록에 없으므로 화면에도 없다.
- `plugins/` 가 바뀌므로 플러그인 0.1.44 → 0.1.45(plugin.json 둘·marketplace.json·pluginGuide.test.ts — f2c791a2c 와 같은 파일).

## 테스트 (`plugins/genia-works/tests/scripts.test.mjs`)

- `agentEvents_run_appendsWakeLinesAndReconnects` — 안내 줄, 기록한 줄마다 `HH:MM:SS` 붙은 화면 줄, 기록 파일 모양 그대로, 남은 tail 없음.
- `agentEvents_run_showsRecentLinesAndKeepsFollowingAfterRotation`(새) — 1MB 직전까지 채운 기록으로 시작: 안내·최근 줄(`--:--:--`),
  첫 wake 가 넘기기를 일으킨 뒤의 다시 붙음·WP-3 도 화면에 나온다.
- `agentEvents_run_pokesIdlePaneOnWake` — poke 결과 줄(`poke WP sent`)이 시각과 함께 화면에 나온다.

## 라이브 확인

격리 tmux 서버(`tmux -L wp1498`)에서 가짜 알림 서버·가짜 HOME 으로 `agent-events run` 을 띄워 `capture-pane` 으로 시작 화면·wake/poke 줄·넘기기 뒤 갱신·종료 뒤 고아 없음을 확인
(`.work-loop/state/evidence/WP-1498/`).
