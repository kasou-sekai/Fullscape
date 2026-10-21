# Apple Music 歌词桥接与动画改造设计

日期：2026-10-21。范围：FullScape 与 LyricShiori 的协作获取、预取、分源缓存和富歌词显示。
本文件先记录设计基准；当前实现范围和核验命令见末尾「实施记录」，传输端点以该记录为准。

## 1. 动画基准与现状

以 **FullScape 当前换行和逐字动画**为视觉基准，Shiori 负责提供完整歌词语义。
用户已验证 Shiori 本地显示，但不把 AppKit 的动画另写一套替换 FullScape 当前效果。

检查的实现：

- `src/ui/components/Lyrics/Lyrics.ts`：预取、活动句、逐字 WAAPI、间奏插入与整轨布局。
- `src/styles/base.scss`：歌词行、逐字、注音和间奏的样式。
- `src/utils/lyric-wrapping.ts`：按实测冻结换行，避免缩放时文字重新排版。
- `src/services/third-party-lyrics.ts`：现有严格/宽松匹配。
- `src/services/lyrics-cache.ts`：按增强模式缓存、桥接鉴权和请求超时。
- Shiori 的 `SharedLyricsCache.swift`、`AppleMusicLyricsService.swift`、`LocalLyricsStorage.swift`。

必须保持的现有参数：

| 行为 | 当前值 / 规则 |
| --- | --- |
| 歌词轨换行 | 520ms，`cubic-bezier(0.3, 0.15, 0.2, 1)` |
| 轨道级联 | 每个距离档 45ms，最多 6 档 |
| 非活动句缩放 | 每档 0.12，最低 0.72 |
| 非活动句模糊 | 每档 0.9px，最多 4.5px；保留现有交互例外 |
| 逐字染色 | 继续使用当前线性时间进度和渐变边界 |
| 逐字抬升/缩放 | 保留 `buildKaraokeKeyframes` 的 smoothstep、0.05→-0.07em、0.998→1.012 |
| 逐字余辉 | 保留现有 peakGlow 与至少 700ms 的 release |
| 间奏 `…` | 继续使用原来的插入位置、节拍和动画 |

当前有两个必须修复的数据假设：只保存一个 `activeIndex`；逐字结束会取“下一句开始”的较小值。
这对普通串行歌词有效，对重叠对唱会截断前一个声部。不能只加一个 `text-align:right` 就算完成。

## 2. 不变量

1. Apple Music 登录与请求只发生在 Shiori，FullScape 不新增登录、token 或 cookie 存储。
2. FullScape 获取 Spotify 基准歌词；连接协作模式下，普通 QQ/网易获取仍归 FullScape，Apple Music 获取归 Shiori。
3. 下载、验证、缓存、选用、发布是不同状态；下一首预取不能改变当前曲歌词。
4. 普通与 Apple Music 记录独立，来源切换不删除另一版。
5. 自动结果不能覆盖手动选择、隐藏状态、手动偏移或较新的来源选择。
6. 一首歌同一提供方的预取、切歌、轮询、重试和手动搜索必须复用尚未完成的请求。
7. 新能力须协商。旧插件只能读取普通歌词，不会误把 Apple Music 当普通 LRC 使用。
8. 变更必须同时覆盖浏览器渲染与 Shiori 的桥接服务；只改插件不能完成自动获取。

## 3. 缓存与选用

`LyricsCacheKind` 的 spotify/enhanced/enhanced-relaxed 表示增强模式，不表示歌词来源。
新增独立的 `sourceFamily: standard | apple-music`，禁止把 Apple Music 塞进 enhanced 后覆盖普通版本。

