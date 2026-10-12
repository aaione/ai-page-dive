/**
 * 提取管线：Readability → DOMPurify → Turndown(GFM)。
 * activeTab 用户手势触发时经 chrome.scripting.executeScript 注入。
 */
import { Readability } from '@mozilla/readability'
import DOMPurify from 'dompurify'
import TurndownService from 'turndown'
import type { PageContent } from '@ai-page-dive/shared'
import { applySiteAdapter } from './adapters.js'

/** 正文提取上限（字符）：与 innerText 兜底共用——readability 路径原先无上限，
 * 在线书籍/论坛长帖可产出数 MB 正文（NM 分片放大 + CLI 订阅一次烧穿） */
const MAX_CONTENT = 200_000

/** token 估算（tips 条「≈N tokens」用量透明）：CJK 按 ≈1 token/字、其余按 4 字符/token。
 *  r56（#8）：纯 len/4 对中文页低估 3-4 倍——用户看到的用量比实际烧的少一大截。
 *  ponytail: 覆盖常用 CJK 区块（中日韩统表/假名/注音/全角），CJK 扩展 B+ 与谚文未计入 */
export function approxTokensOf(s: string): number {
  const cjk = (s.match(/[　-鿿＀-￯]/g) ?? []).length
  return cjk + Math.ceil((s.length - cjk) / 4)
}

/** r57（#3）：shadow 兜底文本的「像正文」判定（双启发式）：体量 ≥1000 字符 +
 *  非空行平均行长 ≥20。UI 组件杂讯（播放器/菜单按钮）是短语枚举，两项皆短；
 *  真正文无论 CJK/拉丁，段落行长轻松过线。 */
export function looksLikeProse(s: string): boolean {
  if (s.length < 1000) return false
  const lines = s.split('\n').filter((l) => l.trim())
  if (!lines.length) return false
  return lines.reduce((a, l) => a + l.length, 0) / lines.length >= 20
}

/** shadow DOM 文本收集：cloneNode/innerText 都进不去 shadow root，正文整体渲染
 * 在 shadow 里的站点会拿到壳。深度受限防深嵌套 DoS（采集器跑在页面进程里） */
function collectShadowText(root: Element, depth = 0): string {
  // r9-review：原实现只递归不读文本，恒返回空串（兜底链 no-op）。基座改为
  // textContent——light DOM 文本 + 各 shadow root 递归拼接；截断与主链一致
  if (depth > 20) return (root.textContent ?? '').slice(0, MAX_CONTENT)
  let out = root.textContent ?? ''
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  let el: Element | null
  while ((el = walker.nextNode() as Element | null)) {
    const sr = (el as HTMLElement).shadowRoot
    if (sr) out += `\n${collectShadowText(sr as unknown as Element, depth + 1)}`
  }
  return out.slice(0, MAX_CONTENT).trim()
}

// SW 经 executeScript(func) 直调 globalThis.__pagediveExtract（绕开 tabs.sendMessage
// 只达 top frame 的限制，iframe 聚合提取需要进每个 frame）。guard：动态注入会执行
// 多次（SW 30s 回收后重新注入），只挂一次。r8：原 chrome.runtime.onMessage 的
// 'extract' 监听已无调用方（SW 无 tabs.sendMessage({t:'extract'}) 路径），删除
if (!(globalThis as any).__pagediveInjected) {
  ;(globalThis as any).__pagediveInjected = true
  ;(globalThis as any).__pagediveExtract = extractPage
}

/** HTML table → GFM markdown（turndown 核心不带表格规则） */
function turndownTable(table: HTMLTableElement): string {
  // closest 过滤：只取本表的行——querySelectorAll('tr') 是后代选择器，
  // 嵌套表格的内层行会被平铺进外层（列错位/语义污染）
  const rows = [...table.querySelectorAll('tr')].filter((tr) => tr.closest('table') === table)
  if (!rows.length) return ''
  const cells = rows.map((tr) =>
    [...tr.querySelectorAll('th,td')]
      .filter((c) => c.closest('tr') === tr || c.closest('table') === table)
      .map((c) => (c.textContent ?? '').trim().replace(/\|/g, '\\|').replace(/\n/g, ' ')),
  )
  const line = (cs: string[]) => `| ${cs.join(' | ')} |`
  const [head, ...body] = cells
  if (!head?.length) return ''
  // 列数对齐到 max（colspan/列数不齐的表直接渲染会破 GFM 结构）。
  // r8-review：循环求 max 不用 spread——12 万+ 行的病态长表会爆 V8 参数栈
  // （~125k 上限），RangeError 被外层 catch 吞掉后整页提取失败连 innerText 兜底都没了
  let width = 0
  for (const r of cells) if (r.length > width) width = r.length
  const pad = (cs: string[]) => { while (cs.length < width) cs.push(''); return cs }
  const out = [line(pad([...head])), `| ${head.map(() => '---').join(' | ')} |`]
  for (const r of body) out.push(line(pad([...r])))
  return out.join('\n') + '\n'
}

