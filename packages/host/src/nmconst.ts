/**
 * NM chunk 上限（字节维度）。
 * ponytail: 与 shared/protocol.ts 的 MAX_CHUNK 是同一契约的两份拷贝——shared 是
 * private workspace 包永不发布，host 走纯 tsc 无 bundler，运行时 import 会让
 * npm 包发布即 ERR_MODULE_NOT_FOUND。一致性由 test/task.test.ts 断言防漂移。
 */
export const MAX_CHUNK = 512 * 1024
