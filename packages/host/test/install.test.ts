import { afterAll, describe, expect, it } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerManifests, resolveHostEntry, stableNodePath } from '../src/scripts/install.js'
import { uninstall } from '../src/scripts/uninstall.js'
import { detectGlobalInstall, isTopLevelGlobal, manifestHasOrigins } from '../src/scripts/postinstall.js'

/**
 * registerManifests（postinstall 与 install 共用的注册核心）：
 * HOME 沙箱 + PAGEDIVE_HOST_ENTRY 指到临时占位——不碰开发机真实 NM manifest，
 * 也不在 src/ 留占位文件（vitest 跑 src/ 源码，dist 入口逻辑用注入替代）。
 */
const SANDBOX = await mkdtemp(join(tmpdir(), 'pd-install-'))
process.env.HOME = SANDBOX
process.env.PAGEDIVE_HOST_ENTRY = join(SANDBOX, 'fake-host-entry.js')
await writeFile(process.env.PAGEDIVE_HOST_ENTRY, '// test placeholder\n')
// 模拟「Chrome 已启动过」：造出 NativeMessagingHosts 的父目录
const NM_DIR = join(SANDBOX, 'Library/Application Support/Google/Chrome/NativeMessagingHosts')
await mkdir(NM_DIR, { recursive: true })

const manifestPath = join(NM_DIR, 'com.pagedive.host.json')

/** 每用例独立起点：删 manifest 后注册——顺序无关（union 语义本身由专门用例覆盖） */
async function freshRegister(extIds: string[]): Promise<string> {
  await rm(manifestPath, { force: true })
  const written = await registerManifests(extIds, true)
  return written[0]
}

afterAll(async () => {
  await rm(SANDBOX, { recursive: true, force: true })
})

