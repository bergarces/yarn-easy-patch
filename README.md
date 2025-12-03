# yarn-easy-patch

A simpler alternative to the cumbersome `yarn patch` workflow.

## The Problem

The standard Yarn patch workflow is tedious:
1. Run `yarn patch <package>` to get a temp folder
2. Manually edit files in that temp folder
3. Run `yarn patch-commit` to create the patch

But often, you've **already made changes** directly in `node_modules` while debugging. Now you need to recreate those changes in the temp folder? 😩

## The Solution

`yarn-easy-patch` automates this by:
1. Running `yarn patch` to create the temp folder
2. **Automatically copying** your changes from `node_modules` to the temp folder
3. Running `yarn patch-commit` to create the patch

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

## Requirements

- Node.js >= 16
- Yarn Berry (Yarn 2+)
- `rsync` (pre-installed on macOS/Linux)

## How It Works

1. Runs `yarn patch <package>` which creates a temporary folder
2. Uses `rsync` to copy your modified files from `node_modules/<package>/` to the temp folder
3. Runs the `yarn patch-commit` command to generate the `.patch` file

## License

MIT
