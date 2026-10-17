# 素材与设计出处

本插件主题明确为 **BanG Dream! Roselia**。这是个人制作的非官方界面主题，与 BanG Dream! 官方无隶属或背书关系。

## 官方素材

下载日期：2026-10-17。文件保持原始下载字节，界面中的裁切和淡化由 CSS 完成。

| 使用内容 | 来源 |
| --- | --- |
| Roselia 乐队标志、五位成员舞台立绘 | [BanG Dream! 少女乐团派对：Roselia 角色页](https://bang-dream.bushimo.jp/character/roselia/) |
| 五人演出主视觉、PNG 乐队标志 | [Roselia 乐队故事第 3 章专题](https://bang-dream.bushimo.jp/bs3/roselia/) |
| 乐队身份核对 | [BanG Dream! 官方 Roselia 艺人页](https://bang-dream.com/artist/roselia/) |

成员包括湊友希那（主唱）、冰川纱夜（吉他）、今井莉莎（贝斯）、宇田川亚子（鼓）、白金燐子（键盘）。界面使用她们的官方角色立绘，不以生成角色代替。

每个文件的下载 URL、来源页、尺寸、SHA-256 与权利说明记录在 [assets/official/sources.json](assets/official/sources.json)。其中 SVG 标志和 Sprechchor 活动标志保留作设计参考，当前界面没有使用。

官方图片、角色与商标权利归原权利人所有；素材可在官网浏览不等于获得开放许可。包的 `UNLICENSED` 不会为这些素材另行授权，仓库作为非官方爱好者主题提供，不代表获得官方素材的再授权或官方背书。

## 原创界面与生成背景

- `assets/roselia-nocturne.png`：使用 Codex 内置 imagegen 生成的无人物背景，构图为月光哥特舞台与蓝玫瑰，给工作区保留大面积安静留白。它不是官方 BanG Dream! 美术。
- 完整提示词、工具与生成记录：[assets/generated.json](assets/generated.json)。
- `src/client/brand.tsx` 中的线描玫瑰小图标是本插件的代码绘制图形；Roselia 文字标志使用官方图片。
- 配色、布局、主题面板与 CSS 装饰为本插件实现。

图片嵌入本地构建产物，日常显示不依赖这些网站可用性。
