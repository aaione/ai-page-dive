import { readFileSync } from 'node:fs'

/** host 版本单源：包根 package.json（src 与 dist 到包根都是 ../，相对层级对称成立，
 * 不随 cwd 漂移）。bump 只改 package.json 一处；extension 侧 manifest/package.json
 * 的一致性由 test/version.test.ts 断言防漂移（四处版本串曾三源漂移过）。
 * 读取失败（打包残缺，罕见）兜底 0.0.0：握手判「过低」强制升级提示，失败方向安全 */
export const HOST_VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
})()
