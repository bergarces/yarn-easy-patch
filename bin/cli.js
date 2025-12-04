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
 * @param {Object} options - Additional options
 * @param {boolean} options.exitOnError - Whether to exit on error (default: true)
 * @returns {Promise<{stdout: string, stderr: string, code: number}>} Promise that resolves with result
 */
async function runCommand(
  command,
  args = [],
  { exitOnError = true, cwd, timeout = 30000 } = {}
) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Set up timeout
    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);

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
      clearTimeout(timeoutId);

      if (timedOut) {
        if (exitOnError) {
          console.error(
            `\n❌ Command timed out after ${timeout}ms: ${command}`
          );
          process.exit(1);
        } else {
          resolve({ stdout, stderr, code: 124, timedOut: true });
        }
        return;
      }

      if (code === 0 || !exitOnError) {
        resolve({ stdout, stderr, code });
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
      clearTimeout(timeoutId);
      if (exitOnError) {
        console.error(`\n❌ Command failed: ${err.message}`);
        process.exit(1);
      } else {
        resolve({ stdout, stderr, code: 1 });
      }
    });
  });
}

/**
 * Finds existing patches for a package in the patches directory
 * @param {string} packageName - The package name (can include version)
 * @param {string} patchesDir - The directory to search for patches
 * @returns {Promise<string[]>} Array of matching patch file paths
 */
