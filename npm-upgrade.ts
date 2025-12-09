import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

function upgradePackagesInDirs(startDir: string): void {
	const packageJsonDirs = findPackageJsonDirs(startDir)

	for (const dir of packageJsonDirs) {
		console.log(`=== Upgrading packages in ${dir}`)
		try {
			execSync('npm upgrade', { cwd: dir, stdio: 'inherit' })
			execSync('npm ls', { cwd: dir, stdio: 'inherit' })
		} catch (error) {
			console.error(`=== Failed to upgrade packages in ${dir}.`, error)
		}
	}
}

function findPackageJsonDirs(dir: string, dirList: string[] = []): string[] {
	// Check if package.json exists in the current directory
	if (fs.existsSync(path.join(dir, 'package-lock.json'))) {
		dirList.push(dir)
	}

	// Read the contents of the directory
	const items = fs.readdirSync(dir)

	for (const item of items) {
		if (item === 'node_modules' || item.includes('cdk.out')) continue

		const itemPath = path.join(dir, item)
		const stat = fs.statSync(itemPath)

		// If it's a directory, recurse into it
		if (stat.isDirectory()) {
			findPackageJsonDirs(itemPath, dirList)
		}
	}

	return dirList
}

// Usage example
const startDir = new URL('.', import.meta.url).pathname
console.log({ startDir })
// const packageJsonDirs = findPackageJsonDirs(startDir)
// console.log(packageJsonDirs)
upgradePackagesInDirs(startDir)
console.log('done.')
