// media/main.js
const vscode = acquireVsCodeApi();

let state = { header: {}, blocks: [] };
let originalState = null; // Исходное состояние для сравнения
let currentEdit = { bIdx: -1, tIdx: -1, dIdx: -1 };
let activeTab = 0;
let isDirty = false; // Флаг несохранённых изменений

// ==================== ДЕЛЕГИРОВАНИЕ СОБЫТИЙ ====================
document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const bIdx = parseInt(target.dataset.bidx);
    const tIdx = parseInt(target.dataset.tidx);
    const dIdx = parseInt(target.dataset.didx);
    const tabId = parseInt(target.dataset.tab);

    switch (action) {
        case 'switchTab':
            switchTab(tabId);
            break;
        case 'addObject':
            addObject(bIdx, tIdx);
            break;
        case 'editObject':
            editObject(bIdx, tIdx, dIdx);
            break;
        case 'deleteObject':
            deleteObject(bIdx, tIdx, dIdx);
            break;
        case 'saveObject':
            saveObject();
            break;
        case 'closeModal':
            closeModal();
            break;
        case 'saveFile':
            saveFile();
            break;
        case 'revertFile':
            revertFile();
            break;
        case 'exportTxt':
            exportTxt();
            break;
        case 'exportJson':
            vscode.postMessage({ type: 'exportJson' });
            break;
        case 'importTxt':
            vscode.postMessage({ type: 'importTxt' });
            break;
        case 'copyRow':
            copyRow(parseInt(target.dataset.bidx), parseInt(target.dataset.tidx), parseInt(target.dataset.didx));
            break;
        case 'duplicateRow':
            duplicateRow(parseInt(target.dataset.bidx), parseInt(target.dataset.tidx), parseInt(target.dataset.didx));
            break;
        case 'moveRow':
            moveRow(parseInt(target.dataset.bidx), parseInt(target.dataset.tidx), parseInt(target.dataset.didx), parseInt(target.dataset.dir));
            break;
        case 'decodeWords':
            decodeWordsFor(parseInt(target.dataset.bidx), parseInt(target.dataset.tidx), parseInt(target.dataset.didx));
            break;
        case 'toggleFilter':
            toggleFilter(target);
            break;
        case 'clearFilter':
            filterText = '';
            applyFilter();
            break;
    }
});

// Закрытие модалки по клику на фон
document.getElementById('objectModal').addEventListener('click', (event) => {
    if (event.target.id === 'objectModal') {
        closeModal();
    }
});

// ==================== INPLACE РЕДАКТИРОВАНИЕ ====================
document.addEventListener('change', (event) => {
    const target = event.target;
    if (!target.matches('.inline-edit')) return;

    const bIdx = parseInt(target.dataset.bidx);
    const tIdx = parseInt(target.dataset.tidx);
    const dIdx = parseInt(target.dataset.didx);
    const field = target.dataset.field;
    const wordIdx = parseInt(target.dataset.wordidx);

    const task = state.blocks[bIdx].tasks[tIdx];
    const row = task.data[dIdx];

    if (field === 'nn') {
        let val = parseInt(target.value);
        if (isNaN(val) || val < 1) {
            val = 1;
            target.value = val;
            flashInvalid(target);
        }
        row.nn = val.toString();
    } else if (field === 'word') {
        let val = target.value.trim().toUpperCase();
        val = val.replace(/[^0-9A-F]/g, '');
        if (val.length === 0) {
            val = '0000';
        } else if (val.length > 4) {
            val = val.slice(0, 4);
            flashInvalid(target);
        }
        val = val.padStart(4, '0');
        target.value = val;
        
        row.words[wordIdx] = val;
    }

    // Помечаем файл как изменённый
    markDirty();
    
    // Визуальная обратная связь
    flashSuccess(target);
});

// Глобальные горячие клавиши
document.addEventListener('keydown', (event) => {
    // Ctrl/Cmd+S — сохранение на всей странице
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveFile();
    }
});

// Обработка Enter в input
document.addEventListener('keydown', (event) => {
    const target = event.target;
    if (!target.matches('.inline-edit')) return;

    if (event.key === 'Enter') {
        event.preventDefault();
        target.blur();
        const allInputs = Array.from(document.querySelectorAll('.inline-edit'));
        const currentIdx = allInputs.indexOf(target);
        if (currentIdx >= 0 && currentIdx < allInputs.length - 1) {
            allInputs[currentIdx + 1].focus();
            allInputs[currentIdx + 1].select();
        }
    } else if (event.key === 'Escape') {
        target.blur();
        renderUI();
    } else if (event.key === 'Tab' && !event.shiftKey) {
        setTimeout(() => {
            const focused = document.activeElement;
            if (focused && focused.matches && focused.matches('.inline-edit')) {
                focused.select();
            }
        }, 0);
    }
    });

// Фокус на input — выделяем всё содержимое
document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (target.matches('.inline-edit')) {
        setTimeout(() => target.select(), 0);
    }
});

