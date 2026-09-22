import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createJiti } from 'jiti';
import { SsbError, asErrorMessage } from './errors.js';
import type {
  CompressionLevel,
  JavaScriptTarget,
  LoadConfigOptions,
  MinifyOptions,
  ObfuscateOptions,
  ObfuscationLevel,
  ResolvedConfig,
  ResolvedMinifyOptions,
  ResolvedObfuscateOptions,
  ResolvedTranspileOptions,
  SsbConfig,
  TranspileOptions,
} from './types.js';

export const CONFIG_FILE_NAMES = [
  'ssb.config.ts',
  'ssb.config.mts',
  'ssb.config.cts',
  'ssb.config.js',
  'ssb.config.mjs',
  'ssb.config.cjs',
  'ssb.config.json',
] as const;

export const DEFAULT_EXCLUDES = [
  '.git', '.git/**', '.hg', '.hg/**', '.svn', '.svn/**',
  'node_modules', 'node_modules/**',
  ...CONFIG_FILE_NAMES,
  '.DS_Store', '**/.DS_Store', 'Thumbs.db', '**/Thumbs.db',
  '*.log', '**/*.log',
  '.*.ssb-tmp-*', '.*.ssb-tmp-*/**', '.*.ssb-backup-*', '.*.ssb-backup-*/**',
] as const;

export function defineConfig(config: SsbConfig): SsbConfig {
  return config;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function discoverConfig(root: string): Promise<string | undefined> {
  let names: Set<string>;
  try {
    names = new Set(await readdir(root));
  } catch (error) {
    throw new SsbError(`无法读取根目录 ${root}: ${asErrorMessage(error)}`, { cause: error });
  }
  const candidates = CONFIG_FILE_NAMES.filter((name) => names.has(name)).map((name) => path.join(root, name));
  if (candidates.length > 1) {
    throw new SsbError(`发现多个 ssb 配置文件，请使用 --config 明确指定：\n${candidates.map((file) => `  - ${file}`).join('\n')}`);
  }
  return candidates[0];
}

async function readConfigFile(filePath: string): Promise<SsbConfig> {
  let value: unknown;
  try {
    if (path.extname(filePath).toLowerCase() === '.json') {
      value = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    } else {
      const jiti = createJiti(import.meta.url, { moduleCache: false });
      value = await jiti.import(filePath, { default: true });
    }
  } catch (error) {
    throw new SsbError(`加载配置文件 ${filePath} 失败: ${asErrorMessage(error)}`, { cause: error });
  }
  if (!isPlainObject(value)) throw new SsbError(`配置文件 ${filePath} 必须导出一个对象。`);
  return value as SsbConfig;
}

function resolveConfigPaths(config: SsbConfig, baseDir: string): SsbConfig {
  const resolved = { ...config };
  if (config.root !== undefined) resolved.root = path.resolve(baseDir, config.root);
  if (config.outDir !== undefined) resolved.outDir = path.resolve(baseDir, config.outDir);
  return resolved;
}

function stringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new SsbError(`${label} 必须是非空字符串数组。`);
  }
  return [...value];
}

function mergeRules(...layers: string[][]): string[] {
  return [...new Set(layers.flat())];
}

function compressionLevel(value: unknown, label: string): CompressionLevel {
  if (value !== 'none' && value !== 'safe' && value !== 'aggressive') {
    throw new SsbError(`${label} 只能是 'none'、'safe' 或 'aggressive'。`);
  }
  return value;
}

function obfuscationLevel(value: unknown, label: string): ObfuscationLevel {
  if (value !== 'none' && value !== 'safe' && value !== 'aggressive') {
    throw new SsbError(`${label} 只能是 'none'、'safe' 或 'aggressive'。`);
  }
  return value;
}

function javaScriptTarget(value: unknown, label: string): JavaScriptTarget {
  if (value !== 'modern' && value !== 'es5') {
    throw new SsbError(`${label} 只能是 'modern' 或 'es5'。`);
  }
  return value;
}

function applyMinify(current: ResolvedMinifyOptions, input: CompressionLevel | MinifyOptions | undefined): ResolvedMinifyOptions {
  if (input === undefined) return current;
  if (typeof input === 'string') {
    const level = compressionLevel(input, 'minify');
    return { ...current, level, html: level, js: level, css: level };
  }
  if (!isPlainObject(input)) throw new SsbError('minify 必须是压缩等级或对象。');
  if ('enabled' in input) {
    throw new SsbError("minify.enabled 已移除，请使用 minify.level: 'none' | 'safe' | 'aggressive'。");
  }
  let next = { ...current };
  if (input.level !== undefined) {
    const level = compressionLevel(input.level, 'minify.level');
    next = { ...next, level, html: level, js: level, css: level };
  }
  if (input.html !== undefined) next.html = compressionLevel(input.html, 'minify.html');
  if (input.js !== undefined) next.js = compressionLevel(input.js, 'minify.js');
  if (input.css !== undefined) next.css = compressionLevel(input.css, 'minify.css');
  if (input.exclude !== undefined) {
    next.exclude = mergeRules(current.exclude, stringArray(input.exclude, 'minify.exclude'));
  }
  return next;
}

