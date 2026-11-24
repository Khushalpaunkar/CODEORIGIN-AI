(function () {
    'use strict';

    var configEl = document.getElementById('analysisConfig');
    var languageEl = document.getElementById('languageData');

    var analysisId = null;
    var languages = [];
    var colors = ['#2dc67e', '#142128', '#36c982', '#a9e9e5', '#f2ca4d', '#ff806b', '#7e6ff2', '#4aa8d8', '#e07a5f', '#81b29a'];

    if (configEl) {
        try {
            analysisId = JSON.parse(configEl.textContent).analysisId;
        } catch (e) {
            analysisId = null;
        }
    }

    if (languageEl) {
        try {
            languages = JSON.parse(languageEl.textContent) || [];
        } catch (e) {
            languages = [];
        }
    }

    function escapeHtml(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatBytes(bytes) {
        var n = Number(bytes) || 0;
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function initChart() {
        var canvas = document.getElementById('languageChart');
        if (!canvas || typeof Chart === 'undefined' || !languages.length) return;

        new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: languages.map(function (l) { return l.name; }),
                datasets: [{
                    data: languages.map(function (l) { return l.files; }),
                    backgroundColor: languages.map(function (_, i) { return colors[i % colors.length]; }),
                    borderColor: '#ffffff',
                    borderWidth: 2,
                    hoverOffset: 6,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '64%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            font: { family: "'DM Mono', monospace", size: 10 },
                            color: '#142128',
                            padding: 16,
                            usePointStyle: true,
                        },
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                var lang = languages[context.dataIndex] || {};
                                return context.label + ': ' + context.parsed + ' file(s), ' + (lang.percent || 0) + '%';
                            },
                        },
                    },
                },
            },
        });
    }

    function initTree() {
        var toggles = document.querySelectorAll('.tree-toggle');

        toggles.forEach(function (toggle) {
            toggle.addEventListener('click', function () {
                var folder = toggle.closest('.tree-folder');
                if (!folder) return;
                var isOpen = folder.classList.toggle('open');
                toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            });
        });

        var files = document.querySelectorAll('.tree-file');

        files.forEach(function (fileBtn) {
            fileBtn.addEventListener('click', function () {
                loadFile(fileBtn);
            });
        });
    }

    function renderViewer(file) {
        var header = document.getElementById('viewerHeader');
        var body = document.getElementById('viewerBody');
        if (!header || !body) return;

        var meta = 'PATH: ' + file.path
            + ' <span>EXT: ' + (file.ext || 'none') + '</span>'
            + '<span>SIZE: ' + formatBytes(file.size) + '</span>'
            + '<span>LINES: ' + file.lines + '</span>';

        header.innerHTML = '<span class="mini-label">SOURCE: ' + escapeHtml(file.name) + '</span>'
            + '<span class="viewer-meta">' + meta + '</span>';

        if (file.truncated || !file.found) {
            body.innerHTML = '<div class="viewer-notice"><i class="bi bi-exclamation-circle"></i> '
                + escapeHtml(file.message || 'Content unavailable.') + '</div>';
            return;
        }

        var lines = String(file.content || '').split(/\r?\n/);
        if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

        var html = '';
        lines.forEach(function (line, index) {
            html += '<div class="code-line">'
                + '<span class="line-number">' + (index + 1) + '</span>'
                + '<span class="line-text">' + escapeHtml(line) + '</span>'
                + '</div>';
        });

        body.innerHTML = html || '<div class="viewer-empty"><p>File is empty.</p></div>';
        body.scrollTop = 0;
    }

    function loadFile(btn) {
        if (!analysisId) return;

        document.querySelectorAll('.tree-file.active').forEach(function (el) {
            el.classList.remove('active');
        });
        btn.classList.add('active');

        var header = document.getElementById('viewerHeader');
        var body = document.getElementById('viewerBody');
        if (header) header.innerHTML = '<span class="mini-label">LOADING ' + escapeHtml(btn.dataset.name) + '…</span>';
        if (body) body.innerHTML = '<div class="viewer-empty"><p>Reading source file…</p></div>';

        fetch('/api/analysis/' + encodeURIComponent(analysisId) + '/file?path=' + encodeURIComponent(btn.dataset.path), {
            headers: { Accept: 'application/json' },
        })
            .then(function (res) { return res.json().catch(function () { return {}; }); })
            .then(function (data) {
                if (!data.success) {
                    renderViewer({
                        name: btn.dataset.name,
                        path: btn.dataset.path,
                        ext: btn.dataset.ext,
                        size: Number(btn.dataset.size) || 0,
                        lines: Number(btn.dataset.lines) || 0,
                        found: false,
                        message: data.error || 'Unable to load this file.',
                    });
                    return;
                }
                renderViewer(data);
            })
            .catch(function () {
                renderViewer({
                    name: btn.dataset.name,
                    path: btn.dataset.path,
                    ext: btn.dataset.ext,
                    size: Number(btn.dataset.size) || 0,
                    lines: Number(btn.dataset.lines) || 0,
                    found: false,
                    message: 'Network error while loading the file.',
                });
            });
    }

    function init() {
        initChart();
        initTree();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
