# GitHub 展示文档与发布准备

日期：2026-10-25。

## 修改范围

- 项目改名后的根目录为 `xin-chao`，此前未初始化 Git；本轮没有初始化、提交、推送或创建远程仓库。
- README 改写为公开项目介绍，包含功能、9张实际截图、本地运行、GitHub Pages 部署、技术栈、原理图、数据更新边界、资料来源与项目结构。
- 截图集中在 `docs/screenshots/`，全部使用相对路径，总大小691,564字节；未引入图床。
- 增加 `.github/workflows/deploy-pages.yml`：main推送或手动触发，Node.js 22、npm ci、63项回归测试、生产构建、上传dist、部署Pages。
- 构建任务仅有源码读取与Pages元数据读取权限；部署任务授予Pages发布及OIDC权限。不需要项目额外保存个人访问令牌。
- 保留 Vite 原有 `base: './'`，没有改动应用页面或业务逻辑。

## 验证

- `npm test`：13个文件、63项测试全部通过。
- `npm run build`：TypeScript和Vite构建通过。
- 工作流YAML可解析，校验main触发、手动触发、dist上传和部署依赖关系。
- README中的13个本地链接全部存在，9张图片均位于docs/screenshots，没有绝对本机路径。
- 在独立端口5189运行生产预览，使用`/xin-chao/`路径打开，确认首页、图鉴、角色详情、皮肤、语音、影片索引和海报预览可用。
- 桌面截图1462像素宽，手机390×844；手机页面clientWidth与scrollWidth均390。
- 截图使用单独端口的四人示例榜单，用户原5173端口的榜单未修改。
- 已验证生产资源及数据子路径，不等同于已在github.io域名完成Wiki跨域验收。
- GitHub远程工作流尚未执行，需创建仓库、推送并在Settings → Pages选择GitHub Actions后验证真实发布。

## 首次上线

在GitHub创建空的公开仓库xin-chao，推送本地项目。在仓库Settings → Pages将Source设为GitHub Actions；首次推送若早于Pages设置，手动运行Deploy to GitHub Pages工作流。发布成功后访问部署结果中的网址，并在真实域名验收上游媒体和Wiki请求。

只发布dist，README截图、研究资料和验收文件保留在源码仓库，不进入站点产物。