- 缓存键包含 trackUri、sourceFamily、增强/匹配模式和匹配规则版本。
- 老 localStorage 记录迁移为 standard；Shiori 继续沿用原目录 + `Apple Music/` 的分源 LRCS。
- 插件来源策略：`auto`、`apple-music`、`standard`。
- auto：尊重该曲已明确选用的来源；没有明确选择时，采用已验证的 Apple Music，否则使用普通歌词。
- 显式来源策略只在对应来源内部应用手动选择优先级；另一来源的手动记录仍保留。
- 隐藏/重置、选择 revision、歌词 document revision 分开处理；切换来源不重用错误的偏移。
- Apple Music 原始 TTML 永久保存在 Shiori。浏览器接收所需的规范化富数据和内容摘要，不在每次轮询中重复传原始 XML。
- 富数据超过现有 localStorage 的 1,750,000 字符预算时，不能静默截断背景/逐字数据；使用 IndexedDB 存放富文档，localStorage 只保留小索引与普通兼容记录。缓存失败不能抹掉另一来源。

## 4. 匹配规则只保留一个实现

从 FullScape 当前 `third-party-lyrics.ts` 抽出无网络、无 DOM 的纯匹配模块；普通源和 Apple Music 均调用它。
抽取必须先保持现有测试结果不变，不能顺带更改宽松含义或质量排序。

同一模块打包为受版本管理的 JavaScriptCore bundle，随 Shiori 发布；Shiori 在后台串行 JSContext 中调用。
OpenCC/NFKC、纯歌名提取、前导元数据剔除、首句选择和文本归一化一起复用。
不使用“Swift 大概等价”的另一个实现，也不执行插件传来的脚本文本。

规则版本为生成 bundle 内容的摘要；握手与每项任务携带该版本。两个版本不一致时不做新的跨端自动认领，
保留已选手动缓存与普通兜底，并提供明确诊断。规则升级后重新验证自动匹配，不重下已有 TTML。

保持的现有规则：

- 时长容差 12,000ms；宽松路径必须双方都有时长。
- 首句时间容差 2,500ms。
- 宽松首句要求归一化文本互相包含；时间超差时，只在一方有效首句位于 0–1,000ms 时放宽时间约束。
- 严格元数据允许原有严格路径；严格歌词匹配失败后，按现有条件进入宽松路径。
- 严格路径下，Spotify 没有同步歌词时仍保持原有“跳过首句比较”的行为。
- 缺少宽松首句证据时不制造 0ms 首句，也不把标题匹配冒充宽松首句通过。
- Apple Music 服务目前自身的 8 秒/4% 时长过滤须调整，不能在公共 matcher 判断前误删本应通过 12 秒规则的候选。

Scape 发送前几句完整的原始基准歌词（建议最多 5 句），而非只发送一条已经挑好的字符串。
这样两端运行同一个首句选择函数。证据字段包含 time/text、是否同步及基准歌词摘要。
TTML 的背景声部不充当主唱首句；语义适配层先区分主唱/背景，再把主唱序列交给公共 matcher。

## 5. 桥接协议 v2

保留现有 localhost、Origin 白名单及 X-LyricShiori-Token。v1 不改语义。
`GET /bridge-session` 增量公布 capabilities、matcherVersion、进程 sessionId、允许的负载上限。

建议的新端点：

| 端点 | 职责 |
| --- | --- |
| `POST /lyrics-v2/prepare` | cache-first 预取/加入已有任务；迅速返回 ready manifest 或 202 + jobId |
| `GET /lyrics-v2/jobs/:id` | 查询状态；支持 revision/ETag，无变化不重复传歌词 |
| `POST /lyrics-v2/activate` | 当前曲确认，原子重新检查手动状态并返回该曲可用来源和选中的富文档 |
| `POST /lyrics-v2/release` | 释放某个队列/当前曲消费者；不能取消另一消费者仍在等的工作 |
| `GET /lyrics-v2/document/:revision` | 按不可变文档 revision 读取正文，便于来源切换和有界传输 |

prepare 请求包括：protocolVersion、clientSessionId、requestId、trackUri、track metadata、
queueRevision、playbackGeneration、role(next/current)、sourcePolicy、matchingMode、matcherVersion、
Spotify 基准歌词及其摘要。所有时间字段以 ms 为单位并明确命名。

任务状态：`queued → resolving → ready | not-found | unauthorized | failed`。
释放消费者与网络任务的生命周期分开，不用一个布尔 pending 兼任这些状态。

