// Subprocess driven by preset-base-mutate.test.js: runs mutation scopes under the real signal handler so the test can
// signal it from outside. argv: <basic|race|restore-fail> <dir>. Writes <dir>/ready once the scenario is in its signal window.
import fs from 'node:fs';
import { sha256Hex } from '../../../../get-shit-done/presets/base/scripts/mutate/classify.mjs';
import { installSignalRestore, restoreFile, withActiveMutation } from '../../../../get-shit-done/presets/base/scripts/mutate/restore.mjs';

const [scenario, dir] = process.argv.slice(2);
const ORIGINAL = 'ORIGINAL\n';
const original = Buffer.from(ORIGINAL);
const sha = sha256Hex(original);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const scope = async (label, applyMs, bodyMs) => {
  const file = `${dir}/${label}.txt`;
  fs.writeFileSync(file, ORIGINAL);
  return withActiveMutation({
    path: file,
    original,
    sha,
    backup: `${dir}/${label}.orig`,
    apply: async () => {
      console.log(`apply ${label}`);
      await sleep(applyMs);
      fs.writeFileSync(file, 'MUTATED\n');
      console.log(`applied ${label}`);
    },
    restore: () => restoreFile(file, original, sha),
  }, async () => {
    await sleep(bodyMs);
    return label;
  });
};

installSignalRestore();
const ready = () => fs.writeFileSync(`${dir}/ready`, '1');

if (scenario === 'basic') {
  const held = scope('one', 50, 60000);
  await sleep(300);
  ready();
  await held;
} else if (scenario === 'race') {
  fs.writeFileSync(`${dir}/decoy.orig`, 'backup');
  void scope('decoy', 2500, 5000);
  const one = scope('one', 50, 0);
  ready();
  console.log(`done ${await one}`);
  await sleep(400); // the test signals within ~150 ms of ready; what follows must find the runner stopping
  void scope('two', 0, 0).then(() => console.log('done two'));
  await sleep(30000);
} else {
  fs.writeFileSync(`${dir}/stuck.orig`, 'backup');
  const stuck = scope('stuck', 0, 5000);
  await sleep(200);
  fs.chmodSync(`${dir}/stuck.txt`, 0o444);
  ready();
  await stuck;
}
