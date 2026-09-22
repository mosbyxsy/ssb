# ssb

`@mosbydev/ssb` 是一个面向传统静态站点的依赖感知打包工具。它从一个或多个 HTML 入口出发，递归收集本地 HTML、JavaScript、CSS、图片、字体、Web App Manifest 等资源，按原相对路径输出到 `dist`，并可分别控制 HTML、JavaScript 和 CSS 的压缩程度。

ssb 不会把 JavaScript 合并成单文件 bundle，也不会解析 `node_modules` 裸模块。它适合无需框架编译、但希望只发布实际依赖文件的静态站点。

## 目录

- [特性](#特性)
- [安装](#安装)
- [快速开始](#快速开始)
- [压缩与混淆](#压缩与混淆)
- [JavaScript 输出目标](#javascript-输出目标)
- [文件收集规则](#文件收集规则)
- [CLI](#cli)
- [配置文件](#配置文件)
- [Node.js API](#nodejs-api)
- [默认安全规则与限制](#默认安全规则与限制)
- [License](#license)

## 特性

- 自动发现当前源码根目录直属的所有 `.html`、`.htm` 入口，也支持多个显式入口和 glob。
- 递归分析 HTML、内联 CSS/JS、CSS `url()`/`@import`、ES modules、Worker、`fetch()`、import map 和 Web App Manifest。
- `none`、`safe`、`aggressive` 三级压缩，支持 HTML/JS/CSS 分别覆盖。
- JavaScript 压缩与标识符混淆彼此独立，避免深度压缩意外改写公共名称。
- 可将现代 JavaScript 语法转译为 ES5，同时保留原有模块和文件结构。
- `include` 补充动态拼接资源，`exclude` 排除文件，`no-transform` 只复制不转换。
- 保持所有文件相对 root 的原位置，无需改写 HTML、CSS 或 JavaScript 中的 URL。
- 在临时目录完成构建后原子替换输出；失败时保留旧的 `dist`。
- TypeScript、JavaScript、JSON 配置文件和可编程 Node.js API。

## 安装

项目依赖：

```bash
npm install --save-dev @mosbydev/ssb
```

直接运行：

```bash
npx ssb
```

也可以全局安装：

```bash
npm install --global @mosbydev/ssb
ssb
```

要求 Node.js 20 或更高版本。

## 快速开始

在静态站点根目录执行：

```bash
ssb
```

ssb 会把根目录直属的所有 HTML 作为入口，递归收集依赖，并以 `safe` 等级输出到 `./dist`。

指定单个或多个入口：

```bash
ssb index.html
ssb index.html about.html admin/index.html
ssb "pages/*.html"
```

位置参数也可以和 `--entry` 组合：

```bash
ssb index.html --entry "pages/*.html"
```

只要命令行提供了任何入口，命令行入口集合就会整体覆盖配置文件中的 `entries`。

## 压缩与混淆

需要把压缩和混淆设置为相同等级时，可以使用聚合参数：

```bash
ssb --optimize aggressive
```

它等价于 `--minify aggressive --obfuscate aggressive`。裸 `--optimize` 使用 `safe`，`--no-optimize` 同时把两者设置为 `none`。聚合参数先应用，具体参数随后覆盖，结果与参数书写顺序无关：

```bash
ssb --optimize aggressive --obfuscate safe --no-minify-css
```

上例最终为 HTML/JS 压缩 `aggressive`、CSS 压缩 `none`、JS 混淆 `safe`。注意 `--optimize safe` 会开启安全混淆，而项目默认配置仍然是“安全压缩、关闭混淆”。

压缩等级为 `none`、`safe`、`aggressive`：

```bash
ssb --minify safe
ssb --minify aggressive
ssb --no-minify
```

正向选项可以省略等级，省略时表示 `safe`：

```bash
ssb --minify
ssb --minify-html
ssb --minify-js
ssb --minify-css
```

即使选项紧邻入口，入口也不会被当成等级：

```bash
ssb --minify-html index.html
```

分别覆盖资源类型：

```bash
ssb --minify safe --minify-html none --minify-js aggressive
```

全局等级先应用，分类型等级随后覆盖，与参数书写顺序无关。上例最终使用 HTML `none`、JavaScript `aggressive`、CSS `safe`。

各等级的含义：

| 等级 | HTML | JavaScript | CSS |
| --- | --- | --- | --- |
| `none` | 原样复制 | 原样复制 | 原样复制 |
| `safe` | 保守折叠空白、删除普通注释 | 紧凑输出、删除普通注释，不优化表达式或改名 | clean-css level 1 |
| `aggressive` | 额外精简安全的冗余属性 | 多轮压缩、常量折叠和死代码删除，但不改标识符名称 | clean-css level 1+2 |

混淆只作用于 JavaScript，并且默认关闭：

```bash
ssb --obfuscate
ssb --obfuscate none
ssb --obfuscate safe
ssb --obfuscate aggressive
ssb --no-obfuscate
```

- `safe` 只改写局部标识符，保留顶层、函数、类和属性名称。
- `aggressive` 允许改写顶层标识符，但仍不改对象属性名称。
- 混淆不是加密，不能保护密钥或敏感业务数据。

保留指定名称：

```bash
ssb --obfuscate aggressive \
  --keep-name publicApi \
  --keep-name handleClick
```

推荐的生产构建：

```bash
ssb --minify aggressive --obfuscate safe
```

## JavaScript 输出目标

默认保持现代 JavaScript 语法：

```bash
ssb --target modern
```

使用 Babel 将独立 JavaScript 文件和 HTML 内的普通脚本降级为 ES5 语法：

```bash
ssb --target es5
```

转译与压缩、混淆相互独立。以下命令仍会执行 ES5 转译，只是不压缩：

```bash
ssb --target es5 --no-minify
```

处理顺序固定为：

```text
原始依赖分析 → 语法转译 → 压缩 → 混淆 → 写入 dist
```

`target: 'es5'` 只降低语法，不提供 polyfill，也不把 ES modules 合并成 bundle：

- `import`、`export`、dynamic import 和 `import.meta` 会保留。
- `Promise`、`fetch`、`Map`、`Set` 等运行时 API 不会自动补充。
- `onclick` 等 HTML 事件属性最多只做文本压缩，不执行混淆或 ES5 转译，避免改变其特殊作用域和顶层 `return` 语义。
- 因此包含 ESM 的产物并不代表可以直接在 IE11 中运行。

## 文件收集规则

ssb 从入口和 `include` 匹配项开始，只输出递归依赖闭包中的文件。

支持的静态引用包括：

- HTML 资源标签的 `src`、`href`、`data`、`poster` 和 `srcset`。
- 指向 `.html`、`.htm` 的页面链接、`<base href>`、内联脚本、内联样式和 `style` 属性。
- import map 中的本地映射目标。
- CSS `url()` 和 `@import`。
- JavaScript 静态 import/export、字符串动态 import、`fetch()`、`importScripts()`、Worker/SharedWorker 和 `new URL(..., import.meta.url)`。
- Web App Manifest 中的图标、截图和快捷方式图标。

HTTP(S)、协议相对 URL、`data:`、`blob:`、`mailto:`、`tel:`、`javascript:`、hash 和裸模块名不会作为本地文件处理。引用中的 query 和 fragment 不参与磁盘路径匹配。

运行时拼接的文件名无法静态分析，需要显式包含：

```bash
ssb --include "images/products/**" --include "data/generated-*.json"
```

被 include 的 HTML、CSS 和 JavaScript 仍会继续分析其依赖。每个 include 表达式必须至少匹配一个文件，避免拼写错误悄悄生成残缺产物。

完全排除文件：

```bash
ssb --exclude "tests/**" --exclude "**/*.map"
```

包含文件但保持原内容：

```bash
ssb --no-transform "vendor/**"
```

如果 vendor 文件本身无法从入口发现，需要组合使用：

```bash
ssb --include "vendor/**" --no-transform "vendor/**"
```

`exclude` 的选择优先级最高。如果入口或已发现的必需依赖不存在、被排除或越过 root，构建会失败，并报告来源文件、引用类型和目标路径。

## CLI

```text
Usage: ssb [options] [entries...]

递归收集、压缩并输出静态站点资源

Arguments:
  entries                         HTML 入口文件或 glob，可指定多个

通用选项：
  -v, --version                   显示版本号
  -h, --help                      显示帮助信息
  --defaults                      以 JSON 显示内置默认配置并退出
  --show-config                   以 JSON 显示合并后的最终配置并退出

输入选项：
  -r, --root <dir>                源码根目录（默认：当前目录）
  -e, --entry <file-or-glob>      添加 HTML 入口，可重复使用
  -c, --config <file>             指定 ssb.config.* 文件
  --no-config                     禁用配置文件自动发现和加载（默认：启用）

输出选项：
  -o, --out-dir <dir>             输出目录（默认：<root>/dist）

代码处理选项：
  --optimize [level]              同时设置压缩和混淆等级（省略：safe）
  --no-optimize                   同时禁用压缩和混淆，等价于 --optimize=none
  --minify [level]                设置全部压缩等级（省略：safe）
  --no-minify                     禁用全部压缩，等价于 --minify=none
  --minify-html [level]           设置 HTML 压缩等级（省略：safe）
  --no-minify-html                禁用 HTML 压缩
  --minify-js [level]             设置 JavaScript 压缩等级（省略：safe）
  --no-minify-js                  禁用 JavaScript 压缩
  --minify-css [level]            设置 CSS 压缩等级（省略：safe）
  --no-minify-css                 禁用 CSS 压缩
  --obfuscate [level]             设置 JS 混淆等级（省略：safe；默认：none）
  --no-obfuscate                  禁用 JavaScript 混淆，等价于 --obfuscate=none
  --target <target>               JavaScript 输出目标：modern 或 es5（默认：modern）
  --keep-name <name>              混淆时保留标识符名称，可重复使用

资源选择选项：
  --exclude <glob>                从站点包中完全排除文件，可重复使用（默认：无）
  --include <glob>                强制加入静态分析无法发现的资源，可重复使用（默认：无）
  --no-transform <glob>           打包文件但保持内容不变，可重复使用（默认：无）

报告选项：
  --dry-run                       完整预演构建但不写入文件（默认：关闭）
  --list-files                    输出最终打包文件列表（默认：关闭）
  --quiet                         成功时不输出任何内容（默认：关闭）
  --json                          以 JSON 输出构建结果（默认：可读文本）
```

`--dry-run` 会执行完整的依赖分析和文本转换验证，但不会创建、替换或清理输出目录：

```bash
ssb --dry-run --list-files
```

在 CI 中输出机器可读结果：

```bash
ssb --json
```

`--quiet` 只隐藏成功信息，不隐藏错误。`--quiet` 与 `--json`、`--list-files` 冲突；`--json` 已包含完整文件数组，因此也不能和 `--list-files` 同时使用。

## 配置文件

ssb 在 root 当前层自动发现唯一的以下文件：

```text
ssb.config.ts  ssb.config.mts  ssb.config.cts
ssb.config.js  ssb.config.mjs  ssb.config.cjs
ssb.config.json
```

推荐使用 TypeScript 配置：

```ts
import { defineConfig } from '@mosbydev/ssb';

export default defineConfig({
  root: '.',
  entries: ['index.html', 'pages/*.html'],
  outDir: './dist',

  include: ['images/products/**'],
  exclude: ['tests/**', '**/*.map'],
  transformExclude: ['vendor/**'],

  minify: {
    level: 'safe',
    html: 'none',
    js: 'aggressive',
    css: 'safe',
    exclude: ['vendor/**'],
  },

  obfuscate: {
    level: 'safe',
    reservedNames: ['publicApi', 'handleClick'],
    exclude: ['vendor/**'],
  },

  transpile: {
    target: 'modern', // 可改为 es5
    exclude: [],
  },
});
```

转译也可以使用字符串简写：

```ts
defineConfig({ transpile: 'modern' }); // 保持现代语法，默认值
defineConfig({ transpile: 'es5' });    // 使用 Babel 降级语法
```

混淆也可以使用字符串简写：

```ts
defineConfig({ obfuscate: 'none' });       // 关闭，默认值
defineConfig({ obfuscate: 'safe' });       // 只改局部标识符
defineConfig({ obfuscate: 'aggressive' }); // 允许改顶层标识符
```

详细对象省略 `level` 时只合并 `exclude` 和 `reservedNames`，不会改变已有混淆等级。因此 CLI 的 `--keep-name` 可以追加名称而不会意外开启混淆。

配置优先级：

```text
内置默认值 < 配置文件 < CLI 参数或 build() 参数
```

- 配置文件中的 `root`、`outDir` 相对配置文件目录解析；CLI 路径相对当前工作目录解析。
- `entries` 采用高优先级整体替换；其余规则数组跨层累加并去重，包括 `include`、`exclude`、`transformExclude` 以及三个处理器各自的 `exclude`。
- `minify` 先应用全局 `level`，再应用 `html`、`js`、`css` 分项值。
- `obfuscate.level` 使用 `none`、`safe`、`aggressive`，默认是 `none`，不再使用单独的 `enabled` 开关。
- `obfuscate.reservedNames` 和 `--keep-name` 累加并去重。
- `transpile.target` 默认为 `modern`；设为 `es5` 时启用 Babel，`transpile.exclude` 只跳过转译。`transpile.enabled` 不受支持。
- `transformExclude` 与 `--no-transform` 会同时追加到压缩、混淆和转译的排除列表。
- 所有资源 glob 相对 root，并统一使用 `/` 分隔符。

查看内置默认值：

```bash
ssb --defaults
```

查看配置文件与 CLI 合并后的最终配置，但不扫描入口或执行构建：

```bash
ssb --show-config --minify-js aggressive
```

## Node.js API

```ts
import { build, defineConfig, loadConfig } from '@mosbydev/ssb';

const config = defineConfig({
  root: './public',
  entries: ['index.html'],
  minify: { level: 'safe', js: 'aggressive' },
  transpile: { target: 'es5', exclude: ['vendor/**'] },
});

const resolved = await loadConfig({ overrides: config });
const result = await build({
  ...config,
  dryRun: false,
});

console.log(result.includedFiles);
```

公共导出包括 `build`、`defineConfig`、`loadConfig`、`SsbError`、配置文件名和默认排除规则，以及对应的 TypeScript 类型。

## 默认安全规则与限制

- 默认排除版本库目录、`node_modules`、配置文件、日志、系统垃圾文件和构建临时目录。
- 输出目录位于 root 内时会自动排除，避免把上一次构建递归复制进新产物。
- 输出目录不能等于 root，也不能包含 root。
- root 内部的符号链接可以使用；逃逸 root 或形成循环的链接会导致构建失败。
- 未识别的文件类型按二进制逐字节复制。
- 不提供 JavaScript bundle、TypeScript 编译、polyfill、source map 生成或裸模块解析。

## License

MIT
