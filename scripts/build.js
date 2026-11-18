const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const manifestPath = path.join(root, 'src/manifest.json')
const styleEntryPath = path.join(root, 'src/common/style.css')

const TARGETS = [
  {
    id: 'square',
    label: '方屏',
    deviceType: 'watch-square',
    designWidth: 390,
    style: './styles/watch-square.css'
  },
  {
    id: 'round',
    label: '圆屏',
    deviceType: 'watch-round',
    designWidth: 466,
    style: './styles/watch-round.css'
  }
]

function readLocalConfig() {
  const file = path.join(root, '.build.local.json')
  if (!fs.existsSync(file)) {
    return {}
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    console.warn(`[warn] .build.local.json 解析失败，已忽略：${error.message}`)
    return {}
  }
}

function resolvePacker() {
  const local = readLocalConfig()
  const studioSuffix = path.join(
    'resources',
    'app',
    'extensions',
    'blueos-debugger',
    'node_modules',
    'blueos-pack',
    'bin',
    'index.js'
  )
  const studioDirs = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')
  ].filter(Boolean)
  const candidates = [
    process.env.BLUEOS_PACK,
    local.packer,
    path.join(root, 'node_modules/blueos-pack/bin/index.js')
  ]
    .concat(studioDirs.map((dir) => path.join(dir, 'BlueOS Studio', studioSuffix)))
    .filter(Boolean)

  const found = candidates.find((item) => fs.existsSync(item))
  if (!found) {
    throw new Error(
      [
        '找不到 BlueOS 打包器，任选一种方式指定：',
        '  1. 设置环境变量 BLUEOS_PACK，指向 blueos-pack/bin/index.js',
        '  2. 在项目根目录新建 .build.local.json（已被 git 忽略），内容：',
        '     { "packer": "D:/你的路径/BlueOS Studio/resources/app/extensions/blueos-debugger/node_modules/blueos-pack/bin/index.js" }'
      ].join('\n')
    )
  }
  return found
}

function parseArgs(argv) {
  const options = { target: 'all', mode: 'both', out: path.join(root, 'dist/packages') }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--target') {
      options.target = argv[i + 1]
      i += 1
    } else if (arg === '--mode') {
      options.mode = argv[i + 1]
      i += 1
    } else if (arg === '--out') {
      options.out = path.resolve(root, argv[i + 1])
      i += 1
    }
  }
  return options
}

function selectTargets(options) {
  if (options.target === 'all') {
    return TARGETS
  }
  const target = TARGETS.find((item) => item.id === options.target)
  if (!target) {
    throw new Error(`未知目标 ${options.target}，可选值：${TARGETS.map((item) => item.id).join(' / ')} / all`)
  }
  return [target]
}

function selectModes(options) {
  if (options.mode === 'both') {
    return [
      { id: 'debug', command: 'build', extra: ['--debug'] },
      { id: 'release', command: 'release', extra: [] }
    ]
  }
  if (options.mode === 'debug') {
    return [{ id: 'debug', command: 'build', extra: ['--debug'] }]
  }
  if (options.mode === 'release') {
    return [{ id: 'release', command: 'release', extra: [] }]
  }
  throw new Error(`未知构建模式 ${options.mode}，可选值：debug / release / both`)
}

function writeStyleEntry(target) {
  fs.writeFileSync(styleEntryPath, `@import "${target.style}";\n`)
}

function writeManifest(baseManifest, target) {
  const next = JSON.parse(JSON.stringify(baseManifest))
  next.deviceTypeList = [target.deviceType]
  next.config = Object.assign({}, next.config, { designWidth: target.designWidth })
  fs.writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`)
}

function newestRpk(dir) {
  if (!fs.existsSync(dir)) {
    return null
  }
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.rpk'))
    .map((name) => path.join(dir, name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
  return files[0] || null
}

function runPacker(packer, target, mode) {
  const args = [packer, mode.command, '--device-type', target.deviceType, '--force'].concat(mode.extra)
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`${target.label} ${mode.id} 构建失败（退出码 ${result.status}）`)
  }
  const dir = path.join(root, 'dist', target.deviceType, mode.id)
  const rpk = newestRpk(dir)
  if (!rpk) {
    throw new Error(`${target.label} ${mode.id} 构建完成但未找到 rpk：${dir}`)
  }
  return rpk
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const targets = selectTargets(options)
  const modes = selectModes(options)
  const packer = resolvePacker()

  const originalManifestText = fs.readFileSync(manifestPath, 'utf8')
  const originalStyleText = fs.readFileSync(styleEntryPath, 'utf8')
  const baseManifest = JSON.parse(originalManifestText)
  const version = baseManifest.versionName || '0.0.0'
  const packages = []

  let restored = false
  function restore() {
    if (restored) {
      return
    }
    restored = true
    try {
      fs.writeFileSync(manifestPath, originalManifestText)
      fs.writeFileSync(styleEntryPath, originalStyleText)
    } catch (error) {
      console.error(`[warn] 还原 manifest.json / style.css 失败：${error.message}`)
    }
  }

  function onSignal(signal) {
    restore()
    console.error(`\n[中断] 收到 ${signal}，已还原 manifest.json 与 style.css`)
    process.exit(130)
  }

  process.on('SIGINT', () => onSignal('SIGINT'))
  process.on('SIGTERM', () => onSignal('SIGTERM'))
  process.on('SIGHUP', () => onSignal('SIGHUP'))

  try {
    for (const target of targets) {
      writeStyleEntry(target)
      writeManifest(baseManifest, target)
      console.log(`\n=== ${target.label} ${target.deviceType} designWidth=${target.designWidth} ===`)
      for (const mode of modes) {
        const rpk = runPacker(packer, target, mode)
        const outName = `buswatch-${target.id}-${version}-${mode.id}.rpk`
        const outPath = path.join(options.out, outName)
        fs.mkdirSync(options.out, { recursive: true })
        fs.copyFileSync(rpk, outPath)
        packages.push({ name: outName, path: outPath })
        console.log(`[ok] ${target.label} ${mode.id}: ${outPath}`)
      }
    }
  } finally {
    restore()
  }

  console.log('\n构建完成：')
  packages.forEach((item) => console.log(`  ${item.path}`))
}

try {
  main()
} catch (error) {
  console.error(`\n[error] ${error.message}`)
  process.exit(1)
}
