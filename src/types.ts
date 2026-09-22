export type CompressionLevel = 'none' | 'safe' | 'aggressive';
export type ObfuscationLevel = 'none' | 'safe' | 'aggressive';
export type JavaScriptTarget = 'modern' | 'es5';

export interface MinifyOptions {
  level?: CompressionLevel;
  html?: CompressionLevel;
  js?: CompressionLevel;
  css?: CompressionLevel;
  exclude?: string[];
}

export interface ObfuscateOptions {
  level?: ObfuscationLevel;
  exclude?: string[];
  reservedNames?: string[];
}

export interface TranspileOptions {
  target?: JavaScriptTarget;
  exclude?: string[];
}

export interface SsbConfig {
  root?: string;
  entries?: string[];
  outDir?: string;
  include?: string[];
  exclude?: string[];
  transformExclude?: string[];
  minify?: CompressionLevel | MinifyOptions;
  obfuscate?: ObfuscationLevel | ObfuscateOptions;
  transpile?: TranspileOptions;
}

export interface BuildOptions extends SsbConfig {
  cwd?: string;
  configFile?: string | false;
  dryRun?: boolean;
}

export interface LoadConfigOptions {
  cwd?: string;
  root?: string;
  configFile?: string | false;
  overrides?: SsbConfig;
}

export interface ResolvedMinifyOptions {
  level: CompressionLevel;
  html: CompressionLevel;
  js: CompressionLevel;
  css: CompressionLevel;
  exclude: string[];
}

export interface ResolvedObfuscateOptions {
  level: ObfuscationLevel;
  exclude: string[];
  reservedNames: string[];
}

export interface ResolvedTranspileOptions {
  target: JavaScriptTarget;
  exclude: string[];
}

export interface ResolvedConfig {
  cwd: string;
  root: string;
  entries: string[];
  outDir: string;
  include: string[];
  exclude: string[];
  transformExclude: string[];
  minify: ResolvedMinifyOptions;
  obfuscate: ResolvedObfuscateOptions;
  transpile: ResolvedTranspileOptions;
  configFile?: string;
}

export interface BuildFileCounts {
  copied: number;
  html: number;
  js: number;
  css: number;
  obfuscated: number;
  transpiled: number;
}

export interface BuildResult {
  dryRun: boolean;
  sourceDir: string;
  outDir: string;
  entryPaths: string[];
  includedFiles: string[];
  files: BuildFileCounts;
  bytesBefore: number;
  bytesAfter: number;
}