// Визуальная обратная связь
function flashSuccess(element) {
    element.classList.add('flash-success');
    setTimeout(() => element.classList.remove('flash-success'), 500);
}

function flashInvalid(element) {
    element.classList.add('flash-invalid');
    setTimeout(() => element.classList.remove('flash-invalid'), 800);
}

// ==================== DIRTY TRACKING ====================
function markDirty() {
    if (!isDirty) {
        isDirty = true;
        updateDirtyIndicator();
    }
}

function markClean() {
    isDirty = false;
    updateDirtyIndicator();
}

function updateDirtyIndicator() {
    const indicator = document.getElementById('dirtyIndicator');
    if (indicator) {
        indicator.style.display = isDirty ? 'inline-block' : 'none';
    }
    
    // Обновляем заголовок вкладки
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        const tabId = parseInt(tab.dataset.tab);
        if (tabId === activeTab) {
            const baseText = tab.textContent.replace(' ●', '');
            tab.textContent = isDirty ? baseText + ' ●' : baseText;
        }
    });
}

// ==================== СОХРАНЕНИЕ ====================
function saveFile() {
    console.log('[Webview] saveFile вызван');
    // Сначала обновляем документ, затем просим хост записать его на диск
    vscode.postMessage({ type: 'save', data: state });
    vscode.postMessage({ type: 'requestDocumentSave', data: state });
    // isDirty сбросим после подтверждения 'saved' от extension host
}

function revertFile() {
    if (isDirty) {
        showConfirmDialog('Отменить все несохранённые изменения и вернуться к последнему сохранённому состоянию?', () => {
            if (originalState) {
                state = JSON.parse(JSON.stringify(originalState));
            }
            markClean();
            renderUI();
        }, 'Откатить', 'Отмена');
    } else {
        // Нет локальных изменений — просим extension host перечитать документ
        vscode.postMessage({ type: 'showMessage', severity: 'info', text: 'Нет несохранённых изменений' });
    }
}

function exportTxt() {
    vscode.postMessage({ type: 'exportTxt', data: state });
}

// ==================== КОПИРОВАНИЕ / ДУБЛИРОВАНИЕ / ПЕРЕМЕЩЕНИЕ СТРОК ====================
function rowToText(row) {
    return `${row.nn} ${row.words.join(' ')}`;
}

function copyRow(bIdx, tIdx, dIdx) {
    const row = state.blocks[bIdx].tasks[tIdx].data[dIdx];
    vscode.postMessage({ type: 'copyToClipboard', text: rowToText(row) });
}

function duplicateRow(bIdx, tIdx, dIdx) {
    const task = state.blocks[bIdx].tasks[tIdx];
    const src = task.data[dIdx];
    task.data.splice(dIdx + 1, 0, { nn: src.nn, words: src.words.slice() });
    markDirty();
    renderUI();
}

function moveRow(bIdx, tIdx, dIdx, dir) {
    const task = state.blocks[bIdx].tasks[tIdx];
    const to = dIdx + dir;
    if (to < 0 || to >= task.data.length) return;
    const arr = task.data;
    [arr[dIdx], arr[to]] = [arr[to], arr[dIdx]];
    markDirty();
    renderUI();
}

// ==================== ФИЛЬТР ЗАДАНИЙ ====================
let filterText = '';

function toggleFilter(btn) {
    // Кнопка-переключатель панели фильтра
    const panel = document.getElementById('filterPanel');
    if (!panel) return;
    const hidden = panel.style.display === 'none';
    panel.style.display = hidden ? 'flex' : 'none';
    if (hidden) {
        const inp = document.getElementById('filterInput');
        if (inp) inp.focus();
    }
}

function applyFilter() {
    const q = (filterText || '').trim().toLowerCase();
    document.querySelectorAll('.task-card').forEach(card => {
        if (!q) { card.style.display = ''; return; }
        const hay = (card.dataset.search || '').toLowerCase();
        card.style.display = hay.includes(q) ? '' : 'none';
    });
    // Обновляем счётчик видимых
    const content = document.querySelector('.content.active');
    if (!content) return;
    const counter = content.querySelector('#filterCount');
    if (counter) {
        const total = content.querySelectorAll('.task-card').length;
        const shown = content.querySelectorAll('.task-card:not([style*="display: none"])').length;
        counter.textContent = q ? `показано ${shown} из ${total}` : '';
    }
}

// ==================== РАСШИФРОВКА СТРОКИ (ДЕКОД ИНСТРУКЦИИ) ====================
function decodeCmd32(w1, w0) {
    const cmd = ((w1 << 16) | w0) >>> 0;
    const g = (shift, mask) => (cmd >>> shift) & mask;
    return {
        start_gen: g(0, 1), wrout: g(1, 1), rd: g(2, 1), ce_comp: g(3, 1),
        arconf: g(4, 0x3F), active_block_3_1: g(12, 0x7), active_block_0: g(15, 1),
        mask_wbuf: g(16, 0xF), en_xor: g(20, 1), en_and: g(21, 1),
        type: g(24, 1), type1: g(25, 0x3), pause: g(27, 1),
        reg_num: g(28, 0x3), inc: g(30, 1), eop: g(31, 1)
    };
}

