import { describe, expect, it } from 'vitest'

import { type DroppedFile, readDroppedTree } from './folderUpload'

// 가짜 FileSystemEntry 빌더 — file/dir 트리를 흉내낸다.
function fileEntry(name: string) {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (cb: (f: File) => void) => cb(new File(['x'], name)),
  }
}
function dirEntry(name: string, children: unknown[]) {
  let served = false
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (cb: (e: unknown[]) => void) => {
        if (served) cb([])
        else {
          served = true
          cb(children)
        }
      },
    }),
  }
}

describe('readDroppedTree', () => {
  it('중첩 폴더를 상대경로와 함께 평탄화한다', async () => {
    const docs = dirEntry('docs', [fileEntry('a.txt'), dirEntry('sub', [fileEntry('b.txt')])])
    const items = {
      length: 1,
      0: { webkitGetAsEntry: () => docs },
    } as unknown as DataTransferItemList

    const result: DroppedFile[] = await readDroppedTree(items)
    const map = result.map((r) => `${r.relativePath.join('/')}/${r.file.name}`).sort()
    expect(map).toEqual(['docs/a.txt', 'docs/sub/b.txt'])
  })
})