function applyObfuscate(
  current: ResolvedObfuscateOptions,
  input: ObfuscationLevel | ObfuscateOptions | undefined,
): ResolvedObfuscateOptions {
  if (input === undefined) return current;
  if (typeof input === 'string') return { ...current, level: obfuscationLevel(input, 'obfuscate') };
  if (!isPlainObject(input)) throw new SsbError('obfuscate 必须是混淆等级或对象。');
  if ('enabled' in input || 'mode' in input) {
    throw new SsbError("obfuscate.enabled/mode 已移除，请使用 obfuscate.level: 'none' | 'safe' | 'aggressive'。");
  }
  const next = { ...current };
  if (input.level !== undefined) next.level = obfuscationLevel(input.level, 'obfuscate.level');
  if (input.exclude !== undefined) {
    next.exclude = mergeRules(current.exclude, stringArray(input.exclude, 'obfuscate.exclude'));
  }
  if (input.reservedNames !== undefined) {
    next.reservedNames = [...new Set([...current.reservedNames, ...stringArray(input.reservedNames, 'obfuscate.reservedNames')])];
  }
  return next;
}

function applyTranspile(
  current: ResolvedTranspileOptions,
  input: JavaScriptTarget | TranspileOptions | undefined,
): ResolvedTranspileOptions {
  if (input === undefined) return current;
  if (typeof input === 'string') {
    return { ...current, target: javaScriptTarget(input, 'transpile') };
  }
  if (!isPlainObject(input)) throw new SsbError("transpile 必须是 'modern'、'es5' 或对象。");
  if ('enabled' in input) {
    throw new SsbError("transpile.enabled 已移除，请使用 transpile.target: 'modern' | 'es5'。");
  }
  return {
    target: input.target === undefined ? current.target : javaScriptTarget(input.target, 'transpile.target'),
    exclude:
      input.exclude === undefined
        ? current.exclude
        : mergeRules(current.exclude, stringArray(input.exclude, 'transpile.exclude')),
  };
}

function mergeConfig(
  cwd: string,
  discoveryRoot: string,
  fileConfig: SsbConfig,
  overrides: SsbConfig,
  configFile?: string,
): ResolvedConfig {
  const root = overrides.root ?? fileConfig.root ?? discoveryRoot;
  const outDir = overrides.outDir ?? fileConfig.outDir ?? path.join(root, 'dist');
  const entries = overrides.entries === undefined
    ? stringArray(fileConfig.entries, 'entries')
    : stringArray(overrides.entries, 'entries');
  const include = mergeRules(
    stringArray(fileConfig.include, 'include'),
    stringArray(overrides.include, 'include'),
  );
  const exclude = mergeRules(
    [...DEFAULT_EXCLUDES],
    stringArray(fileConfig.exclude, 'exclude'),
    stringArray(overrides.exclude, 'exclude'),
  );
  const transformExclude = mergeRules(
    stringArray(fileConfig.transformExclude, 'transformExclude'),
    stringArray(overrides.transformExclude, 'transformExclude'),
  );

  let minify: ResolvedMinifyOptions = { level: 'safe', html: 'safe', js: 'safe', css: 'safe', exclude: [] };
  minify = applyMinify(minify, fileConfig.minify);
  minify = applyMinify(minify, overrides.minify);

  let obfuscate: ResolvedObfuscateOptions = { level: 'none', exclude: [], reservedNames: [] };
  obfuscate = applyObfuscate(obfuscate, fileConfig.obfuscate);
  obfuscate = applyObfuscate(obfuscate, overrides.obfuscate);

  let transpile: ResolvedTranspileOptions = { target: 'modern', exclude: [] };
  transpile = applyTranspile(transpile, fileConfig.transpile);
  transpile = applyTranspile(transpile, overrides.transpile);

  minify.exclude = mergeRules(minify.exclude, transformExclude);
  obfuscate.exclude = mergeRules(obfuscate.exclude, transformExclude);
  transpile.exclude = mergeRules(transpile.exclude, transformExclude);

  const resolved: ResolvedConfig = {
    cwd, root, entries, outDir, include, exclude, transformExclude, minify, obfuscate, transpile,
  };
  if (configFile !== undefined) resolved.configFile = configFile;
  return resolved;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<ResolvedConfig> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const discoveryRoot = path.resolve(cwd, options.root ?? options.overrides?.root ?? '.');
  let configFile: string | undefined;
  if (options.configFile !== false) {
    configFile = typeof options.configFile === 'string'
      ? path.resolve(cwd, options.configFile)
      : await discoverConfig(discoveryRoot);
  }

  let fileConfig: SsbConfig = {};
  if (configFile !== undefined) {
    if (!(await pathExists(configFile))) throw new SsbError(`配置文件不存在: ${configFile}`);
    fileConfig = resolveConfigPaths(await readConfigFile(configFile), path.dirname(configFile));
  }
  const overrides = resolveConfigPaths(options.overrides ?? {}, cwd);
  if (options.root !== undefined) overrides.root = path.resolve(cwd, options.root);
  return mergeConfig(cwd, discoveryRoot, fileConfig, overrides, configFile);
}
