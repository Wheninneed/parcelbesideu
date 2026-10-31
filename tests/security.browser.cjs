// Uses an existing Playwright installation; never installs packages.
// All page requests are fulfilled from local files/fakes or aborted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require(process.env.PARCEL_PLAYWRIGHT_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const qa = path.join(root, '.local', 'security-qa');
const profile = path.join(qa, 'browser-profile');
const temp = path.join(qa, 'tmp');
fs.mkdirSync(temp, { recursive: true });
process.env.TEMP = temp;
process.env.TMP = temp;

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=';
const richAnswer = '<h2>Pickup guide</h2><p><strong>Bold</strong> <em>Italic</em> <u>Underline</u> <s>Strike</s></p>' +
  '<ol><li>First</li><li>Second</li></ol><blockquote>Keep the receipt</blockquote><pre>sample code</pre>' +
  '<p class="ql-align-center custom-class" style="color: rgb(230, 0, 0); background-color: #ffff00; text-align:center; position:fixed; background-image:url(https://blocked.test/track)">Colored text</p>' +
  '<p><a href="https://example.test/pickup">Pickup details</a></p><img src="' + image + '" alt="Sample image">';

const supabaseStub = `window.supabase = { createClient() { return {
  auth: { async getSession() { return { data: { session: {} } }; } },
  from(table) {
    const call = { table, operation: 'select' };
    const query = {
      select() { return this; }, order() { return this; },
      gte() { return this; }, range(from, to) { call.range = [from, to]; return this; },
      eq(column, value) { call.filter = { column, value }; return this; },
      single() { call.single = true; return this; },
      insert() { call.operation = 'insert'; return this; },
      update() { call.operation = 'update'; return this; },
      upsert() { call.operation = 'upsert'; return this; },
      delete() { call.operation = 'delete'; return this; },
      in() { return this; },
      then(resolve, reject) {
        window.__dbCalls.push(call);
        if (call.operation !== 'select') return Promise.reject(new Error('Real or mock DB writes are forbidden in browser QA')).then(resolve, reject);
        let rows = table === 'site_visits' ? window.__fixture.visits : (table === 'message_templates' ? window.__fixture.templates : window.__fixture.settings);
        if (call.filter) rows = rows.filter(row => row[call.filter.column] === call.filter.value);
        if (call.range) rows = rows.slice(call.range[0], call.range[1] + 1);
        return Promise.resolve({ data: call.single ? rows[0] : rows, error: null }).then(resolve, reject);
      }
    };
    return query;
  }
}; } };`;