function formatDecodedInstruction(cmd) {
    const blockBit = (cmd.active_block_0 << 3) | cmd.active_block_3_1;
    const ops = [];
    if (cmd.start_gen) ops.push('START_GEN');
    if (cmd.wrout) ops.push('WROUT');
    if (cmd.rd) ops.push('RD');
    if (cmd.ce_comp) ops.push('CE_COMP');
    if (cmd.pause) ops.push('PAUSE');
    if (cmd.inc) ops.push('INC');
    if (cmd.eop) ops.push('EOP');
    const parts = [];
    if (ops.length) parts.push('операции: ' + ops.join(' | '));
    parts.push(`блок=${blockBit}`);
    parts.push(`reg=${cmd.reg_num}`);
    parts.push(`arconf=${cmd.arconf}`);
    parts.push(`mask_wbuf=${cmd.mask_wbuf}`);
    if (cmd.en_xor) parts.push('XOR');
    if (cmd.en_and) parts.push('AND');
    parts.push(cmd.type ? 'srv' : 'std');
    return parts.join(', ');
}

function decodeWordsFor(bIdx, tIdx, dIdx) {
    const task = state.blocks[bIdx].tasks[tIdx];
    const tp = task.header.TpTsk;
    const row = task.data[dIdx];
    const lines = [];
    lines.push(`TpTsk=${tp}, NN=${row.nn}`);
    lines.push('Сырые слова (D16b7..D16b0): ' + row.words.join(' '));

    if (tp === 4) {
        const w1 = parseInt(row.words[6], 16) || 0;
        const w0 = parseInt(row.words[7], 16) || 0;
        const cmd = decodeCmd32(w1, w0);
        lines.push('CMD32 = 0x' + (((w1 << 16) | w0) >>> 0).toString(16).toUpperCase().padStart(8, '0'));
        lines.push(formatDecodedInstruction(cmd));
        for (const k of Object.keys(cmd)) {
            lines.push(`  ${k} = ${cmd[k]}`);
        }
    } else if (tp === 2) {
        const bytes = [];
        for (const w of row.words) {
            const v = parseInt(w, 16) || 0;
            bytes.push((v >> 8) & 0xFF, v & 0xFF);
        }
        lines.push('Шаблон (байты): ' + bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' '));
    } else if (tp === 6) {
        let cnf = BigInt(0);
        for (let i = 0; i < 8; i++) cnf = (cnf << BigInt(16)) | BigInt(parseInt(row.words[i], 16) || 0);
        const g = (shift, mask) => Number((cnf >> BigInt(shift)) & BigInt(mask));
        lines.push('CNF128 = 0x' + cnf.toString(16).toUpperCase().padStart(32, '0'));
        lines.push(`  a1=${g(0,3)} a2=${g(2,3)} a3=${g(4,3)} a4=${g(6,3)} rec3=${g(8,1)} ac=${g(10,3)} arr=${g(12,3)} dir=${g(14,1)}`);
        lines.push(`  arc1=${g(16,0x7F)} arc2=${g(24,0x7F)}`);
        lines.push(`  tr_R=[${g(32,0xFF)},${g(40,0xFF)},${g(48,0xFF)},${g(56,0xFF)}] sh_R=[${g(64,0xFF)},${g(72,0xFF)},${g(80,0xFF)},${g(88,0xFF)}]`);
        lines.push(`  sh_C=[${g(96,0xFF)},${g(104,0xFF)},${g(112,0xFF)}] rev_reg=${g(120,1)} rev_txt=${g(121,1)}`);
    }

    showInfoDialog('Декодирование строки', lines.join('\n'));
}