export function extractPage(): PageContent | { error: string } {
  try {
    const adapted = applySiteAdapter(location.href, document)
    if (adapted) return adapted

    // 微型 frame 早退（r7-perf）：广告/埋点 iframe 也跑全量 Readability+DOMPurify+
    // Turndown 是纯浪费（SW 对 allFrames 每 frame 调一次）。只对 iframe 生效（主
    // frame 不设限），阈值远低于任何正文页；empty-content 在 SW 侧按「该 frame
    // 无正文」处理，正文主体在长 frame 中竞选出（extractBest 取最长）
    try {
      if (window !== window.top && (document.body?.innerText || '').length < 500) {
        return { error: 'empty-content' }
      }
    } catch { /* frame 环境异常时继续常规管线 */ }

    const docClone = document.cloneNode(true) as Document
    const article = new Readability(docClone).parse()
    const html = DOMPurify.sanitize(article?.content || '', {
      FORBID_TAGS: ['script', 'style', 'noscript'],
    })
    let markdown = ''
    if (html) {
      const td = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
      })
      // ponytail: 表格是 GFM 最重要的块，自写规则（不引 turndown-plugin-gfm 全家桶）
      td.addRule('table', {
        filter: ['table'],
        replacement: (_content, node) => turndownTable(node as HTMLTableElement),
      })
      td.remove(['thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col'])
      markdown = td.turndown(html)
    }
    // Readability 失败/空壳/「成功但残缺」（cloneNode 不克隆 shadow DOM——正文在
    // shadow root 里的站点 Readability 拿到的是壳）→ 正文全文逐字兜底，截断防数
    // MB 正文烧穿订阅。jsdom 无 innerText（真实 Chrome 才有）——?? '' 保持兜底链可求值
    const innerText = document.body.innerText ?? ''
    // r78（cmu-agents 课程表实证）：Readability 的 sibling 裁剪会把开头整块当低分
    // 兄弟丢掉——结构化产出非空但不足页面可见文本 1/4（该页实测 1334/5361，Sep–
    // Oct 8 的 Lecture 1-4 整块被裁，CLI 收到的快照从 Oct 13 开始）。「成功/失败」
    // 二态间没有「成功但残缺」检测 = 静默丢正文。宁带噪声勿丢正文：looksLikeProse
    // 过线且对账 1/4 即判残缺降级。误伤面 = 产出比真低于 1/4 的文章页（如长评论
    // 区被正常剥除）会带上评论噪声——损失是总结变啰嗦，漏检的损失是 CLI 对页面
    // 四分之三的内容视而不见，后者不可接受
    const degraded = !markdown.trim() || (looksLikeProse(innerText) && markdown.length < innerText.length / 4)
    let originalChars = 0
    if (degraded) {
      // r57（#3）：shadow 兜底「非空即正文」会放行组件杂讯——正文在 light DOM 的
      // 站点上 Readability 失败时，shadow 里常是播放器/菜单短语，几百字符的按钮
      // 枚举被 CLI 总结得有模有样，比明确失败更误导（与丢片同罪）。looksLikeProse
      // 双启发式过线且不短于 innerText 才采纳 shadow 文本
      const shadowText = collectShadowText(document.body)
      const fallback = looksLikeProse(shadowText) && shadowText.length >= innerText.length ? shadowText : innerText
      // 残缺降级时 Readability 产出已判不可信——兜底不能回头取它的 article.textContent
      const source = markdown.trim() ? fallback : article?.textContent || fallback
      originalChars = source.length
      markdown = source.slice(0, MAX_CONTENT)
    } else {
      originalChars = markdown.length
      if (markdown.length > MAX_CONTENT) markdown = markdown.slice(0, MAX_CONTENT)
    }
    if (!markdown.trim()) return { error: 'empty-content' }

    // 提取质量提示（panel tips 条展示）：
    // - 截断：正文超上限被截——用户应知道总结只覆盖了前 200k 字符
    // - 低置信：innerText 兜底路径拿到的是整页逐字文本（含导航/评论/杂讯），
    //   Readability 结构化解析失败本身即是信号
    const truncated = originalChars > MAX_CONTENT
    const lowConfidence = degraded || !article?.content
    const notices: string[] = []
    if (truncated) notices.push(`原文 ${originalChars.toLocaleString()} 字符超上限，仅取前 ${MAX_CONTENT.toLocaleString()}`)
    if (lowConfidence) notices.push('本页结构解析不可信，已退化为全文提取，总结质量可能受限')

    return {
      url: location.href,
      title: article?.title || document.title,
      byline: article?.byline || undefined,
      publishedTime: article?.publishedTime || undefined,
      siteName: article?.siteName || undefined,
      lang: document.documentElement.lang || undefined,
      extractor: !degraded && article?.content ? 'readability' : 'innertext',
      contentMarkdown: markdown,
      approxTokens: approxTokensOf(markdown),
      notice: notices.length ? notices.join('；') : undefined,
      // r57（#2）：结构化截断信号——host prompt 据此切换截断如实文案（notice 只是 UI 提示）
      truncatedOriginalChars: truncated ? originalChars : undefined,
    }
  } catch (e: any) {
    return { error: String(e?.message ?? e) }
  }
}
