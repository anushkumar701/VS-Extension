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
const assert = __importStar(require("assert"));
const vscode = __importStar(require("vscode"));
suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');
    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('WikanAdnyana.cobee-playground'));
    });
    test('Should register commands', async () => {
        const ext = vscode.extensions.getExtension('WikanAdnyana.cobee-playground');
        await ext?.activate();
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('cobeePlayground.run'), "Run command is not registered");
        assert.ok(commands.includes('cobeePlayground.clear'), "Clear command is not registered");
    });
    test('Should activate and run', async () => {
        // Open a new untitled JS file to test the run command
        const doc = await vscode.workspace.openTextDocument({
            content: 'console.log("hello test");',
            language: 'javascript'
        });
        await vscode.window.showTextDocument(doc);
        // Execute the command to open the panel
        await vscode.commands.executeCommand('cobeePlayground.run');
        // Check if the command ran successfully without throwing
        assert.ok(true);
    });
});
//# sourceMappingURL=extension.test.js.map