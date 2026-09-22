import { createRequire } from 'node:module';
import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { build } from './build.js';
import { loadConfig } from './config.js';
import { SsbError } from './errors.js';
import type {
  BuildOptions,
  BuildResult,
  CompressionLevel,
  JavaScriptTarget,
  MinifyOptions,
  ObfuscateOptions,
  ObfuscationLevel,
  TranspileOptions,
} from './types.js';

interface CliOptions {
  defaults?: boolean;
  showConfig?: boolean;
  root?: string;
  entry?: string[];
  config?: string | false;
  outDir?: string;
  optimize?: CompressionLevel | false;
  minify?: CompressionLevel | false;
  minifyHtml?: CompressionLevel | false;
  minifyJs?: CompressionLevel | false;
  minifyCss?: CompressionLevel | false;
  target?: JavaScriptTarget;
  obfuscate?: ObfuscationLevel | false;
  keepName?: string[];
  include?: string[];
  exclude?: string[];
  transform?: true | string[];
  dryRun?: boolean;
  listFiles?: boolean;
  json?: boolean;
  quiet?: boolean;
}

const packageMetadata = createRequire(import.meta.url)('../package.json') as { version: string };
const COMPRESSION_LEVELS = new Set(['none', 'safe', 'aggressive']);
const OBFUSCATION_LEVELS = new Set(['none', 'safe', 'aggressive']);
const OPTIONAL_LEVEL_FLAGS = new Map([
  ['--optimize', COMPRESSION_LEVELS],
  ['--minify', COMPRESSION_LEVELS],
  ['--minify-html', COMPRESSION_LEVELS],
  ['--minify-js', COMPRESSION_LEVELS],
  ['--minify-css', COMPRESSION_LEVELS],
  ['--obfuscate', OBFUSCATION_LEVELS],
]);

export interface CliDependencies {
  build?: (options?: BuildOptions) => Promise<BuildResult>;
  write?: (text: string) => void;
}

function collectNonEmpty(value: string, previous: unknown): string[] {
  if (value.trim() === '') throw new InvalidArgumentError('不能是空字符串');
  return [...(Array.isArray(previous) ? previous as string[] : []), value];
}

function parseCompressionLevel(value: string): CompressionLevel {
  if (!COMPRESSION_LEVELS.has(value)) throw new InvalidArgumentError("只能是 'none'、'safe' 或 'aggressive'");
  return value as CompressionLevel;
}

function parseObfuscationLevel(value: string): ObfuscationLevel {
  if (!OBFUSCATION_LEVELS.has(value)) throw new InvalidArgumentError("只能是 'none'、'safe' 或 'aggressive'");
  return value as ObfuscationLevel;
}

function parseJavaScriptTarget(value: string): JavaScriptTarget {
  if (value !== 'modern' && value !== 'es5') {
    throw new InvalidArgumentError("只能是 'modern' 或 'es5'");
  }
  return value;
}

/**
 * 只有下一个参数精确匹配合法等级时才交给 Commander 消费；否则裸开关统一补为 safe，
 * 保留下一个参数作为 HTML 入口或 glob。显式等级推荐使用 `--minify=aggressive`。
 */
export function normalizeOptionalLevels(argv: readonly string[]): string[] {
  const normalized = [...argv];
  for (let index = 2; index < normalized.length; index += 1) {
    const argument = normalized[index]!;
    const levels = OPTIONAL_LEVEL_FLAGS.get(argument);
    if (levels === undefined) continue;
    const next = normalized[index + 1];
    if (next !== undefined && levels.has(next)) {
      index += 1;
      continue;
    }
    normalized[index] = `${argument}=safe`;
  }
  return normalized;
}

