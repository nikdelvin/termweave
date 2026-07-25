import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

export async function withTemporaryDirectory<T>(task: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(resolve(tmpdir(), 'termweave-test-'))
  try {
    return await task(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
