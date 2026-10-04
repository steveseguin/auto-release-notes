// Run with: node --test tests/pagination.test.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const commit = i => ({ sha: String(i), commit: { message: `fix: change ${i}`, author: { name: 'Tester', date: '2026-10-03T00:00:00Z' } } });

async function run(mode, count, { include = '', failPage = 0 } = {}) {
    const elements = new Map();
    function element(id) {
        if (!elements.has(id)) elements.set(id, {
            value: '', style: {}, textContent: '',
            classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}
        });
        return elements.get(id);
    }
    element('date-range').value = '14';
    element('include-keywords').value = include;
    const calls = [];
    const commits = Array.from({ length: count }, (_, i) => commit(i));
    const repo = { GITNFO_OWNER: 'example', GITNFO_REPO: 'demo', GITNFO_BRANCH: 'release/v1&test' };
    const context = {
        document: { getElementById: element, querySelectorAll: () => [] },
        window: mode === 'auto' ? { ...repo } : {},
        localStorage: { getItem: () => null }, Date,
        fetch: async (url, options) => {
            const parsed = new URL(url);
            const page = Number(parsed.searchParams.get('page') || 1);
            calls.push({ parsed, options });
            const failure = page === failPage;
            return {
                ok: !failure, status: failure ? 403 : 200, statusText: failure ? 'Forbidden' : 'OK',
                headers: { get: name => name.toLowerCase() === 'link' && page * 100 < count
                    ? `<https://api.github.com/repos/example/demo/commits?page=${page + 1}>; rel="next", <https://api.github.com/repos/example/demo/commits?page=${Math.ceil(count / 100)}>; rel="last"` : null },
                json: async () => failure ? { message: 'API rate limit exceeded' } : commits.slice((page - 1) * 100, page * 100)
            };
        }
    };
    vm.createContext(context);
    const initial = vm.runInContext(source, context);
    if (mode === 'auto') await initial;
    else {
        Object.assign(context.window, repo, { currentCommits: [commit('stale')] });
        await context.fetchCommits();
    }
    return { calls, commits: context.window.currentCommits, output: element('output-content').textContent, error: element('error') };
}

for (const mode of ['auto', 'manual']) {
    for (const count of [0, 2, 100, 101, 250]) {
        test(`${mode}: retrieves all ${count} commits before summary`, async () => {
            const result = await run(mode, count);
            assert.equal(result.commits.length, count);
            assert.equal(result.calls.length, Math.max(1, Math.ceil(count / 100)));
            for (const { parsed, options } of result.calls) {
                assert.equal(parsed.searchParams.get('sha'), 'release/v1&test');
                assert.equal(parsed.searchParams.get('per_page'), '100');
                assert.equal(options.headers.Accept, 'application/vnd.github.v3+json');
                assert.equal(parsed.searchParams.get('since'), result.calls[0].parsed.searchParams.get('since'));
            }
            if (count) assert.match(result.output, new RegExp(`\\(${count} commits`));
            else assert.match(result.output, /No commits found/);
        });
    }
    test(`${mode}: filters can match only commit 101`, async () => {
        const result = await run(mode, 101, { include: 'change 100' });
        assert.equal(result.commits.length, 1);
        assert.equal(result.commits[0].sha, '100');
        assert.match(result.output, /1 commits, 100 filtered/);
    });
    for (const failPage of [1, 2]) {
        test(`${mode}: page ${failPage} rate limit reports failure without partial or stale commits`, async () => {
            const result = await run(mode, 101, { failPage });
            assert.equal(result.calls.length, failPage);
            assert.equal(result.commits.length, 0);
            assert.equal(result.output, '');
            assert.equal(result.error.style.display, 'block');
            assert.match(result.error.textContent, /403 Forbidden - API rate limit exceeded/);
        });
    }
}