describe('registerManifests', () => {
  it('空 extIds 写出 allowed_origins=[] 的 manifest，返回写入路径', async () => {
    const p = await freshRegister([])
    const manifest = JSON.parse(await readFile(p, 'utf8'))
    expect(manifest.name).toBe('com.pagedive.host')
    expect(manifest.allowed_origins).toEqual([])
    expect(manifest.type).toBe('stdio')
    // path 指向 wrapper 且 wrapper 存在、首行 shebang、带回退链
    expect(manifest.path).toBe(join(SANDBOX, '.ai-page-dive', 'host-wrapper.sh'))
    const wrapper = await readFile(manifest.path, 'utf8')
    expect(wrapper).toMatch(/^#!\/bin\/sh/)
    expect(wrapper).toContain('/usr/bin/env node')
  })

  // Chrome 扩展 ID 恒为 32 位 a-p——用合法 fixture（install 已对 id 做该校验）
  const ID_A = 'a'.repeat(32)
  const ID_B = 'b'.repeat(32)

  it('origins union：先登记 X 再空注册，X 保留（postinstall 升级不丢 ID）', async () => {
    await registerManifests([ID_A], true)
    const p = (await registerManifests([], true))[0]
    const manifest = JSON.parse(await readFile(p, 'utf8'))
    expect(manifest.allowed_origins).toContain(`chrome-extension://${ID_A}/`)
    // 重复登记同 ID 不重复
    await registerManifests([ID_A], true)
    const dedup = JSON.parse(await readFile(p, 'utf8'))
    expect(dedup.allowed_origins.filter((o: string) => o === `chrome-extension://${ID_A}/`)).toHaveLength(1)
  })

  it('半写崩溃不留脏 manifest：残留 .tmp 不影响重写', async () => {
    await writeFile(join(NM_DIR, 'com.pagedive.host.json.tmp'), '半写的垃圾{{{')
    const p = await freshRegister([ID_B])
    const manifest = JSON.parse(await readFile(p, 'utf8'))
    expect(manifest.allowed_origins).toContain(`chrome-extension://${ID_B}/`)
  })

  it('非法扩展 ID（非 32 位 a-p）被跳过，不污染 allowed_origins', async () => {
    // 合法用 p*32（a-p 是 16 字母 a..p，q 及以后不合法）；非法：4 位、含大写/连字符、33 位
    const p = await freshRegister(['aaaa', 'NOT-VALID', 'z'.repeat(33), 'p'.repeat(32)])
    const manifest = JSON.parse(await readFile(p, 'utf8'))
    expect(manifest.allowed_origins).toEqual([`chrome-extension://${'p'.repeat(32)}/`])
  })

  it('r58 #13：升级口径判据 manifestHasOrigins——空 origins（首装）false / 已登记 true', async () => {
    expect(manifestHasOrigins(await freshRegister([]))).toBe(false)
    expect(manifestHasOrigins(await freshRegister([ID_A]))).toBe(true)
  })

  it('resolveHostEntry：dist/scripts/ 布局解析到上级 dist/index.js（r58 N1）', () => {
    // 发布布局：bin = dist/index.js，install 编译产物在 dist/scripts/ 下——旧实现
    // 算出 dist/scripts/index.js（不存在），真实用户 install 必败；vitest 走 env
    // 注入跑 src/ 源码永远踩不中。env 注入优先级不变
    const saved = process.env.PAGEDIVE_HOST_ENTRY
    delete process.env.PAGEDIVE_HOST_ENTRY
    try {
      expect(resolveHostEntry('/g/dist/scripts/install.js')).toBe('/g/dist/index.js')
      expect(resolveHostEntry('/g/src/scripts/install.ts')).toBe('/g/src/index.js')
      process.env.PAGEDIVE_HOST_ENTRY = '/injected.js'
      expect(resolveHostEntry('/g/dist/scripts/install.js')).toBe('/injected.js')
    } finally {
      process.env.PAGEDIVE_HOST_ENTRY = saved
    }
  })
})

describe('uninstall 如实计数（r58 R3）', () => {
  it('只数真实删掉的注册——干净机器报 0，仅存 manifest 报 1', async () => {
    // 自清场：上序 registerManifests 用例留下 manifest + wrapper。清后等同干净机器
    // （Chrome 目录在、注册全无）；'Chrome for Testing' 目录不存在不计数。
    // 旧实现 rmSync force 无条件 n++ → 恒 3
    await rm(manifestPath, { force: true })
    await rm(join(SANDBOX, '.ai-page-dive', 'host-wrapper.sh'), { force: true })
    const logs: string[] = []
    const orig = console.log
    console.log = (s: unknown) => { logs.push(String(s)) }
    try {
      uninstall()
      expect(logs.at(-1)).toContain('已清理 0 处')
      writeFileSync(manifestPath, '{}')
      uninstall()
      expect(logs.at(-1)).toContain('已清理 1 处')
      expect(existsSync(manifestPath)).toBe(false)
    } finally {
      console.log = orig
    }
  })
})

describe('postinstall 守卫（纯函数）', () => {
  const MAC = '/Users/u/.nvm/versions/node/v20.0.0/lib/node_modules/@aaione/ai-page-dive'

  it('detectGlobalInstall：npm -g / pnpm（含尾斜杠）/ yarn 命中，本地与路径前缀陷阱不命中', () => {
    expect(detectGlobalInstall({ npm_config_global: 'true' }, '/any/where')).toBe(true)
    // pnpm：PNPM_HOME 前缀 + sep 边界
    expect(detectGlobalInstall({ PNPM_HOME: '/Users/u/Library/pnpm' }, '/Users/u/Library/pnpm/global/v1/packages/@aaione/ai-page-dive')).toBe(true)
    // 尾斜杠 PNPM_HOME（shell 配置常见）——resolve 规范化后仍命中
    expect(detectGlobalInstall({ PNPM_HOME: '/Users/u/Library/pnpm/' }, '/Users/u/Library/pnpm/global/v1/packages/@aaione/ai-page-dive')).toBe(true)
    // 边界陷阱：pnpm-foo 不是 pnpm 目录
    expect(detectGlobalInstall({ PNPM_HOME: '/Users/u/Library/pnpm' }, '/Users/u/Library/pnpm-foo/node_modules/@aaione/ai-page-dive')).toBe(false)
    // yarn v1 全局路径特征
    expect(detectGlobalInstall({}, '/Users/u/.config/yarn/global/node_modules/@aaione/ai-page-dive')).toBe(true)
    // 本地/monorepo：无任何特征
    expect(detectGlobalInstall({}, MAC)).toBe(false)
    expect(detectGlobalInstall({}, '/Users/u/work/ai-page-dive/packages/host')).toBe(false)
  })

  it('isTopLevelGlobal：顶层 node_modules 直接子目录（含 scoped）为真，嵌套宿主为假', async () => {
    // 顶层（scoped）：.../npm-global/lib/node_modules/@aaione/ai-page-dive
    expect(isTopLevelGlobal(MAC)).toBe(true)
    // 嵌套（scoped）：.../host-tool/node_modules/@aaione/ai-page-dive（grandparent package.json 的 name 是宿主）
    const hostDir = join(SANDBOX, 'host-tool', 'node_modules', '@aaione', 'ai-page-dive')
    await mkdir(hostDir, { recursive: true })
    await writeFile(join(SANDBOX, 'host-tool', 'package.json'), JSON.stringify({ name: 'host-tool' }))
    expect(isTopLevelGlobal(hostDir)).toBe(false)
  })

  it('stableNodePath：brew Cellar 版本化路径改写 opt 稳定链，非 brew 原样（r7-impl 回归）', () => {
    const yes = () => true, no = () => false
    // Apple Silicon brew：版本化 Cellar → opt 稳定链（brew upgrade 清旧 Cellar 后仍存活）
    expect(stableNodePath('/opt/homebrew/Cellar/node/22.14.0/bin/node', yes))
      .toBe('/opt/homebrew/opt/node/bin/node')
    // 版本化包名 node@22 同样映射（opt/node@22 由 brew 维护）
    expect(stableNodePath('/opt/homebrew/Cellar/node@22/22.14.0/bin/node', yes))
      .toBe('/opt/homebrew/opt/node@22/bin/node')
    // Intel brew
    expect(stableNodePath('/usr/local/Cellar/node/20.10.0/bin/node', yes))
      .toBe('/usr/local/opt/node/bin/node')
    // opt 链不存在（brew 卸载/异常）：保守回退原路径
    expect(stableNodePath('/opt/homebrew/Cellar/node/22.14.0/bin/node', no))
      .toBe('/opt/homebrew/Cellar/node/22.14.0/bin/node')
    // nvm / 官方 pkg / 系统路径：非 Cellar 形态原样返回
    expect(stableNodePath('/Users/u/.nvm/versions/node/v20.0.0/bin/node', yes))
      .toBe('/Users/u/.nvm/versions/node/v20.0.0/bin/node')
    expect(stableNodePath('/usr/local/bin/node', yes)).toBe('/usr/local/bin/node')
  })
})