async function main() {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge', headless: true, viewport: { width: 1280, height: 1000 },
    serviceWorkers: 'block', acceptDownloads: false,
    env: { ...process.env, TEMP: temp, TMP: temp },
    args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--no-default-browser-check']
  });
  let blockedRequests = 0;
  let cachedEditorRequests = 0;
  const options = new WeakMap();
  const allowedFiles = new Set(['faq.html', 'admin-faq.html', 'admin.html', 'admin-templates.html',
    'stores.html', 'index.html', 'styles.css', 'app.js', 'faq-content.js', 'assets/vendor/dompurify-3.4.13.min.js']);

  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const pageOptions = options.get(route.request().frame().page()) || {};
    if (url.hostname === '127.0.0.1') {
      const name = decodeURIComponent(url.pathname).replace(/^\//, '');
      if (allowedFiles.has(name) && !(pageOptions.blockPurifier && name.includes('dompurify-')) &&
          !(pageOptions.blockHelper && name === 'faq-content.js')) {
        const type = name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.css') ? 'text/css' : 'application/javascript';
        await route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(path.join(root, name)) });
        return;
      }
    } else if (url.href === 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2') {
      await route.fulfill({ contentType: 'application/javascript', body: supabaseStub });
      return;
    } else if (url.href === 'https://cdn.quilljs.com/1.3.6/quill.js' || url.href === 'https://cdn.quilljs.com/1.3.6/quill.snow.css') {
      const css = url.pathname.endsWith('.css');
      await route.fulfill({ contentType: css ? 'text/css' : 'application/javascript',
        body: fs.readFileSync(path.join(qa, css ? 'quill-1.3.6.snow.css' : 'quill-1.3.6.js')) });
      cachedEditorRequests++;
      return;
    }
    blockedRequests++;
    await route.abort('blockedbyclient');
  });

  async function withPage(name, fixture, callback, extra = {}) {
    const page = await context.newPage();
    options.set(page, extra);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.dismiss());
    await page.addInitScript(data => {
      window.__fixture = data;
      window.__dbCalls = [];
      window.__injected = false;
      window.__alerts = [];
      window.alert = value => window.__alerts.push(String(value));
      window.confirm = () => false;
    }, { settings: [], templates: [], visits: [], ...fixture });
    try {
      await page.goto('http://127.0.0.1/' + name, { waitUntil: 'networkidle' });
      await callback(page);
      assert.equal(await page.evaluate(() => window.__injected), false, 'Unexpected script execution');
      assert.equal(await page.evaluate(() => window.__dbCalls.some(call => call.operation !== 'select')), false, 'Unexpected DB write');
      assert.deepEqual(errors, [], 'Unexpected page error');
    } finally {
      await page.close();
    }
  }

  const faqFixture = answer => ({ settings: [{ id: 'faq', content: JSON.stringify([
    { question: 'When can I pick up?', answer }, { question: 'How do I contact you?', answer: '<p>Send a message.</p>' }
  ]) }] });

  try {
    await test('FAQ preserves approved formatting, images, colors and accordion behavior', async () => {
      await withPage('faq.html', faqFixture(richAnswer), async page => {
        assert.equal(await page.locator('.faq-answer-content h2').first().textContent(), 'Pickup guide');
        assert.equal(await page.locator('.faq-answer-content strong').count(), 1);
        assert.equal(await page.locator('.faq-answer-content li').count(), 2);
        assert.equal(await page.locator('.faq-answer-content img').getAttribute('src'), image);
        assert.equal(await page.locator('.faq-answer-content img').evaluate(node => node.complete && node.naturalWidth === 1), true);
        const style = await page.locator('.faq-answer-content .ql-align-center').evaluate(node => ({
          color: node.style.color, background: node.style.backgroundColor, align: node.style.textAlign,
          position: node.style.position, backgroundImage: node.style.backgroundImage, customClass: node.classList.contains('custom-class')
        }));
        assert.deepEqual(style, { color: 'rgb(230, 0, 0)', background: 'rgb(255, 255, 0)', align: 'center', position: '', backgroundImage: '', customClass: false });
        assert.match(await page.locator('.faq-answer-content a').getAttribute('rel'), /noopener/);
        await page.locator('.faq-question').first().click();
        assert.equal(await page.locator('.faq-item.active').count(), 1);
        await page.screenshot({ path: path.join(qa, 'faq-desktop.png'), fullPage: true, animations: 'disabled' });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(qa, 'faq-mobile.png'), fullPage: true, animations: 'disabled' });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.locator('.faq-question').nth(1).click();
        assert.equal(await page.locator('.faq-item.active').count(), 1);
        assert.equal(await page.locator('.faq-item').first().evaluate(node => node.classList.contains('active')), false);
      });
    });

    await test('sanitizer blocks HTML/event/namespace/URL payloads in the real browser', async () => {
      await withPage('faq.html', faqFixture('Sample'), async page => {
        const payloads = [
          '<img src=x onerror="window.__injected=true">',
          '<script>window.__injected=true</script>',
          '<svg><g onload="window.__injected=true"></g></svg>',
          '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=window.__injected=true>">',
          '<iframe srcdoc="<script>parent.__injected=true</script>"></iframe>',
          '<object data="javascript:window.__injected=true"></object>',
          '<a href="java&#x09;script:window.__injected=true" onclick="window.__injected=true">Click</a>',
          '<a href="data:text/html,test">Click</a>',
          '<a href="https://user:password@example.test/">Click</a>',
          '<img src="data:image/svg+xml;base64,PHN2Zy8+">',
          '<p id="DOMPurify" name="ParcelFaqContent" data-value="unsafe" class="custom-class" style="position:fixed;background-image:url(https://blocked.test/track)">Text</p>'
        ];
        const result = await page.evaluate(values => {
          const violations = [];
          const container = document.createElement('div');
          document.body.appendChild(container);
          values.forEach((html, index) => {
            if (!window.ParcelFaqContent.render(container, html)) violations.push('fallback:' + index);
            if (container.querySelector('script,svg,math,iframe,object,style,form')) violations.push('tag:' + index);
            container.querySelectorAll('*').forEach(node => {
              Array.from(node.attributes).forEach(attr => {
                if (/^on/i.test(attr.name) || /^(?:id|name|data-)/.test(attr.name)) violations.push('attribute:' + index);
              });
              if (node.hasAttribute('href') || node.hasAttribute('src')) violations.push('unexpected-url:' + index);
              if (node.style.position || node.style.backgroundImage) violations.push('style:' + index);
            });
          });
          return violations;
        }, payloads);
        assert.deepEqual(result, []);
      });
    });

    await test('FAQ permits mail/phone links and rejects SVG or non-image data URLs', async () => {
      const answer = '<p><a href="mailto:help@example.test">Mail</a><a href="tel:+10000000000">Phone</a></p>' +
        '<img src="data:text/html;base64,PHNjcmlwdD4=">';
      await withPage('faq.html', faqFixture(answer), async page => {
        assert.match(await page.locator('.faq-answer-content a').nth(0).getAttribute('href'), /^mailto:/);
        assert.match(await page.locator('.faq-answer-content a').nth(1).getAttribute('href'), /^tel:/);
        assert.equal(await page.locator('.faq-answer-content img').getAttribute('src'), null);
      });
    });

    const raw = '<img src=x onerror="window.__injected=true"><strong>Literal fallback</strong>';
    for (const [label, extra] of [['sanitizer missing', { blockPurifier: true }], ['helper missing', { blockHelper: true }]]) {
      await test('public FAQ falls back to literal text when ' + label, async () => {
        await withPage('faq.html', faqFixture(raw), async page => {
          assert.equal(await page.locator('.faq-answer-content').first().textContent(), raw);
          assert.equal(await page.locator('.faq-answer-content img').count(), 0);
        }, extra);
      });
    }

    await test('a sanitizer exception also falls back to literal text', async () => {
      await withPage('faq.html', faqFixture('Sample'), async page => {
        const result = await page.evaluate(value => {
          window.DOMPurify.sanitize = () => { throw new Error('Simulated sanitizer failure'); };
          const container = document.createElement('div');
          document.body.appendChild(container);
          return { rendered: window.ParcelFaqContent.render(container, value), text: container.textContent, elements: container.children.length };
        }, raw);
        assert.deepEqual(result, { rendered: false, text: raw, elements: 0 });
      });
    });

    await test('FAQ questions are literal text and admin previews cannot reparse encoded markup', async () => {
      const question = '<img src=x onerror="window.__injected=true"> Question';
      const answer = '<p>&lt;img src=x onerror="window.__injected=true"&gt;</p><p><strong>Safe</strong></p>';
      const fixture = { settings: [{ id: 'faq', content: JSON.stringify([{ question, answer }]) }] };
      await withPage('faq.html', fixture, async page => {
        assert.equal(await page.locator('.faq-question-text').textContent(), question);
        assert.equal(await page.locator('.faq-question img').count(), 0);
      });
      await withPage('admin-faq.html', fixture, async page => {
        assert.match(await page.locator('.faq-list-q').textContent(), /<img/);
        assert.equal(await page.locator('.faq-list img').count(), 0);
        await page.locator('.faq-list-actions button').filter({ hasText: '✏️' }).click();
        assert.equal(await page.locator('.ql-editor strong').textContent(), 'Safe');
        assert.equal(await page.locator('.ql-editor img').count(), 0);
        assert.equal(await page.evaluate(() => faqs[0].answer), answer);
      });
    });

    await test('real Quill editor receives only sanitized FAQ content', async () => {
      await withPage('admin-faq.html', faqFixture(richAnswer + raw), async page => {
        await page.locator('.faq-list-actions button').filter({ hasText: '✏️' }).first().click();
        assert.equal(await page.locator('.ql-editor h2').textContent(), 'Pickup guide');
        assert.equal(await page.locator('.ql-editor img[src]').count(), 1);
        assert.equal(await page.locator('.ql-editor [onerror],.ql-editor [onclick]').count(), 0);
        assert.equal(await page.evaluate(() => Quill.version), '1.3.6');
        await page.screenshot({ path: path.join(qa, 'admin-faq-editor.png'), fullPage: true });
      });
    });

    for (const [label, extra] of [['sanitizer missing', { blockPurifier: true }], ['helper missing', { blockHelper: true }]]) {
      await test('admin editor safely accepts literal text when ' + label, async () => {
        await withPage('admin-faq.html', faqFixture(raw), async page => {
          await page.locator('.faq-list-actions button').filter({ hasText: '✏️' }).first().click();
          assert.match(await page.locator('.ql-editor').textContent(), /<img src=x/);
          assert.equal(await page.locator('.ql-editor img,.ql-editor strong').count(), 0);
        }, extra);
      });
    }

    await test('public hours and closure reasons are rendered as text', async () => {
      const reason = '<img src=x onerror="window.__injected=true"> closure';
      const hours = { regular: { mon: { open: reason, close: '19:00' } }, holidays: [{ date: '9999-01-01', reason }] };
      await withPage('index.html', { settings: [{ id: 'business_hours', content: JSON.stringify(hours) }] }, async page => {
        assert.match(await page.locator('#business-hours-content').textContent(), /<img/);
        assert.match(await page.locator('#holiday-alert-container').textContent(), /<img/);
        assert.equal(await page.locator('#business-hours-content img,#holiday-alert-container img').count(), 0);
      });
      await withPage('index.html', { settings: [{ id: 'business_hours', content: reason }] }, async page => {
        assert.equal(await page.locator('#business-hours-content').textContent(), reason);
        assert.equal(await page.locator('#business-hours-content img').count(), 0);
      });
    });

    await test('store cards permit HTTP(S) URLs and keep untrusted names literal', async () => {
      const name = '<img src=x onerror="window.__injected=true"> Store';
      const stores = [
        { name, url: 'javascript:window.__injected=true', logo: 'data:text/html,test', category: 'Sample' },
        { name: 'Valid store', url: 'https://example.test/shop', logo: 'https://example.test/logo.png', category: 'Sample' }
      ];
      await withPage('stores.html', { settings: [{ id: 'recommended_stores', content: JSON.stringify({ stores, featured: [], categories: ['Sample'] }) }] }, async page => {
        assert.equal(await page.locator('.store-name').first().textContent(), name);
        assert.equal(await page.locator('#all-stores-container .store-card').first().getAttribute('href'), null);
        assert.equal(await page.locator('#all-stores-container img').first().getAttribute('src'), null);
        assert.match(await page.locator('#all-stores-container .store-card').nth(1).getAttribute('rel'), /noopener/);
        assert.equal(await page.locator('.store-name img').count(), 0);
      });
    });

    await test('admin holiday/store summaries are text and invalid store URLs are rejected', async () => {
      const text = '<img src=x onerror="window.__injected=true"> Sample';
      const stores = [{ name: text, category: text, url: 'javascript:window.__injected=true' }];
      const settings = [
        { id: 'business_hours', content: JSON.stringify({ regular: {}, holidays: [{ date: '9999-01-01', reason: text }] }) },
        { id: 'recommended_stores', content: JSON.stringify({ stores, featured: stores, categories: ['Sample'] }) }
      ];
      await withPage('admin.html', { settings }, async page => {
        assert.equal(await page.locator('#holiday-list img,#all-stores-admin img,#featured-stores-admin img').count(), 0);
        assert.match(await page.locator('#holiday-list').textContent(), /<img/);
        assert.equal(await page.locator('#all-stores-admin a,#featured-stores-admin a').count(), 0);
        await page.locator('#store-name').fill('Sample');
        await page.locator('#store-url').fill('javascript:window.__injected=true');
        await page.locator('#add-store-btn').click();
        assert.equal(await page.evaluate(() => storesData.stores.length), 1);
        assert.equal(await page.evaluate(() => window.__alerts.length), 1);
      });
    });

    await test('group and row buttons pass special names/IDs as literal values', async () => {
      const group = 'Sample\'s "group" <img src=x onerror="window.__injected=true">';
      const rowId = "row');window.__injected=true;//";
      const templates = [
        { id: rowId, sheet_name: '주소', category: group, title: 'Sample', content: '{}' },
        { id: 2, sheet_name: '주소', category: '__proto__', title: 'Sample', content: '{}' }
      ];
      await withPage('admin-templates.html', { templates }, async page => {
        await page.locator('#toggle-edit-mode-btn').click();
        assert.equal(await page.locator('#template-table-body img').count(), 0);
        await page.evaluate(() => {
          window.__actions = [];
          window.renameAddressGroup = value => window.__actions.push(['rename', value]);
          window.deleteAddressGroup = value => window.__actions.push(['delete-group', value]);
          window.startInlineEdit = value => window.__actions.push(['edit', value]);
          window.deleteTemplateRow = value => window.__actions.push(['delete-row', value]);
        });
        await page.getByRole('button', { name: '✏️ Rename', exact: true }).first().click();
        await page.getByRole('button', { name: '❌ Delete Group', exact: true }).first().click();
        await page.locator('[data-row-action="edit"]').first().click();
        await page.locator('[data-row-action="delete"]').first().click();
        assert.deepEqual(await page.evaluate(() => window.__actions), [
          ['rename', group], ['delete-group', group], ['edit', rowId], ['delete-row', rowId]
        ]);
      });
    });


    await test('daily chart labels show unique visitors including zero, preserving view totals', async () => {
      await withPage('admin.html', {}, async page => {
        await page.evaluate(() => {
          const since = new Date(); since.setDate(since.getDate() - 29); since.setHours(0,0,0,0);
          const first = new Date(since); first.setHours(12);
          const middle = new Date(since); middle.setDate(middle.getDate() + 14); middle.setHours(12);
          const rows = [
            { visitor_id:'sample-first',page:'/',created_at:first.toISOString() },
            { visitor_id:'sample-first',page:'/',created_at:first.toISOString() },
            ...Array.from({length:3},(_,i)=>({visitor_id:'sample-middle-'+i,page:'/',created_at:middle.toISOString()}))
          ];
          renderVisitStats(rows,since);
        });
        const labels = await page.locator('.daily-bar-value').allTextContents();
        assert.equal(labels.length,30); assert.equal(labels[0],'1'); assert.equal(labels[14],'3'); assert.equal(labels[29],'0');
        assert.match(await page.locator('.daily-bar').first().getAttribute('title'),/방문자 1 · 조회 2/);
        assert.equal(await page.locator('#stat-views').textContent(),'5');
        assert.equal(await page.locator('#stat-month').textContent(),'4');
        const label = await page.locator('.daily-bar-value').nth(14).boundingBox();
        const bar = await page.locator('.daily-bar').nth(14).boundingBox();
        assert.ok(label.y + label.height <= bar.y);
        await page.locator('.admin-dashboard-header').screenshot({path:path.join(qa,'admin-actions-desktop.png'),animations:'disabled'});
        await page.setViewportSize({width:390,height:844});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await page.locator('.admin-dashboard-header').screenshot({path:path.join(qa,'admin-actions-mobile.png'),animations:'disabled'});
        await page.locator('#stats-body').screenshot({path:path.join(qa,'admin-stats-mobile.png'),animations:'disabled'});
      });
    });
    await test('daily chart handles empty data and large labels without clipping', async () => {
      await withPage('admin.html', {}, async page => {
        assert.equal(await page.locator('.daily-bar-value').count(),30);
        assert.deepEqual(await page.locator('.daily-bar-value').allTextContents(),Array(30).fill('0'));
        await page.evaluate(() => {
          const since=new Date();since.setDate(since.getDate()-29);since.setHours(0,0,0,0);
          const date=new Date(since);date.setHours(12);
          renderVisitStats(Array.from({length:1234},(_,i)=>({visitor_id:'sample-'+i,page:'/',created_at:date.toISOString()})),since);
        });
        assert.equal(await page.locator('.daily-bar-value').first().textContent(),'1,234');
        const widths=await page.locator('.daily-bar').first().evaluate(node=>({bar:node.getBoundingClientRect().width,label:node.querySelector('.daily-bar-value').getBoundingClientRect().width}));
        assert.ok(widths.label<=widths.bar);
        await page.setViewportSize({width:390,height:844});
        assert.equal(await page.locator('.daily-chart-viewport').evaluate(node=>node.scrollWidth>node.clientWidth),true);
      });
    });
    await test('dashboard shortcuts have consistent rounded padding and retain their destinations', async () => {
      await withPage('admin.html', {}, async page => {
        assert.equal(await page.locator('.admin-actions .admin-action').count(),4);
        assert.deepEqual(await page.locator('.admin-actions a').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href'))),['admin-expenses.html','admin-faq.html','admin-templates.html']);
        const styles=await page.locator('.admin-action').evaluateAll(nodes=>nodes.map(node=>{const style=getComputedStyle(node);return {vertical:parseFloat(style.paddingTop),horizontal:parseFloat(style.paddingLeft),radius:parseFloat(style.borderRadius),height:node.getBoundingClientRect().height};}));
        assert.ok(styles.every(style=>style.vertical>=10&&style.horizontal>=14&&style.radius>=10&&style.height>=44));
        await page.setViewportSize({width:390,height:844});
        const mobile=await page.locator('.admin-action').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth;}));
        assert.ok(mobile.every(Boolean));
      });
    });

    console.log(JSON.stringify({ realNetworkRequestsAllowed: 0, blockedPageRequests: blockedRequests, existingEditorAssetsServedFromLocalCache: cachedEditorRequests }));
  } finally {
    await context.close();
    for (const directory of [profile, temp]) {
      if (!fs.existsSync(directory)) continue;
      const actual = fs.realpathSync(directory);
      const base = fs.realpathSync(qa) + path.sep;
      if (!actual.startsWith(base)) throw new Error('Refusing to remove a directory outside the QA workspace');
      fs.rmSync(actual, { recursive: true, force: true });
    }
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