async function findExistingPatches(packageName, patchesDir) {
  try {
    await fs.access(patchesDir);
  } catch {
    return [];
  }

  const files = await fs.readdir(patchesDir);

  // Normalize package name for matching yarn's patch file naming convention
  // Yarn keeps @ but replaces / with -
  // e.g., @metamask/assets-controllers -> @metamask-assets-controllers
  //       react-native -> react-native
  // Note: packageName is already version-stripped when passed to this function
  const normalizedName = packageName.replace(/\//g, "-");

  const matchingPatches = files.filter((file) => {
    if (!file.endsWith(".patch")) return false;
    // Patch files are named like: package-name-npm-1.2.3-hash.patch
    // or for scoped: @scope-package-npm-1.2.3-hash.patch
    return file.startsWith(normalizedName + "-");
  });

  return matchingPatches.map((file) => path.join(patchesDir, file));
}

/**
 * Attempts to apply a patch to a directory
 * @param {string} patchPath - Path to the patch file
 * @param {string} targetDir - Directory to apply patch to
 * @returns {Promise<{success: boolean, output: string, canApply: boolean}>}
 */
async function tryApplyPatch(patchPath, targetDir) {
  // Use absolute path for the patch file since we'll be changing cwd
  const absolutePatchPath = path.resolve(patchPath);

  // Try with patch command first (more reliable for standalone patches)
  // Flags:
  //   --dry-run: check if it can be applied without making changes
  //   --no-backup-if-mismatch: don't create .orig backup files
  //   -p1: strip first path component (a/ or b/)
  //   -N/--forward: ignore already applied patches
  //   -t/--batch: non-interactive mode (don't prompt for input)
  //   -i: input file
  const dryRunResult = await runCommand(
    "patch",
    [
      "--dry-run",
      "--no-backup-if-mismatch",
      "--forward",
      "--batch",
      "-p1",
      "-i",
      absolutePatchPath,
    ],
    { exitOnError: false, cwd: targetDir, timeout: 5000 }
  );

  if (dryRunResult.code === 0) {
    // Patch can be applied cleanly, now actually apply it
    const applyResult = await runCommand(
      "patch",
      [
        "--no-backup-if-mismatch",
        "--forward",
        "--batch",
        "-p1",
        "-i",
        absolutePatchPath,
      ],
      { exitOnError: false, cwd: targetDir, timeout: 10000 }
    );
    return {
      success: applyResult.code === 0,
      output: applyResult.stdout || applyResult.stderr,
      canApply: true,
    };
  }

  // Try with git apply as fallback (with --3way disabled to avoid prompts)
  const gitCheckResult = await runCommand(
    "git",
    ["apply", "--check", "--ignore-whitespace", absolutePatchPath],
    { exitOnError: false, cwd: targetDir, timeout: 5000 }
  );

  if (gitCheckResult.code === 0) {
    // Patch can be applied cleanly, now actually apply it
    const applyResult = await runCommand(
      "git",
      ["apply", "--ignore-whitespace", absolutePatchPath],
      { exitOnError: false, cwd: targetDir, timeout: 10000 }
    );
    return {
      success: applyResult.code === 0,
      output: applyResult.stdout || applyResult.stderr,
      canApply: true,
    };
  }

  return {
    success: false,
    output:
      dryRunResult.stderr ||
      dryRunResult.stdout ||
      gitCheckResult.stderr ||
      gitCheckResult.stdout,
    canApply: false,
  };
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
const args = process.argv.slice(2);

// Handle --version flag
if (args.includes("--version") || args.includes("-v")) {
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json", { with: { type: "json" } });
  console.log(pkg.version);
  process.exit(0);
}

// Parse --patches-dir option
const patchesDirIndex = args.findIndex(
  (arg) => arg === "--patches-dir" || arg.startsWith("--patches-dir=")
);
let patchesDir = path.join(process.cwd(), ".yarn", "patches");

// Track which argument indices are used by options (to exclude from package name detection)
const optionValueIndices = new Set();

if (patchesDirIndex !== -1) {
  const arg = args[patchesDirIndex];
  if (arg.includes("=")) {
    patchesDir = arg.split("=")[1];
  } else if (args[patchesDirIndex + 1]) {
    patchesDir = args[patchesDirIndex + 1];
    optionValueIndices.add(patchesDirIndex + 1);
  }
}

// Find package name (first non-flag argument that isn't an option value)
const packageName = args.find(
  (arg, index) => !arg.startsWith("-") && !optionValueIndices.has(index)
);

// Handle --help flag or no arguments
if (!packageName || args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage: yarn-easy-patch <package-name> [options]

This script automates creating Yarn patches by:
  1. Checking for existing patches and applying them to node_modules
  2. Running 'yarn patch' to create a temp folder
  3. Copying your modified files from node_modules to the temp folder
  4. Running 'yarn patch-commit' to create the patch

Options:
  -h, --help              Show this help message
  -v, --version           Show version number
  --patches-dir <path>    Directory to look for existing patches
                          (default: .yarn/patches)

Examples:
  yarn dlx yarn-easy-patch react-native
  yarn dlx yarn-easy-patch @babel/core

  # With custom patches directory:
  yarn dlx yarn-easy-patch react-native --patches-dir ./patches

  # Or if installed globally:
  yarn-easy-patch react-native
`);
  process.exit(0);
}

console.log(`📦 Creating patch for: ${packageName}`);

// Step 0: Check for existing patches and try to apply them
const cleanPackageName = stripVersion(packageName);
const nodeModulesPath = path.join(
  process.cwd(),
  "node_modules",
  cleanPackageName
);

// Check if the package exists in node_modules first
try {
  await fs.access(nodeModulesPath);
} catch {
  console.error(
    `\n❌ Package ${cleanPackageName} not found in node_modules at ${nodeModulesPath}`
  );
  process.exit(1);
}

console.log(`\n🔍 Checking for existing patches in ${patchesDir}...`);
const existingPatches = await findExistingPatches(cleanPackageName, patchesDir);

if (existingPatches.length > 0) {
  console.log(`   Found ${existingPatches.length} existing patch(es):`);
  for (const patchPath of existingPatches) {
    const patchName = path.basename(patchPath);
    console.log(`   - ${patchName}`);
  }

  // Try to apply each patch
  for (const patchPath of existingPatches) {
    const patchName = path.basename(patchPath);
    console.log(`\n   Attempting to apply: ${patchName}`);

    const result = await tryApplyPatch(patchPath, nodeModulesPath);

    if (result.success) {
      console.log(`   ✅ Patch applied successfully!`);
    } else if (result.canApply) {
      console.log(`   ⚠️  Patch application had issues:`);
      if (result.output) {
        console.log(`      ${result.output.trim().replace(/\n/g, "\n      ")}`);
      }
    } else {
      console.log(
        `   ❌ Patch cannot be applied cleanly (may already be applied or conflicts exist)`
      );
      if (result.output) {
        console.log(`      ${result.output.trim().replace(/\n/g, "\n      ")}`);
      }
      console.log(`   ℹ️  Continuing without applying this patch...`);
    }
  }
} else {
  console.log(`   No existing patches found.`);
}

// Step 1: Run yarn patch and capture the output
console.log(`\n1️⃣  Running yarn patch ${packageName}...`);
const { stdout: patchOutput } = await runCommand("yarn", [
  "patch",
  packageName,
]);

// Parse the output to get the temp folder and patch-commit command
const folderMatch = patchOutput.match(
  /You can now edit the following folder: (.+)/u
);
const commandMatch = patchOutput.match(
  /Once you are done run (yarn patch-commit -s .+) and Yarn will/u
);

if (!folderMatch || !commandMatch) {
  console.error(
    `\n❌ Could not parse yarn patch output. Output was:\n${patchOutput}`
  );
  process.exit(1);
}

const tempFolder = folderMatch[1].trim();
const patchCommitCommand = commandMatch[1].trim();

console.log(`✅ Temporary folder created: ${tempFolder}`);

console.log(`\n2️⃣  Copying changes from node_modules to temp folder...`);
console.log(`   Source: ${nodeModulesPath}`);
console.log(`   Target: ${tempFolder}`);

// Step 3: Copy the modified files from node_modules to the temp folder
// Exclude nested node_modules to avoid copying other packages' files
await runCommand("rsync", [
  "-a",
  "--delete",
  "--exclude",
  "node_modules",
  "--exclude",
  "*.orig",
  "--exclude",
  "*.rej",
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

// Step 5: Clean up old patch files if a new one was created
if (existingPatches.length > 0) {
  // Find all current patches in the directory
  const currentPatches = await findExistingPatches(
    cleanPackageName,
    patchesDir
  );
  const oldPatchNames = new Set(existingPatches.map((p) => path.basename(p)));

  // Find patches that are NEW (exist now but weren't there before)
  const newlyCreatedPatches = currentPatches.filter(
    (p) => !oldPatchNames.has(path.basename(p))
  );

  if (newlyCreatedPatches.length > 0) {
    console.log(
      `\n🔍 New patch created: ${newlyCreatedPatches
        .map((p) => path.basename(p))
        .join(", ")}`
    );

    // Delete all the old patches since we have a new one
    for (const oldPatchPath of existingPatches) {
      const oldPatchName = path.basename(oldPatchPath);
      try {
        await fs.unlink(oldPatchPath);
        console.log(`🗑️  Removed old patch: ${oldPatchName}`);
      } catch (err) {
        console.warn(
          `⚠️  Could not remove old patch ${oldPatchName}: ${err.message}`
        );
      }
    }
  }
}

console.log(`📝 The patch file should now be in your .yarn/patches/ directory`);
