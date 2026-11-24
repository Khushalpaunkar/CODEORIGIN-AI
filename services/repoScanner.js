const fsp = require('fs/promises');
const path = require('path');

const MAX_FILES = 5000;
const MAX_FILE_BYTES = 1024 * 1024; // 1 MB per file for line counting
const MAX_STORED_CONTENT_BYTES = 200 * 1024; // 200 KB stored per file for viewer
const MAX_TOTAL_STORED_BYTES = 8 * 1024 * 1024; // ~8 MB stored content per analysis

const SKIP_DIRS = new Set([
    '.git', '.hg', '.svn', 'node_modules', 'bower_components', 'vendor',
    'dist', 'build', 'out', 'target', '.next', '.nuxt', '.output',
    'coverage', '.cache', '.gradle', '.idea', '.vscode', '__pycache__',
    '.pytest_cache', '.mypy_cache', 'venv', '.venv', 'env', '.terraform',
    'Pods', 'DerivedData', '.dart_tool', '.bundle',
]);

const LANGUAGE_BY_EXT = {
    js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
    ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
    py: 'Python', pyw: 'Python',
    java: 'Java',
    c: 'C', h: 'C', cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++', hh: 'C++', hxx: 'C++',
    cs: 'C#',
    go: 'Go',
    rs: 'Rust',
    php: 'PHP',
    rb: 'Ruby', rake: 'Ruby',
    swift: 'Swift',
    kt: 'Kotlin', kts: 'Kotlin',
    scala: 'Scala',
    dart: 'Dart',
    lua: 'Lua',
    r: 'R',
    m: 'Objective-C',
    pl: 'Perl', pm: 'Perl',
    sh: 'Shell', bash: 'Shell', zsh: 'Shell', fish: 'Shell',
    ps1: 'PowerShell',
    sql: 'SQL',
    html: 'HTML', htm: 'HTML', vue: 'Vue', svelte: 'Svelte',
    css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less',
    json: 'JSON', yml: 'YAML', yaml: 'YAML', toml: 'TOML', ini: 'INI', xml: 'XML',
    md: 'Markdown', markdown: 'Markdown',
    txt: 'Text',
    graphql: 'GraphQL', gql: 'GraphQL',
    ex: 'Elixir', exs: 'Elixir',
    erl: 'Erlang',
    hs: 'Haskell',
    clj: 'Clojure',
    ml: 'OCaml',
    groovy: 'Groovy',
    gradle: 'Groovy',
    tf: 'Terraform',
    dockerfile: 'Dockerfile',
    makefile: 'Makefile',
};

const SUPPORTED_EXTS = new Set(Object.keys(LANGUAGE_BY_EXT));

const SPECIAL_FILENAMES = {
    dockerfile: 'Dockerfile',
    makefile: 'Makefile',
    rakefile: 'Rakefile',
    gemfile: 'Gemfile',
    procfile: 'Procfile',
    license: 'Text',
    readme: 'Markdown',
};

const LINE_COMMENT = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'java', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx', 'cs', 'go', 'rs', 'php', 'swift', 'kt', 'kts', 'scala', 'dart', 'groovy', 'gradle', 'js', 'vue', 'graphql', 'gql', 'ex', 'exs', 'hs', 'clj', 'ml']);
const HASH_COMMENT = new Set(['py', 'pyw', 'rb', 'rake', 'sh', 'bash', 'zsh', 'fish', 'pl', 'pm', 'yml', 'yaml', 'toml', 'tf', 'r', 'dockerfile', 'makefile']);
const HTML_COMMENT = new Set(['html', 'htm', 'xml']);
const CSS_COMMENT = new Set(['css', 'scss', 'sass', 'less']);

function isBinaryBuffer(buf) {
    const len = Math.min(buf.length, 8000);
    for (let i = 0; i < len; i++) {
        const b = buf[i];
        if (b === 0) return true;
        if (b < 9 || (b > 13 && b < 32)) return true;
    }
    return false;
}

function classifyLines(text, ext) {
    let blank = 0;
    let comment = 0;
    let code = 0;

    const lines = text.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    const isLineComment = LINE_COMMENT.has(ext);
    const isHash = HASH_COMMENT.has(ext);
    const isHtml = HTML_COMMENT.has(ext);
    const isCss = CSS_COMMENT.has(ext);
    let inBlockComment = false;

    for (const raw of lines) {
        const line = raw.trim();

        if (line === '') {
            blank++;
            continue;
        }

        if (isBlockCommentSyntax(ext)) {
            if (inBlockComment) {
                comment++;
                if (line.includes('*/')) inBlockComment = false;
                continue;
            }
            if (line.startsWith('/*')) {
                comment++;
                if (!line.includes('*/')) inBlockComment = true;
                continue;
            }
        }

        if (isHtml && line.startsWith('<!--')) {
            comment++;
            if (!line.includes('-->')) {
                // multi-line HTML comment: treat subsequent lines as comments until -->
                inBlockComment = true;
            }
            continue;
        }
        if (inBlockComment && isHtml) {
            comment++;
            if (line.includes('-->')) inBlockComment = false;
            continue;
        }

        if (isCss && line.startsWith('/*')) {
            comment++;
            if (!line.includes('*/')) inBlockComment = true;
            continue;
        }
        if (inBlockComment && isCss) {
            comment++;
            if (line.includes('*/')) inBlockComment = false;
            continue;
        }

        if (isLineComment && (line.startsWith('//') || line.startsWith('///'))) {
            comment++;
            continue;
        }
        if (isHash && line.startsWith('#')) {
            comment++;
            continue;
        }

        code++;
    }

    return { blank, comment, code, total: lines.length };
}

