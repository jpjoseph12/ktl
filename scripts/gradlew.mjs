/* Runs the Android Gradle wrapper from npm scripts on any OS
   (gradlew.bat on Windows, ./gradlew elsewhere). */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const androidDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'android');
const isWindows = process.platform === 'win32';
/* A .bat can only be run through a shell on Windows, and cmd won't always
   search the working folder — so give it the full path, quoted for the
   space in the project folder's name. */
const wrapper = isWindows ? `"${path.join(androidDir, 'gradlew.bat')}"` : './gradlew';
const result = spawnSync(wrapper, process.argv.slice(2), {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWindows
});
process.exit(result.status ?? 1);
