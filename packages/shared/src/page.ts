/** Content Script 提取产物的统一 schema */
export interface PageContent {
  url: string
  title: string
  byline?: string
  publishedTime?: string
  siteName?: string
  lang?: string
  /** 提取器标识：readability | adapter:<name> | innertext */
  extractor: string
  /** 归一化后的 markdown 正文（全量） */
  contentMarkdown: string
  /** 粗略 token 估算（chars/4），仅用于 prompt 提示 */
  approxTokens: number
  /** 提取质量提示（截断/低置信），panel tips 条展示；无则不渲染 */
  notice?: string
  /** 原文超 200k 上限被截时的原始字符数（未截不落键）。r57（#2）：host prompt
   *  据此把「完整正文」切换为截断如实文案——否则 agent 把「后半缺席」当
   *  「文章本来就没有」，在最长最需要深读的文档上产出结构性错误总结 */
  truncatedOriginalChars?: number
}
