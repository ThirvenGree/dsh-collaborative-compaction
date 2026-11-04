# 原始历史全文检索设计

本适配基于固定的 billion-context v0.1.212，保留原始历史、摘要与证据读取接口，只替换搜索时的原文定位路径。

## 采用的资料与决策

- [SQLite FTS5 文档](https://sqlite.org/fts5.html#the_trigram_tokenizer)：trigram 支持任意子串，但 MATCH 不支持不足三个 Unicode 字符的查询。因此长查询使用 trigram，一至两字另建字符片段索引；候选仍用字面匹配确认。
- [SQLite 外部内容索引一致性](https://sqlite.org/fts5.html#external_content_table_pitfalls)：新增、更正、撤回及删除必须与索引维护关联，已有数据还需要首次构建。这里在源库用事务触发器记录变化，后台工作线程增量更新派生索引。
- [fts5-cjk 项目](https://github.com/Ray0907/fts5-cjk)：参考连续中文使用相邻双字片段的思路。本适配自行实现字符片段编码，复用内置 FTS5，不加载该项目的原生扩展或复制其源码。
- [Node Worker 文档](https://nodejs.org/docs/latest-v22.x/api/worker_threads.html)：SQLite 查询、脱敏文本准备和索引构建放到工作线程，避免在宿主线程扫描整段历史。
- [SQLite WAL 并发边界](https://sqlite.org/wal.html#walresetbug)：固定 Node 所带的 SQLite 版本也要纳入并发设计。搜索线程只读正式历史库；独立可重建的搜索库使用回滚日志，不额外给正式库增加后台写入和检查点线程。

## 数据与检索范围

这里的“按会话隔离”指一次查询及证据引用只属于选定目标，不表示限制哪些调用者可以选择该目标。当前生产工具没有调用会话到目标会话的访问白名单；已知的准确引擎 ID 或唯一标准 ID 可以定位同一引擎存储中的可检索完整原文。实际存储目录决定数据范围，DSH profile 名称本身不隔离共用的存储。

索引文件位于原 index.db 旁，文件名为 `index.db.search.sqlite`。它只保存搜索所需、经凭据遮蔽的文本及来源字段，不是正式记忆库，也不会上传 GitHub。推理内容、system 消息和图片二进制不进入搜索文档。原始 CAS 内容不改写。

当前会话搜索合并持久化记录和本轮尚未落盘的消息。新消息覆盖同 ID 的旧内容；检索命中仍带来源、角色、时间、明确的更正关系和原文读取入口。相邻消息按真实记录顺序读取，不能把两个搜索命中项当作相邻发言。跨会话使用同一个工作线程索引，但始终以目标会话 ID 隔离。磁盘会话读取轻量状态与索引，不在主进程加载整段原文，也不恢复为活动会话；内存中的目标会话额外提供已送达引擎的新消息。目标为未知或别名有歧义时明确失败，不默认选择某段聊天。读取入口同时返回目标会话与证据 ID，分页保持两者不变。它只读取本机同一引擎存储中已有的数据，不自动导入尚未送达引擎的 DSH 会话。

客户端重发完整历史时，第一次同步仍需把内存消息交给工作线程；后续只发送发生变化的正文和消息顺序。与已保存原文相同的内存副本继续使用索引。查询失败会使该会话的传输缓存失效，下一次重新同步，避免漏掉失败请求中的新消息。搜索线程重启后同样重新同步。

传输缓存采用最近使用顺序，最多保留 16 个会话，并按约 64 MiB 的估算预算逐出；同一次逐出会同步给工作线程。单个超大活动会话允许超过该预算，避免每次搜索都重新传输整段正文，因此这不是严格的进程内存上限。

索引按稳定消息身份和版本维护。普通 prepare 引起的 revisionEpoch 变化不会触发整库重建。正常 SQLite 已保留原文的压缩块不会额外加载懒加载的 full.text；仅缺少结构化原文的旧格式归档保留兼容扫描。

## 验证边界

测试使用独立临时数据库和合成文本，不调用外部模型，不写正式聊天、人物或记忆。验收包括两字人名、数字参数、参数内部子串、路径、日期、尚未落盘的新消息、同长度更正、删除、撤回以及旧证据句柄失效。

长历史报告见 [history-search-benchmark.md](history-search-benchmark.md)，本次跨会话 2 万条原文对照见 [cross-session-search-benchmark.md](cross-session-search-benchmark.md)。首建时间和磁盘增量必须单独报告，不能只用热查询表现宣称整体加速。旧格式归档的首次懒加载、很大的本轮内存消息，以及命中很多记录的查询仍有开销；索引不是语义检索，也不能从关键词结果自动推断事实或更正关系。

运行中的搜索缓存能识别已经与原文一致的旧内存副本，外部更正或删除原文后不会再用该副本复活旧内容。但工作线程重启以后，如果宿主继续传入没有版本信息的旧消息，它与一次新的同 ID 编辑无法仅凭文字区分；此时仍按当前会话输入优先处理。索引不能代替宿主在外部更正历史后刷新会话快照。

## Cross-session read contract

`search_context({conversation_id, query})` targets one known local engine session. The SQLite worker searches persisted originals, and resident snapshots overlay just-received messages. `open:ev-...:offset` reads a bounded page using the same target. Evidence identities include the source session and content; stale or wrong-session handles do not return another record. Search does not switch the caller binding, hydrate a cold session, decompress history or change formal memory. Searchable data excludes reasoning, system messages, binary media and masked credentials. History never received by this engine is outside this index.
