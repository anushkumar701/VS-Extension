# JS Live Preview — Comprehensive Technical Architecture Document

This document provides an exhaustive, low-level technical overview of the "JS Live Preview" Visual Studio Code extension. It details how the VS Code Extension Host environment operates, the specific VS Code APIs leveraged, how our custom functionalities are constructed on top of them, and the complex interoperability required to bridge isolated execution layers safely.

---

## 1. The VS Code Extension Environment: A Primer

To understand how this extension is built, one must first understand the strict architectural boundaries enforced by Visual Studio Code.

VS Code is an Electron-based application running multiple Node.js and Chromium processes. Extensions do **not** run in the main UI thread. Instead, they run in a separate background process called the **Extension Host**. 

When an extension needs to display custom UI (like our Live Preview panel), it must spawn a **Webview**. A Webview is essentially an isolated iframe rendered by Chromium, completely segregated from the Extension Host. 

Because of this architecture, an extension relies heavily on **Inter-Process Communication (IPC)**. The Extension Host (Node.js) cannot touch the DOM of the Webview, and the Webview (Browser JS) cannot access Node.js APIs or the file system. They can only communicate by passing serialized JSON messages back and forth.

---

## 2. Core VS Code APIs Utilized

Our extension relies on the `vscode` API module provided by the Extension Host. Here are the core APIs driving the functionality:

*   **`vscode.commands.registerCommand(id, callback)`**: Hooks the extension into VS Code's Command Palette and UI buttons. We use this to bind `jsLivePreview.run` to the "Play" button in the editor title bar.
*   **`vscode.window.activeTextEditor`**: Retrieves a reference to the currently focused text editor, allowing us to read the active user code via `editor.document.getText()`.
*   **`vscode.window.createWebviewPanel(...)`**: Spawns the Webview alongside the editor (`vscode.ViewColumn.Beside`). It configures the panel's title, initial webview-specific options (like `enableScripts: true`), and the strict directories it is allowed to load local files from (`localResourceRoots`).
*   **`webviewPanel.webview.postMessage(message)` / `webviewPanel.webview.onDidReceiveMessage(callback)`**: The IPC bridge between the Node.js Extension Host and the sandboxed Webview HTML/JS frontend.
*   **`webviewPanel.webview.asWebviewUri(uri)`**: Converts standard local file paths (e.g., `media/style.css`) into secure internal VS Code URIs (`vscode-webview-resource://...`) that bypass Webview security restrictions.
*   **`vscode.workspace.onDidChangeTextDocument`**: A reactive event listener that fires whenever the user types in the active file. We use this to instantly auto-preview text changes with a 300ms debounce timer.
*   **`vscode.workspace.onDidSaveTextDocument`**: Fires when a file is saved. We use this to auto-refresh the preview when the user hits `Ctrl+S`.

---

## 3. Architecture & Functional Components

To safely execute arbitrary user code and capture its `console` output, the extension is split into three highly specialized execution layers.

### Layer A: The Extension Backend (`out/extension.js`)
Executes in: **VS Code Extension Host (Node.js)**