function showInfoDialog(title, text) {
    const modal = document.createElement('div');
    modal.className = 'modal open';
    modal.style.zIndex = '250';
    modal.innerHTML = `
        <div class="modal-content" style="width: 560px;">
            <div class="modal-header"><h3>${title}</h3></div>
            <div class="modal-body"><pre class="decoded-output">${text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre></div>
            <div class="modal-footer">
                <button class="btn-secondary" data-info-action="close">Закрыть</button>
                <button data-info-action="copy">Копировать</button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const cleanup = () => {
        modal.remove();
        document.removeEventListener('click', handler, true);
    };
    const handler = (event) => {
        const btn = event.target.closest('[data-info-action]');
        if (!btn) return;
        if (btn.dataset.infoAction === 'copy') {
            vscode.postMessage({ type: 'copyToClipboard', text });
        } else {
            cleanup();
        }
    };
    document.addEventListener('click', guarded, true);
}

// ==================== РЕНДЕРИНГ UI ====================
function renderUI() {
    console.log('[Webview] renderUI вызван, активная вкладка:', activeTab);
    
    const tabs = document.getElementById('tabsContainer');
    const contents = document.getElementById('contentsContainer');
    
    if (!tabs || !contents) {
        console.error('[Webview] Контейнеры не найдены!');
        return;
    }
    
    tabs.innerHTML = '';
    contents.innerHTML = '';

    // Индикатор несохранённых изменений
    const dirtyIndicator = `<span id="dirtyIndicator" style="display: ${isDirty ? 'inline-block' : 'none'}; color: var(--vscode-editorWarning-foreground, #e5e510); margin-left: 10px; font-weight: bold;" title="Есть несохранённые изменения">●</span>`;
    const saveButton = `<button data-action="saveFile" style="margin-left: auto; ${isDirty ? '' : 'opacity: 0.5;'}" ${isDirty ? '' : 'disabled'}>Сохранить</button>`;

    // Вкладка 0: S0
    const isActive0 = activeTab === 0;
    tabs.innerHTML += `<div class="tab ${isActive0 ? 'active' : ''}" data-action="switchTab" data-tab="0">
        Файл (S0)${isActive0 && isDirty ? ' ●' : ''}
    </div>`;
    contents.innerHTML += `<div class="content ${isActive0 ? 'active' : ''}" id="tab-0">
        <div style="display: flex; align-items: center; margin-bottom: 15px;">
            <h3 style="margin: 0;">Заголовок файла</h3>
            ${dirtyIndicator}
            ${saveButton}
        </div>
        <div class="info-panel">
            <div class="info-row">
                <span class="info-label">Всего блоков (NB):</span>
                <span class="info-value">${state.header.NB || '0'}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Исполняемых блоков (NCB):</span>
                <span class="info-value">${state.header.NCB || '0'}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Всего заданий (NTSK):</span>
                <span class="info-value">${state.header.NTSK || '0'}</span>
            </div>
            <div class="info-row">
                <span class="info-label">128-битных слов (N128bW):</span>
                <span class="info-value">${state.header.N128bW || '0'}</span>
            </div>
        </div>
        <div class="form-section">
            <div class="form-section-title">Операции с файлом</div>
            <div class="toolbar">
                <button class="btn-secondary" data-action="exportTxt" title="Сохранить копию текущего состояния в текстовый файл DCFA">Экспорт в .txt</button>
                <button class="btn-secondary" data-action="exportJson" title="Выгрузить разобранную структуру в JSON">Экспорт в JSON</button>
                <button class="btn-secondary" data-action="importTxt" title="Загрузить содержимое другого .dcfa/.txt файла в текущий документ">Импорт из файла…</button>
                <button class="btn-secondary" data-action="revertFile" title="Отменить несохранённые изменения">Откатить изменения</button>
            </div>
        </div>
    </div>`;

    // Вкладки блоков
    if (state.blocks && state.blocks.length > 0) {
        state.blocks.forEach((block, bIdx) => {
            const tabId = bIdx + 1;
            const isActive = activeTab === tabId;
            
            tabs.innerHTML += `<div class="tab ${isActive ? 'active' : ''}" data-action="switchTab" data-tab="${tabId}">
                Блок ${block.header.IB} <span class="badge">${block.tasks.length}</span>${isActive && isDirty ? ' ●' : ''}
            </div>`;
            
            let html = `<div class="content ${isActive ? 'active' : ''}" id="tab-${tabId}">
                <div style="display: flex; align-items: center; margin-bottom: 15px;">
                    <h3 style="margin: 0;">Задания в блоке ${block.header.IB}</h3>
                    ${dirtyIndicator}
                    ${saveButton}
                </div>
                <div class="filter-panel" id="filterPanel">
                    <input type="text" id="filterInput" class="filter-input" placeholder="Фильтр по ID задания / TpTsk…" />
                    <button class="btn-secondary" data-action="clearFilter">Сброс</button>
                    <span id="filterCount" class="filter-count"></span>
                </div>
                <div class="info-panel">
                    <div class="info-row">
                        <span class="info-label">Всего заданий (NTskB):</span>
                        <span class="info-value">${block.header.NTskB}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">128-битных слов (N128bWB):</span>
                        <span class="info-value">${block.header.N128bWB}</span>
                    </div>
                </div>`;
            
            if (block.tasks.length === 0) {
                html += `<div class="empty-state">Нет заданий в этом блоке</div>`;
            } else {
                block.tasks.forEach((task, tIdx) => {
                    const searchHay = `задание ${task.header.ITsk} tptsk=${task.header.TpTsk} cetesk=${task.header.CETsk}`;
                    html += `<div class="task-card" data-search="${searchHay}" data-bidx="${bIdx}" data-tidx="${tIdx}">
                        <div class="task-card-header">
                            <h4>
                                Задание ${task.header.ITsk}
                                <span class="task-type-badge task-type-${task.header.TpTsk}">TpTsk=${task.header.TpTsk}</span>
                            </h4>
                            <button class="btn-add" data-action="addObject" data-bidx="${bIdx}" data-tidx="${tIdx}">+ Добавить</button>
                        </div>
                        <div class="task-card-body">`;
                    
                    if (task.data.length === 0) {
                        html += `<div class="empty-state">Нет данных</div>`;
                    } else {
                        html += `<table class="data-table">
                            <tr>
                                <th>№</th>
                                <th>NN</th>`;
                        for(let i = 7; i >= 0; i--) {
                            html += `<th>D16b${i}</th>`;
                        }
                        html += `<th>Действия</th></tr>`;
                        
                        task.data.forEach((row, dIdx) => {
                            html += `<tr>
                                <td class="row-num">${dIdx}</td>
                                <td>
                                    <input type="text" 
                                           class="inline-edit nn-input" 
                                           value="${row.nn}" 
                                           data-bidx="${bIdx}" 
                                           data-tidx="${tIdx}" 
                                           data-didx="${dIdx}" 
                                           data-field="nn"
                                           title="Число повторов (≥1)">
                                </td>`;
                            
                            row.words.forEach((w, wordIdx) => {
                                html += `<td>
                                    <input type="text" 
                                           class="inline-edit hex-input" 
                                           value="${w}" 
                                           maxlength="4"
                                           data-bidx="${bIdx}" 
                                           data-tidx="${tIdx}" 
                                           data-didx="${dIdx}" 
                                           data-field="word"
                                           data-wordidx="${wordIdx}"
                                           title="16-битное hex-значение">
                                </td>`;
                            });
                            
                            html += `<td class="actions">
                                <button class="btn-icon" data-action="editObject" data-bidx="${bIdx}" data-tidx="${tIdx}" data-didx="${dIdx}" title="Открыть расширенный редактор">Ред.</button>
                                <button class="btn-icon" data-action="decodeWords" data-bidx="${bIdx}" data-tidx="${tIdx}" data-didx="${dIdx}" title="Расшифровать поля строки">🔎</button>
                                <button class="btn-icon" data-action="copyRow" data-bidx="${bIdx}" data-tidx="${tIdx}" data-didx="${dIdx}" title="Скопировать строку в буфер обмена">⧉</button>
                                <button class="btn-icon" data-action="duplicateRow" data-bidx="${bIdx}" data-tidx="${tIdx}" data-didx="${dIdx}" title="Дублировать строку ниже">+</button>
                                <button class="btn-icon" data-action="moveRow" data-bidx="${bIdx}" data-tidx="${tIdx}" data-didx="${dIdx}" data-dir="-1" title="Переместить строку вверх">↑</button>
                                <button class="btn-icon" data-action="moveRow" data-bidx="${bIdx}" data-tidx="${tIdx}" data-didx="${dIdx}" data-dir="1" title="Переместить строку вниз">↓</button>
                                <button class="btn-icon btn-danger" data-action="deleteObject" data-bidx="${bIdx}" data-tidx="${tIdx}" data-didx="${dIdx}" title="Удалить строку">Удал.</button>
                            </td></tr>`;
                        });
                        html += `</table>`;
                    }
                    
                    html += `</div></div>`;
                });
            }
            
            html += `</div>`;
            contents.innerHTML += html;
        });
    }

    // Восстанавливаем значение фильтра и применяем его после перерисовки
    const fi = document.getElementById('filterInput');
    if (fi) {
        fi.value = filterText || '';
        if (filterText) applyFilter();
    }
}

// ==================== ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК ====================
function switchTab(idx) {
    console.log('[Webview] switchTab:', idx);
    activeTab = idx;
    renderUI();
}

// ==================== ДЕЙСТВИЯ С ОБЪЕКТАМИ ====================
function addObject(bIdx, tIdx) {
    console.log('[Webview] addObject:', bIdx, tIdx);
    const task = state.blocks[bIdx].tasks[tIdx];
    task.data.push({ 
        nn: '1', 
        words: ['0000', '0000', '0000', '0000', '0000', '0000', '0000', '0000'] 
    });
    markDirty();
    renderUI();
}

function editObject(bIdx, tIdx, dIdx) {
    console.log('[Webview] editObject:', bIdx, tIdx, dIdx);
    currentEdit = { bIdx, tIdx, dIdx };
    const task = state.blocks[bIdx].tasks[tIdx];
    const tp = task.header.TpTsk;
    const row = task.data[dIdx];
    
    document.getElementById('modalTitle').innerText = `Редактирование (TpTsk=${tp})`;
    const body = document.getElementById('modalBody');
    body.innerHTML = '';

    if (tp === 4) renderInstructionForm(body, row.words);
    else if (tp === 2) renderTemplateForm(body, row.words);
    else if (tp === 6) renderConfigurationForm(body, row.words);
    else renderRawForm(body, row.words);

    document.getElementById('objectModal').classList.add('open');
}

function deleteObject(bIdx, tIdx, dIdx) {
    console.log('[Webview] deleteObject:', bIdx, tIdx, dIdx);
    
    showConfirmDialog(`Удалить строку ${dIdx}?`, () => {
        state.blocks[bIdx].tasks[tIdx].data.splice(dIdx, 1);
        markDirty();
        renderUI();
    });
}

function showConfirmDialog(message, onConfirm, okLabel = 'Удалить', cancelLabel = 'Отмена') {
    const modal = document.createElement('div');
    modal.className = 'modal open';
    modal.style.zIndex = '200';
    modal.innerHTML = `
        <div class="modal-content" style="width: 400px;">
            <div class="modal-header">
                <h3>Подтверждение</h3>
            </div>
            <div class="modal-body">
                <p>${message}</p>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" data-confirm-action="cancel">${cancelLabel}</button>
                <button class="btn-danger" data-confirm-action="ok">${okLabel}</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const cleanup = () => {
        modal.remove();
        document.removeEventListener('click', guarded, true);
    };

    // stopImmediatePropagation — чтобы внешний делегат не отреагировал на кнопки модалки
    const guarded = (event) => {
        if (event.target.closest('[data-confirm-action]')) event.stopImmediatePropagation();
        handler(event);
    };

    const handler = (event) => {
        const btn = event.target.closest('[data-confirm-action]');
        if (!btn) return;
        
        if (btn.dataset.confirmAction === 'ok') {
            cleanup();
            onConfirm();
        } else if (btn.dataset.confirmAction === 'cancel') {
            cleanup();
        }
    };

    document.addEventListener('click', handler, true);
}

