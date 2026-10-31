const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin-templates.html'), 'utf8');
const script = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(match => !/\bsrc\s*=/.test(match[1]))
  .map(match => match[2]).join('\n');

// Execute the real page script with fake DOM/data clients. No browser, credentials,
// external libraries, network APIs, or real database connections are used.
function createPage(rows = [], options = {}) {
  const elements = new Map();
  const calls = [];
  const alerts = [];
  const pendingPrompts = [];
  const confirmations = [];
  const failures = [];
  const copied = [];

  function element() {
    return {
      value: '', style: {}, children: [], dataset: {}, listeners: new Map(),
      classList: { add() {}, remove() {}, toggle() {} },
      get innerHTML() {
        return this.children.length
          ? this.children.map(child => child.textContent || child.innerHTML).join('')
          : this.markup || '';
      },
      set innerHTML(value) { this.markup = value; this.children = []; this.copyCells = null; },
      appendChild(child) { this.children.push(child); },
      addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(listener);
      },
      click() { (this.listeners.get('click') || []).forEach(listener => listener()); },
      querySelectorAll(selector) {
        if (selector !== '.copyable-cell') return [];
        this.copyCells ||= [...this.innerHTML.matchAll(/<td\b[^>]*class="[^"]*\bcopyable-cell\b[^"]*"[^>]*>/g)]
          .map(() => element());
        return this.copyCells;
      }
    };
  }

  const document = {
    addEventListener() {},
    createElement: element,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    querySelectorAll() { return []; }
  };

  const client = {
    from(table) {
      const call = { table };
      const query = {
        select() { call.operation ||= 'select'; return this; },
        order() { return this; },
        update(payload) { Object.assign(call, { operation: 'update', payload }); return this; },
        insert(payload) { Object.assign(call, { operation: 'insert', payload }); return this; },
        delete() { call.operation = 'delete'; return this; },
        eq(column, value) { call.filter = { column, value }; return this; },
        then(resolve, reject) {
          calls.push(JSON.parse(JSON.stringify(call)));
          const error = options.failOperation === call.operation ? { message: 'Simulated failure' } : null;
          let data = null;
          if (!error && call.operation === 'insert') {
            data = call.payload.map((row, index) => ({ ...row, id: 100 + index }));
          } else if (!error && call.operation === 'select') {
            data = rows;
          }
          return Promise.resolve({ data, error }).then(resolve, reject);
        }
      };
      return query;
    }
  };

  const context = vm.createContext({
    document,
    console: { error() { failures.push(true); }, warn() {} },
    alert(message) { alerts.push(message); },
    prompt() { return pendingPrompts.shift() ?? null; },
    confirm() { return confirmations.shift() ?? true; },
    navigator: { clipboard: { writeText(text) { copied.push(text); return Promise.resolve(); } } },
    setTimeout() {},
    __client: client,
    __rows: JSON.parse(JSON.stringify(rows))
  });
  context.window = context;
  new vm.Script(script, { filename: 'admin-templates.inline.js' }).runInContext(context);
  const run = code => vm.runInContext(code, context);
  run('db = __client; templates = __rows; isEditMode = true;');

  return {
    context, document, calls, alerts, failures, copied, pendingPrompts, confirmations, run,
    state() { return JSON.parse(run('JSON.stringify({ templates, activeSheet, editingRowId })')); },
    tabs() { return document.getElementById('tabs-list').children.map(child => child.innerHTML).join('\n'); },
    editAddress(values = {}) {
      const fields = {
        name: 'Sample', group: 'Sample Group', address: 'Updated address',
        zip: '00000', city: 'Updated city', phone: '', gate: '', comment: ''
      };
      Object.entries({ ...fields, ...values }).forEach(([key, value]) => {
        document.getElementById('edit-addr-' + key).value = value;
      });
    }
  };
}

function addressRow(content) {
  return { id: 1, sheet_name: '주소', category: 'Sample Group', title: 'Sample', content };
}

