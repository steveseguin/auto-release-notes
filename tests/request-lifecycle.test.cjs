const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = fs.readFileSync(process.env.SOURCE_FILE || path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const commit = (id) => ({ sha: id, commit: { message: `fix: ${id}`, author: { name: 'Tester', date: '2026-09-20T00:00:00Z' } } });
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise, resolve, reject}; }
function harness(auto = false) {
    const elements = new Map(), calls = [];
    function element(id) {
        if (!elements.has(id)) {
            const classes = new Set();
            elements.set(id, { value: '', style: {}, textContent: '', innerHTML: '', disabled: false,
                classList: { add: x=>classes.add(x), remove: x=>classes.delete(x), contains: x=>classes.has(x), toggle: x=>classes.has(x)?classes.delete(x):classes.add(x) }, addEventListener() {} });
        }
        return elements.get(id);
    }
    element('date-range').value = '30';
    element('google-api-key').value = 'inert-test-fixture';
    const repo = { GITNFO_OWNER: 'example', GITNFO_REPO: 'demo', GITNFO_BRANCH: 'main' };
    const context = { window: auto ? {...repo} : {}, document: { getElementById: element, querySelectorAll: ()=>[] }, localStorage: {getItem: ()=>null}, Date,
        fetch: (url, options) => { const response = deferred(); calls.push({url, options, response}); return response.promise; } };
    vm.createContext(context);
    const initial = vm.runInContext(source, context);
    if (!auto) Object.assign(context.window, repo);
    const complete = (i, ids, body) => calls[i].response.resolve({ok:true, headers:{get:()=>null}, json:()=> body ? body.promise : Promise.resolve(ids.map(commit))});
    return { context, element, calls, initial, complete };
}
for (const mode of ['manual', 'auto']) {
    test(`${mode}: an older successful response cannot replace newer results or AI input`, async()=> {
        const h=harness(mode==='auto'); const first=mode==='auto'?h.initial:h.context.fetchCommits();
        h.element('date-range').value='7'; const second=h.context.fetchCommits();
        h.complete(1,['latest-seven-day']); await second;
        h.complete(0,['old-thirty-day']); await first;
        assert.deepEqual(Array.from(h.context.window.currentCommits,c=>c.sha),['latest-seven-day']);
        assert.match(h.element('output-content').textContent,/last 7 days/);
        assert.doesNotMatch(h.element('output-content').textContent,/old-thirty-day/);
    });
    test(`${mode}: stale empty response cannot replace a newer summary`, async()=> {
        const h=harness(mode==='auto'); const first=mode==='auto'?h.initial:h.context.fetchCommits();
        const second=h.context.fetchCommits(); h.complete(1,['latest']); await second;
        h.complete(0,[]); await first;
        assert.match(h.element('output-content').textContent,/latest/);
    });
    test(`${mode}: stale network failure cannot add an error to a newer success`, async()=> {
        const h=harness(mode==='auto'); const first=mode==='auto'?h.initial:h.context.fetchCommits();
        const second=h.context.fetchCommits(); h.complete(1,['latest']); await second;
        h.calls[0].response.reject(new Error('old network failure')); await first;
        assert.equal(h.element('error').style.display,'none');
    });
    test(`${mode}: stale success cannot replace a newer failure`, async()=> {
        const h=harness(mode==='auto'); const first=mode==='auto'?h.initial:h.context.fetchCommits();
        const second=h.context.fetchCommits(); h.calls[1].response.reject(new Error('new failure')); await second;
        h.complete(0,['old']); await first;
        assert.equal(h.element('output').classList.contains('visible'),false);
        assert.match(h.element('error').textContent,/new failure/);
    });
    test(`${mode}: delayed JSON parsing also loses ownership to a newer request`, async()=> {
        const h=harness(mode==='auto'); const first=mode==='auto'?h.initial:h.context.fetchCommits();
        const body=deferred(); h.complete(0,[],body); await Promise.resolve();
        const second=h.context.fetchCommits();h.complete(1,['latest']);await second;
        body.resolve([commit('old')]);await first;
        assert.deepEqual(Array.from(h.context.window.currentCommits,c=>c.sha),['latest']);
    });
    test(`${mode}: empty newest result remains empty when an older request finishes`, async()=> {
        const h=harness(mode==='auto');const first=mode==='auto'?h.initial:h.context.fetchCommits();
        const second=h.context.fetchCommits();h.complete(1,[]);await second;
        h.complete(0,['old']);await first;
        assert.match(h.element('output-content').textContent,/No commits found/);
        assert.equal(h.element('ai-summary-btn').style.display,'none');
    });
    test(`${mode}: summary labels the date range actually requested`, async()=> {
        const h=harness(mode==='auto');const first=mode==='auto'?h.initial:h.context.fetchCommits();
        h.element('date-range').value='7';h.complete(0,['thirty-day']);await first;
        assert.match(h.element('output-content').textContent,/last 30 days/);
    });
    test(`${mode}: stale HTTP error cannot replace current success`, async()=> {
        const h=harness(mode==='auto'); const first=mode==='auto'?h.initial:h.context.fetchCommits();
        const second=h.context.fetchCommits();h.complete(1,['latest']);await second;
        h.calls[0].response.resolve({ok:false,status:403,statusText:'Forbidden',json:async()=>({message:'old rate limit'})});await first;
        assert.equal(h.element('error').style.display,'none');
        assert.match(h.element('output-content').textContent,/latest/);
    });
    test(`${mode}: stale JSON failure cannot replace current success`, async()=> {
        const h=harness(mode==='auto'); const first=mode==='auto'?h.initial:h.context.fetchCommits();
        const body=deferred();h.complete(0,[],body);await Promise.resolve();
        const second=h.context.fetchCommits();h.complete(1,['latest']);await second;
        body.reject(new Error('old JSON failure'));await first;
        assert.equal(h.element('error').style.display,'none');
    });
    test(`${mode}: an invalid newer fetch still supersedes a pending one`, async()=> {
        const h=harness(mode==='auto'); const first=mode==='auto'?h.initial:h.context.fetchCommits();
        delete h.context.window.GITNFO_REPO;await h.context.fetchCommits();
        h.complete(0,['old']);await first;
        assert.equal(h.element('output').classList.contains('visible'),false);
        assert.match(h.element('repo-info').textContent,/Please navigate/);
    });
    test(`${mode}: current failures are still visible`, async()=> {
        const h=harness(mode==='auto');const first=mode==='auto'?h.initial:h.context.fetchCommits();
        h.calls[0].response.reject(new Error('current network failure'));await first;
        assert.equal(h.element('error').style.display,'block');
        assert.match(h.element('error').textContent,/current network failure/);
    });
    test(`${mode}: an ordinary current success retains output, filtering and AI input`, async()=> {
        const h=harness(mode==='auto'); h.element('exclude-keywords').value='excluded';
        const first=mode==='auto'?h.initial:h.context.fetchCommits(); h.complete(0,['kept','excluded']);await first;
        assert.match(h.element('output-content').textContent,/1 commits, 1 filtered/);
        assert.deepEqual(Array.from(h.context.window.currentCommits,c=>c.sha),['kept']);
        assert.equal(h.element('ai-summary-btn').style.display,'inline-flex');
    });
}
