// Build-only adapter: keep Expo's canonicalized paths on the same subst drive
// as the Gradle project. The application never imports this file.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const physicalRoot = process.env.QINGZHANG_PHYSICAL_ROOT;
const buildRoot = process.env.QINGZHANG_BUILD_ROOT;
if (!physicalRoot || !buildRoot) {
  throw new Error('Local Android build path variables are missing');
}
const result = spawnSync(
  process.execPath,
  ['--no-warnings', '--eval', "require('expo/bin/autolinking')", ...process.argv.slice(1)],
  { cwd: process.cwd(), env: process.env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

function remap(value) {
  if (typeof value === 'string' && path.win32.isAbsolute(value)) {
    const relative = path.win32.relative(physicalRoot, value);
    if (!path.win32.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..\\')) {
      // CMake embeds these JSON paths in quoted strings; a trailing backslash
      // would escape the closing quote. Forward slashes also work on Windows.
      return path.win32.join(buildRoot, relative).replace(/\\/g, '/');
    }
  }
  if (Array.isArray(value)) return value.map(remap);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remap(child)]));
  }
  return value;
}

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(remap(JSON.parse(result.stdout))));
} else {
  process.stdout.write(result.stdout);
}
