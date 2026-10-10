/** ai-page-dive uninstall：清 NM 注册（各目录 manifest + wrapper）。
 * r52（review #5）：npm uninstall 后这些文件在 npm 生命周期之外永久残留——对
 * 「本地最小 footprint」叙事是硬伤。用户数据（~/.ai-page-dive 历史与自定义
 * workflow）不删：退出产品不该毁数据。preuninstall 钩子自动走此处 */
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HOST_NAME, macOSManifestDirs } from './install.js'
import { assertNotRoot } from '../rootguard.js'

export function uninstall(): void {
  // r71（r70 host low#2）：root 对称防御——install 有守卫而 uninstall 没有：
  // sudo npm uninstall -g 时 preuninstall 钩子以 root 跑，rmSync 以 root 属主
  // 删系统目录文件（/Library/Application Support/...），属主错乱风险同 install
  assertNotRoot('uninstall')
  // r58（R3）：rmSync force 对缺失文件不报错——无条件 n++ 曾让干净机器也报
  // 「已清理 3 处」。只数真实删掉的
  let n = 0
  for (const dir of macOSManifestDirs()) {
    const p = join(dir, `${HOST_NAME}.json`)
    try {
      if (existsSync(p)) { rmSync(p, { force: true }); n++ }
    } catch { /* 目录权限等：继续清其余 */ }
  }
  try {
    const wrapper = join(homedir(), '.ai-page-dive', 'host-wrapper.sh')
    if (existsSync(wrapper)) { rmSync(wrapper, { force: true }); n++ }
  } catch { /* 同上 */ }
  console.log(`[ai-page-dive] 已清理 ${n} 处本机注册。历史与自定义 workflow 保留在 ~/.ai-page-dive/，不需要可手动删除`)
}
