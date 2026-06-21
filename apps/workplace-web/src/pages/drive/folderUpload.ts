// 드롭된 폴더 트리를 순회해 (파일, 상위 폴더 경로) 목록으로 평탄화한다.
// webkitGetAsEntry 기반. directoryReader.readEntries 는 호출당 최대 ~100개만 반환하므로
// 빈 배열이 올 때까지 반복 호출해야 누락이 없다.

export interface DroppedFile {
  file: File
  // 루트(드롭 지점) 기준 상위 폴더명 경로. 파일명은 제외. 예: docs/sub/a.txt → ['docs','sub']
  relativePath: string[]
}

// 최소한의 FileSystemEntry 타입(브라우저 비표준 API).
interface FsEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (cb: (f: File) => void, err: (e: unknown) => void) => void
  createReader?: () => { readEntries: (cb: (e: FsEntry[]) => void, err: (e: unknown) => void) => void }
}

function entryFile(entry: FsEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file!(resolve, reject))
}

function readAll(reader: { readEntries: (cb: (e: FsEntry[]) => void, err: (e: unknown) => void) => void }): Promise<FsEntry[]> {
  return new Promise((resolve, reject) => {
    const acc: FsEntry[] = []
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(acc)
        else {
          acc.push(...batch)
          next()
        }
      }, reject)
    next()
  })
}

async function walk(entry: FsEntry, prefix: string[], out: DroppedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await entryFile(entry)
    out.push({ file, relativePath: prefix })
    return
  }
  if (entry.isDirectory && entry.createReader) {
    const children = await readAll(entry.createReader())
    for (const child of children) {
      await walk(child, [...prefix, entry.name], out)
    }
  }
}

// DataTransfer 항목들에서 폴더/파일 엔트리를 모아 평탄화. 폴더 드롭이 아니면(엔트리 미지원) 빈 배열.
export async function readDroppedTree(items: DataTransferItemList): Promise<DroppedFile[]> {
  const entries: FsEntry[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const getEntry = (item as unknown as { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry
    const entry = getEntry ? getEntry.call(item) : null
    if (entry) entries.push(entry)
  }
  const out: DroppedFile[] = []
  for (const e of entries) {
    await walk(e, [], out)
  }
  return out
}
