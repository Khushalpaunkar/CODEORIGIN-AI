const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const https = require('https');
const AdmZip = require('adm-zip');

const MAX_ZIP_BYTES = 100 * 1024 * 1024; // 100 MB
const DOWNLOAD_TIMEOUT_MS = 60 * 1000; // 60s

const GITHUB_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

class GitHubError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.statusCode = statusCode;
    }
}

function parseGitHubUrl(rawUrl) {
    const url = (rawUrl || '').trim();
    if (!url) throw new GitHubError('Please enter a GitHub repository URL.', 400);

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new GitHubError('Invalid URL. Use the format https://github.com/owner/repository', 400);
    }

    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') {
        throw new GitHubError('Only public https://github.com repository URLs are supported.', 400);
    }

    const match = url.match(GITHUB_URL_RE);
    if (!match) {
        throw new GitHubError('Invalid GitHub repository URL. Use the format https://github.com/owner/repository', 400);
    }

    const owner = match[1];
    const name = match[2];
    if (!owner || !name || owner === '.' || name === '.') {
        throw new GitHubError('Invalid GitHub repository URL.', 400);
    }

    return { owner, name, url: `https://github.com/${owner}/${name}` };
}

function httpsGetJson(requestUrl, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const req = https.get(
            requestUrl,
            {
                headers: {
                    'User-Agent': 'CodeOrigin-AI',
                    Accept: 'application/vnd.github+json',
                },
                timeout: timeoutMs,
            },
            (res) => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    body += chunk;
                    if (body.length > 512 * 1024) {
                        req.destroy();
                        reject(new GitHubError('GitHub API response too large.', 502));
                    }
                });
                res.on('end', () => {
                    if (res.statusCode === 404) {
                        return reject(
                            new GitHubError(
                                'Repository not found. It may be private, deleted, or the URL is incorrect.',
                                404
                            )
                        );
                    }
                    if (res.statusCode === 403 || res.statusCode === 429) {
                        return reject(
                            new GitHubError('GitHub API rate limit exceeded. Please try again shortly.', 429)
                        );
                    }
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        return reject(new GitHubError('Unable to reach GitHub. Please try again later.', 502));
                    }
                    try {
                        resolve(JSON.parse(body));
                    } catch {
                        reject(new GitHubError('Unexpected response from GitHub.', 502));
                    }
                });
            }
        );
        req.on('timeout', () => {
            req.destroy();
            reject(new GitHubError('GitHub request timed out.', 504));
        });
        req.on('error', (err) => {
            reject(new GitHubError(`Could not reach GitHub: ${err.message}`, 502));
        });
    });
}

async function fetchRepoMeta(owner, name) {
    try {
        const data = await httpsGetJson(`https://api.github.com/repos/${owner}/${name}`);
        return {
            defaultBranch: data.default_branch || '',
            description: typeof data.description === 'string' ? data.description : '',
            visibility: data.private ? 'private' : data.visibility || 'public',
            lastUpdated: data.pushed_at ? new Date(data.pushed_at) : null,
            exists: true,
        };
    } catch (err) {
        if (err instanceof GitHubError && err.statusCode === 404) throw err;
        // Metadata is nice-to-have; the ZIP download is the source of truth.
        return {
            defaultBranch: '',
            description: '',
            visibility: 'public',
            lastUpdated: null,
            exists: false,
        };
    }
}

function isUnsafeEntryPath(entryPath) {
    if (!entryPath) return true;
    const normalized = path.posix.normalize(entryPath.replace(/\\/g, '/'));
    if (normalized.startsWith('../') || normalized === '..') return true;
    if (normalized.startsWith('/')) return true;
    if (/^[A-Za-z]:/.test(normalized)) return true;
    return false;
}

async function extractZip(zipPath, destDir) {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    if (!entries.length) {
        throw new GitHubError('Downloaded repository archive is empty.', 502);
    }

    const resolvedDest = path.resolve(destDir);

    for (const entry of entries) {
        if (entry.isDirectory) continue;
        const entryName = entry.entryName.replace(/\\/g, '/');
        if (isUnsafeEntryPath(entryName)) continue; // zip-slip protection

        const targetPath = path.resolve(destDir, entryName);
        if (!targetPath.startsWith(resolvedDest + path.sep) && targetPath !== resolvedDest) continue;

        await fsp.mkdir(path.dirname(targetPath), { recursive: true });
        await fsp.writeFile(targetPath, entry.getData());
    }
}

