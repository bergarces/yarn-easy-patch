#!/usr/bin/env node

import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";

/**
 * Runs a shell command and returns stdout as a string
 * Automatically displays errors and exits on failure
 *
 * @param {string} command - The command to run
 * @param {string[]} args - Arguments for the command
 * @returns {Promise<string>} Promise that resolves with stdout or exits process on error
 */
async function runCommand(command, args = []) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["inherit", "pipe", "pipe"],
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    }

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        console.error(`\n❌ Command failed:`);
        if (stdout) {
          console.error(stdout);
        }
        if (stderr) {
          console.error(stderr);
        }
        process.exit(1);
      }
    });

    child.on("error", (err) => {
      console.error(`\n❌ Command failed: ${err.message}`);
      process.exit(1);
    });
  });
}

/**
 * Strips version specifier from package name
 * @param {string} packageName
 * @returns {string}
 */
function stripVersion(packageName) {
  // For scoped packages (@scope/package@version), find the second @
  if (packageName.startsWith("@")) {
    const firstSlash = packageName.indexOf("/");
    if (firstSlash === -1) {
      return packageName;
    }
    const afterScope = packageName.substring(firstSlash);
    const versionAt = afterScope.indexOf("@");
    if (versionAt === -1) {
      return packageName;
    }
    return packageName.substring(0, firstSlash + versionAt);
  }
  // For non-scoped packages (package@version), find the first @
  const atIndex = packageName.indexOf("@");
  return atIndex === -1 ? packageName : packageName.substring(0, atIndex);
}

// Main execution
const packageName = process.argv[2];

if (!packageName) {
  console.log(`
Usage: yarn-easy-patch <package-name>

This script automates creating Yarn patches by:
  1. Running 'yarn patch' to create a temp folder
  2. Copying your modified files from node_modules to the temp folder
  3. Running 'yarn patch-commit' to create the patch

Example:
  yarn dlx yarn-easy-patch react-native

  # Or if installed globally:
  yarn-easy-patch react-native
`);
  process.exit(0);
}

console.log(`📦 Creating patch for: ${packageName}`);

// Step 1: Run yarn patch and capture the output
console.log(`\n1️⃣  Running yarn patch ${packageName}...`);
const patchResult = await runCommand("yarn", ["patch", packageName]);

// Parse the output to get the temp folder and patch-commit command
const folderMatch = patchResult.match(
  /You can now edit the following folder: (.+)/u
);
const commandMatch = patchResult.match(
  /Once you are done run (yarn patch-commit -s .+) and Yarn will/u
);

if (!folderMatch || !commandMatch) {
  console.error(
    `\n❌ Could not parse yarn patch output. Output was:\n${patchResult}`
  );
  process.exit(1);
}

const tempFolder = folderMatch[1].trim();
const patchCommitCommand = commandMatch[1].trim();

console.log(`✅ Temporary folder created: ${tempFolder}`);

// Step 2: Get the source folder from node_modules
// Strip version specifier (handles both @version and @npm:version formats)
const cleanPackageName = stripVersion(packageName);
const nodeModulesPath = path.join(
  process.cwd(),
  "node_modules",
  cleanPackageName
);

// Check if the package exists in node_modules
try {
  await fs.access(nodeModulesPath);
} catch {
  console.error(
    `\n❌ Package ${cleanPackageName} not found in node_modules at ${nodeModulesPath}`
  );
  process.exit(1);
}

console.log(`\n2️⃣  Copying changes from node_modules to temp folder...`);
console.log(`   Source: ${nodeModulesPath}`);
console.log(`   Target: ${tempFolder}`);

// Step 3: Copy the modified files from node_modules to the temp folder
// Exclude nested node_modules to avoid copying other packages' files
await runCommand("rsync", [
  "-av",
  "--delete",
  "--exclude",
  "node_modules",
  `${nodeModulesPath}/`,
  `${tempFolder}/`,
]);
console.log(`✅ Changes copied successfully`);

// Step 4: Run the patch-commit command
console.log(`\n3️⃣  Running patch-commit command...`);
console.log(`   Command: ${patchCommitCommand}`);

// Parse and run the patch-commit command
const commitParts = patchCommitCommand.split(" ");
const [cmd, ...cmdArgs] = commitParts;
await runCommand(cmd, cmdArgs);

console.log(`\n✅ Patch created successfully for ${packageName}!`);
console.log(`📝 The patch file should now be in your .yarn/patches/ directory`);
