# 验证记录

验证日期：2026-10-17。插件：Roselia 主题，`dsh-display-roselia@0.2.1`。

## 官方接入

- DSH `0.2.1-rc.2`，只读参考提交 `687f282e86`；macOS、Node.js `24.22.0`、真实 Web Client / Chromium。
- 通过官方 `dsh plugin --profile web add <本地插件目录>` 建立的链接安装加载，profile 与 bundle 由官方 CLI 管理。
- 安装和服务启动受 macOS Seatbelt 保护，禁止写入官方源码目录；本轮只构建独立插件。
- 主题使用 `theme.overrideTokens` 和品牌插槽。模型入口通过 `conversation.input.model` 的 `priority: -100` 覆盖，读取和提交仍使用官方 `modelDirectories`；不重复声明原生入口的 children，停用后恢复原生入口。

## 自动检查

`npm run typecheck` 与 `npm test` 均通过，**55 / 55** 项测试覆盖主题生命周期、偏好与随机成员、单入口覆盖与卸载恢复、无推理模型、provider 分组、目标模型默认档位、失败与过期手势、锁定状态、无搜索列表的键盘导航、Tab 焦点循环、Escape 和外部关闭。

拖动回归确认粒子数量随预览从 4 颗增至 16 颗，拖动过程中不提交，释放时只提交一次；官方状态变化会同步更新视觉。冷启动验证 `modelDirectories`、`sessions`、`remote`、`remote.session` 声明完整。

构建校验单个 DSH factory、激活前不操作 DOM、输入均位于插件目录及 runtime external 白名单。CSS source map 不包含开发机器的绝对路径。

## 页面验收

- 输入框底部只有「模型名 + 推理强度」入口，关闭时没有滑条；点击直接显示 256 × 98px 浮层，轨道 24px、滑块 28px，无闪电图标。
- 点击浮层模型名进入无搜索框的列表；显示真实 provider、模型名和选中勾号。鼠标切换及 Home / End / Enter 操作正常，选择可调模型后回到滑条。
- 实际切换过 DeepSeek-V4-Pro 与 DeepSeek-V4.1-Flash；连续键盘调整会更新共享选择，焦点可继续操作。最终恢复验收开始时的 DeepSeek-V4-Pro / Max。
- Low 显示冷蓝渐变、8 颗粒子、约 5.67 秒流动周期；Max 显示紫色渐变、16 颗粒子、3 秒周期和更强辉光。粒子数量按当前模型的相对档位计算，不改变适配器公布的档位。
- 桌面和 390 × 844 窄屏均检查，无横向溢出，浮层保持在视口内；测试后已移除视口覆盖。
- 断电后以原官方源码 CLI、原 web profile 恢复 3080 服务，链接插件继续生效。主题设置标题为「Roselia 主题」。

此前已检查明暗主题、四种场景、固定及随机成员、偏好保持、主题面板焦点返回。官方账号模块曾出现独立的 account read failed 日志，未计作本插件修复内容。

## 范围

未发送模型请求或修改模型凭据；Electron Desktop、其他 DSH 版本和真实长对话未实测。模型目录重试使用官方公开 load 接口，其缓存与 provider 局部失败刷新仍服从官方生命周期。

运行日志、登录信息、profile 数据与开发依赖不打包、不提交。素材随客户端离线提供。

## 截图

- [高档位推理浮层](screenshots/reasoning-popover.jpg)
- [低档位推理浮层](screenshots/reasoning-low.jpg)
- [无搜索模型列表](screenshots/model-picker.jpg)
- [窄窗口](screenshots/member-stage-narrow.jpg)
- [随机成员舞台](screenshots/member-stage-dark.jpg)
