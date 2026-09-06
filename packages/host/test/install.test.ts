import { afterAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerManifests } from '../src/install.js'

/**
 * registerManifests（postinstall 与 install 共用的注册核心）：
 * 用 PAGEDIVE_EXTRA_NM_DIR 指到临时目录，不碰开发机真实 NM manifest。
 * macOSManifestDirs 的正式目录有 existsSync(join(dir,'..')) 守卫——
 * HOME 未改时可能真写入！先把 HOME 换到沙箱再跑。
 */
const SANDBOX = await mkdtemp(join(tmpdir(), 'pd-install-'))
process.env.HOME = SANDBOX
// 模拟「Chrome 已启动过」：造出 NativeMessagingHosts 的父目录
const NM_DIR = join(SANDBOX, 'Library/Application Support/Google/Chrome/NativeMessagingHosts')
await mkdir(NM_DIR, { recursive: true })
// vitest 跑的是 src/ 源码，registerManifests 的 hostPath 会指向 src/index.js——
// 预放占位文件模拟 dist 入口（真实运行在 dist/ 下天然存在）
await writeFile(new URL('../src/index.js', import.meta.url).pathname, '// test placeholder\n')

afterAll(async () => {
  await rm(SANDBOX, { recursive: true, force: true })
  await rm(new URL('../src/index.js', import.meta.url).pathname, { force: true })
})

describe('registerManifests', () => {
  it('空 extIds 写出 allowed_origins=[] 的 manifest，返回写入路径', async () => {
    const written = await registerManifests([], true)
    expect(written.length).toBeGreaterThanOrEqual(1)
    const manifest = JSON.parse(await readFile(written[0], 'utf8'))
    expect(manifest.name).toBe('com.pagedive.host')
    expect(manifest.allowed_origins).toEqual([])
    expect(manifest.type).toBe('stdio')
    // path 指向 wrapper 且 wrapper 存在、可执行语义（首行 shebang）
    expect(manifest.path).toBe(join(SANDBOX, '.ai-page-dive', 'host-wrapper.sh'))
    const wrapper = await readFile(manifest.path, 'utf8')
    expect(wrapper).toMatch(/^#!\/bin\/sh/)
    // wrapper 带回退链：node 路径失效时 env node 兜底
    expect(wrapper).toContain('/usr/bin/env node')
  })

  it('origins union：先登记 X 再空注册，X 保留（postinstall 升级不丢 ID）', async () => {
    await registerManifests(['aaaa'], true)
    const again = await registerManifests([], true)
    const manifest = JSON.parse(await readFile(again[0], 'utf8'))
    expect(manifest.allowed_origins).toContain('chrome-extension://aaaa/')
    // 重复登记同 ID 不重复
    await registerManifests(['aaaa'], true)
    const dedup = JSON.parse(await readFile(again[0], 'utf8'))
    expect(dedup.allowed_origins.filter((o: string) => o === 'chrome-extension://aaaa/')).toHaveLength(1)
  })

  it('半写崩溃不留脏 manifest：手动放一个 .tmp 后重写不受影响', async () => {
    const tmpFile = join(NM_DIR, 'com.pagedive.host.json.tmp')
    await writeFile(tmpFile, '半写的垃圾{{{')
    const written = await registerManifests(['bbbb'], true)
    const manifest = JSON.parse(await readFile(written[0], 'utf8'))
    expect(manifest.allowed_origins).toContain('chrome-extension://bbbb/')
  })
})
