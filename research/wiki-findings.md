# 鸣潮官方 Wiki 素材调查

核验日期：2026-10-23。此文件只记录官方 Wiki 这一来源。

## 已整理的文件

| 文件 | 内容 |
| --- | --- |
| `wiki-character-profiles.json` | 65 条公开共鸣者图鉴记录；人物简介、身份、所属、CV、原始立绘标签与链接、少量中文个性语音；排除技能、数值、养成、配队数据 |
| `wiki-art-verified.json` | 290 个去重图片 URL 的原始尺寸、文件大小、图片格式、所属角色与原始素材标签；包括立绘、移动版立绘和服装图片 |
| `wiki-selected-art.json` | 每条角色记录的一张优先候选图，64 条选用“编队立绘”，莉莉暂为“角色预告”；保留原图 URL 和尺寸 |
| `wiki-avatar-catalog.json` | 官方 Wiki“头像”图鉴 87 条名称、资料页 ID、原图 URL；包含角色之外的活动及服装头像 |

## 目录口径

- 共鸣者目录返回 65 条记录，65 条详情均获取成功。
- 这不是 65 个独立且已实装的角色。目录包含男女漂泊者各 4 个属性条目、秧秧和“秧秧·玄翎”，也有“角色预告”资料。
- `identityGroup` 将漂泊者按男女分组、把秧秧两形态归组后得到 58 组。这仅用于讨论排行榜合并规则，不是官方角色人数。
- 不把 `showTeaserIcon` 解释为未实装标记：部分老角色仍保留该营销标记，日期区间也可能覆盖很长时间。
- 莉莉目前只有一张“角色预告”图，未找到“编队立绘”。不能给她自动继承另一角色的图。
- 65 条记录均有简介和主立绘；63 条“其他信息”中包含身份、所属及 CV 等内容。基础资料未提供可直接提取的生日字段；不要从“生日祝福”语音推断角色生日。
- 5 位角色有服装相关组件：赞妮、珂莱塔、长离、今汐、散华。服装不自动当作独立排行榜角色。

## 可重复的公开读取方式

这些接口来自 Wiki 页面自身公开加载的 JavaScript。没有使用用户凭据、登录 token 或私有账号资料。Wiki 由官方社区承载，词条包含社区维护内容，不能把每一段词条编辑文字都称为制作组原创文案。

读取入口：

- https://wiki.kurobbs.com/mc/home?bbs_clientSource=12
- https://wiki.kurobbs.com/resource/wiki/prod/assets/index-cb566e5b.js
- https://wiki.kurobbs.com/resource/wiki/prod/assets/use-glossary-library-helper-store-cdcbdd5c.js

公共请求头：

```text
Content-Type: application/x-www-form-urlencoded
wiki_type: 9
source: wiki
```

目录树：

```sh
curl 'https://api.kurobbs.com/wiki/core/catalogue/config/getTree' \
  -H 'wiki_type: 9' -H 'source: wiki' \
  -H 'Content-Type: application/x-www-form-urlencoded' --data ''
```

在树中找到 `游戏图鉴`，其 `共鸣者` 的目录 ID 为 `1105`，`头像` 的目录 ID 为 `1363`。

角色目录：

```sh
curl 'https://api.kurobbs.com/wiki/core/catalogue/item/getPage' \
  -H 'wiki_type: 9' -H 'source: wiki' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'catalogueId=1105&page=1&limit=1000'
```

头像目录同上，将 `catalogueId` 改为 `1363`。条目数组位于 `data.results.records`，总数位于 `data.results.total`。条目里的 `content.contentUrl` 是目录卡片图，不应直接等同于最佳立绘。

角色详情，以今汐为例：

```sh
curl 'https://api.kurobbs.com/wiki/core/catalogue/item/getEntryDetail' \
  -H 'wiki_type: 9' -H 'source: wiki' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'id=1249040336606580736'
```

资料页：https://wiki.kurobbs.com/mc/item/1249040336606580736

解析规则：

