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
}
