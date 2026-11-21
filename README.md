<div align="center">

<img src="src/assets/images/icon.png" width="96" alt="腕上公交">

# 腕上公交

[![Release](https://img.shields.io/github/v/release/wor97600-tech/buswatch)](https://github.com/wor97600-tech/buswatch/releases)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

蓝河 OS（BlueOS）手表公交到站应用 · 方屏 / 圆屏

</div>

腕上公交是装在手表上的公交到站应用。抬手腕就能看到关注的线路还有几站到，不用掏手机。

数据来自车来了，需要联网：手表通过手机连接或 eSIM 上网。断网时显示上次缓存的静态信息，不会编造到站时间。

## 功能

- **城市切换**：车来了城市列表，应用内直接切换
- **搜索**：站点、线路、地点关键词搜索
- **关注**：可关注单条线路，也可关注整个站点
- **到站卡片**：线路、方向、实时到站、首末班、更新时间
- **线路详情**：全线站点顺序、当前站高亮、「当前第 N 站 / 共 M 站」
- **返回操作**：右滑返回上一页，或点击左上角返回按钮
- **离线可用**：静态信息本地缓存，接口不可用时展示缓存数据
- **数据持久化**：关注列表与已保存站点保存在本地

## 安装

从 [Releases](https://github.com/wor97600-tech/buswatch/releases) 下载对应屏幕形态的安装包：

| 屏幕 | 安装包 |
| --- | --- |
| 方屏 | `buswatch-square-<version>.rpk` |
| 圆屏 | `buswatch-round-<version>.rpk` |

用 BlueOS Studio 装到手表即可。

## 项目结构

```text
BusWatch/
  build.config.js              构建配置
  scripts/build.js             一次生成方屏和圆屏两个安装包
  src/                         应用本体
    app.ux                     应用从这里启动
    manifest.json              应用信息：名字、版本、权限、屏幕类型
    assets/images/icon.png     图标
    common/                    两个屏型共用的代码
      config.js                城市、接口地址、超时等设置
      net.js                   发网络请求
      chelaile.js              对接车来了的到站数据
      realtime-core.js         算到站时间、首末班、当前站
      store.js                 保存关注的线路和站点
      session.js               页面之间传数据
      page-logic.js            五个页面共用的逻辑
      style.css                样式入口，构建时指向方屏或圆屏
      styles/
        watch-square.css       方屏尺寸样式
        watch-round.css        圆屏尺寸样式
    pages/                     页面
      Home/index.ux            首页：关注列表与到站卡片
      Search/index.ux          搜索站点、线路
      Station/index.ux         站点详情
      Line/index.ux            线路详情
      City/index.ux            城市选择
```

## 已知限制

- 实时到站覆盖城市以车来了接口为准，海口已实测覆盖
- 接口不可用时展示本地缓存，不编造到站时间
- 站名输入依赖手表系统输入法或语音输入

## 开发

构建、配置与模拟器调试见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 许可证

[MIT](LICENSE) © 2026 Hahu