- `data.content.modules[*].components[*]` 中 `type == "role-component"` 的 `role` 含主资料。
- `role.figures` 包含来源标签 `name`、`url` 和可能存在的 `verticalFigureUrl`。
- `role.roleDescription` 是短简介，`role.info` 含性别和出生地等字段。
- “其他信息”组件的表格含身份、所属、CV 等信息。
- “角色皮肤”和“皮肤立绘”组件包含服装图片。
- “个性语音”组件可提供中文自我介绍、喜好、食物、生日祝福等语音直链；当前资料只选取这些类别。完整剧情档案只记录章节名及来源，不复制全文。
- API 使用的长整数 ID 超过 JavaScript 安全整数范围。交给前端的数据中 `entryId` 必须存成字符串，避免 `Number` 精度丢失。

## 图片尺寸和可用性

290 个原图 URL 均通过 CDN 元信息接口核验成功：

```text
原图URL?x-oss-process=image/info
```

返回 `ImageWidth`、`ImageHeight`、`FileSize`、`Format`。原图 URL 原样保留；没有通过猜测文件名或强行放大图片生成“高清版”。

| 样本 | 原始标签 | 像素尺寸 | 适用观察 |
| --- | --- | --- | --- |
| 今汐 | 立绘 | 719 x 713 | 实际看图为透明半身；适合较小展示 |
| 今汐 | 编队立绘 | 1111 x 1515 | 实际看图为透明全身，细节清晰，适合 H5 角色详情 |
| 今汐 | 海报立绘 | 1104 x 648 | 实际看图为带背景横图；角色本体只占其中一部分 |
| 琳奈 | 编队立绘 | 1920 x 2843 | 原图元信息核验 |
| 绯雪 | 编队立绘 | 1868 x 2739 | 原图元信息核验 |
| 秋水 | 编队立绘 | 1756 x 3106 | 原图元信息核验 |
| 陆·赫斯 | 编队立绘 | 1980 x 2970 | 原图元信息核验 |
| 丽贝卡 | 编队立绘 | 4285 x 6685 | 原图元信息核验；文件约 9.1 MB，列表中宜按展示大小生成派生链接 |

今汐三种不同用途的真实原图：

- 半身：https://prod-alicdn-community.kurobbs.com/forum/27b8039090e04cc2aed0bcbe989d5d9420240627.png
- 透明全身：https://prod-alicdn-community.kurobbs.com/forum/16686bb7915c4e63941b44aeb4976fdf20240627.png
- 横版海报：https://prod-alicdn-community.kurobbs.com/forum/5a77c64dae0c4e2a8cd90c312cf771c120240805.png

丽贝卡高清编队立绘：

- https://prod-alicdn-community.kurobbs.com/forum/d91e23138412472d8c65fc1b1c58c40f20260509.png

`wiki-selected-art.json` 的 65 条候选图共有 63 个不同 URL，因为部分漂泊者属性条目复用同一张图。候选图的最小宽度为 983 像素，最小高度为 1117 像素；全部长边大于 1000 像素。选图依据是来源的“编队立绘”标签，正式排版仍需检查具体人物姿态和裁切位置。

## 给后续前端的建议

- 用数据文件存放稳定角色 ID、显示名、变体关系、图片原链接和来源链接，页面通过这些字段引用素材。
- 优先用头像服务排行榜列表，用编队立绘服务展开详情或前三名展示；海报用于背景或独立展示。
- 主数据保留原图 URL；根据 CSS 展示大小和设备像素比生成 CDN 缩放链接，避免一次加载多个数 MB 的全尺寸图片。
- 保留 `name` 原始素材标签，避免把所有“立绘”“基本信息”“海报立绘”都当作透明全身图。
- 当前只验证图片本身可访问、尺寸与抽样画质，尚未测试最终 H5 域名环境中的跨域请求、Canvas 导出及所有图片的构图。
- 素材范围已确认：完整档案、珍贵之物、故事、全部可获取语种的个性与战斗语音，以及额外服装和皮肤均需收集并展示，见 `MATERIAL_SCOPE.md`。漂泊者属性和角色形态的排名分组、预告角色是否入榜、皮肤展示方式留到后续产品阶段讨论。
