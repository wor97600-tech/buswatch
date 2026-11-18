<div align="center">

<img src="src/assets/images/icon.png" width="96" alt="腕上公交">

# 腕上公交

[![Release](https://img.shields.io/github/v/release/wor97600-tech/buswatch)](https://github.com/wor97600-tech/buswatch/releases)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

蓝河 OS（BlueOS）手表公交到站应用 · 方屏 / 圆屏

</div>

一款运行在蓝河 OS（BlueOS）手表上的公交到站应用，基于车来了公开接口获取实时到站数据。同时支持方屏与圆屏两种屏幕形态，可通过手机连接或 eSIM 独立联网使用。

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

## 目录结构

```
BusWatch/
  build.config.js
  scripts/
    build.js            双版本构建脚本
  src/
    app.ux
    manifest.json       方屏基准配置，构建时由脚本临时改写
    assets/images/
    common/             方屏 / 圆屏共用
      config.js         城市、接口地址、缓存与网络参数
      net.js            HTTP 请求封装
      chelaile.js       车来了接口适配层
      realtime-core.js  线路 / 到站数据计算
      store.js          关注列表与本地缓存
    pages/Home/
      index.ux          单页应用（首页 / 搜索 / 站点 / 线路 / 城市）
      style.css         样式入口，构建时由脚本指向对应屏型
      styles/
        watch-square.css  方屏尺寸样式
        watch-round.css   圆屏尺寸样式
```

方屏与圆屏共用同一套数据层和页面逻辑，差异仅在样式与 `deviceTypeList` / `designWidth`。

## 构建

```powershell
npm run build          # 方屏 + 圆屏，debug + release
npm run build:square   # 只构建方屏
npm run build:round    # 只构建圆屏
npm run build:release  # 只构建 release 包
```

脚本按 `scripts/build.js` 中的 `TARGETS` 依次切换 `manifest.json` 的 `deviceTypeList` / `config.designWidth` 与 `style.css` 的样式入口，构建完成后自动还原。产物位于 `dist/packages/`。

### 包体积

默认构建会关闭 QuickJS 快照（`--enable-snapshot false`），避免为每个页面额外打包一份预编译字节码。多页面 release 包约 100 KB；如果开启快照会增加到约 240 KB。页面代码和功能逻辑不变，代价是首次加载时多一次脚本解析、启动略慢。

如果更在意启动速度而不是安装包大小，可以重新打开快照：

```powershell
npm run build:snapshot
```

新增屏幕形态时，在 `TARGETS` 中增加一项（`deviceType`、`designWidth`、`style`），并在 `styles/` 下添加对应样式文件即可。

打包器默认从 BlueOS Studio 安装目录查找，也可通过环境变量 `BLUEOS_PACK` 指定；若安装路径不在默认位置，可在项目根目录创建 `.build.local.json`（已被 git 忽略）：

```json
{ "packer": "D:/你的安装路径/resources/app/extensions/blueos-debugger/node_modules/blueos-pack/bin/index.js" }
```

## 在 BlueOS Studio 中运行

1. 用 BlueOS Studio 打开本项目根目录
2. 选择设备类型 `watch-square`（390×450）或 `watch-round`（466×466）
3. 编译预览，模拟器自动加载 `dist/<deviceType>/debug/*.rpk`

命令行编译：

```powershell
node "<BlueOS Studio 安装目录>\resources\app\extensions\blueos-debugger\node_modules\blueos-pack\bin\index.js" build --device-type watch-square --debug
```

## 配置

编辑 `src/common/config.js`：

```js
chelaile: {
  enabled: true,
  host: 'ts-api.tundrey.com',  // 车来了接口地址
  timeout: 9000,
  retry: 1
}
```

城市默认海口（`cityId: '129'`），可在应用内切换。

> 手表端 HTTPS 不可用，数据接口仅支持 HTTP。修改 `host` 前请确认目标域名支持 HTTP。

## 已知限制

- 实时到站覆盖城市以车来了接口为准，海口已实测覆盖
- 接口不可用时展示本地缓存，不编造到站时间
- 站名输入依赖手表系统输入法或语音输入

## 许可证

[MIT](LICENSE)
