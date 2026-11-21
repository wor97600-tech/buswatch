# 开发说明

构建、配置与调试相关的内容。功能与目录说明见 [README](../README.md)。

## 环境

- Node.js 18+
- BlueOS Studio（编译与真机调试）

## 构建

```powershell
npm run build          # 方屏 + 圆屏，debug + release
npm run build:square   # 只构建方屏
npm run build:round    # 只构建圆屏
npm run build:release  # 只构建 release 包
```

脚本按 `scripts/build.js` 中的 `TARGETS` 依次切换 `manifest.json` 的 `deviceTypeList` / `config.designWidth` 与 `style.css` 的样式入口，构建完成后自动还原。产物位于 `dist/packages/`。

### 包体积

默认构建会关闭 QuickJS 快照（`--enable-snapshot false`），避免为每个页面额外打包一份预编译字节码。多页面 release 包约 100 KB；开启快照会增加到约 240 KB，页面代码和功能不变，代价是首次加载多一次脚本解析、启动略慢。

如果更在意启动速度而不是安装包大小，可以重新打开快照：

```powershell
npm run build:snapshot
```

### 新增屏幕形态

在 `TARGETS` 中增加一项（`deviceType`、`designWidth`、`style`），并在 `styles/` 下添加对应样式文件即可。

### 打包器路径

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
