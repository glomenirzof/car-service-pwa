import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

/**
 * True when the module is the script node was started with. Comparing
 * `file://${argv[1]}` by hand breaks on Windows (C:\ paths), so both sides
 * go through pathToFileURL.
 */
export function isMain(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync(entry)).href || moduleUrl === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}