function saveObject() {
    console.log('[Webview] saveObject');
    const { bIdx, tIdx, dIdx } = currentEdit;
    const task = state.blocks[bIdx].tasks[tIdx];
    const tp = task.header.TpTsk;
    let row = task.data[dIdx];

    if (tp === 4) {
        let cmd = 0;
        document.querySelectorAll('.cmd-field').forEach(inp => {
            const val = parseInt(inp.value) || 0;
            const name = inp.dataset.bit;
            
            if (name === 'start_gen') cmd |= (val & 1) << 0;
            else if (name === 'wrout') cmd |= (val & 1) << 1;
            else if (name === 'rd') cmd |= (val & 1) << 2;
            else if (name === 'ce_comp') cmd |= (val & 1) << 3;
            else if (name === 'arconf') cmd |= (val & 0x3F) << 4;
            else if (name === 'active_block[3..1]') cmd |= (val & 0x7) << 12;
            else if (name === 'active_block[0]') cmd |= (val & 0x1) << 15;
            else if (name === 'mask_wbuf') cmd |= (val & 0xF) << 16;
            else if (name === 'en_xor') cmd |= (val & 0x1) << 20;
            else if (name === 'en_and') cmd |= (val & 0x1) << 21;
            else if (name === 'type (std/srv)') cmd |= (val & 0x1) << 24;
            else if (name === 'type1') cmd |= (val & 0x3) << 25;
            else if (name === 'pause') cmd |= (val & 0x1) << 27;
            else if (name === 'reg_num') cmd |= (val & 0x3) << 28;
            else if (name === 'inc') cmd |= (val & 0x1) << 30;
            else if (name === 'eop') cmd |= (val & 0x1) << 31;
        });
        row.words[6] = ((cmd >> 16) & 0xFFFF).toString(16).padStart(4, '0').toUpperCase();
        row.words[7] = (cmd & 0xFFFF).toString(16).padStart(4, '0').toUpperCase();
    } else if (tp === 2) {
        document.querySelectorAll('.tmpl-field').forEach(inp => {
            const idx = parseInt(inp.dataset.idx);
            row.words[idx] = inp.value.padStart(4, '0').toUpperCase();
        });
    } else if (tp === 6) {
        let cnf = BigInt(0);
        document.querySelectorAll('.cnf-field').forEach(inp => {
            const val = parseInt(inp.value) || 0;
            const name = inp.dataset.bit;
            
            if (name === 'a1') cnf |= BigInt(val & 0x3) << BigInt(0);
            else if (name === 'a2') cnf |= BigInt(val & 0x3) << BigInt(2);
            else if (name === 'a3') cnf |= BigInt(val & 0x3) << BigInt(4);
            else if (name === 'a4') cnf |= BigInt(val & 0x3) << BigInt(6);
            else if (name === 'rec3') cnf |= BigInt(val & 0x1) << BigInt(8);
            else if (name === 'ac') cnf |= BigInt(val & 0x3) << BigInt(10);
            else if (name === 'arr') cnf |= BigInt(val & 0x3) << BigInt(12);
            else if (name === 'dir') cnf |= BigInt(val & 0x1) << BigInt(14);
            else if (name === 'arc1') cnf |= BigInt(val & 0x7F) << BigInt(16);
            else if (name === 'arc2') cnf |= BigInt(val & 0x7F) << BigInt(24);
            else if (name === 'tr_R1') cnf |= BigInt(val & 0xFF) << BigInt(32);
            else if (name === 'tr_R2') cnf |= BigInt(val & 0xFF) << BigInt(40);
            else if (name === 'tr_R3') cnf |= BigInt(val & 0xFF) << BigInt(48);
            else if (name === 'tr_R4') cnf |= BigInt(val & 0xFF) << BigInt(56);
            else if (name === 'sh_R1') cnf |= BigInt(val & 0xFF) << BigInt(64);
            else if (name === 'sh_R2') cnf |= BigInt(val & 0xFF) << BigInt(72);
            else if (name === 'sh_R3') cnf |= BigInt(val & 0xFF) << BigInt(80);
            else if (name === 'sh_R4') cnf |= BigInt(val & 0xFF) << BigInt(88);
            else if (name === 'sh_C1') cnf |= BigInt(val & 0xFF) << BigInt(96);
            else if (name === 'sh_C2') cnf |= BigInt(val & 0xFF) << BigInt(104);
            else if (name === 'sh_C3') cnf |= BigInt(val & 0xFF) << BigInt(112);
            else if (name === 'rev_reg') cnf |= BigInt(val & 0x1) << BigInt(120);
            else if (name === 'rev_txt') cnf |= BigInt(val & 0x1) << BigInt(121);
        });
        
        // Разбиваем 128-битное значение на 8 слов по 16 бит
        for (let i = 7; i >= 0; i--) {
            row.words[i] = (Number((cnf >> BigInt(i * 16)) & BigInt(0xFFFF)))
                .toString(16).padStart(4, '0').toUpperCase();
        }
    } else {
        const raw = document.getElementById('rawHex').value.split(/\s+/);
        if (raw.length === 8) row.words = raw.map(w => w.padStart(4, '0').toUpperCase());
    }

    closeModal();
    markDirty();
    renderUI();
}