function isBlockCommentSyntax(ext) {
    return LINE_COMMENT.has(ext) && ['js','jsx','mjs','cjs','ts','tsx','mts','cts','java','c','h','cpp','cc','cxx','hpp','hh','hxx','cs','go','rs','php','swift','kt','kts','scala','dart','groovy','gradle','vue','ex','exs','hs','clj','ml'].includes(ext);
}

function resolveLanguage(name, ext) {
    if (SUPPORTED_EXTS.has(ext)) return LANGUAGE_BY_EXT[ext];
    const lower = name.toLowerCase();
    if (SPECIAL_FILENAMES[lower]) return SPECIAL_FILENAMES[lower];
    return null;
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function scanRepository(rootDir) {
    const stats = {
        totalFiles: 0,
        totalFolders: 0,
        supportedFiles: 0,
        totalLines: 0,
        blankLines: 0,
        commentLines: 0,
        codeLines: 0,
        languages: [],
    };

    const languageMap = new Map();
    let storedContentBytes = 0;
    let truncatedByLimit = false;

    async function walk(dirPath, relPath) {
        let entries;
        try {
            entries = await fsp.readdir(dirPath, { withFileTypes: true });
        } catch {
            return [];
        }

        entries.sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        const nodes = [];

        for (const entry of entries) {
            if (stats.totalFiles >= MAX_FILES) {
                truncatedByLimit = true;
                break;
            }

            const name = entry.name;
            if (name.startsWith('.') && name !== '.env.example') {
                // skip hidden files/dirs except harmless dotfiles we may still skip anyway
                if (entry.isDirectory()) continue;
            }

            const absPath = path.join(dirPath, name);
            const nodePath = relPath ? `${relPath}/${name}` : name;

            if (entry.isDirectory()) {
                if (SKIP_DIRS.has(name)) continue;
                stats.totalFolders++;
                const children = await walk(absPath, nodePath);
                nodes.push({
                    name,
                    path: nodePath,
                    type: 'folder',
                    ext: '',
                    size: 0,
                    lines: 0,
                    supported: false,
                    children,
                });
                continue;
            }

            if (!entry.isFile()) continue;

            stats.totalFiles++;

            const ext = path.extname(name).toLowerCase().replace('.', '');
            const language = resolveLanguage(name, ext);
            const supported = Boolean(language);

            let size = 0;
            try {
                const st = await fsp.stat(absPath);
                size = st.size;
            } catch {
                size = 0;
            }

            const node = {
                name,
                path: nodePath,
                type: 'file',
                ext: ext ? `.${ext}` : '',
                size,
                lines: 0,
                supported,
                content: null,
                contentTruncated: false,
            };

            if (supported && size <= MAX_FILE_BYTES) {
                try {
                    const buf = await fsp.readFile(absPath);
                    if (!isBinaryBuffer(buf)) {
                        const text = buf.toString('utf8');
                        const counts = classifyLines(text, ext);
                        node.lines = counts.total;
                        stats.totalLines += counts.total;
                        stats.blankLines += counts.blank;
                        stats.commentLines += counts.comment;
                        stats.codeLines += counts.code;
                        stats.supportedFiles++;

                        const langStats = languageMap.get(language) || { name: language, files: 0, lines: 0 };
                        langStats.files++;
                        langStats.lines += counts.total;
                        languageMap.set(language, langStats);

                        const contentBytes = Buffer.byteLength(text, 'utf8');
                        if (contentBytes <= MAX_STORED_CONTENT_BYTES && storedContentBytes + contentBytes <= MAX_TOTAL_STORED_BYTES) {
                            node.content = text;
                            storedContentBytes += contentBytes;
                        } else {
                            node.contentTruncated = true;
                            if (contentBytes <= MAX_STORED_CONTENT_BYTES) {
                                node.content = text.slice(0, Math.floor(MAX_STORED_CONTENT_BYTES / 2));
                                storedContentBytes += Buffer.byteLength(node.content, 'utf8');
                            }
                        }
                    }
                } catch {
                    // unreadable file — skip content, keep metadata
                }
            } else if (supported && size > MAX_FILE_BYTES) {
                node.contentTruncated = true;
                stats.supportedFiles++;
                const langStats = languageMap.get(language) || { name: language, files: 0, lines: 0 };
                langStats.files++;
                languageMap.set(language, langStats);
            }

            nodes.push(node);
        }

        return nodes;
    }

    const fileTree = await walk(rootDir, '');

    stats.languages = [...languageMap.values()].sort((a, b) => b.files - a.files || b.lines - a.lines);

    const totalLanguageFiles = stats.languages.reduce((sum, l) => sum + l.files, 0);
    stats.languages = stats.languages.map((l) => ({
        ...l,
        percent: totalLanguageFiles ? Math.round((l.files / totalLanguageFiles) * 1000) / 10 : 0,
    }));

    return { stats, fileTree, truncatedByLimit, hasContent: stats.totalFiles > 0 };
}

module.exports = {
    scanRepository,
    formatBytes,
    MAX_FILES,
    MAX_FILE_BYTES,
    LANGUAGE_BY_EXT,
};
