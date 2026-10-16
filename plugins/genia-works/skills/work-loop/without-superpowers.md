# superpowers 없이 설계·구현하기 (work-loop)

`process-issue.md` 5번에서 superpowers 스킬이 없을 때 쓴다. 끝나면 `process-issue.md` 6번(리뷰)으로 돌아간다.

## 설치 안내 — 첫 실행에 한 번

`MAIN/.work-loop/state/superpowers-notice` 가 없으면 세션 출력에 아래 안내를 남기고 그 파일을 만든다(있으면 다시 안내하지 않는다). 설치는 직접 하지 않는다 — 사람이 정한다. 설치하지 않아도 아래 절차로 처리한다.

> superpowers 플러그인을 설치하면 더 꼼꼼하게 처리합니다.
> `/plugin install superpowers@claude-plugins-official` (공식 마켓플레이스가 없으면 먼저 `/plugin marketplace add anthropics/claude-plugins-official`)
> 설치한 뒤 이 세션을 다시 띄우면 다음 이슈부터 씁니다.

## 기본 절차

1. **짧은 설계 메모**: `MAIN/.work-loop/state/notes/<이슈 키>.md` 에 완료 기준을 다시 적고, 바꿀 파일과 접근 방안, 그렇게 고른 이유를 몇 줄로 적는다. 정한 것은 「내가 정한 것」에 옮긴다. 접근 방안이 둘 이상이고 어느 쪽이 맞는지 명확하지 않으면 `process-issue.md` 4번처럼 묻는다.
2. **테스트 먼저**: 완료 기준마다 그것을 확인하는 테스트를 먼저 쓰고, 돌려서 실패하는 것을 본다(실패 이유가 「기능 없음」이어야 한다). 저장소의 테스트 규칙(`CLAUDE.md`·`.work-loop/project.md`)을 따른다.
3. **구현**: 테스트가 통과할 만큼만 고친다. 저장소의 코딩 규칙을 따른다. 테스트를 다시 돌려 통과를 본다.
4. **자체 리뷰**: 브랜치 전체 diff 를 처음부터 읽는다. 완료 기준을 모두 덮는지, 빠진 경우(빈 값·오류·권한)와 관계없는 변경이 없는지 확인하고 고친다.
