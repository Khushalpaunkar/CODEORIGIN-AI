const os = require('os');
const path = require('path');
const fsp = require('fs/promises');

const Analysis = require('../models/Analysis');
const { GitHubError, parseGitHubUrl, fetchRepoMeta, downloadAndExtract } = require('../services/githubService');
const { scanRepository, formatBytes } = require('../services/repoScanner');

const TEMP_PREFIX = 'codeorigin-analysis-';

function sendError(res, err) {
    const status = err instanceof GitHubError ? err.statusCode : 500;
    const message = err instanceof GitHubError ? err.message : 'Analysis failed. Please try again.';
    if (status >= 500) console.error('[analysis] error:', err);
    return res.status(status).json({ success: false, error: message });
}

async function cleanupDir(dir) {
    if (!dir) return;
    try {
        await fsp.rm(dir, { recursive: true, force: true });
    } catch (err) {
        console.warn('[analysis] temp cleanup failed:', err.message);
    }
}

// POST /api/analyze — process a GitHub repository and return a new analysisId
async function startAnalysis(req, res) {
    const userId = req.session.user && req.session.user.id;
    if (!userId) return res.status(401).json({ success: false, error: 'You must be signed in.' });

    let repo;
    try {
        repo = parseGitHubUrl(req.body && req.body.url);
    } catch (err) {
        return sendError(res, err);
    }

    const { isDatabaseConnected } = require('../config/db');
    if (!isDatabaseConnected()) {
        return res.status(503).json({
            success: false,
            error: 'Database is unavailable. Analysis cannot be saved right now.',
        });
    }

    let tempDir = null;

    try {
        const meta = await fetchRepoMeta(repo.owner, repo.name);

        tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
        const sourceRoot = await downloadAndExtract(repo.owner, repo.name, tempDir);

        const scan = await scanRepository(sourceRoot);

        if (!scan.hasContent) {
            return res.status(400).json({
                success: false,
                error: 'This repository appears to be empty — nothing to analyze.',
            });
        }

        const analysis = new Analysis({
            analysisId: Analysis.generateId(),
            user: userId,
            repository: {
                url: repo.url,
                owner: repo.owner,
                name: repo.name,
                defaultBranch: meta.defaultBranch,
                description: meta.description,
                visibility: meta.visibility,
                lastUpdated: meta.lastUpdated,
            },
            status: 'completed',
            stats: {
                totalFiles: scan.stats.totalFiles,
                totalFolders: scan.stats.totalFolders,
                supportedFiles: scan.stats.supportedFiles,
                totalLines: scan.stats.totalLines,
                blankLines: scan.stats.blankLines,
                commentLines: scan.stats.commentLines,
                codeLines: scan.stats.codeLines,
                languages: scan.stats.languages,
            },
            fileTree: scan.fileTree,
            startedAt: new Date(),
            completedAt: new Date(),
        });

        await analysis.save();

        return res.json({ success: true, analysisId: analysis.analysisId });
    } catch (err) {
        return sendError(res, err);
    } finally {
        await cleanupDir(tempDir);
    }
}

function findNodeByPath(nodes, targetPath) {
    if (!Array.isArray(nodes)) return null;
    for (const node of nodes) {
        if (node.path === targetPath) return node;
        if (node.children && node.children.length) {
            const found = findNodeByPath(node.children, targetPath);
            if (found) return found;
        }
    }
    return null;
}

function findAnalysisForUser(analysisId, userId) {
    if (!/^[a-f0-9]{18}$/i.test(analysisId || '')) return null;
    return Analysis.findOne({ analysisId, user: userId });
}

// GET /analysis/:analysisId — render the analysis page for the signed-in owner
async function getAnalysis(req, res) {
    const userId = req.session.user && req.session.user.id;
    const { analysisId } = req.params;

    const analysis = await findAnalysisForUser(analysisId, userId);
    if (!analysis) {
        return res.status(404).render('errors/not-found', {
            pageTitle: 'Analysis Not Found | CodeOrigin AI',
            message: 'This analysis does not exist or you do not have access to it.',
        });
    }

    const stats = analysis.stats || {};
    const totalLanguageFiles = (stats.languages || []).reduce((sum, l) => sum + (l.files || 0), 0);
    const languages = (stats.languages || []).map((l) => ({
        name: l.name,
        files: l.files,
        lines: l.lines,
        percent: l.percent || (totalLanguageFiles ? Math.round((l.files / totalLanguageFiles) * 1000) / 10 : 0),
    }));

    res.render('repository/analysis', {
        pageTitle: `${analysis.repository.owner}/${analysis.repository.name} | CodeOrigin AI`,
        analysis,
        stats,
        languages,
        languagesJson: JSON.stringify(languages).replace(/</g, '\\u003c'),
        formatBytes,
        chartColors: ['#2dc67e', '#142128', '#36c982', '#a9e9e5', '#f2ca4d', '#ff806b', '#7e6ff2', '#4aa8d8', '#e07a5f', '#81b29a'],
        statusLabel: {
            completed: 'ANALYSIS COMPLETE',
            processing: 'SCANNING REPOSITORY',
            empty: 'EMPTY REPOSITORY',
            failed: 'ANALYSIS FAILED',
        }[analysis.status] || 'ANALYSIS STATUS',
    });
}

// GET /api/analysis/:analysisId/file?path=... — stored source content
async function getFileContent(req, res) {
    const userId = req.session.user && req.session.user.id;
    const { analysisId } = req.params;
    const filePath = req.query.path;

    if (typeof filePath !== 'string' || !filePath || filePath.length > 1024) {
        return res.status(400).json({ success: false, error: 'Invalid file path.' });
    }

    const analysis = await findAnalysisForUser(analysisId, userId);
    if (!analysis) {
        return res.status(404).json({ success: false, error: 'Analysis not found.' });
    }

    const node = findNodeByPath(analysis.fileTree || [], filePath);
    if (!node || node.type !== 'file') {
        return res.status(404).json({ success: false, error: 'File not found in this analysis.' });
    }

    if (node.content === null || node.content === undefined) {
        return res.json({
            success: true,
            found: false,
            name: node.name,
            path: node.path,
            ext: node.ext,
            size: node.size,
            lines: node.lines,
            truncated: true,
            content: null,
            message: node.supported
                ? 'File content was not stored (too large or binary).'
                : 'This file type is not part of the supported source scan.',
        });
    }

    return res.json({
        success: true,
        found: true,
        name: node.name,
        path: node.path,
        ext: node.ext,
        size: node.size,
        lines: node.lines,
        truncated: Boolean(node.contentTruncated),
        content: node.content,
        message: node.contentTruncated ? 'Content preview truncated for storage limits.' : '',
    });
}

module.exports = { startAnalysis, getAnalysis, getFileContent };
