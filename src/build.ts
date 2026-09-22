import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config.js';
import { collectRequiredSourceFiles } from './dependencies.js';
import { SsbError, asErrorMessage } from './errors.js';
import { collectSourceFiles, isPathInside, toPosixPath } from './paths.js';
import { processTextFile } from './processors.js';
import type { BuildOptions, BuildResult } from './types.js';

const TEXT_EXTENSIONS = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.css']);

function excludeNestedDirectory(root: string, directory: string, excludes: readonly string[]): string[] {
  const next = [...excludes];
  if (!isPathInside(path.resolve(root), path.resolve(directory))) return next;
  const relative = toPosixPath(path.relative(root, directory));
  next.push(relative, `${relative}/**`);
  return next;
}

function validateOutputPath(root: string, outDir: string): void {
  if (root === outDir || isPathInside(outDir, root)) {
    throw new SsbError(`输出目录不能等于源码根目录或包含源码根目录: ${outDir}`);
  }
}

function normalizeEntry(entry: string, root: string): string {
  if (entry.trim() === '') throw new SsbError('HTML 入口不能是空字符串。');
  if (path.isAbsolute(entry)) {
    if (/[*?\[\]{}()]/.test(entry)) throw new SsbError(`绝对入口不支持 glob: ${entry}`);
    const relative = path.relative(root, entry);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new SsbError(`HTML 入口必须位于源码根目录内: ${entry}`);
    }
    return toPosixPath(relative);
  }
  const normalized = entry.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized === '..' || normalized.startsWith('../')) throw new SsbError(`HTML 入口越过源码根目录: ${entry}`);
  return normalized;
}

async function replaceDirectory(stageDir: string, outDir: string, backupDir: string): Promise<void> {
  let backedUp = false;
  let promoted = false;
  try {
    try {
      await rename(outDir, backupDir);
      backedUp = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await rename(stageDir, outDir);
    promoted = true;
  } catch (error) {
    if (backedUp && !promoted) {
      try {
        await rename(backupDir, outDir);
      } catch (restoreError) {
        throw new SsbError(`替换输出失败且无法恢复旧输出，备份位于 ${backupDir}: ${asErrorMessage(restoreError)}`, {
          cause: error,
        });
      }
    }
    throw new SsbError(`替换输出目录失败: ${asErrorMessage(error)}`, { cause: error });
  }
  if (backedUp) {
    try {
      await rm(backupDir, { recursive: true, force: true });
    } catch (error) {
      throw new SsbError(`新输出已生成，但无法清理旧输出备份 ${backupDir}: ${asErrorMessage(error)}`, { cause: error });
    }
  }
}

export async function build(options: BuildOptions = {}): Promise<BuildResult> {
  const { cwd, configFile, dryRun = false, ...overrides } = options;
  const config = await loadConfig({
    ...(cwd === undefined ? {} : { cwd }),
    ...(configFile === undefined ? {} : { configFile }),
    overrides,
  });
  const root = path.resolve(config.root);
  const outDir = path.resolve(config.outDir);
  validateOutputPath(root, outDir);
  const excludes = excludeNestedDirectory(root, outDir, config.exclude);
  const inventory = await collectSourceFiles(root, excludes);

  let entries = config.entries.map((entry) => normalizeEntry(entry, root));
  if (entries.length === 0) {
    entries = inventory
      .map((file) => file.relativePath)
      .filter((relativePath) => !relativePath.includes('/') && /\.html?$/i.test(relativePath));
    if (entries.length === 0) {
      throw new SsbError(`在 ${root} 根目录下未找到 HTML 文件，请通过位置参数、--entry 或配置 entries 指定入口。`);
    }
  }

  const collected = await collectRequiredSourceFiles({ inventory, entries, include: config.include });
  let stageDir: string | undefined;
  let backupDir: string | undefined;
  if (!dryRun) {
    const parentDir = path.dirname(outDir);
    const outName = path.basename(outDir);
    const token = randomUUID();
    stageDir = path.join(parentDir, `.${outName}.ssb-tmp-${token}`);
    backupDir = path.join(parentDir, `.${outName}.ssb-backup-${token}`);
    await mkdir(parentDir, { recursive: true });
    await mkdir(stageDir);
  }

  const counts = { copied: 0, html: 0, js: 0, css: 0, obfuscated: 0, transpiled: 0 };
  let bytesBefore = 0;
  let bytesAfter = 0;
  try {
    for (const file of collected.files) {
      const destination = stageDir === undefined ? undefined : path.join(stageDir, ...file.relativePath.split('/'));
      if (destination !== undefined) await mkdir(path.dirname(destination), { recursive: true });
      bytesBefore += file.size;
      const extension = path.posix.extname(file.relativePath).toLowerCase();
      if (!TEXT_EXTENSIONS.has(extension)) {
        if (destination !== undefined) await copyFile(file.sourcePath, destination);
        bytesAfter += file.size;
        counts.copied += 1;
        continue;
      }
      try {
        const source = await readFile(file.sourcePath, 'utf8');
        const processed = await processTextFile(source, file.relativePath, config);
        if (processed.kind === 'copied') {
          if (destination !== undefined) await copyFile(file.sourcePath, destination);
          bytesAfter += file.size;
          counts.copied += 1;
        } else {
          if (destination !== undefined) await writeFile(destination, processed.content, 'utf8');
          bytesAfter += Buffer.byteLength(processed.content);
          counts[processed.kind] += 1;
        }
        if (processed.obfuscated) counts.obfuscated += 1;
        if (processed.transpiled) counts.transpiled += 1;
      } catch (error) {
        throw new SsbError(`处理 ${file.relativePath} 失败: ${asErrorMessage(error)}`, { cause: error });
      }
    }
    if (stageDir !== undefined && backupDir !== undefined) await replaceDirectory(stageDir, outDir, backupDir);
  } catch (error) {
    if (stageDir !== undefined) await rm(stageDir, { recursive: true, force: true });
    throw error;
  }

  return {
    dryRun,
    sourceDir: root,
    outDir,
    entryPaths: collected.entryPaths,
    includedFiles: collected.files.map((file) => file.relativePath),
    files: counts,
    bytesBefore,
    bytesAfter,
  };
}