网络处理线程只做鉴权、校验和入队；Apple Music WKWebView 调用转到 MainActor。
不能让 NWConnection 的处理队列同步等待 Apple Music 登录页/API。

## 6. 正常时序

### 6.1 下一首变化

1. FullScape 从队列取得下一首 URI、歌名、艺术家、专辑、时长。
2. 检查对应来源的浏览器缓存，再向 Shiori 做一次本地 LRCS 查询。
3. 命中有效手动/已验证文档直接准备；不为命中项重新访问提供方。
4. 未命中时，Scape 通过现有 `spotifyRequests` 获取一次 Spotify 基准歌词。
5. Scape 向 Shiori prepare：Shiori 再查 Apple Music 分源缓存，没有则加入 Apple Music 获取任务。
6. 普通获取仍只由 Scape 执行。prefer-Apple/auto 可先等待预取结果，再决定是否需要普通增强；Spotify 基准始终可复用为兜底。
7. Shiori 用公共 matcher 验证候选，保存 Apple Music 分源记录并标 ready。此时不改变桌面当前曲，不发布为正在播放的插件歌词。

### 6.2 歌曲开始

1. songchange 增加 playbackGeneration；使用实际当前 URI，不把“上一首预测的下一首”当事实。
2. 对同一个任务 activate；即使预取仍在进行，也只加入已有 Promise，不再获取一遍。
3. Shiori 重新检查来源选择、手动 revision、隐藏状态及匹配证据，返回选中版本。
4. Scape 收到结果后再检查当前 URI、generation 与最新选择 revision；一致才渲染。
5. 不匹配的旧结果可以留作该歌曲缓存，不能覆盖现在播放的其他歌曲。

零预取时间的快速切歌不能承诺开头一定已有完整歌词。初始建议最多等待 1,200ms，之后先显示已有缓存/Spotify；
后台任务继续复用。Apple Music 稍后成功时，非手动状态下在下一个主句边界升级，避免半个字的动画被重建。
已准备 ready 的下一首则在 songchange 时直接交付，不走固定延迟。

## 7. 去重、请求所有权与失败

两端都要有状态机；现有 lease 只是“插件正在工作”的提示，不能当成有结果或任务锁。

### Shiori 任务代理

- 逻辑任务键：trackUri + family + matchingMode + matcherVersion + 基准证据摘要。
- 提供方网络键：搜索参数/店面，或 catalogID + storefront + language + endpoint。
- 多个逻辑任务可共享同一个物理 Apple 请求；匹配、来源选择和手动状态不进入物理请求键。
- 登陆态探测和 storefront 查询也合并，禁止当前曲和下一首各初始化一个登录会话。
- 网络任务运行中，超时/消费者取消不立即删除它。底层请求尚未结束时标为 draining，重入继续合并，避免 WKWebView 无法硬取消时又发一份。
- 文档已有但首句证据变化：重新验证已有文档，不重新下载。
- 候选搜索和歌词下载分级缓存；负缓存按明确原因设置短 TTL，不把未登录写成“这首歌没有歌词”。

### FullScape

- 下一首、当前曲、刷新和共享同步统一经过 coordinator。
- 现有 spotifyRequests/enhancedRequests 保留并纳入它，不在新桥接路径旁边再起一组外部请求。
- prepare 重发使用相同 requestId；队列 revision 改变只改变订阅/发布资格。
- ready 任务缓存状态，不因每秒共享轮询重新 prepare 或请求 Apple。
- 配置切换只查对应来源，已有文档重新选用；不以更换 sourcePolicy 作为刷新所有提供方的理由。
- 缓存回传不被当作新下载再次 POST，避免 Scape→Shiori→Scape 的回声循环。

### 断联

协作模式中不采用“等几秒没消息，两边同时查 QQ/网易”的自动接管方式。
Scape 断联时继续使用浏览器缓存/Spotify 与其原有普通请求；Shiori 开着协作模式时不自行重复启动普通源自动搜索。
Shiori 独立使用普通自动搜索需要退出协作模式。这样正常连接和断联兜底的职责都保持唯一。
恢复连接时先交换会话/任务状态，不重放整条队列。只有下一首和当前曲保持活跃订阅。

