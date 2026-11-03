const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function activate(context) {
    const provider = new DcfaEditorProvider(context);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider('dcfa.editor', provider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // Команда сохранения из webview (вызывается по Ctrl/Cmd+S через keybinding)
    context.subscriptions.push(vscode.commands.registerCommand('dcfa.editor.save', () => {
        provider.requestActiveSave();
    }));

    // Команда: создать новый DCFA файл с пустым заголовком
    context.subscriptions.push(vscode.commands.registerCommand('dcfaEditor.newFile', async () => {
        const uri = await vscode.window.showSaveDialog({
            filters: { 'DCFA Files': ['dcfa', 'txt'] },
            defaultUri: vscode.Uri.file('untitled.dcfa')
        });
        if (!uri) return;
        const content = '0 0 0 0\n';
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
        await vscode.workspace.openTextDocument(uri);
        await vscode.commands.executeCommand('vscode.openWith', uri, 'dcfa.editor');
        vscode.window.showInformationMessage(`DCFA: создан файл ${uri.fsPath}`);
    }));

}

class DcfaEditorProvider {
    constructor(context) {
        this.context = context;
        this._templateCache = null;
        this._panels = new Map(); // panelId -> { panel, document, lastState }
    }

    _trackPanel(panel, document) {
        const id = `${Date.now()}-${Math.random()}`;
        const entry = { panel, document, lastState: null };
        this._panels.set(id, entry);
        // Отслеживаем последнее состояние из webview для Ctrl+S
        panel.onDidDispose(() => this._panels.delete(id));
        return entry;
    }

    requestActiveSave() {
        // Выбираем последнюю добавленную панель (активную)
        const entries = Array.from(this._panels.values());
        const active = entries[entries.length - 1];
        if (!active) return;
        const { panel, document, lastState } = active;
        const data = lastState || this.parseDcfa(document.getText());
        this.updateDocument(document, data).then(async () => {
            const ok = await document.save();
            if (ok) panel.webview.postMessage({ type: 'saved' });
        });
    }

    async resolveCustomTextEditor(document, webviewPanel, _token) {
        webviewPanel.webview.options = { enableScripts: true };
        webviewPanel.webview.html = await this.getHtmlForWebview(webviewPanel.webview);

        const panelEntry = this._trackPanel(webviewPanel, document);

        const updateWebview = () => {
            const text = document.getText();
            const jsonData = this.parseDcfa(text);
            webviewPanel.webview.postMessage({ type: 'update', data: jsonData });
        };

        webviewPanel.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case 'save':
                    panelEntry.lastState = message.data;
                    this.updateDocument(document, message.data).then(() => {
                        // Подтверждаем сохранение в webview
                        webviewPanel.webview.postMessage({ type: 'saved' });
                    });
                    return;
                case 'ready':
                    updateWebview();
                    return;
                case 'requestDocumentSave': {
                    // Сохраняем состояние webview в документ и записываем файл на диск
                    await this.updateDocument(document, message.data || this.parseDcfa(document.getText()));
                    const ok = await document.save();
                    if (ok) {
                        webviewPanel.webview.postMessage({ type: 'saved' });
                    } else {
                        vscode.window.showWarningMessage('DCFA: не удалось сохранить файл');
                    }
                    return;
                }
                case 'exportJson': {
                    const text = JSON.stringify(this.parseDcfa(document.getText()), null, 2);
                    await this._saveWithDialog(webviewPanel, 'json', 'JSON files (*.json)', text);
                    return;
                }
                case 'exportTxt': {
                    const text = this.updateDocumentToString(message.data || this.parseDcfa(document.getText()));
                    await this._saveWithDialog(webviewPanel, 'txt', 'Text Files (*.txt)', text + '\n');
                    return;
                }
                case 'importTxt': {
                    const uris = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        canSelectMany: false,
                        openLabel: 'Импортировать',
                        filters: { 'DCFA/Text files': ['dcfa', 'txt'] }
                    });
                    if (!uris || uris.length === 0) return;
                    try {
                        const content = Buffer.concat(
                            await vscode.workspace.fs.readFile(uris[0])
                        ).toString('utf-8');
                        const jsonData = this.parseDcfa(content);
                        await this.updateDocument(document, jsonData);
                        webviewPanel.webview.postMessage({ type: 'update', data: jsonData });
                        vscode.window.showInformationMessage(
                            `DCFA: импортирован файл ${path.basename(uris[0].fsPath)}`);
                    } catch (err) {
                        vscode.window.showErrorMessage(`DCFA: ошибка импорта — ${err.message}`);
                    }
                    return;
                }
                case 'copyToClipboard': {
                    await vscode.env.clipboard.writeText(message.text || '');
                    vscode.window.setStatusBarMessage('DCFA: скопировано в буфер обмена', 2000);
                    return;
                }
                case 'showMessage': {
                    const text = message.text || '';
                    if (message.severity === 'error') vscode.window.showErrorMessage(`DCFA: ${text}`);
                    else if (message.severity === 'warning') vscode.window.showWarningMessage(`DCFA: ${text}`);
                    else vscode.window.showInformationMessage(`DCFA: ${text}`);
                    return;
                }
            }
        });

        // Обработка закрытия вкладки
        webviewPanel.onDidDispose(() => {
            // Здесь можно добавить проверку isDirty, но для простоты пока пропускаем
            // VSCode сам обработает несохранённые изменения через стандартный механизм
        });

        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) {
                // Если документ изменился извне (не через наш редактор), обновляем webview
                // Но только если это не наше изменение
                // Для простоты пока отключаем автообновление
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });

        updateWebview();
    }

    parseDcfa(text) {
        const data = { header: null, blocks: [] };
        let currentBlock = null;
        let currentTask = null;

        const lines = text.split(/\r?\n/);
        
        for (let line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const tokens = trimmed.split(/\s+/);
            const numbers = [];
            
            for (let token of tokens) {
                if (/^-?\d+$/.test(token) || /^[0-9a-fA-F]+$/.test(token)) {
                    numbers.push(token);
                } else {
                    break;
                }
            }

            if (numbers.length === 0) continue;

            if (numbers.length === 4 && !data.header) {
                data.header = {
                    NB: numbers[0],
                    NCB: numbers[1],
                    NTSK: numbers[2],
                    N128bW: numbers[3]
                };
            } else if (numbers.length === 7) {
                currentBlock = {
                    header: {
                        IB: numbers[0],
                        NTskB: numbers[1],
                        N128bWB: numbers[2],
                        CSCC: numbers[3],
                        CRq: numbers[4],
                        CClc: numbers[5],
                        CdTsk: numbers[6]
                    },
                    tasks: []
                };
                data.blocks.push(currentBlock);
                currentTask = null;
            } else if ((numbers.length === 5 || numbers.length === 6) && currentBlock) {
                currentTask = {
                    header: {
                        IB: numbers[0],
                        ITsk: numbers[1],
                        CETsk: numbers[2],
                        TpTsk: parseInt(numbers[3]),
                        N128bWTsk: numbers[4]
                    },
                    data: []
                };
                currentBlock.tasks.push(currentTask);
            } else if (numbers.length === 11 && currentTask) {
                currentTask.data.push({
                    nn: numbers[2],
                    words: numbers.slice(3, 11)
                });
            }
        }

        if (!data.header) {
            data.header = { NB: '0', NCB: '0', NTSK: '0', N128bW: '0' };
        }

        return data;
    }

    updateDocumentToString(jsonData) {
        let lines = [];
        
        if (jsonData.header) {
            const h = jsonData.header;
            lines.push(`${h.NB} ${h.NCB} ${h.NTSK} ${h.N128bW}`);
        }
        
        for (let block of jsonData.blocks) {
            const bh = block.header;
            lines.push(`${bh.IB} ${bh.NTskB} ${bh.N128bWB} ${bh.CSCC} ${bh.CRq} ${bh.CClc} ${bh.CdTsk}`);
            
            for (let task of block.tasks) {
                const th = task.header;
                lines.push(`${th.IB} ${th.ITsk} ${th.CETsk} ${th.TpTsk} ${th.N128bWTsk}`);
                
                for (let d of task.data) {
                    lines.push(`${th.IB} ${th.ITsk} ${d.nn} ${d.words.join(' ')}`);
                }
            }
        }
        
        return lines.join('\n');
    }

    updateDocument(document, jsonData) {
        const text = this.updateDocumentToString(jsonData);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
        return vscode.workspace.applyEdit(edit);
    }

    async _saveWithDialog(webviewPanel, ext, label, content) {
        const defaultName = webviewPanel.title.replace(/\.[a-zA-Z]+$/, '') + '.' + ext;
        const target = await vscode.window.showSaveDialog({
            filters: { [label]: [ext] },
            saveLabel: 'Экспортировать',
            defaultUri: vscode.Uri.file(defaultName)
        });
        if (!target) return false;
        try {
            await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf-8'));
            vscode.window.showInformationMessage(`DCFA: файл сохранён — ${target.fsPath}`);
            return true;
        } catch (err) {
            vscode.window.showErrorMessage(`DCFA: ошибка сохранения — ${err.message}`);
            return false;
        }
    }

    async getHtmlForWebview(webview) {
        const templatePath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'dcfa-editor.html');
        const scriptPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js');
        const stylePath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'styles.css');

        const scriptUri = webview.asWebviewUri(scriptPath);
        const styleUri = webview.asWebviewUri(stylePath);
        const nonce = getNonce();

        if (!this._templateCache) {
            const rawHtml = fs.readFileSync(templatePath.fsPath, 'utf-8');
            this._templateCache = rawHtml;
        }

        return this._templateCache
            .replace(/#{cspSource}/g, webview.cspSource)
            .replace(/#{nonce}/g, nonce)
            .replace(/#{scriptUri}/g, scriptUri)
            .replace(/#{styleUri}/g, styleUri);
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function deactivate() {}
module.exports = { activate, deactivate };