function closeModal() {
    document.getElementById('objectModal').classList.remove('open');
}

// ==================== ФОРМЫ РЕДАКТИРОВАНИЯ ====================
function renderInstructionForm(container, words) {
    const w1 = parseInt(words[6], 16);
    const w0 = parseInt(words[7], 16);
    const cmd = (w1 << 16) | w0;

    const fields = [
        { name: 'start_gen', range: '[0]', val: (cmd >> 0) & 1 },
        { name: 'wrout', range: '[1]', val: (cmd >> 1) & 1 },
        { name: 'rd', range: '[2]', val: (cmd >> 2) & 1 },
        { name: 'ce_comp', range: '[3]', val: (cmd >> 3) & 1 },
        { name: 'arconf', range: '[9..4]', val: (cmd >> 4) & 0x3F },
        { name: 'active_block[3..1]', range: '[14..12]', val: (cmd >> 12) & 0x7 },
        { name: 'active_block[0]', range: '[15]', val: (cmd >> 15) & 0x1 },
        { name: 'mask_wbuf', range: '[19..16]', val: (cmd >> 16) & 0xF },
        { name: 'en_xor', range: '[20]', val: (cmd >> 20) & 0x1 },
        { name: 'en_and', range: '[21]', val: (cmd >> 21) & 0x1 },
        { name: 'type (std/srv)', range: '[24]', val: (cmd >> 24) & 0x1 },
        { name: 'type1', range: '[26..25]', val: (cmd >> 25) & 0x3 },
        { name: 'pause', range: '[27]', val: (cmd >> 27) & 0x1 },
        { name: 'reg_num', range: '[29..28]', val: (cmd >> 28) & 0x3 },
        { name: 'inc', range: '[30]', val: (cmd >> 30) & 0x1 },
        { name: 'eop', range: '[31]', val: (cmd >> 31) & 0x1 }
    ];

    container.innerHTML += `<div class="form-section">
        <div class="form-section-title">Поля инструкции (32 бита)</div>`;
    
    fields.forEach(f => {
        container.innerHTML += `<div class="bit-field">
            <span class="bit-name">${f.name}</span>
            <span class="bit-range">cmd${f.range}</span>
            <input type="number" class="cmd-field" data-bit="${f.name}" value="${f.val}" min="0">
        </div>`;
    });
    
    container.innerHTML += `</div>`;
}

