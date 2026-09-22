/** dev harness 入口：先装 chrome mock 再拉起真实 sidepanel 入口（r44 自验用） */
import './chrome-mock.js'
await import('../sidepanel/main.js')