This is the brain of the operation. It manages the VS Code UI lifecycle and handles the heavyweight lifting.
1.  **State Management:** Holds references to the active `WebviewPanel`, tracks whether the webview has finished booting (`isWebviewReady`), and caches the latest code executed (`currentRunData`).
2.  **The Local HTTP Server (The Root Execution Fix):**
    *   VS Code Webviews enforce severely restricted Content Security Policies (CSP). If we execute user code inside a standard iframe with a `srcdoc` or a Blob URL, the iframe is flagged as an opaque `null` origin.
    *   A `null` origin blocks `window.parent.postMessage` due to cross-origin security rules, destroying our ability to relay `console.log` back to our custom console pane.
    *   **The Solution:** The backend uses Node.js's native `http` module to spawn an ephemeral local server (`http.createServer()`). It binds to `127.0.0.1` on port `0` (which delegates port allocation to the OS, avoiding collisions).
    *   When the server receives an HTTP GET request to its root (`/`), it takes the cached `currentRunData` (the user's code), injects the **Console Interceptor Shim**, wraps it in a valid HTML5 skeleton, and serves it back with a `200 OK` response.
3.  **Command Orchestration:** When `jsLivePreview.run` is triggered, it extracts the `code`, `filename`, and `languageId`. It either boots the Panel or reveals it, then sends an IPC message to Layer B containing the `serverPort` where the code is waiting to be served.

### Layer B: The Webview Live Preview UI (`media/main.js` & `media/style.css`)
Executes in: **VS Code Webview (Chromium Browser Engine)**

This layer provides the graphical interface the user interacts with (Preview pane + Console pane).
1.  **Strict Content Security Policy (CSP):** The HTML generated in Layer A strictly policies what Layer B can do. We use cryptographic `nonce` tokens to permit only our `main.js` to execute. We explicitly whitelist our local HTTP server with `frame-src http://127.0.0.1:*`.
2.  **Webview Bridge Initialization:** On startup, `main.js` calls `acquireVsCodeApi()` and immediately sends a `{ type: 'ready' }` message to Layer A to finalize the handshake.
3.  **UI Event Loop:**
    *   **Incoming Data:** Listens to `window.addEventListener('message')`. When it receives the `run` command containing the `port` from Layer A, it updates the "Running..." status UI.
    *   **Iframe Bootstrapping:** It sets the `src` attribute of the hidden `<iframe id="preview">` to `http://127.0.0.1:[PORT]/?t=[TIMESTAMP]`. The query parameter `?t=` acts as a cache-buster guaranteeing the browser requests a fresh execution environment rather than loading from disk cache.
4.  **Custom Console Rendering Engine:**
    *   When a `log` message arrives from Layer C (the iframe), it parses the serialized string, determines the level (`log`, `warn`, `error`, `info`), updates diagnostic badges, and dynamically builds precise DOM structures representing the log output complete with timestamps and color-coded icons.

### Layer C: The Sandboxed Execution Context (User Code)
Executes in: **Nested `<iframe sandbox="...">` (Isolated Origin)**

This is where the actual user JavaScript or HTML renders and executes.
1.  **The Console Interceptor Shim:**
    *   Before serving the file, Layer A injects a `<script>` tag at the absolute top of the HTML tree. 
    *   This shim aggressively overtakes the native browser `console` object.
    *   `console.log`, `console.warn`, etc., are replaced with proxy functions. When the user's code calls `console.log({ foo: 'bar' })`, the shim serializes the object safely (to avoid recursive cloning errors required by the DOM messaging algorithm) and invokes `window.parent.postMessage({ type: 'log', ... }, '*')`.
    *   It also binds to `window.onerror` and `window.addEventListener('unhandledrejection')` to catch syntax errors, reference errors, and unhandled Promises that the user triggers, ensuring crash data flows back to the UI.
2.  **Iframe Sandbox Enforcement:**
    *   The iframe explicitly uses `sandbox="allow-scripts allow-forms allow-modals"`.
    *   Noticeably absent is `allow-top-navigation`. This prevents malicious or badly written user code from redirecting the parent Webview or breaking out of the sandbox.

---

## 4. Interoperability & Communication Flow (Step-by-Step)

The life blood of the extension is the asynchronous communication between Node.js, the Webview, and the Iframe.

**Scenario:** The user has `app.js` open. It contains `console.log("Hello OS!");`. They hit the "Run" button in the VS Code editor title bar.

1.  **[VS Code Shell]** Fires the `jsLivePreview.run` command.
2.  **[Backend - Node.js]** `extension.js` retrieves the text string `console.log("Hello OS!");` from the active editor.
3.  **[Backend - Node.js]** Caches the script payload locally to memory (`currentRunData`).
4.  **[Backend -> Webview]** `extension.js` calls `panel.webview.postMessage({ command: 'run', filename: 'app.js', port: 43210 })`.
5.  **[Webview]** `main.js` catches the IPC message. It updates the UI status dot to yellow (running).
6.  **[Webview -> HTTP Server]** `main.js` sets the `<iframe src>` to `http://127.0.0.1:43210/?t=1658402910`. The Chromium engine initiates an HTTP network request.
7.  **[HTTP Server -> Webview (Iframe)]** `extension.js` receives the request, wraps the `app.js` code in the HTML skeleton + the Console Shim script, and serves it globally.
8.  **[Iframe Context]** The HTML parses. First, the Shadow Shim evaluates, hijacking the `console` object. Next, the user's script evaluates: `console.log("Hello OS!");`.
9.  **[Iframe Context -> Webview]** The Shim intercepts the string `"Hello OS!"`, processes it, and fires `window.parent.postMessage({ type: 'log', level: 'log', msg: 'Hello OS!' }, '*')`.
10. **[Webview]** `main.js`'s top-level window catches the `message` event. Seeing `type: 'log'`, it routes to `addLogEntry('log', 'Hello OS!')`.
11. **[Webview]** A DOM element simulating a terminal entry is dynamically created and appended to `#consoleLog`. The scrollbar shifts to the bottom.

## 5. Extensibility and Future Considerations

By decoupling the execution engine entirely from the webview file protocol via the local HTTP server, the extension architecture allows high extensibility. Features like real-time Hot Module Replacement (HMR) or supporting complex source-mapped transpiled languages are strictly isolated architectural upgrades that will not break the visualization and sandbox boundaries.
