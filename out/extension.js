"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
let panel;
let isWebviewReady = false;
let server;
let serverPort = 0;
let currentRunData = null;
let pendingRun = null;
let activeDialogResolver = null;
const sseClients = new Set();
function triggerLiveReload() {
    for (const client of sseClients) {
        try {
            client.write('data: reload\n\n');
        } catch (e) {
            sseClients.delete(client);
        }
    }
}
const SUPPORTED_LANGS = ['javascript', 'html', 'typescript'];
const SHIM = `<script>
(function(){
  /* ── Console interception ── */
  var origLog = console.log.bind(console);
  var origWarn = console.warn.bind(console);
  var origError = console.error.bind(console);
  var origInfo = console.info.bind(console);

  function serialize(v){
    if(v===null)return'null';
    if(v===undefined)return'undefined';
    if(typeof v==='function')return v.toString().split('\\n')[0]+'{ ... }';
    if(Array.isArray(v)){
      // Render arrays horizontally like browser DevTools: [1, 2, 3]
      try{
        var items=[];
        for(var i=0;i<v.length;i++) items.push(serialize(v[i]));
        return'['+items.join(', ')+']';
      }catch(e){return String(v);}
    }
    if(typeof v==='object'){
      // Render objects compactly on one line: {name: "Alice", scores: [95, 87, 92]}
      try{
        var keys=Object.keys(v);
        var pairs=[];
        for(var i=0;i<keys.length;i++) pairs.push(keys[i]+': '+serialize(v[keys[i]]));
        return'{'+pairs.join(', ')+'}';
      }catch(e){return String(v);}
    }
    return String(v);
  }
  function send(level,args){
    try {
      if (level === 'warn') origWarn.apply(console, args);
      else if (level === 'error') origError.apply(console, args);
      else if (level === 'info') origInfo.apply(console, args);
      else origLog.apply(console, args);
    } catch(e){}

    var parts=[];
    for(var i=0;i<args.length;i++) parts.push(serialize(args[i]));
    var msg = parts.join(' ');
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'log', level: level, msg: msg }, '*');
    }
  }
  console.log   = function(){ send('log',   arguments); };
  console.warn  = function(){ send('warn',  arguments); };
  console.error = function(){ send('error', arguments); };
  console.info  = function(){ send('info',  arguments); };

  window.onerror = function(msg,src,line,col,err){
    var realLine = line;
    // Only adjust inline scripts (src is empty or matches url)
    var isInline = !src || src === window.location.href || src === window.location.href.split('?')[0] || src === window.location.href.split('#')[0];
    if (isInline && typeof window.__pgLineOffset === 'number') {
      realLine = Math.max(1, line - window.__pgLineOffset);
    }
    var rawMsg = err && err.message ? String(err.message) : String(msg);
    // Some browsers append their own " (line X)" or ":X" to the message, strip it so we don't show it twice
    rawMsg = rawMsg.replace(/ \\(line \\d+\\)$/i, '').replace(/\\d+:\\d+$/i, '');
    var m = rawMsg + (realLine ? ' (line ' + realLine + ')' : '');
    window.parent.postMessage({type:'log', level:'error', msg:m}, '*');
    return false;
  };
  window.addEventListener('unhandledrejection',function(e){
    var m=e.reason?(e.reason.message||String(e.reason)):'Unhandled promise rejection';
    window.parent.postMessage({type:'log',level:'error',msg:m},'*');
  });

  /* ── Safe document.write (prevents wiping async DOM) ── */
  var oldWrite = document.write.bind(document);
  var oldWriteln = document.writeln.bind(document);
  function writeSafe(str, nl){
    if(document.readyState === 'loading') { nl ? oldWriteln(str) : oldWrite(str); return; }
    var div = document.createElement('div');
    div.innerHTML = String(str) + (nl ? '<br>' : '');
    while(div.firstChild) { document.body.appendChild(div.firstChild); }
  }
  document.write = function(){ for(var i=0;i<arguments.length;i++) writeSafe(arguments[i], false); };
  document.writeln = function(){ for(var i=0;i<arguments.length;i++) writeSafe(arguments[i], true); };

  /* ── Synchronous Dialog Routing ── */
  function syncRequest(type, msg, def) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/__sync_dialog?type=' + type, false);
      xhr.send(JSON.stringify({ msg: msg != null ? String(msg) : '', def: def != null ? String(def) : '' }));
      if (xhr.status === 200) {
        return JSON.parse(xhr.responseText).val;
      }
    } catch(e) { }
    return null;
  }

  window.alert = function(m){ syncRequest('alert',m); };
  window.confirm = function(m){ return syncRequest('confirm',m) || false; };
  window.prompt = function(m,d){ return syncRequest('prompt',m,d); };

  /* ── Heartbeat (infinite loop watchdog) ── */
  setInterval(function(){
    window.parent.postMessage({ type: 'heartbeat' }, '*');
  }, 1000);

  /* ── REPL: eval expressions sent from the console input ── */
  window.addEventListener('message', function(e){
    if(!e.data || e.data.type !== 'eval') return;
    try{
      var result = (0,eval)(e.data.code);
      window.parent.postMessage({ type:'eval_result', value:serialize(result), isError:false }, '*');
    }catch(err){
      window.parent.postMessage({ type:'eval_result', value:err.message, isError:true }, '*');
    }
  });
  /* ── Live Reload SSE Listener for external browser windows ── */
  if (typeof EventSource !== 'undefined') {
    try {
      var es = new EventSource('/__live_reload');
      es.onmessage = function(e) {
        if (e.data === 'reload') {
          window.location.reload();
        }
      };
    } catch(e) {}
  }
})();
</script>`;
function detectInfiniteLoop(code) {
    // Strip comments and strings to avoid false positives
    const stripped = code
        .replace(/\/\/.*$/gm, '') // single-line comments
        .replace(/\/\*[\s\S]*?\*\//g, '') // multi-line comments
        .replace(/'(?:[^'\\]|\\.)*'/g, '""') // single-quoted strings
        .replace(/"(?:[^"\\]|\\.)*"/g, '""') // double-quoted strings
        .replace(/`(?:[^`\\]|\\.)*`/g, '""'); // template literals
    // 1. while(true) / while(1) without break
    const whileTrueRe = /while\s*\(\s*(true|1)\s*\)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
    let match;
    while ((match = whileTrueRe.exec(stripped)) !== null) {
        const body = match[2];
        if (!body.includes('break')) {
            return `Detected "while(${match[1]})" loop without a "break" statement. This will create an infinite loop.`;
        }
    }
    // 2. for(;;) without break
    const forEverRe = /for\s*\(\s*;?\s*;?\s*\)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
    while ((match = forEverRe.exec(stripped)) !== null) {
        const body = match[1];
        if (!body.includes('break')) {
            return `Detected "for(;;)" loop without a "break" statement. This will create an infinite loop.`;
        }
    }
    // 3. for(init; condition; <empty update>) — e.g. for(var i=0; i<10; i) 
    const forNoUpdateRe = /for\s*\(\s*(?:var|let|const)?\s*(\w+)\s*=\s*[^;]+;\s*[^;]+;\s*\1\s*\)/g;
    while ((match = forNoUpdateRe.exec(stripped)) !== null) {
        return `Detected "for" loop where "${match[1]}" is never modified (e.g., "${match[1]}" instead of "${match[1]}++"). This will create an infinite loop.`;
    }
    return null;
}
function buildHtmlDoc(jsCode) {
    let topHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body{font-family:'Segoe UI',system-ui,sans-serif;padding:20px;color:#1a1a1a;
       font-size:14px;line-height:1.7;margin:0;}
  h1,h2,h3{margin:.4em 0 .6em;}p{margin:.5em 0;}
  code,pre{font-family:monospace;background:#f4f4f4;padding:1px 5px;border-radius:3px;}
  pre{padding:10px;overflow:auto;}
</style>
</head>
<body>
${SHIM}
<script>
`;
    const lineOffset = topHtml.split('\n').length;
    return topHtml + `window.__pgLineOffset = ${lineOffset};\n` + jsCode + `\n</script>\n</body>\n</html>`;
}
function injectShimIntoHtml(htmlCode) {
    const shimLines = SHIM.split('\n').length - 1 + 2; // +2 for the script tags below
    const injectCode = `\n<script>window.__pgLineOffset = ${shimLines};</script>\n`;
    if (/<head[\s>]/i.test(htmlCode)) {
        return htmlCode.replace(/(<head[^>]*>)/i, '$1\n' + SHIM + injectCode);
    }
    else if (/<body[\s>]/i.test(htmlCode)) {
        return htmlCode.replace(/(<body[^>]*>)/i, '$1\n' + SHIM + injectCode);
    }
    else {
        return SHIM + injectCode + htmlCode;
    }
}
function activate(context) {
    // Start HTTP Server on an ephemeral port locally
    server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (!req.url) {
            res.writeHead(404);
            res.end();
            return;
        }
        // Strip cache-busting query params if present
        const urlPath = decodeURIComponent(req.url.split('?')[0] || '/');
        // ── Live Reload SSE Endpoint ──
        if (urlPath === '/__live_reload') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });
            res.write('retry: 1000\n\n');
            sseClients.add(res);
            req.on('close', () => sseClients.delete(res));
            return;
        }
        // ── Synchronous Dialog Interception ──
        if (urlPath === '/__sync_dialog') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const urlParams = new URL(req.url || '', `http://${req.headers.host}`).searchParams;
                    const type = urlParams.get('type') || 'alert';
                    if (!panel) {
                        res.writeHead(500);
                        res.end();
                        return;
                    }
                    // Relay to Webview (main.js)
                    panel.webview.postMessage({
                        command: 'show_dialog',
                        dialogType: type,
                        msg: data.msg,
                        def: data.def
                    });
                    // Block HTTP response until Webview answers
                    activeDialogResolver = (val) => {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ val: val }));
                        activeDialogResolver = null;
                    };
                }
                catch (e) {
                    res.writeHead(500);
                    res.end();
                }
            });
            return;
        }
        // Determine the exact URL path expected for the currently running file
        const runFilePath = currentRunData ? '/' + currentRunData.relativePath : '/';
        // ROOT PATH: Serve the explicitly run file (with shim injected)
        if (urlPath === '/' || urlPath === runFilePath || (runFilePath === '/index.html' && urlPath === '/')) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            if (!currentRunData) {
                res.end('<!DOCTYPE html><html><body>No code to run.</body></html>');
                return;
            }
            let html = '';
            if (currentRunData.language === 'html') {
                html = injectShimIntoHtml(currentRunData.code);
            }
            else {
                html = buildHtmlDoc(currentRunData.code);
            }
            res.end(html);
            return;
        }
        if (urlPath === '/favicon.ico') {
            res.writeHead(204);
            res.end();
            return;
        }

        // ADJACENT FILES: Serve other assets relative to the active file folder or workspace root
        if (currentRunData && currentRunData.workspaceRoot && urlPath !== '/') {
            try {
                const normalizedPath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
                const currentFileDir = path.dirname(path.join(currentRunData.workspaceRoot, currentRunData.relativePath));
                
                let filePath = path.join(currentFileDir, normalizedPath);
                if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
                    filePath = path.join(currentRunData.workspaceRoot, normalizedPath);
                }

                const rel = path.relative(currentRunData.workspaceRoot, filePath);
                if (rel.startsWith('..') || path.isAbsolute(rel)) {
                    res.writeHead(403);
                    res.end('Forbidden');
                    return;
                }
                if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                    const ext = path.extname(filePath).toLowerCase();
                    const mimeTypes = {
                        '.js': 'text/javascript',
                        '.css': 'text/css',
                        '.json': 'application/json',
                        '.png': 'image/png',
                        '.jpg': 'image/jpeg',
                        '.jpeg': 'image/jpeg',
                        '.gif': 'image/gif',
                        '.svg': 'image/svg+xml',
                        '.html': 'text/html',
                        '.woff': 'font/woff',
                        '.woff2': 'font/woff2',
                        '.ttf': 'font/ttf'
                    };
                    // Inject SHIM into adjacent HTML files so heartbeat + console work on navigation
                    if (ext === '.html') {
                        const htmlContent = fs.readFileSync(filePath, 'utf8');
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(injectShimIntoHtml(htmlContent));
                    }
                    else {
                        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
                        fs.createReadStream(filePath).pipe(res);
                    }
                    return;
                }
            }
            catch (e) {
                console.error('Error serving file:', e);
            }
        }
        res.writeHead(404);
        res.end();
    });
    server.listen(0, '127.0.0.1', () => {
        const address = server?.address();
        if (address) {
            serverPort = address.port;
        }
    });
    function extractHtmlTitle(code) {
        const match = code.match(/<title[^>]*>([^<]+)<\/title>/i);
        return match ? match[1].trim() : null;
    }
    function sendRun(code, filename, language, workspaceRoot, relativePath) {
        currentRunData = { code, filename, language, workspaceRoot, relativePath };
        triggerLiveReload();
        if (!panel)
            return;
        // Update panel title to reflect the HTML <title> tag or fallback to filename
        if (language === 'html') {
            const htmlTitle = extractHtmlTitle(code);
            panel.title = htmlTitle ? htmlTitle : `${filename} — JS Live Preview`;
        }
        else {
            panel.title = `${filename} — JS Live Preview`;
        }
        const msg = { command: 'run', filename, language, port: serverPort, relativePath };
        if (isWebviewReady) {
            panel.webview.postMessage(msg);
        }
        else {
            pendingRun = { code, filename, language, workspaceRoot, relativePath };
        }
    }
    async function openAndRun(editor) {
        const code = editor.document.getText();
        const filename = path.basename(editor.document.fileName);
        const language = editor.document.languageId;
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        const workspaceRoot = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(editor.document.fileName);
        let relativePath = path.relative(workspaceRoot, editor.document.fileName).replace(/\\/g, '/');
        if (!relativePath || relativePath.startsWith('..')) {
            relativePath = filename;
        }
        // --- Layer 1: Static Infinite Loop Detection ---
        if (language === 'javascript' || language === 'typescript') {
            const warning = detectInfiniteLoop(code);
            if (warning) {
                const choice = await vscode.window.showWarningMessage(`⚠️ Infinite Loop Warning\n\n${warning}\n\nRunning this code may freeze VS Code and require a restart.`, { modal: true }, 'Run Anyway', 'Cancel');
                if (choice !== 'Run Anyway') {
                    return;
                }
            }
        }
        if (!panel) {
            isWebviewReady = false;
            panel = vscode.window.createWebviewPanel('jsLivePreview', language === 'html' ? (extractHtmlTitle(code) || `${filename} - Live Preview`) : `${filename} - Live Preview`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(context.extensionPath, 'media'))
                ],
                retainContextWhenHidden: true,
            });
            panel.iconPath = {
                light: vscode.Uri.file(path.join(context.extensionPath, 'media', 'logo.png')),
                dark: vscode.Uri.file(path.join(context.extensionPath, 'media', 'logo.png')),
            };
            panel.webview.html = getWebviewContent(panel.webview, context);
            panel.webview.onDidReceiveMessage((msg) => {
                if (msg.type === 'ready') {
                    isWebviewReady = true;
                    if (pendingRun) {
                        currentRunData = pendingRun;
                        // Update title for the pending run
                        if (panel) {
                            const pr = pendingRun;
                            panel.title = pr.language === 'html'
                                ? (extractHtmlTitle(pr.code) || `${pr.filename} - Live Preview`)
                                : `${pr.filename} - Live Preview`;
                        }
                        panel?.webview.postMessage({
                            command: 'run',
                            filename: pendingRun.filename,
                            language: pendingRun.language,
                            port: serverPort,
                            relativePath: pendingRun.relativePath
                        });
                        pendingRun = null;
                    }
                }
                else if (msg.type === 'dialog_result') {
                    if (activeDialogResolver) {
                        activeDialogResolver(msg.val);
                    }
                }
                else if (msg.type === 'jump_to_line') {
                    if (currentRunData) {
                        const filePath = path.join(currentRunData.workspaceRoot, currentRunData.relativePath);
                        const uri = vscode.Uri.file(filePath);
                        const ln = Math.max(0, (msg.line || 1) - 1);
                        vscode.window.showTextDocument(uri, {
                            selection: new vscode.Range(ln, 0, ln, 0),
                            viewColumn: vscode.ViewColumn.One,
                            preserveFocus: false
                        });
                    }
                }
                else if (msg.type === 'open_external') {
                    if (serverPort) {
                        vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${serverPort}/`));
                    }
                }
            }, undefined, context.subscriptions);
            panel.onDidDispose(() => {
                panel = undefined;
                isWebviewReady = false;
                pendingRun = null;
            }, null, context.subscriptions);
            pendingRun = { code, filename, language, workspaceRoot, relativePath };
        }
        else {
            panel.reveal(vscode.ViewColumn.Beside, true);
            sendRun(code, filename, language, workspaceRoot, relativePath);
        }
    }
    const runCommand = vscode.commands.registerCommand('jsLivePreview.run', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('Live Preview: No active file to run.');
            return;
        }
        const openLocation = vscode.workspace.getConfiguration('jsLivePreview').get('openLocation');
        openAndRun(editor);
        if (openLocation === 'externalBrowser') {
            setTimeout(() => {
                if (serverPort) {
                    vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${serverPort}/`));
                }
            }, 300);
        }
    });
    const clearCommand = vscode.commands.registerCommand('jsLivePreview.clear', () => {
        panel?.webview.postMessage({ command: 'clear' });
    });
    const openExternalCommand = vscode.commands.registerCommand('jsLivePreview.openExternal', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('Live Preview: No active file to open.');
            return;
        }
        if (!serverPort) {
            await openAndRun(editor);
        } else {
            const filename = path.basename(editor.document.fileName);
            const language = editor.document.languageId;
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            const workspaceRoot = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(editor.document.fileName);
            let relativePath = path.relative(workspaceRoot, editor.document.fileName).replace(/\\/g, '/');
            if (!relativePath || relativePath.startsWith('..')) {
                relativePath = filename;
            }
            const code = editor.document.getText();
            currentRunData = { code, filename, language, workspaceRoot, relativePath };
        }
        if (serverPort) {
            vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${serverPort}/`));
        }
    });
    const onEditorChange = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && panel && editor.viewColumn && editor.viewColumn !== vscode.ViewColumn.One) {
            vscode.window.showTextDocument(editor.document, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
        }
    });
    const onSave = vscode.workspace.onDidSaveTextDocument((doc) => {
        if (!currentRunData)
            return;
        if (doc.fileName === path.join(currentRunData.workspaceRoot, currentRunData.relativePath)) {
            currentRunData.code = doc.getText();
        }
        sendRun(currentRunData.code, currentRunData.filename, currentRunData.language, currentRunData.workspaceRoot, currentRunData.relativePath);
    });

    let liveTypingTimer = null;
    const onChangeType = vscode.workspace.onDidChangeTextDocument((e) => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor || e.document !== activeEditor.document) return;
        const lang = activeEditor.document.languageId;
        if (!SUPPORTED_LANGS.includes(lang)) return;

        if (liveTypingTimer) clearTimeout(liveTypingTimer);
        liveTypingTimer = setTimeout(() => {
            const filename = path.basename(activeEditor.document.fileName);
            const relativePath = vscode.workspace.asRelativePath(activeEditor.document.uri);
            const workspaceRoot = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)?.uri.fsPath || path.dirname(activeEditor.document.fileName);
            const code = activeEditor.document.getText();
            currentRunData = { code, filename, language: lang, workspaceRoot, relativePath };
            sendRun(code, filename, lang, workspaceRoot, relativePath);
        }, 300);
    });

    context.subscriptions.push(runCommand, clearCommand, openExternalCommand, onEditorChange, onSave, onChangeType);
}
function getWebviewContent(webview, context) {
    const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'style.css')));
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'main.js')));
    const errorIconUri = webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'error.png')));
    const nonce = getNonce();
    const csp = [
        `default-src 'none'`,
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `img-src ${webview.cspSource} https: data:`,
        `script-src 'nonce-${nonce}' ${webview.cspSource} 'unsafe-inline' 'unsafe-eval' blob:`,
        `frame-src http://127.0.0.1:* https:`,
        `connect-src ${webview.cspSource} blob: https:`,
    ].join('; ');
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JS Live Preview</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body data-error-icon="${errorIconUri}">

  <!-- ═══ Status Bar ═══ -->
  <div class="statusbar" id="statusbar">
    <span class="status-dot idle" id="statusDot"></span>
    <span class="status-file" id="statusFile">No file run yet — press ▶ to start</span>
    <div class="statusbar-actions">
      <button class="icon-btn clear-btn" id="openExternalBtn" title="Open preview in external browser window">
        🌐 Open in Browser
      </button>
      <button class="icon-btn clear-btn" id="clearBtn" title="Clear console">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
          <path d="M10 3h3v1h-1v9l-1 1H4l-1-1V4H2V3h3V2a1 1 0 011-1h3a1 1 0 011 1v1zm-4-1v1h3V2H6zM4 13h7V4H4v9zm2-8H5v7h1V5zm1 0h1v7H7V5zm2 0h1v7H9V5z"/>
        </svg>
        Clear
      </button>
    </div>
  </div>

  <!-- ═══ Main Layout ═══ -->
  <div class="main">

    <!-- Preview Panel -->
    <div class="preview-section" id="previewSection">
      <div class="section-header">
        <span class="header-dot preview-dot"></span>
        <span class="header-label">Preview</span>
        <span class="preview-hint" id="previewHint"></span>
        <div class="resp-toolbar">
          <button class="resp-btn active" data-width="100%" title="Desktop (full width)">🖥</button>
          <button class="resp-btn" data-width="768px" title="Tablet (768px)">📟</button>
          <button class="resp-btn" data-width="375px" title="Mobile (375px)">📱</button>
        </div>
      </div>
      <div class="preview-wrap" id="previewWrap">
        <div class="empty-preview" id="emptyPreview">
          <div class="empty-icon">▶</div>
          <div class="empty-text">Press the <strong>Run</strong> button<br>or open a JS / HTML file</div>
        </div>
        <iframe
          class="preview-frame"
          id="preview"
          sandbox="allow-scripts allow-forms allow-modals allow-same-origin allow-popups"
          title="Live preview"
          style="display:none"
        ></iframe>
      </div>
    </div>

    <!-- Vertical resize handle -->
    <div class="resize-handle-v" id="resizeHandleV"></div>

    <!-- Console Panel -->
    <div class="console-section" id="consoleSection">
      <div class="console-header" id="consoleHeader">
        <span class="console-toggle" id="consoleToggle" title="Toggle Console">▼</span>
        <span class="header-dot console-dot"></span>
        <span class="header-label">Console</span>
        <span class="badge" id="badge"></span>
        <span class="count-pill error-count" id="errorCount">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7"/><path fill="var(--pg-panel,#161b22)" d="M7.25 4h1.5v5h-1.5zm0 6h1.5v1.5h-1.5z"/></svg>
          <span>0</span>
        </span>
        <span class="count-pill warn-count" id="warnCount">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8.22 1.75a.25.25 0 00-.44 0L1.03 13.5c-.05.09 0 .2.1.2H14.87c.1 0 .15-.11.1-.2L8.22 1.75z"/><path fill="var(--pg-panel,#161b22)" d="M7.25 6h1.5v4h-1.5zm0 5h1.5v1.5h-1.5z"/></svg>
          <span>0</span>
        </span>
      </div>
      <div class="console-filters" id="consoleFilters">
        <button class="filter-btn active" data-filter="all">All</button>
        <button class="filter-btn" data-filter="log">Log</button>
        <button class="filter-btn" data-filter="warn">Warn</button>
        <button class="filter-btn" data-filter="error">Error</button>
        <button class="filter-btn" data-filter="info">Info</button>
      </div>
      <div class="console-log" id="consoleLog">
        <div class="console-empty" id="emptyState">
          Console output will appear here after you run your code
        </div>
      </div>
      <div class="console-repl" id="consoleRepl">
        <span class="repl-prompt">›</span>
        <input type="text" id="replInput" class="repl-input" placeholder="Evaluate JavaScript… (Enter to run)" autocomplete="off" spellcheck="false">
        <button class="repl-run-btn" id="replBtn" title="Run">▶</button>
      </div>
    </div>

  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
function getNonce() {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}
function deactivate() {
    panel?.dispose();
    for (const client of sseClients) {
        try { client.end(); } catch (e) {}
    }
    sseClients.clear();
    if (server) {
        server.close();
    }
}
//# sourceMappingURL=extension.js.map