async function downloadAndExtract(owner, name, tempDir) {
    const zipPath = path.join(tempDir, 'repo.zip');
    const extractDir = path.join(tempDir, 'src');
    await fsp.mkdir(extractDir, { recursive: true });

    // codeload redirects between hosts; follow manually via https
    const zipUrl = `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/zip/HEAD`;
    await downloadFileWithRedirects(zipUrl, zipPath);
    await extractZip(zipPath, extractDir);

    // Remove the archive to keep temp footprint small
    try {
        await fsp.unlink(zipPath);
    } catch (_) { /* ignore */ }

    // GitHub wraps everything in a single top-level folder: <repo>-<sha>/
    const entries = await fsp.readdir(extractDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    if (entries.length === 1 && dirs.length === 1) {
        return path.join(extractDir, dirs[0].name);
    }
    return extractDir;
}

function downloadFileWithRedirects(fileUrl, destPath, redirectsLeft = 5) {
    return new Promise((resolve, reject) => {
        const doRequest = (currentUrl, left) => {
            const parsed = new URL(currentUrl);
            const req = https.get(
                currentUrl,
                {
                    headers: { 'User-Agent': 'CodeOrigin-AI' },
                    timeout: DOWNLOAD_TIMEOUT_MS,
                },
                (res) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        res.resume();
                        if (left <= 0) {
                            return reject(new GitHubError('Too many redirects from GitHub.', 502));
                        }
                        const next = new URL(res.headers.location, parsed).toString();
                        return doRequest(next, left - 1);
                    }

                    if (res.statusCode === 404) {
                        res.resume();
                        return reject(
                            new GitHubError(
                                'Repository not found. It may be private, deleted, or the URL is incorrect.',
                                404
                            )
                        );
                    }
                    if (res.statusCode === 403 || res.statusCode === 429) {
                        res.resume();
                        return reject(
                            new GitHubError('GitHub rate limit exceeded. Please try again shortly.', 429)
                        );
                    }
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        res.resume();
                        return reject(new GitHubError('Unable to download repository from GitHub.', 502));
                    }

                    const contentLength = parseInt(res.headers['content-length'] || '0', 10);
                    if (contentLength > MAX_ZIP_BYTES) {
                        res.destroy();
                        return reject(new GitHubError('Repository is too large to analyze (limit: 100 MB).', 413));
                    }

                    const fileStream = fs.createWriteStream(destPath);
                    let received = 0;
                    let failed = false;

                    const failWith = (err) => {
                        if (failed) return;
                        failed = true;
                        fileStream.destroy();
                        try {
                            fs.unlinkSync(destPath);
                        } catch (_) { /* ignore */ }
                        reject(err);
                    };

                    res.on('data', (chunk) => {
                        received += chunk.length;
                        if (received > MAX_ZIP_BYTES) {
                            res.destroy();
                            failWith(new GitHubError('Repository is too large to analyze (limit: 100 MB).', 413));
                        }
                    });

                    res.pipe(fileStream);
                    fileStream.on('finish', () => {
                        if (failed) return;
                        fileStream.close(() => (failed ? undefined : resolve(destPath)));
                    });
                    fileStream.on('error', (err) =>
                        failWith(new GitHubError(`Download failed: ${err.message}`, 502))
                    );
                    res.on('error', (err) =>
                        failWith(new GitHubError(`Download failed: ${err.message}`, 502))
                    );
                }
            );

            req.on('timeout', () => {
                req.destroy();
                reject(new GitHubError('Repository download timed out.', 504));
            });
            req.on('error', (err) => reject(new GitHubError(`Download failed: ${err.message}`, 502)));
        };

        doRequest(fileUrl, redirectsLeft);
    });
}

module.exports = {
    GitHubError,
    parseGitHubUrl,
    fetchRepoMeta,
    downloadAndExtract,
    MAX_ZIP_BYTES,
};