test('editing an address preserves state and unknown JSON fields, including nested values', async () => {
  const page = createPage([addressRow(JSON.stringify({
    address: 'Original address', state: 'Original region', phone: 'sample-phone',
    metadata: { instructions: ['one', 'two'] }, enabled: false, count: 0, optional: null
  }))]);
  page.editAddress({ comment: 'New comment', phone: '' });
  await page.context.saveAddressInlineEdit(1);
  assert.equal(page.calls.length, 1);
  const saved = JSON.parse(page.calls[0].payload.content);
  assert.equal(saved.state, 'Original region');
  assert.deepEqual(saved.metadata, { instructions: ['one', 'two'] });
  assert.equal(saved.enabled, false);
  assert.equal(saved.count, 0);
  assert.equal(saved.optional, null);
  assert.equal(saved.address, 'Updated address');
  assert.equal(saved.comment, 'New comment');
  assert.equal(saved.phone, '');
  assert.equal(page.state().templates[0].content, page.calls[0].payload.content);
});

test('legacy plain text still opens as an address and can be edited', async () => {
  const page = createPage([addressRow('Legacy address')]);
  assert.equal(page.run("parseAddressContent('Legacy address').address"), 'Legacy address');
  page.editAddress({ address: 'Edited legacy address' });
  await page.context.saveAddressInlineEdit(1);
  assert.equal(JSON.parse(page.calls[0].payload.content).address, 'Edited legacy address');
});

test('saving a missing row cannot overwrite content without its original fields', async () => {
  const page = createPage([]);
  page.editAddress();
  await page.context.saveAddressInlineEdit(99);
  assert.equal(page.calls.length, 0);
  assert.equal(page.alerts.length, 1);
});

test('failed address update preserves original data and the active edit', async () => {
  const original = addressRow(JSON.stringify({ address: 'Original', state: 'Original region' }));
  const page = createPage([original], { failOperation: 'update' });
  page.run('editingRowId = 1;');
  page.editAddress();
  await page.context.saveAddressInlineEdit(1);
  assert.deepEqual(page.state().templates, [original]);
  assert.equal(page.state().editingRowId, 1);
  assert.equal(page.alerts.length, 1);
});

test('new empty sheet remains selected and survives switching away and back without DB writes', () => {
  const page = createPage([{ id: 1, sheet_name: 'Existing', content: 'Sample' }]);
  page.pendingPrompts.push('New Sheet');
  page.context.addNewSheetTab();
  assert.equal(page.state().activeSheet, 'New Sheet');
  assert.match(page.tabs(), /New Sheet/);
  page.context.switchSheet('Existing');
  assert.match(page.tabs(), /New Sheet/);
  page.context.switchSheet('New Sheet');
  assert.equal(page.state().activeSheet, 'New Sheet');
  assert.equal(page.calls.length, 0);
});

test('duplicate sheet names are rejected for both saved and empty sheets', () => {
  const page = createPage([{ id: 1, sheet_name: 'Existing', content: 'Sample' }]);
  page.pendingPrompts.push('New Sheet', ' New Sheet ', 'Existing');
  page.context.addNewSheetTab();
  page.context.addNewSheetTab();
  page.context.addNewSheetTab();
  assert.equal(page.alerts.length, 2);
  assert.equal(page.document.getElementById('tabs-list').children.length, 2);
});

test('an empty draft sheet can be deleted without a database request', async () => {
  const page = createPage([{ id: 1, sheet_name: 'Existing', content: 'Sample' }]);
  page.pendingPrompts.push('Draft');
  page.context.addNewSheetTab();
  await page.context.deleteSheetTab('Draft');
  assert.doesNotMatch(page.tabs(), /Draft/);
  assert.equal(page.state().activeSheet, 'Existing');
  assert.equal(page.calls.length, 0);
});