同一进程正常协作时保证同键单个物理 in-flight 请求；进程崩溃后远端是否已收请求无法被本地事务证明，
因此不宣称跨崩溃的全球 exactly-once。恢复过程使用缓存、冷却与有限重试，而非无界重复请求。

## 8. 富歌词与时间语义

浏览器富文档区分：document、voice/agent、主句、背景子句、词和嵌套音节。

- 每句有稳定 key、start/end、agent、alignment、parentKey、role。
- background 是父句的子层，不成为独立滚动焦点，不贡献主唱首句匹配。
- 每词/音节保留显式 start/end 和文本范围，不能用另一个声部的下一句来推断结束。
- DOM 文本范围统一 UTF-16，并保留词/音节层级；不能混用 Swift Character、JS code point 和 UTF-16 的索引。
- 原始 TTML/未知扩展留在 Shiori；传输用有版本的规范化树，禁止 `innerHTML = ttml`。
- offset 与提供方校时只应用一次；Apple Music 不使用 QQ 的 200ms 修正。
- 对时间、索引、层级深度、文本量和响应总大小做边界检查。解析失败只退回普通版本，不损坏两版缓存。

## 9. 显示与动画

### 多句与右对齐

保留一个滚动锚点，同时用 `activeLineIds` 驱动所有正在唱的主句和背景子句。
WAAPI 动画记录改为逐句 Map；另一个声部进入不能 reset 前一个仍活动的句。

右声部沿右侧排版，使用 `right center` 作为缩放锚点；右侧横向缩进与左侧镜像。
换行、级联延迟、缩放和抬升沿用本文件列出的原值。
当前 renderer 中写死的 left transform-origin、left bleed、rightSpace 要按 alignment 处理，
而非额外叠加一个会干扰当前轨道的 CSS transform。

继续使用 freezeMeasuredLyricRows；按最终高亮字体和正确对齐测量并冻结换行。
字体加载、窗口改变时重测；高亮、淡入、来源心跳不重新创建逐字 DOM。

### 小字展开

- 非当前高亮主句：背景小字不占轨道空间且不可见；节点保留以免反复建 DOM。
- 主句进入高亮：读取预先测量的背景完整高度，把额外空间作为轨道布局的一部分展开。
- 相邻主句的位移和背景展开共用 520ms 与歌词轨 easing，像现有 `…` 插入一样真实让位。
- 背景内容独立 opacity 淡入/淡出；不把文字 scaleY 拉伸，也不以 display:none 瞬间挤动轨道。
- 初始方案：进入时空间 520ms，淡入 240ms、延后 80ms；离开时淡出 160ms，空间收回 520ms、延后 120ms。
  新增小字参数集中定义，可在视觉验收时微调，不修改既有换行/逐字参数。
- 同一高亮组内重叠的背景层取实际布局高度，不能把声部重叠错误地识别成间奏。
- 背景自身的逐字染色按它的显式时间轴；空间/可见性受父句高亮约束。
- 暂停只冻结播放时钟；seek 后直接复原应有空间/可见状态，不能从歌曲开始重放展开动画。
- 小字高度变化需要更新下方位置及手动滚动边界，避免自动焦点抖动；减少动画设置下直接到目标状态。

## 10. 实施拆分

1. 固定视觉基准；抽取纯 matcher，增加 Node/JavaScriptCore 同输入同输出的跨运行时测试。
2. 建立 v2 数据合同、任务代理与来源维度缓存；首先测试命中、去重、乱序、重连、手动覆盖保护。
3. 将下一首预取和 songchange 接入 prepare/activate；先用模拟数据验证完整交接，不改动画参数。
4. 接入多活动句、右声部布局、嵌套音节；保留普通歌词路径的原视觉结果。
5. 加入背景小字空间/淡入淡出；浏览器固定时间帧验收。
6. 用珊瑚海真实 TTML 联调，再打包更新插件与 Shiori。开发、构建不等于已安装到 Spotify。

