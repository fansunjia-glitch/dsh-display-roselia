# 验证记录

验证日期：2026-10-17。插件：`dsh-display-roselia@0.2.0`。

## 环境与官方接入

- DSH `0.2.1-rc.2`，只读参考提交 `687f282e86`。
- macOS、Node.js `24.22.0`、真实 DSH Web Client / Chromium。
- 使用官方 `dsh plugin --profile web add <本地插件目录>` 链接安装；CLI 自动维护 profile 依赖与 bundle 层。
- 官方源码 CLI 的安装和启动进程受 macOS Seatbelt 保护，拒绝写入官方仓库。安装后官方仓库工作区仍干净。
- 主题使用 `theme.overrideTokens`、品牌插槽；推理浮层使用 `conversation.input.right` 与 `modelDirectories`。没有修改或拦截官方模型菜单。

## 自动检查

`npm run typecheck` 通过；最终 `npm test` **45 / 45 通过**。覆盖主题生命周期、偏好和随机成员、官方插槽、浮层按需显示、Escape/外部关闭、拖动单次提交、键盘连续调整、双向同步、默认档位、失败与过期手势、忙碌门控及卸载。

新增冷启动回归：严格验证调用 `directoryFor()` 的范围已声明 `modelDirectories`、`sessions`、`remote`、`remote.session`；连接服务缺失时推理入口延迟注册，主题仍可使用。

构建同时验证：仅注册一个符合 DSH 协议的 factory；加载时不提前操作 DOM；输入文件都属于插件目录；运行时 external 受白名单约束。CSS source map 使用插件相对路径，不携带开发机器路径。

## 页面验收

已验证的主题行为：深浅色跟随 DSH、四种场景、固定成员与随机相遇、刷新保持偏好、纯净模式、主题面板键盘关闭与焦点返回。随机模式在重新进入主页时更换成员，连续两次不会重复；普通渲染不换人。

桌面 `1200 × 900` 与窄窗口 `390 × 844` 已验收：默认不渲染滑条；点击后展开圆角浮层；蓝紫流光、白色正圆滑块显示正确。End、连续方向键及真实鼠标拖动会更新官方菜单，焦点连续可用；Escape 和外部点击关闭。窄屏浮层位于视口 12–378px 内，无横向溢出。测试后恢复原档位。

全新页面复核后，官方模型目录首次加载的注入错误不再出现；DSH 官方账号状态模块出现过独立的 account read failed 日志，控件仍可加载与选择。未将该账号模块问题计作已修复。官方插件管理器显示 0.2.0、已启用且组件运行中。响应式测试覆盖已清除。

## 交付与范围

源码、构建产物、素材出处和截图随交付包提供。运行日志、登录信息、profile 数据与开发依赖均排除。素材离线嵌入；日常显示不请求图片网站。

未发送模型请求、未修改模型凭据。Electron Desktop、其他 DSH 版本与真实长对话未实测。停用、卸载、热重载和 Blob URL 释放由自动化生命周期测试覆盖。

0.1.0 还验证过 macOS 隔离预览进程启动、退出清理及大型背景图片的 Blob URL 回归。

## 截图

- [默认随机成员舞台](screenshots/member-stage-dark.jpg)
- [推理强度浮层](screenshots/reasoning-popover.jpg)
- [窄窗口](screenshots/member-stage-narrow.jpg)
- [浅色主题](screenshots/nocturne-light.jpg)（0.1.0）
- [主题设置面板](screenshots/theme-settings.jpg)（0.1.0）
