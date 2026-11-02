const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function activate(context) {
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider('dcfa.editor', new DcfaEditorProvider(context), {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );
}

class DcfaEditorProvider {
    constructor(context) {
        this.context = context;
        this._templateCache = null;
    }

    async resolveCustomTextEditor(document, webviewPanel, _token) {
        webviewPanel.webview.options = { enableScripts: true };
        webviewPanel.webview.html = await this.getHtmlForWebview(webviewPanel.webview);

        const updateWebview = () => {
            const text = document.getText();
            const jsonData = this.parseDcfa(text);
            webviewPanel.webview.postMessage({ type: 'update', data: jsonData });
        };

        webviewPanel.webview.onDidReceiveMessage(message => {
            switch (message.type) {
                case 'save':
                    this.updateDocument(document, message.data).then(() => {
                        // Подтверждаем сохранение в webview
                        webviewPanel.webview.postMessage({ type: 'saved' });
                    });
                    return;
                case 'ready':
                    updateWebview();
                    return;
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

    updateDocument(document, jsonData) {
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
        
        const text = lines.join('\n');
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
        return vscode.workspace.applyEdit(edit);
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