建议模块：`lyrics-matching.ts`、`lyrics-coordinator.ts`、`lyrics-rich-document.ts`、
`lyrics-rich-layout.ts`，避免把更多职责继续堆入已有三千行的 Lyrics.ts。
Shiori 增加 AppleMusicPrefetchCoordinator、公共 matcher bundle adapter 和 v2 bridge routing。

## 11. 验收矩阵

### 请求与选择

- 相同下一首事件连续触发、预取刚开始就切入、多个刷新/共享同步同时触发：同物理键只请求一次。
- A→B→C 快速切歌、shuffle 改队列、repeat-one：B 不能覆盖 C；已预取 B 再回来不重复下载。
- 首句证据更新/来源切换：重新验证或读取已有文档，不重新访问歌词提供方。
- 未登录、无歌词、超时、Shiori 重启：有界退回普通/Spotify，不形成请求风暴。
- 手动改源/偏移、隐藏、重置发生在下载中：旧结果不能夺回控制权。
- strict/relaxed、繁简/本地化标题、12 秒/2.5 秒/1 秒边界与缺字段：公共 matcher 两个运行时结果一致。
- 老插件/老 Shiori：v1 普通路径可用，富数据不误发。

### 显示

- 普通歌词改造前后固定时间帧一致；新增功能不改原有曲线和逐字时钟。
- 珊瑚海对唱：两声部同时高亮，右侧换行与当前轨道节奏一致，无被下一句截断的长字。
- 背景小字：提前不占位；主句进入时平滑让位并淡入；退出淡出收回，无闪烁或跳位。
- 重复声部、多个同时背景、中文/日文 ruby、emoji/组合字符、跨行长字、空白和停顿。
- 暂停/恢复、前后 seek、窗口缩放/字体加载、手动滚动/返回同步、来源切换均不重叠、不跳时。
- 60/120Hz 下检查动画时钟与布局读取；不能每个音节都强制重测全轨。

只有两端单元测试、桥接集成测试、浏览器逐帧回归和真实歌曲检查完成后，才报告已完成效果一致性验收。

## 实施记录

已实现的传输为 `prepare`、`activate`、`release` 和 `selection` 四个 POST 端点；prepare 本身兼作有界任务状态查询，
activate 使用 `knownRevision` 返回 unchanged，因此本版没有增加重复职能的独立 job/document GET。
下一首只接收 ready manifest，正文在 activate 交付。队列兴趣用独立 revision 防止 ABA，后台获取串行执行。
匹配 bundle 与协议 hash 一致；Apple Music 预取始终采用现有宽松路径（先严格、再宽松），普通源保留原配置开关。
富文档缓存放在独立 IndexedDB，普通缓存保持原格式；缓存回声被隔离。

可重复核验命令：

```sh
npm run check
npm test
npm run test:lyrics-layout
npm run test:apple-music-layout
node scripts/build-shiori-matcher.mjs /path/to/LyricShiori/Sources/LyricShiori/Resources
```

`FULLSCAPE_APPLE_FIXTURE=/path/to/Apple Music/珊瑚海....lrcs` 可对本地真实缓存执行 browser 验收，
并可用于 Shiori 的 Swift 测试。测试只读用户文件，在临时目录运行；歌词正文和浏览器截图不提交到仓库。
没有该环境变量时保留合成多声部/背景测试，Swift 的真实文件验收明确跳过。

### 实际选源确认与自动排序

`selection` 仅在实际显示时提交（包含来源、文档 revision、客户端单调递增选择 revision），
Shiori 核对当前 Spotify 曲目和文档后选择独立缓存槽并更新桌面。下一首预取没有此副作用。
普通 v1 缓存同步不会改变已确认的 Apple 来源；手动选择、隐藏和较新的曲目选择优先。
断开重连通过当前显示状态重试，缓存只读刷新不触发歌词下载。

自动排序使用两端同一 `lyrics-preference.ts` bundle：中文歌词 Apple Music 优先；其他歌曲依次为
富文本 Apple Music、带中文翻译逐字、无翻译逐字、带中文翻译普通、普通同步、无时间轴歌词。
普通外语 Apple Music 不会阻止仍在获取的带翻译逐字候选更新显示。显式来源模式和手动选择保留优先权。