test('adding the first row persists the intended sheet name and opens its row for editing', async () => {
  const page = createPage([{ id: 1, sheet_name: 'Existing', content: 'Sample' }]);
  page.pendingPrompts.push('New Sheet');
  page.context.addNewSheetTab();
  await page.context.addNewTemplateRow();
  assert.equal(page.calls[0].operation, 'insert');
  assert.equal(page.calls[0].payload[0].sheet_name, 'New Sheet');
  assert.equal(page.state().activeSheet, 'New Sheet');
  assert.equal(page.state().editingRowId, 100);
  const reloaded = createPage(page.state().templates);
  reloaded.context.switchSheet('New Sheet');
  assert.equal(reloaded.state().activeSheet, 'New Sheet');
});

test('canceling sheet creation leaves the current sheet and rows unchanged', () => {
  const page = createPage([{ id: 1, sheet_name: 'Existing', content: 'Sample' }]);
  page.context.switchSheet('Existing');
  const original = page.state();
  page.context.addNewSheetTab();
  assert.deepEqual(page.state(), original);
  assert.equal(page.calls.length, 0);
});

test('creating a sheet respects cancellation of an unsaved row edit', () => {
  const page = createPage([{ id: 1, sheet_name: 'Existing', content: 'Sample' }]);
  page.context.switchSheet('Existing');
  page.run('editingRowId = 1;');
  page.pendingPrompts.push('New Sheet');
  page.confirmations.push(false);
  page.context.addNewSheetTab();
  assert.equal(page.state().activeSheet, 'Existing');
  assert.equal(page.state().editingRowId, 1);
  assert.doesNotMatch(page.tabs(), /New Sheet/);
});

test('address cells copy quotes and other special characters as their original text', () => {
  const original = addressRow(JSON.stringify({
    address: 'Sample \' " ` ${text} & <text> \\ road', city: '시/도', zip_code: '00000'
  }));
  original.title = 'Sample\'s "name"';
  const page = createPage([original]);
  page.run("activeSheet = '주소'; isEditMode = false; renderTable();");
  const row = page.document.getElementById('template-table-body').children
    .find(child => child.querySelectorAll('.copyable-cell').length > 0);
  const cells = row.querySelectorAll('.copyable-cell');
  assert.equal(cells.length, 6);
  assert.doesNotMatch(row.innerHTML, /onclick="copyTemplateText/);
  cells[0].click();
  cells[1].click();
  assert.deepEqual(page.copied, [original.title, JSON.parse(original.content).address]);
  assert.equal(page.calls.length, 0);
});

test('template cells copy multiline text literally and remain disabled in edit mode', () => {
  const content = 'Sample\'s "text" ` ${literal} & <text> \\ path\nSecond line';
  const page = createPage([{ id: 1, sheet_name: 'Existing', title: 'Sample', category: '', content }]);
  page.run("activeSheet = 'Existing'; isEditMode = false; renderTable();");
  let row = page.document.getElementById('template-table-body').children[0];
  assert.doesNotMatch(row.innerHTML, /onclick="copyTemplateText/);
  row.querySelectorAll('.copyable-cell')[0].click();
  assert.deepEqual(page.copied, [content]);
  page.run('isEditMode = true; renderTable();');
  row = page.document.getElementById('template-table-body').children[0];
  row.querySelectorAll('.copyable-cell')[0].click();
  assert.deepEqual(page.copied, [content]);
});

test('new sheet names containing quotes and markup remain literal text and can be selected', () => {
  const page = createPage([{ id: 1, sheet_name: 'Existing', content: 'Sample' }]);
  const name = 'Sample\'s "sheet" <text> & `';
  page.pendingPrompts.push(name);
  page.context.addNewSheetTab();
  const tab = page.document.getElementById('tabs-list').children[1];
  assert.equal(tab.children[0].textContent, name);
  page.context.switchSheet('Existing');
  tab.children[0].click();
  assert.equal(page.state().activeSheet, name);
  assert.equal(page.calls.length, 0);
});
