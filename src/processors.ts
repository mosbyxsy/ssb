import path from 'node:path';
import { transformAsync as transformWithBabel } from '@babel/core';
import presetEnv from '@babel/preset-env';
import CleanCSS from 'clean-css';
import { minify as minifyHtml } from 'html-minifier-terser';
import { minify as minifyJavaScript } from 'terser';
import { SsbError } from './errors.js';
import { matchesAny } from './paths.js';
import type { CompressionLevel, ResolvedConfig } from './types.js';

export type ProcessedKind = 'copied' | 'html' | 'js' | 'css';

export interface ProcessedText {
  content: string;
  kind: ProcessedKind;
  obfuscated: boolean;
  transpiled: boolean;
}

function levelFor(relativePath: string, level: CompressionLevel, config: ResolvedConfig): CompressionLevel {
  return matchesAny(relativePath, config.minify.exclude) ? 'none' : level;
}

function canObfuscate(relativePath: string, config: ResolvedConfig): boolean {
  return config.obfuscate.level !== 'none' && !matchesAny(relativePath, config.obfuscate.exclude);
}

function canTranspile(relativePath: string, config: ResolvedConfig): boolean {
  return config.transpile.target === 'es5' && !matchesAny(relativePath, config.transpile.exclude);
}

async function transpileJavaScriptToEs5(source: string): Promise<string> {
  const result = await transformWithBabel(source, {
    babelrc: false,
    configFile: false,
    comments: true,
    compact: false,
    sourceMaps: false,
    sourceType: 'unambiguous',
    presets: [[presetEnv, {
      bugfixes: true,
      modules: false,
      targets: { ie: '11' },
      useBuiltIns: false,
    }]],
  });
  if (result?.code === undefined || result.code === null) {
    throw new SsbError('Babel 未生成 JavaScript 输出。');
  }
  return result.code;
}

async function transformJavaScript(
  source: string,
  level: CompressionLevel,
  obfuscate: boolean,
  aggressiveObfuscation: boolean,
  transpile: boolean,
  reservedNames: string[],
  inlineEvent: boolean,
): Promise<string> {
  const input = transpile && !inlineEvent ? await transpileJavaScriptToEs5(source) : source;
  if (level === 'none' && !obfuscate) return input;
  const aggressive = level === 'aggressive';
  const ecma = transpile ? 5 : 2020;
  const result = await minifyJavaScript(input, {
    compress: aggressive ? { passes: 3, unsafe: false } : false,
    ecma,
    mangle: obfuscate && !inlineEvent
      ? {
          eval: false,
          keep_classnames: !aggressiveObfuscation,
          keep_fnames: !aggressiveObfuscation,
          properties: false,
          reserved: reservedNames,
          toplevel: aggressiveObfuscation,
        }
      : false,
    keep_classnames: !aggressiveObfuscation,
    keep_fnames: !aggressiveObfuscation,
    parse: inlineEvent ? { bare_returns: true } : {},
    format: { beautify: false, ecma, comments: /^!/ },
  });
  if (result.code === undefined) throw new SsbError('Terser 未生成 JavaScript 输出。');
  return result.code;
}

function cleanCssOptions(level: CompressionLevel): CleanCSS.OptionsOutput {
  return {
    inline: ['none'],
    level: level === 'aggressive' ? { 1: {}, 2: {} } : 1,
    rebase: false,
  };
}

function transformCss(source: string, level: CompressionLevel): string {
  if (level === 'none') return source;
  const result = new CleanCSS(cleanCssOptions(level)).minify(source);
  if (result.errors.length > 0) throw new SsbError(`CSS 压缩失败: ${result.errors.join('; ')}`);
  return result.styles;
}

async function transformHtml(source: string, relativePath: string, config: ResolvedConfig): Promise<string> {
  const htmlLevel = levelFor(relativePath, config.minify.html, config);
  const jsLevel = levelFor(relativePath, config.minify.js, config);
  const cssLevel = levelFor(relativePath, config.minify.css, config);
  const obfuscate = canObfuscate(relativePath, config);
  const transpile = canTranspile(relativePath, config);
  const aggressiveHtml = htmlLevel === 'aggressive';
  if (htmlLevel === 'none' && jsLevel === 'none' && cssLevel === 'none' && !obfuscate && !transpile) return source;

  return minifyHtml(source, {
    collapseWhitespace: htmlLevel !== 'none',
    conservativeCollapse: !aggressiveHtml,
    continueOnParseError: false,
    keepClosingSlash: true,
    minifyCSS: cssLevel === 'none' ? false : cleanCssOptions(cssLevel),
    minifyJS: jsLevel === 'none' && !obfuscate && !transpile
      ? false
      : async (text: string, inline: boolean) => transformJavaScript(
          text,
          jsLevel,
          obfuscate && !inline,
          config.obfuscate.level === 'aggressive' && !inline,
          transpile,
          config.obfuscate.reservedNames,
          inline,
        ),
    preserveLineBreaks: false,
    preventAttributesEscaping: false,
    processConditionalComments: false,
    removeAttributeQuotes: aggressiveHtml,
    removeComments: htmlLevel !== 'none',
    removeEmptyAttributes: false,
    removeOptionalTags: false,
    removeRedundantAttributes: aggressiveHtml,
    removeScriptTypeAttributes: aggressiveHtml,
    removeStyleLinkTypeAttributes: aggressiveHtml,
    sortAttributes: false,
    sortClassName: false,
    useShortDoctype: aggressiveHtml,
  });
}

export async function processTextFile(source: string, relativePath: string, config: ResolvedConfig): Promise<ProcessedText> {
  const extension = path.posix.extname(relativePath).toLowerCase();
  const obfuscate = canObfuscate(relativePath, config);
  if (extension === '.html' || extension === '.htm') {
    const transpile = canTranspile(relativePath, config);
    const active = levelFor(relativePath, config.minify.html, config) !== 'none'
      || levelFor(relativePath, config.minify.js, config) !== 'none'
      || levelFor(relativePath, config.minify.css, config) !== 'none'
      || obfuscate
      || transpile;
    return {
      content: await transformHtml(source, relativePath, config),
      kind: active ? 'html' : 'copied',
      obfuscated: obfuscate,
      transpiled: transpile,
    };
  }
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    const level = levelFor(relativePath, config.minify.js, config);
    const transpile = canTranspile(relativePath, config);
    return {
      content: await transformJavaScript(
        source,
        level,
        obfuscate,
        config.obfuscate.level === 'aggressive',
        transpile,
        config.obfuscate.reservedNames,
        false,
      ),
      kind: level !== 'none' || obfuscate || transpile ? 'js' : 'copied',
      obfuscated: obfuscate,
      transpiled: transpile,
    };
  }
  if (extension === '.css') {
    const level = levelFor(relativePath, config.minify.css, config);
    return {
      content: transformCss(source, level),
      kind: level === 'none' ? 'copied' : 'css',
      obfuscated: false,
      transpiled: false,
    };
  }
  return { content: source, kind: 'copied', obfuscated: false, transpiled: false };
}
