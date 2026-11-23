import DiffMatchPatch from 'diff-match-patch'

const diff = new DiffMatchPatch()
diff.Diff_Timeout = 0.2

/** 버전 비교와 편집기의 변경 수가 같은 YAML 행 경계를 쓰도록 비교 결과를 공유한다. */
export function compareWorkflowYaml(before: string, after: string) {
  const { chars1, chars2, lineArray } = diff.diff_linesToChars_(before, after)
  const chunks = diff.diff_main(chars1, chars2, false)
  diff.diff_charsToLines_(chunks, lineArray)
  return chunks
}

/** 붙어 있는 삭제·추가는 하나의 변경으로 세고, 같은 행이 나오면 다음 묶음을 시작한다. */
export function countWorkflowYamlChanges(before: string, after: string): number {
  if (before === after) return 0
  let count = 0
  let previousChanged = false
  for (const [operation] of compareWorkflowYaml(before, after)) {
    const changed = operation !== 0
    if (changed && !previousChanged) count++
    previousChanged = changed
  }
  return count
}
