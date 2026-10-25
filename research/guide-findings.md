# 鸣潮官方攻略站素材调查

核验日期：2026-10-23。仅访问无需登录的公开页面、页面脚本、公开 GET 接口和公开图片，没有读取账号、Cookie 或登录凭据。

## 结论

- 公开角色目录可一次取得当前攻略站的 60 条角色记录及 120 条角色图片链接，已保存为 `guide-catalog.json`，每个角色有官方简体中文名、角色 ID、方形头像和半身展示图。60 是此来源的条目数，不等于去重后人物数。
- 全部 120 张图片已读取 PNG 文件头核验尺寸，结果统一为头像 256 x 256、展示图 696 x 960。12 张代表图片另已完整读取和解码，验证透明度、有效边界及文件体积。
- 目录直接给出的 URL 均不带 `x-oss-process` 等缩放参数。此来源的 696 x 960 也是页面实际使用的源文件；没有发现页面公开暴露更大版本的方法。不能把它称作角色原始超高清立绘。
- 图片适合排行榜头像和中小型角色卡。按 2 倍像素密度估算，256 图建议显示到约 128 CSS px，696 图建议显示到约 348 CSS px；大屏主视觉或高像素密度手机全宽大图应优先使用其他官方来源的更高分辨率图。
- 此站以战斗攻略为主。抽查 `/role/info?roleGbId=1304` 的文本只有角色名、连招和技能描述，没有人物身份、生日、喜好或世界观简介，因此规范化素材表没有采纳战斗描述。

## 来源与可复现方式

入口：

- `https://mcguide.kurogames.com/zh-Hans/?role_id=1312&strategy_id=10233`
- `https://mcguide.kurogames.com/assets/js/main-DJB4nTJe.js`
- `https://mcguide.kurogames.com/assets/js/index-BE1E2Kjm.js`

本次页面 HTML 的公开构建信息为 `Version: 2.0.0`、`Branch: production`、`BuildTime: 9/29/2026, 8:16:41 AM`。哈希脚本名可能随部署改变，应每次先获取入口 HTML。

页面脚本实际调用的公开接口：

```sh
curl -L -H 'x-language: zh-Hans' \
  'https://guide-server.aki-game.com/role/avatar/list'

curl -L -H 'x-language: zh-Hans' \
  'https://guide-server.aki-game.com/role/info?roleGbId=1304'
```

接口返回 `{ "code": 200, "message": "ok", "data": ... }`。本次直接无鉴权请求成功。前端也配置了备用接口域名 `https://guide-server-1.aki-game.com`，本次没有因主域失败而启用或验证备用域。

主要目录字段：

| 原字段 | 用途 |
| --- | --- |
| `roleGbId` | 官方攻略站角色 ID |
| `texts[].language == "zh-Hans"` 的 `name` | 官方简体中文名 |
| `cardPictureUrl` | 方形头像 PNG |
| `illustrationPictureUrl` | 半身展示 PNG；不是所有角色的完整全身立绘 |
| `star` | 稀有度，可选辅助标签 |
| `roleStatus` | 站内状态，勿与个人 XP 排名混淆 |
| `mayRoleGbId` | 页面用于兼容另一角色 ID 的别名映射 |

公开脚本的 `roleStatus` 枚举为 `1=ALREADY_ONLINE`、`2=NEWLY_LAUNCHED`、`3=UP`、`4=PROSPECT`。本次目录分布为 57 条 `ALREADY_ONLINE`、1 条 `NEWLY_LAUNCHED`、2 条 `UP`，没有 `PROSPECT`。这只是来源站点当时标注，并非独立的版本考证。

## 实际图片核验

测试第三方嵌入时使用 `Origin: https://example.com`、`Referer: https://example.com/`，对 120 张图片发送 `Range: bytes=0-4095`。本次均返回 HTTP 206 和 `Access-Control-Allow-Origin: *`，没有出现第三方 Referer 导致拒绝的情况。此结果说明当前公开图片适合直接 URL 引用，但不构成永久可用性保证。