function renderTemplateForm(container, words) {
    container.innerHTML += `<div class="form-section">
        <div class="form-section-title">Шаблон (32 байта = 16 слов)</div>`;
    
    for(let i = 0; i < Math.min(8, words.length); i++) {
        container.innerHTML += `<div class="form-group">
            <label>Слово ${i} (D16b${7-i})</label>
            <input type="text" class="tmpl-field hex-input" data-idx="${i}" value="${words[i]}">
        </div>`;
    }
    
    container.innerHTML += `</div>`;
}

function renderConfigurationForm(container, words) {
    let cnf = BigInt(0);
    for (let i = 0; i < 8; i++) {
        cnf = (cnf << BigInt(16)) | BigInt(parseInt(words[i], 16) || 0);
    }
    
    const fields = [
        { name: 'a1', range: '[1..0]', val: Number((cnf >> BigInt(0)) & BigInt(0x3)) },
        { name: 'a2', range: '[3..2]', val: Number((cnf >> BigInt(2)) & BigInt(0x3)) },
        { name: 'a3', range: '[5..4]', val: Number((cnf >> BigInt(4)) & BigInt(0x3)) },
        { name: 'a4', range: '[7..6]', val: Number((cnf >> BigInt(6)) & BigInt(0x3)) },
        { name: 'rec3', range: '[8]', val: Number((cnf >> BigInt(8)) & BigInt(0x1)) },
        { name: 'ac', range: '[11..10]', val: Number((cnf >> BigInt(10)) & BigInt(0x3)) },
        { name: 'arr', range: '[13..12]', val: Number((cnf >> BigInt(12)) & BigInt(0x3)) },
        { name: 'dir', range: '[14]', val: Number((cnf >> BigInt(14)) & BigInt(0x1)) },
        { name: 'arc1', range: '[22..16]', val: Number((cnf >> BigInt(16)) & BigInt(0x7F)) },
        { name: 'arc2', range: '[30..24]', val: Number((cnf >> BigInt(24)) & BigInt(0x7F)) },
        { name: 'tr_R1', range: '[39..32]', val: Number((cnf >> BigInt(32)) & BigInt(0xFF)) },
        { name: 'tr_R2', range: '[47..40]', val: Number((cnf >> BigInt(40)) & BigInt(0xFF)) },
        { name: 'tr_R3', range: '[55..48]', val: Number((cnf >> BigInt(48)) & BigInt(0xFF)) },
        { name: 'tr_R4', range: '[63..56]', val: Number((cnf >> BigInt(56)) & BigInt(0xFF)) },
        { name: 'sh_R1', range: '[71..64]', val: Number((cnf >> BigInt(64)) & BigInt(0xFF)) },
        { name: 'sh_R2', range: '[79..72]', val: Number((cnf >> BigInt(72)) & BigInt(0xFF)) },
        { name: 'sh_R3', range: '[87..80]', val: Number((cnf >> BigInt(80)) & BigInt(0xFF)) },
        { name: 'sh_R4', range: '[95..88]', val: Number((cnf >> BigInt(88)) & BigInt(0xFF)) },
        { name: 'sh_C1', range: '[103..96]', val: Number((cnf >> BigInt(96)) & BigInt(0xFF)) },
        { name: 'sh_C2', range: '[111..104]', val: Number((cnf >> BigInt(104)) & BigInt(0xFF)) },
        { name: 'sh_C3', range: '[119..112]', val: Number((cnf >> BigInt(112)) & BigInt(0xFF)) },
        { name: 'rev_reg', range: '[120]', val: Number((cnf >> BigInt(120)) & BigInt(0x1)) },
        { name: 'rev_txt', range: '[121]', val: Number((cnf >> BigInt(121)) & BigInt(0x1)) }
    ];

    container.innerHTML += `<div class="form-section">
        <div class="form-section-title">Поля конфигурации (128 бит)</div>`;
    
    fields.forEach(f => {
        container.innerHTML += `<div class="bit-field">
            <span class="bit-name">${f.name}</span>
            <span class="bit-range">cnf${f.range}</span>
            <input type="number" class="cnf-field" data-bit="${f.name}" value="${f.val}" min="0">
        </div>`;
    });
    
    container.innerHTML += `</div>`;
}

function renderRawForm(container, words) {
    container.innerHTML += `<div class="form-section">
        <div class="form-section-title">Редактирование сырых hex-слов</div>
        <p style="font-size: 12px; color: var(--vscode-descriptionForeground);">
            Введите 8 hex-значений через пробел:
        </p>
        <input type="text" id="rawHex" value="${words.join(' ')}" style="width: 100%; font-family: monospace;">
    </div>`;
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
console.log('[Webview] Отправляем ready');
vscode.postMessage({ type: 'ready' });

// Обработка сообщений от extension host
window.addEventListener('message', event => {
    const message = event.data;
    console.log('[Webview] Получено сообщение:', message);
    
    if (message.type === 'update') {
        state = message.data;
        originalState = JSON.parse(JSON.stringify(state)); // Сохраняем копию
        isDirty = false;
        renderUI();
    } else if (message.type === 'saved') {
        // После записи документа фиксируем текущее состояние как базовое
        originalState = JSON.parse(JSON.stringify(state));
        markClean();
    }
});

// Живой фильтр заданий
document.addEventListener('input', (event) => {
    if (event.target && event.target.id === 'filterInput') {
        filterText = event.target.value;
        applyFilter();
    }
});