function hasLongOption(args: readonly string[], name: string): boolean {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

function validateCliArguments(args: readonly string[]): void {
  const conflicts: Array<[string, string]> = [
    ['--optimize', '--no-optimize'],
    ['--minify', '--no-minify'],
    ['--minify-html', '--no-minify-html'],
    ['--minify-js', '--no-minify-js'],
    ['--minify-css', '--no-minify-css'],
    ['--obfuscate', '--no-obfuscate'],
    ['--defaults', '--show-config'],
    ['--quiet', '--json'],
    ['--quiet', '--list-files'],
    ['--json', '--list-files'],
  ];
  for (const [positive, negative] of conflicts) {
    if (hasLongOption(args, positive) && hasLongOption(args, negative)) {
      throw new SsbError(`参数 ${positive} 与 ${negative} 不能同时使用。`);
    }
  }
  const hasConfig = hasLongOption(args, '--config')
    || args.some((arg) => arg === '-c' || (arg.startsWith('-c') && !arg.startsWith('--') && arg.length > 2));
  if (hasConfig && hasLongOption(args, '--no-config')) {
    throw new SsbError('参数 --config 与 --no-config 不能同时使用。');
  }
}

export function createBuildOptions(entries: readonly string[], options: CliOptions, args: readonly string[]): BuildOptions {
  const result: BuildOptions = {};
  if (options.root !== undefined) result.root = options.root;
  const cliEntries = [...entries, ...(options.entry ?? [])];
  if (cliEntries.length > 0) result.entries = cliEntries;
  if (options.config !== undefined) result.configFile = options.config;
  if (options.outDir !== undefined) result.outDir = options.outDir;
  if (options.include !== undefined) result.include = options.include;
  if (options.exclude !== undefined) result.exclude = options.exclude;
  if (Array.isArray(options.transform)) result.transformExclude = options.transform;
  if (options.dryRun) result.dryRun = true;

  const hasOptimize = hasLongOption(args, '--optimize') || hasLongOption(args, '--no-optimize');
  const optimizeLevel: CompressionLevel | undefined = hasOptimize
    ? options.optimize === false
      ? 'none'
      : options.optimize ?? 'safe'
    : undefined;

  const minify: MinifyOptions = {};
  let hasMinify = optimizeLevel !== undefined;
  if (optimizeLevel !== undefined) minify.level = optimizeLevel;
  if (hasLongOption(args, '--minify') || hasLongOption(args, '--no-minify')) {
    minify.level = options.minify === false ? 'none' : options.minify ?? 'safe';
    hasMinify = true;
  }
  const fields: Array<[keyof Pick<MinifyOptions, 'html' | 'js' | 'css'>, CompressionLevel | false | undefined, string, string]> = [
    ['html', options.minifyHtml, '--minify-html', '--no-minify-html'],
    ['js', options.minifyJs, '--minify-js', '--no-minify-js'],
    ['css', options.minifyCss, '--minify-css', '--no-minify-css'],
  ];
  for (const [field, value, positive, negative] of fields) {
    if (hasLongOption(args, positive) || hasLongOption(args, negative)) {
      minify[field] = value === false ? 'none' : value ?? 'safe';
      hasMinify = true;
    }
  }
  if (hasMinify) result.minify = minify;

  if (options.target !== undefined) {
    const transpile: TranspileOptions = { target: options.target };
    result.transpile = transpile;
  }

  const hasObfuscate = hasLongOption(args, '--obfuscate') || hasLongOption(args, '--no-obfuscate');
  if (hasOptimize || hasObfuscate || (options.keepName !== undefined && options.keepName.length > 0)) {
    const obfuscate: ObfuscateOptions = {};
    if (optimizeLevel !== undefined) obfuscate.level = optimizeLevel;
    if (hasObfuscate) {
      obfuscate.level = options.obfuscate === false ? 'none' : options.obfuscate ?? 'safe';
    }
    if (options.keepName !== undefined) obfuscate.reservedNames = options.keepName;
    result.obfuscate = obfuscate;
  }
  return result;
}

async function createDefaultConfigSnapshot(): Promise<Record<string, unknown>> {
  const defaults = await loadConfig({ configFile: false });
  return {
    root: '.', entries: [], outDir: './dist', exclude: defaults.exclude, include: defaults.include,
    transformExclude: defaults.transformExclude, minify: defaults.minify, obfuscate: defaults.obfuscate,
    transpile: defaults.transpile,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export async function runCli(argv: readonly string[], dependencies: CliDependencies = {}): Promise<void> {
  const normalizedArgv = normalizeOptionalLevels(argv);
  const args = normalizedArgv.slice(2);
  const buildSite = dependencies.build ?? build;
  const write = dependencies.write ?? ((text: string) => process.stdout.write(text));
  const program = new Command()
    .name('ssb')
    .description('递归收集、压缩并输出静态站点资源')
    .optionsGroup('通用选项：')
    .version(packageMetadata.version, '-v, --version', '显示版本号')
    .helpOption('-h, --help', '显示帮助信息')
    .option('--defaults', '以 JSON 显示内置默认配置并退出')
    .option('--show-config', '以 JSON 显示合并后的最终配置并退出')
    .argument('[entries...]', 'HTML 入口文件或 glob，可指定多个')
    .optionsGroup('输入选项：')
    .option('-r, --root <dir>', '源码根目录（默认：当前目录）')
    .option('-e, --entry <file-or-glob>', '添加 HTML 入口，可重复使用', collectNonEmpty)
    .option('-c, --config <file>', '指定 ssb.config.* 文件（默认：自动发现）')
    .option('--no-config', '禁用配置文件自动发现和加载（默认：启用）')
    .optionsGroup('输出选项：')
    .option('-o, --out-dir <dir>', '输出目录（默认：<root>/dist）')
    .optionsGroup('代码处理选项：')
    .option('--optimize [level]', '同时设置压缩和混淆等级（省略：safe）', parseCompressionLevel)
    .option('--no-optimize', '同时禁用压缩和混淆，等价于 --optimize=none')
    .option('--minify [level]', '设置全部压缩等级：none、safe、aggressive（省略：safe）', parseCompressionLevel)
    .option('--no-minify', '禁用全部压缩，等价于 --minify=none')
    .option('--minify-html [level]', '设置 HTML 压缩等级（省略：safe）', parseCompressionLevel)
    .option('--no-minify-html', '禁用 HTML 压缩')
    .option('--minify-js [level]', '设置 JavaScript 压缩等级（省略：safe）', parseCompressionLevel)
    .option('--no-minify-js', '禁用 JavaScript 压缩')
    .option('--minify-css [level]', '设置 CSS 压缩等级（省略：safe）', parseCompressionLevel)
    .option('--no-minify-css', '禁用 CSS 压缩')
    .option('--obfuscate [level]', '设置 JS 混淆等级：none、safe、aggressive（省略：safe；默认：none）', parseObfuscationLevel)
    .option('--no-obfuscate', '禁用 JavaScript 混淆，等价于 --obfuscate=none')
    .option('--target <target>', 'JavaScript 输出目标：modern 或 es5（默认：modern）', parseJavaScriptTarget)
    .option('--keep-name <name>', '混淆时保留标识符名称，可重复使用', collectNonEmpty)
    .optionsGroup('资源选择选项：')
    .option('--exclude <glob>', '从站点包中完全排除文件，可重复使用（默认：无）', collectNonEmpty)
    .option('--include <glob>', '强制加入静态分析无法发现的资源，可重复使用（默认：无）', collectNonEmpty)
    .option('--no-transform <glob>', '打包文件但保持内容不变，可重复使用（默认：无）', collectNonEmpty)
    .optionsGroup('报告选项：')
    .option('--dry-run', '完整预演构建但不写入文件（默认：关闭）')
    .option('--list-files', '输出最终打包文件列表（默认：关闭）')
    .option('--quiet', '成功时不输出任何内容（默认：关闭）')
    .option('--json', '以 JSON 输出构建结果（默认：可读文本）')
    .configureOutput({ writeOut: write, writeErr: () => undefined })
    .exitOverride()
    .allowExcessArguments(false);

  program.action(async (entries: string[], rawOptions: CliOptions) => {
    validateCliArguments(args);
    if (rawOptions.defaults) {
      write(`${JSON.stringify(await createDefaultConfigSnapshot(), null, 2)}\n`);
      return;
    }
    const buildOptions = createBuildOptions(entries, rawOptions, args);
    if (rawOptions.showConfig) {
      const { cwd, configFile, dryRun: _dryRun, ...overrides } = buildOptions;
      const resolved = await loadConfig({
        ...(cwd === undefined ? {} : { cwd }),
        ...(configFile === undefined ? {} : { configFile }),
        overrides,
      });
      write(`${JSON.stringify(resolved, null, 2)}\n`);
      return;
    }
    const result = await buildSite(buildOptions);
    if (rawOptions.quiet) return;
    if (rawOptions.json) {
      write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    const ratio = result.bytesBefore === 0 ? 0 : 1 - result.bytesAfter / result.bytesBefore;
    write([
      result.dryRun ? `ssb: 预演完成，未写入 ${result.outDir}` : `ssb: 已输出到 ${result.outDir}`,
      `入口: ${result.entryPaths.length}；文件: ${result.includedFiles.length}；HTML ${result.files.html}；JS ${result.files.js}；CSS ${result.files.css}；混淆 ${result.files.obfuscated}；转译 ${result.files.transpiled}`,
      `体积: ${formatBytes(result.bytesBefore)} -> ${formatBytes(result.bytesAfter)}（减少 ${(ratio * 100).toFixed(1)}%）`,
      ...(rawOptions.listFiles ? ['包含文件：', ...result.includedFiles.map((file) => `  ${file}`)] : []),
    ].join('\n') + '\n');
  });

  try {
    await program.parseAsync(normalizedArgv, { from: 'node' });
  } catch (error) {
    if (error instanceof CommanderError && (error.code === 'commander.helpDisplayed' || error.code === 'commander.version')) return;
    throw error;
  }
}