PNG 类型 6 有独立 alpha 通道，类型 3 为调色板；后者使用 `tRNS` 同样支持透明度，不能因没有独立 alpha 通道就判为不透明。全部 120 张图的文件头包含独立 alpha 或调色板透明信息；完整核验的 12 张均实际存在透明像素，alpha 范围均为 0 到 255。

下表的有效内容边界为 `(left, top, right, bottom)`，单位是原图像素。展示图外框统一 696 x 960。

| 角色 | ID | 头像体积 | 展示图体积 | 展示图有效内容边界 |
| --- | --- | ---: | ---: | --- |
| 锁暝 | 1312 | 81,481 B | 632,682 B | (0, 0, 696, 957) |
| 漂泊者·气动 | 1408 | 36,598 B | 237,037 B | (0, 42, 696, 960) |
| 珂莱塔 | 1107 | 94,504 B | 416,181 B | (0, 162, 696, 957) |
| 相里要 | 1305 | 66,722 B | 322,754 B | (0, 130, 696, 957) |
| 今汐 | 1304 | 83,524 B | 348,765 B | (0, 169, 696, 957) |
| 秧秧 | 1402 | 87,033 B | 374,303 B | (10, 147, 686, 935) |

已目视检查今汐和漂泊者·气动的完整展示图：

- 今汐为半身人物展示图，顶部有 169 px 透明留白，发梢/服饰触及左右边界；即使外框高 960 px，实际人物有效高度也只有 788 px。后续布局应设置角色独立裁切/对齐信息，避免统一 `object-position: center` 造成头部位置不齐。
- 漂泊者·气动为男女漂泊者同框图，不能直接当作单独男主或女主的素材。调色板图片含透明信息。

今汐实际资源：

```text
https://guide-res.aki-game.com/introduction/material/315e7aac9186a176b8b15c15e0a0d779/f0f853fc28b06aab285db5ab274bec52.png
https://guide-res.aki-game.com/introduction/material/91df769d78fab5575c781a6eaa4733bd/f0f853fc28b06aab285db5ab274bec52.png
```

## 条目合并和后续使用注意

- 目录有 `漂泊者·气动`、`漂泊者·衍射`、`漂泊者·湮灭`、`漂泊者·导电` 4 条。XP 排行榜是否合并属性，以及是否按男女漂泊者拆分，需要用户决定。
- `mayRoleGbId` 在本次目录的 4 条漂泊者记录分别对应 1406、1501、1605、1310。脚本只证明其作为路由兼容别名使用；本表不凭 ID 推断性别。
- `秧秧` 和 `秧秧·玄翎` 是目录里的不同名称记录；是否按人物合并或作为不同形态排名应由用户决定。
- 本目录没有独立的皮肤/服装集合字段，因此不能把当前 60 条记录当作所有换装的完整索引。
- 建议将此来源当作角色 ID/姓名目录和统一尺寸图片的后备资源源，人物简介与高分辨率主视觉继续从官方 Wiki/官方角色介绍补充。
- 后续页面通过集中 JSON 配置引用官方资源 URL，避免在组件里重复写 URL；不应假设浏览器可以随意直接调用接口，接口跨域政策需单独验证。静态素材 JSON 则可由构建或素材更新脚本刷新。

## 本次文件

- `guide-directory-raw.json`：完整接口响应快照，保留复核来源。
- `guide-catalog.json`：过滤战斗内容后的角色素材目录，包含每张图片的真实尺寸、PNG 透明方式、HTTP/CORS 结果，以及抽样图的有效边界。
- `guide-inspect.py`：本次图片核验脚本，从 `/tmp/mcguide-roles.json` 读取已抓取目录；正文使用公开 URL，没有任何鉴权参数。完整图片仅暂存在 `/tmp/mcguide-*.png` 供质量检查，没有把图片写入前端资源目录。
