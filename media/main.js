// @ts-check
// JS Live Preview — Webview script (preview + console only)
(function () {
    'use strict';

    // ── VS Code API ───────────────────────────────────────────────────
    // eslint-disable-next-line no-undef
    const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

    // ── Elements ──────────────────────────────────────────────────────
    const preview   = /** @type {HTMLIFrameElement} */ (document.getElementById('preview'));
    const emptyPreview  = document.getElementById('emptyPreview');
    const previewHint   = document.getElementById('previewHint');
    const previewWrap   = document.getElementById('previewWrap');
    const consoleLog    = document.getElementById('consoleLog');
    const badge         = document.getElementById('badge');
    const errorCount    = document.getElementById('errorCount');
    const warnCount     = document.getElementById('warnCount');
    const clearBtn      = document.getElementById('clearBtn');
    const statusDot     = document.getElementById('statusDot');
    const statusFile    = document.getElementById('statusFile');
    const resizeHandleV = document.getElementById('resizeHandleV');
    const consoleSection  = document.getElementById('consoleSection');
    const consoleHeader   = document.getElementById('consoleHeader');
    const consoleToggle   = document.getElementById('consoleToggle');
    const replInput = /** @type {HTMLInputElement} */ (document.getElementById('replInput'));
    const replBtn   = document.getElementById('replBtn');
    const openExternalBtn = document.getElementById('openExternalBtn');

    openExternalBtn?.addEventListener('click', () => {
        vscode?.postMessage({ type: 'open_external' });
    });

    let logCount = 0, errors = 0, warnings = 0;
    let lastFilename = '', lastLanguage = '';
    let lastPort = null;
    let lastRelativePath = '';
    let watchdogTimer = null;
    let lastHeartbeat = 0;
    let runStartTime = 0;

    // ── Feature state ────────────────────────────────────────────────
    let currentFilter = 'all';
    let allLogEntries = []; // { level: string, el: HTMLElement }

    // ── Signal webview is ready ───────────────────────────────────────
    if (vscode) vscode.postMessage({ type: 'ready' });

    // ── Messages from extension + iframe ─────────────────────────────
    window.addEventListener('message', (e) => {
        const msg = e.data;
        if (!msg) return;

        if (msg.command === 'run') {
            runCode(msg.filename || 'script', msg.language || 'javascript', msg.port, msg.relativePath || '');
        } else if (msg.command === 'clear') {
            clearConsole();
        } else if (msg.type === 'heartbeat') {
            lastHeartbeat = Date.now();
        } else if (msg.type === 'log') {
            addLogEntry(msg.level, msg.msg);
        } else if (msg.type === 'eval_result') {
            // Result from REPL eval — prefix with ← to distinguish
            addLogEntry(msg.isError ? 'error' : 'log', (msg.isError ? '' : '← ') + msg.value);
        } else if (msg.command === 'show_dialog') {
            stopWatchdog();
            showDialog(msg.dialogType, msg.msg, msg.def).then(val => {
                vscode?.postMessage({ type: 'dialog_result', val });
                lastHeartbeat = Date.now();
                startWatchdog(lastFilename);
            });
        }
    });

    // ── Feature 1: Console Filter Tabs ───────────────────────────────
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter || 'all';
            applyFilter();
        });
    });

    function applyFilter() {
        allLogEntries.forEach(({ level, el }) => {
            const show = currentFilter === 'all' || level === currentFilter;
            el.style.display = show ? '' : 'none';
        });
    }

    // ── Feature 5: Responsive Preview Toggles ────────────────────────
    document.querySelectorAll('.resp-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.resp-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const w = btn.dataset.width || '100%';
            if (w === '100%') {
                preview.style.width = '100%';
                preview.style.boxShadow = '';
                previewWrap?.classList.remove('resp-mode');
            } else {
                preview.style.width = w;
                preview.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.1), 0 8px 32px rgba(0,0,0,0.4)';
                previewWrap?.classList.add('resp-mode');
            }
        });
    });

    // ── Feature 11: REPL Console Input ───────────────────────────────
    let replHistory = [];
    let replHistoryIndex = -1;

    function sendEval(code) {
        if (!code.trim()) return;
        replHistory.push(code);
        replHistoryIndex = replHistory.length;
        addLogEntry('log', '> ' + code);   // echo input like DevTools
        if (preview.contentWindow) {
            preview.contentWindow.postMessage({ type: 'eval', code }, '*');
        } else {
            addLogEntry('error', 'No script running. Run a file first.');
        }
    }

    replInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            sendEval(replInput.value);
            replInput.value = '';
        } else if (e.key === 'ArrowUp') {
            if (replHistory.length > 0 && replHistoryIndex > 0) {
                replHistoryIndex--;
                replInput.value = replHistory[replHistoryIndex];
            }
            e.preventDefault();
        } else if (e.key === 'ArrowDown') {
            if (replHistory.length > 0 && replHistoryIndex < replHistory.length - 1) {
                replHistoryIndex++;
                replInput.value = replHistory[replHistoryIndex];
            } else if (replHistoryIndex >= replHistory.length - 1) {
                replHistoryIndex = replHistory.length;
                replInput.value = '';
            }
            e.preventDefault();
        }
    });

    replBtn?.addEventListener('click', () => {
        sendEval(replInput?.value || '');
        if (replInput) replInput.value = '';
        replInput?.focus();
    });

    // ── Dialog Builder ───────────────────────────────────────────────
    function showDialog(type, message, defVal) {
        return new Promise(res => {
            const ov = document.createElement('div'); ov.className = '__pg-ov';
            const dl = document.createElement('div'); dl.className = '__pg-dl';
            const dt = document.createElement('div'); dt.className = '__pg-dt';
            dt.textContent = type === 'prompt' ? 'Input' : type === 'confirm' ? 'Confirm' : 'Alert';
            dl.appendChild(dt);
            const dm = document.createElement('div'); dm.className = '__pg-dm';
            dm.textContent = message != null ? String(message) : '';
            dl.appendChild(dm);
            let inp;
            if (type === 'prompt') {
                inp = document.createElement('input'); inp.className = '__pg-di'; inp.type = 'text';
                inp.value = defVal != null ? String(defVal) : ''; dl.appendChild(inp);
            }
            const db = document.createElement('div'); db.className = '__pg-db';
            const done = v => { ov.remove(); res(v); };
            if (type === 'confirm' || type === 'prompt') {
                const cb = document.createElement('button'); cb.className = '__pg-b __pg-bc';
                cb.textContent = 'Cancel'; cb.onclick = () => done(type === 'confirm' ? false : null);
                db.appendChild(cb);
            }
            const ob = document.createElement('button'); ob.className = '__pg-b __pg-bp';
            ob.textContent = 'OK';
            ob.onclick = () => {
                if (type === 'prompt') done(inp.value);
                else if (type === 'confirm') done(true);
                else done(undefined);
            };
            db.appendChild(ob); dl.appendChild(db); ov.appendChild(dl);
            document.body.appendChild(ov);
            if (inp) inp.focus(); else ob.focus();
            ov.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); ob.click(); }
                if (e.key === 'Escape') { e.preventDefault(); done(type === 'alert' ? undefined : type === 'confirm' ? false : null); }
            });
        });
    }

    // ── Button handlers ───────────────────────────────────────────────
    clearBtn.addEventListener('click', clearConsole);

    // ── Console Toggle ───────────────────────────────────────────────
    let consoleCollapsed = false;
    let lastConsoleH = null;
    const previewSection = document.getElementById('previewSection');

    consoleHeader.addEventListener('click', () => {
        consoleCollapsed = !consoleCollapsed;
        consoleSection.classList.toggle('collapsed', consoleCollapsed);
        if (consoleCollapsed) {
            lastConsoleH = consoleSection.getBoundingClientRect().height;
            resizeHandleV.style.display = 'none';
            consoleSection.style.height = '';
            consoleSection.style.flex = '';
            previewSection.style.height = '';
            previewSection.style.flex = '1';
        } else {
            resizeHandleV.style.display = '';
            if (lastConsoleH && lastConsoleH > 40) {
                const main = document.querySelector('.main');
                const totalH = main.getBoundingClientRect().height;
                const consoleH = Math.min(lastConsoleH, totalH - 80);
                previewSection.style.flex = 'none';
                previewSection.style.height = (totalH - consoleH - 4) + 'px';
                consoleSection.style.height = consoleH + 'px';
            } else {
                previewSection.style.flex = '1';
                previewSection.style.height = '';
                consoleSection.style.height = '35%';
            }
        }
    });

    // ── Feature 6: Execution Timer ───────────────────────────────────
    function setStatus(state, filename, elapsedMs) {
        statusDot.className = 'status-dot ' + state;
        if (state === 'running') {
            statusFile.textContent = '⟳ Running ' + filename + '…';
        } else {
            const timer = (elapsedMs != null) ? ` (${elapsedMs}ms)` : '';
            statusFile.textContent = '✓ ' + filename + timer;
        }
    }

    // ── Run Code ─────────────────────────────────────────────────────
    function runCode(filename, language, port, relativePath) {
        clearConsole();
        stopWatchdog();
        lastFilename = filename;
        lastLanguage = language;
        lastPort = port;
        lastRelativePath = relativePath;
        runStartTime = Date.now();
        setStatus('running', filename);
        emptyPreview.style.display = 'none';
        preview.style.display = 'block';

        const localOrigin = 'http://127.0.0.1:' + port;

        preview.onload = () => {
            const elapsed = Date.now() - runStartTime;
            setStatus('done', filename, elapsed);
            if (previewHint) previewHint.textContent = filename;
            lastHeartbeat = Date.now();
            try {
                const frameSrc = preview.contentWindow?.location?.href || '';
                if (frameSrc && !frameSrc.startsWith(localOrigin) && frameSrc !== 'about:blank') {
                    stopWatchdog();
                }
            } catch (e) {
                stopWatchdog();
            }
        };

        const urlPath = relativePath.startsWith('/') ? relativePath : '/' + relativePath;
        preview.src = localOrigin + urlPath + '?t=' + Date.now();
        startWatchdog(filename);
    }

    // ── Watchdog Timer ────────────────────────────────────────────────
    function startWatchdog(filename) {
        lastHeartbeat = Date.now();
        watchdogTimer = setInterval(() => {
            if (Date.now() - lastHeartbeat > 5000) {
                stopWatchdog();
                preview.src = 'about:blank';
                setStatus('done', filename);
                addLogEntry('error', '⏱️ Script terminated — possible infinite loop detected. The script did not respond for 5 seconds and was killed to protect your computer.');
                if (consoleSection.classList.contains('collapsed')) {
                    consoleSection.classList.remove('collapsed');
                    resizeHandleV.style.display = '';
                    consoleSection.style.height = '35%';
                }
            }
        }, 2000);
    }

    function stopWatchdog() {
        if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
    }

    // ── Feature 10: Error Line → Jump to Editor ───────────────────────
    function attachLineJump(msgEl) {
        msgEl.querySelectorAll('.error-line[data-line]').forEach(span => {
            span.style.cursor = 'pointer';
            span.title = 'Click to open this line in the editor';
            span.addEventListener('click', () => {
                vscode?.postMessage({ type: 'jump_to_line', line: parseInt(span.dataset.line) });
            });
        });
    }

    // ── Add Log Entry ─────────────────────────────────────────────────
    function addLogEntry(level, msg) {
        const empty = document.getElementById('emptyState');
        if (empty) empty.remove();

        const now = new Date();
        const ts = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' +
            pad(now.getSeconds()) + '.' + pad3(now.getMilliseconds());

        const ICONS  = { log: '›', warn: '⚠', error: '✕', info: 'ℹ' };
        const ICLASS = { log: 'icon-log', warn: 'icon-warn', error: 'icon-error', info: 'icon-info' };

        const entry = document.createElement('div');
        entry.className = 'log-entry level-' + level;

        const timeEl = document.createElement('span');
        timeEl.className = 'log-time';
        timeEl.textContent = ts;

        const iconEl = document.createElement('i');
        iconEl.className = 'log-icon ' + (ICLASS[level] || 'icon-log');
        if (level === 'error') {
            const errorIconSrc = document.body.getAttribute('data-error-icon');
            if (errorIconSrc) {
                const img = document.createElement('img');
                img.src = errorIconSrc; img.className = 'log-icon-img'; img.alt = 'Error';
                iconEl.textContent = ''; iconEl.appendChild(img);
            } else { iconEl.textContent = ICONS[level] || '›'; }
        } else { iconEl.textContent = ICONS[level] || '›'; }
        iconEl.setAttribute('aria-hidden', 'true');

        const msgEl = document.createElement('span');
        msgEl.className = 'log-msg';
        msgEl.textContent = msg;

        entry.appendChild(timeEl);
        entry.appendChild(iconEl);
        entry.appendChild(msgEl);

        if (level === 'error') {
            const hintObj = parseErrorMessage(msg);
            msgEl.innerHTML = hintObj.en;
            attachLineJump(msgEl); // Feature 10

            const btn = document.createElement('button');
            btn.className = 'translate-btn'; btn.textContent = 'ID';
            let showingId = false;
            btn.onclick = () => {
                showingId = !showingId;
                msgEl.innerHTML = showingId ? hintObj.id : hintObj.en;
                attachLineJump(msgEl); // re-attach after innerHTML swap
                btn.textContent = showingId ? 'EN' : 'ID';
                btn.classList.toggle('active', showingId);
            };
            entry.appendChild(btn);
        }

        // Feature 1: store entry for filter
        allLogEntries.push({ level, el: entry });
        const visible = currentFilter === 'all' || level === currentFilter;
        if (!visible) entry.style.display = 'none';

        consoleLog.appendChild(entry);
        consoleLog.scrollTop = consoleLog.scrollHeight;

        logCount++;
        if (level === 'error') errors++;
        if (level === 'warn') warnings++;
        updateBadges();
    }

    // ── Error Message Parser ──────────────────────────────────────────
    function parseErrorMessage(errorMsg) {
        let msg = String(errorMsg);
        msg = msg.replace(/ \\\(line \\\d+\\\)$/i, '').replace(/\\\d+:\\\d+$/i, '').trim();
        const lineMatch = errorMsg.match(/\(line (\d+)\)/);
        const lineInfo = lineMatch
            ? `<span class="error-line" data-line="${lineMatch[1]}">Line ${lineMatch[1]}</span>`
            : '';

        if (msg.includes('is not defined')) {
            const v = (msg.match(/([a-zA-Z0-9_$]+) is not defined/) || [])[1] || 'Variable';
            return {
                en: `<strong>${v}</strong> is missing or undefined ${lineInfo}<ul><li>Check your spelling (uppercase/lowercase matters)</li><li>Define it using <code>let</code>, <code>const</code>, or <code>var</code></li><li>Make sure it\'s declared before this line</li></ul><small>${msg}</small>`,
                id: `<strong>${v}</strong> belum dideklarasikan ${lineInfo}<ul><li>Periksa huruf besar/kecil (typo)</li><li>Buat dulu pakai <code>let</code>, <code>const</code>, atau <code>var</code></li><li>Pastikan posisinya sebelum baris ini</li></ul><small>${msg}</small>`
            };
        }
        if (msg.includes('is not a function')) {
            const v = (msg.match(/([a-zA-Z0-9_$.]+) is not a function/) || [])[1] || 'This';
            return {
                en: `<strong>${v}</strong> is not a function ${lineInfo}<ul><li>Are you sure this is a function?</li><li>It might be a String, Number, or Object</li><li>Check for typos in the function name</li></ul><small>${msg}</small>`,
                id: `<strong>${v}</strong> bukan sebuah fungsi ${lineInfo}<ul><li>Apakah ini memang sebuah fungsi?</li><li>Mungkin tipenya String, Number, atau Object</li><li>Periksa typo pada nama fungsi</li></ul><small>${msg}</small>`
            };
        }
        if (msg.includes('Unexpected token') || msg.includes('Unexpected string') || msg.includes('Unexpected number')) {
            return {
                en: `Unexpected symbol or keyword ${lineInfo}<ul><li>Missing a comma <code>,</code> or semicolon <code>;</code>?</li><li>Extra or missing bracket <code>}</code> or parenthesis <code>)</code>?</li><li>Check your quotation marks</li></ul><small>${msg}</small>`,
                id: `Ada simbol yang tidak seharusnya ${lineInfo}<ul><li>Kurang koma <code>,</code> atau titik koma <code>;</code>?</li><li>Kurang/kelebihan kurung <code>}</code> atau <code>)</code>?</li><li>Periksa tanda kutip</li></ul><small>${msg}</small>`
            };
        }
        if (msg.includes('Unexpected identifier')) {
            return {
                en: `Unexpected word found ${lineInfo}<ul><li>Forgot a comma <code>,</code> or semicolon <code>;</code> on the previous line?</li><li>Check for typos in variable names</li></ul><small>${msg}</small>`,
                id: `Ada kata yang tidak terduga ${lineInfo}<ul><li>Lupa koma atau titik koma <code>;</code> di baris sebelumnya?</li><li>Periksa typo pada nama variabel</li></ul><small>${msg}</small>`
            };
        }
        if (msg.includes('Cannot read properties of null') || msg.includes('Cannot read properties of undefined') || msg.includes('Cannot set properties of null') || msg.includes('Cannot set properties of undefined')) {
            return {
                en: `Tried to access something empty (null/undefined) ${lineInfo}<ul><li>Is the HTML element you\'re targeting actually there?</li><li>Did a function forget to <code>return</code> a value?</li><li>Is the variable set before you use it?</li></ul><small>${msg}</small>`,
                id: `Mencoba mengambil data dari nilai kosong ${lineInfo}<ul><li>Apakah elemen HTML yang dituju benar ada?</li><li>Apakah ada fungsi yang lupa <code>return</code>?</li><li>Pastikan variabel sudah diisi sebelum dipakai</li></ul><small>${msg}</small>`
            };
        }
        if (msg.includes('Maximum call stack size exceeded')) {
            return {
                en: `Infinite loop detected ${lineInfo}<ul><li>Is your loop missing a stop condition?</li><li>Is a function calling itself endlessly?</li></ul><small>${msg}</small>`,
                id: `Perulangan tak berujung terdeteksi ${lineInfo}<ul><li>Apakah loop kamu punya kondisi berhenti?</li><li>Apakah ada fungsi yang memanggil dirinya sendiri?</li></ul><small>${msg}</small>`
            };
        }
        if (msg.includes('missing ) after argument list')) {
            return {
                en: `Missing <code>)</code> or <code>,</code> ${lineInfo}<ul><li>Use commas between values in <code>console.log()</code></li><li>Did you close all parentheses?</li></ul><small>${msg}</small>`,
                id: `Kurang <code>)</code> atau <code>,</code> ${lineInfo}<ul><li>Gunakan koma antar nilai di <code>console.log()</code></li><li>Pastikan semua kurung tertutup</li></ul><small>${msg}</small>`
            };
        }
        if (msg.includes('Invalid or unexpected token') || msg.includes('Missing initializer in const declaration')) {
            return {
                en: `Invalid character or syntax ${lineInfo}<ul><li>Hidden characters from copy-paste?</li><li>Check all quotes and brackets match</li></ul><small>${msg}</small>`,
                id: `Karakter atau sintaks tidak valid ${lineInfo}<ul><li>Ada karakter tersembunyi dari copy-paste?</li><li>Pastikan tanda kutip dan kurung berpasangan</li></ul><small>${msg}</small>`
            };
        }
        if (msg.includes('Assignment to constant variable')) {
            return {
                en: `Can\'t change a <code>const</code> variable ${lineInfo}<ul><li><code>const</code> values are permanent</li><li>Use <code>let</code> if you need to change it later</li></ul><small>${msg}</small>`,
                id: `Nilai <code>const</code> tidak bisa diubah ${lineInfo}<ul><li>Nilai <code>const</code> bersifat permanen</li><li>Gunakan <code>let</code> jika ingin diubah</li></ul><small>${msg}</small>`
            };
        }
        return {
            en: `An error occurred ${lineInfo}<ul><li>Check your spelling (case-sensitive)</li><li>Check commas, semicolons, and brackets</li><li>Read the error message below</li></ul><small>${msg}</small>`,
            id: `Terjadi error ${lineInfo}<ul><li>Periksa ejaan (huruf besar/kecil penting)</li><li>Periksa koma, titik koma, dan kurung</li><li>Baca pesan error di bawah</li></ul><small>${msg}</small>`
        };
    }

    function updateBadges() {
        badge.textContent = String(logCount);
        badge.classList.toggle('visible', logCount > 0);
        errorCount.querySelector('span').textContent = String(errors);
        errorCount.classList.toggle('visible', errors > 0);
        warnCount.querySelector('span').textContent = String(warnings);
        warnCount.classList.toggle('visible', warnings > 0);
    }

    function clearConsole() {
        consoleLog.innerHTML = '<div class="console-empty" id="emptyState">Console output will appear here after you run your code</div>';
        logCount = 0; errors = 0; warnings = 0;
        allLogEntries = [];
        // Reset filter to All
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        const allBtn = document.querySelector('.filter-btn[data-filter="all"]');
        if (allBtn) allBtn.classList.add('active');
        currentFilter = 'all';
        updateBadges();
    }

    // ── Vertical Resize ───────────────────────────────────────────────
    (function initResize() {
        const main = document.querySelector('.main');
        let dragging = false, startY = 0, startH = 0;
        resizeHandleV.addEventListener('mousedown', (e) => {
            if (consoleCollapsed) return;
            dragging = true; startY = e.clientY;
            startH = previewSection.getBoundingClientRect().height;
            resizeHandleV.classList.add('dragging');
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
            preview.style.pointerEvents = 'none';
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const delta = e.clientY - startY;
            const totalH = main.getBoundingClientRect().height;
            const consoleHeaderH = consoleHeader.getBoundingClientRect().height + 6;
            const newH = Math.min(Math.max(startH + delta, 80), totalH - consoleHeaderH);
            const consoleH = totalH - newH - 4;
            previewSection.style.flex = 'none';
            previewSection.style.height = newH + 'px';
            consoleSection.style.height = consoleH + 'px';
            lastConsoleH = consoleH;
        });
        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            resizeHandleV.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            preview.style.pointerEvents = '';
        });
    })();

    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function pad3(n) { return n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n; }

})();
