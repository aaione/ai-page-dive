/** root/sudo 守卫（install 与 postinstall 共享）。
 * root 写出的 manifest/wrapper 属主为 root，后续普通用户幂等重写会 EACCES 死锁。
 * 不做 SUDO_USER 换算（跨用户属主是新的失败面）——只拒绝并给重装指引。 */
export function assertNotRoot(cmd: string): void {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    console.error(`[ai-page-dive] 检测到以 root/sudo 运行 ${cmd}，已中止（避免写坏用户目录属主）。`)
    console.error('[ai-page-dive] 建议：用 nvm/Homebrew 的 Node 以普通用户重装（npm i -g @aaione/ai-page-dive，无需 sudo）。')
    process.exit(1)
  }
}
