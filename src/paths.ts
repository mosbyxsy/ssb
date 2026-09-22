import { lstat, opendir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { SsbError, asErrorMessage } from './errors.js';

export interface SourceFile {
  sourcePath: string;
  relativePath: string;
  size: number;
}

export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

export function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function matchesAny(relativePath: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => minimatch(relativePath, pattern, {
    dot: true,
    nocase: process.platform === 'win32',
  }));
}

function isExcluded(relativePath: string, patterns: readonly string[], directory: boolean): boolean {
  if (matchesAny(relativePath, patterns)) return true;
  return directory && matchesAny(`${relativePath}/`, patterns);
}

async function collectDirectory(
  physicalDirectory: string,
  logicalDirectory: string,
  sourceRealPath: string,
  excludes: readonly string[],
  ancestors: ReadonlySet<string>,
  output: SourceFile[],
): Promise<void> {
  let directory;
  try {
    directory = await opendir(physicalDirectory);
  } catch (error) {
    throw new SsbError(`无法读取目录 ${physicalDirectory}: ${asErrorMessage(error)}`, { cause: error });
  }

  const entries = [];
  for await (const entry of directory) entries.push(entry);
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const physicalPath = path.join(physicalDirectory, entry.name);
    const logicalPath = logicalDirectory ? path.join(logicalDirectory, entry.name) : entry.name;
    const relativePath = toPosixPath(logicalPath);
    const info = await lstat(physicalPath);

    if (info.isSymbolicLink()) {
      const target = await realpath(physicalPath);
      if (target !== sourceRealPath && !isPathInside(sourceRealPath, target)) {
        throw new SsbError(`符号链接指向源码目录之外: ${physicalPath} -> ${target}`);
      }
      const targetInfo = await stat(target);
      if (isExcluded(relativePath, excludes, targetInfo.isDirectory())) continue;
      if (targetInfo.isDirectory()) {
        if (ancestors.has(target)) throw new SsbError(`检测到循环符号链接: ${physicalPath}`);
        const next = new Set(ancestors);
        next.add(target);
        await collectDirectory(target, logicalPath, sourceRealPath, excludes, next, output);
      } else if (targetInfo.isFile()) {
        output.push({ sourcePath: target, relativePath, size: targetInfo.size });
      }
      continue;
    }

    if (info.isDirectory()) {
      if (isExcluded(relativePath, excludes, true)) continue;
      const target = await realpath(physicalPath);
      if (ancestors.has(target)) throw new SsbError(`检测到循环目录: ${physicalPath}`);
      const next = new Set(ancestors);
      next.add(target);
      await collectDirectory(physicalPath, logicalPath, sourceRealPath, excludes, next, output);
    } else if (info.isFile() && !isExcluded(relativePath, excludes, false)) {
      output.push({ sourcePath: physicalPath, relativePath, size: info.size });
    }
  }
}

export async function collectSourceFiles(sourceDirectory: string, excludes: readonly string[]): Promise<SourceFile[]> {
  let sourceRealPath: string;
  try {
    sourceRealPath = await realpath(sourceDirectory);
  } catch (error) {
    throw new SsbError(`源码根目录不存在或不可读: ${sourceDirectory}`, { cause: error });
  }
  const output: SourceFile[] = [];
  await collectDirectory(sourceRealPath, '', sourceRealPath, excludes, new Set([sourceRealPath]), output);
  return output;
}
