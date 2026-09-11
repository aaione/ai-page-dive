import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HOST_VERSION } from '../src/version.js'

/** 版本串防漂移：四处曾三源漂移（bump 漏改 manifest/帮助文案）。
 * bump 只改 packages/host/package.json——漏改任何一处这里变红 */
describe('版本单源一致性', () => {
  it('HOST_VERSION（运行时读包根）=== host package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(HOST_VERSION).toBe(pkg.version)
  })

  it('extension package.json / manifest.json === host 版本（CWS 与 npm 同轨发布）', () => {
    const extPkg = JSON.parse(
      readFileSync(new URL('../../../apps/extension/package.json', import.meta.url), 'utf8'),
    )
    const manifest = JSON.parse(
      readFileSync(new URL('../../../apps/extension/public/manifest.json', import.meta.url), 'utf8'),
    )
    expect(extPkg.version).toBe(HOST_VERSION)
    expect(manifest.version).toBe(HOST_VERSION)
  })
})
