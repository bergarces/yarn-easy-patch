# yarn-easy-patch

A simpler alternative to the cumbersome `yarn patch` workflow.

## The Problem

The standard Yarn patch workflow is an unusable aberration:
1. Run `yarn patch <package>` to get a temp folder
2. Manually edit files in that temp folder
3. Run `yarn patch-commit` to create the patch

But often, you've **already made changes** directly in `node_modules` while debugging. Now you need to recreate those changes in the temp folder? 😩

## The Solution

`yarn-easy-patch` automates this by:
1. **Detecting existing patches** and applying them to `node_modules` first
2. Running `yarn patch` to create the temp folder
3. **Automatically copying** your changes from `node_modules` to the temp folder
4. Running `yarn patch-commit` to create the patch
5. **Cleaning up old patch files** if a new one was created

Just make your changes in `node_modules`, then run one command!

## Installation

### Run directly (no install needed)

```bash
yarn dlx yarn-easy-patch <package-name>
```

### Install globally

```bash
npm install -g yarn-easy-patch
```

Then run:

```bash
yarn-easy-patch <package-name>
```

## Usage

```bash
# Make your changes directly in node_modules
vim node_modules/some-package/lib/index.js

# Create the patch
yarn dlx yarn-easy-patch some-package
```

The patch file will be created in your `.yarn/patches/` directory and your `package.json` will be updated with the patch resolution.

### Incremental Patching

If you already have a patch for a package and want to add more changes, `yarn-easy-patch` will:

1. **Detect the existing patch** in `.yarn/patches/`
2. **Apply it to `node_modules`** before you make additional changes
3. **Create a new combined patch** with both old and new changes
4. **Remove the old patch file** automatically

This lets you incrementally build on existing patches without losing previous work.

### Options

```bash
yarn-easy-patch <package-name> [options]

Options:
  -h, --help              Show help message
  -v, --version           Show version number
  --patches-dir <path>    Directory to look for existing patches
                          (default: .yarn/patches)
```

### Examples

```bash
# Basic usage
yarn dlx yarn-easy-patch react-native

# Scoped packages
yarn dlx yarn-easy-patch @babel/core

# Custom patches directory
yarn dlx yarn-easy-patch some-package --patches-dir ./my-patches
```

## Requirements

- Node.js >= 16
- Yarn Berry (Yarn 2+)
- `rsync` (pre-installed on macOS/Linux)

## How It Works

1. Checks for existing patches in `.yarn/patches/` and attempts to apply them to `node_modules`
2. Runs `yarn patch <package>` which creates a temporary folder
3. Uses `rsync` to copy your modified files from `node_modules/<package>/` to the temp folder
4. Runs the `yarn patch-commit` command to generate the `.patch` file
5. Removes old patch files if a new one with a different hash was created

## License

MIT
