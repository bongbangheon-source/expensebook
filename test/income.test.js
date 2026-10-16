const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Exercise real HTTP authentication and routing with controlled database replies.
// No production credentials, network connection, or existing records are used.
process.env.APP_PASSWORD = 'income-test-password';
process.env.DATABASE_URL = 'postgresql://test:test@example.invalid/test';
const calls = [];
let nextRows = [], nextError;
const sql = async (parts, ...values) => {
  const statement = parts.join('?');
  calls.push({ statement, values });
  if (statement.startsWith('CREATE TABLE')) return [];
  if (nextError) { const error = nextError; nextError = null; throw error; }
  return nextRows;
};
const driverPath = require.resolve('@neondatabase/serverless');
require.cache[driverPath] = { id: driverPath, filename: driverPath, loaded: true, exports: { neon: () => sql } };
const app = require('../app');
let server, base, cookie;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  const response = await request('/login', 'POST', { password: process.env.APP_PASSWORD });
  cookie = response.headers.get('set-cookie').split(';')[0];
});
after(() => new Promise(resolve => server.close(resolve)));
function request(url, method = 'GET', body) {
  return fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const income = { date: '2026-10-16', title: '  월급  ', category: '급여', amount: 3000000 };
test('income and balance endpoints require login', async () => {
  for (const endpoint of ['/incomes?month=2026-10', '/summary?month=2026-10']) assert.equal((await fetch(base + endpoint)).status, 401);
});
test('create income preserves parameterization and existing expense schema', async () => {
  nextRows = [{ id: 31 }];
  const response = await request('/incomes', 'POST', income);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: 31 });
  assert.ok(calls.some(call => call.statement.startsWith('CREATE TABLE IF NOT EXISTS incomes')));
  assert.ok(!calls.some(call => /DROP|TRUNCATE/.test(call.statement)));
  assert.deepEqual(calls.at(-1).values, ['2026-10-16', '월급', '급여', 3000000]);
});
test('date filtering retains full-month income totals', async () => {
  nextRows = [{ id:31, ...income, amount:3000000 }, { id:32, ...income, date:'2026-10-01', amount:100000 }];
  const response = await request('/incomes?month=2026-10&date=2026-10-16');
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.incomes.length, 1);
  assert.equal(data.incomes[0].id, 31);
  assert.equal(data.total, 3100000);
  assert.equal(data.count, 2);
  assert.deepEqual(calls.at(-1).values, ['2026-10-01', '2026-10-01']);
});
test('update and delete target only the chosen income and handle missing records', async () => {
  nextRows = [{ id:31 }];
  assert.equal((await request('/incomes/31', 'PUT', {...income, amount:4000000})).status, 200);
  assert.match(calls.at(-1).statement, /^UPDATE incomes SET/);
  assert.deepEqual(calls.at(-1).values, [income.date, '월급', '급여', 4000000, '31']);
  assert.equal((await request('/incomes/31', 'DELETE')).status, 200);
  assert.match(calls.at(-1).statement, /^DELETE FROM incomes/);
  nextRows = [];
  assert.equal((await request('/incomes/31', 'DELETE')).status, 404);
  assert.equal((await request('/incomes/31', 'PUT', income)).status, 404);
});
test('invalid income requests never reach the database', async () => {
  const count = calls.length;
  for (const body of [undefined, {...income,date:'2026-02-30'}, {...income,category:'식비'}, {...income,title:' '}, {...income,amount:0}, {...income,amount:-1}, {...income,amount:1.5}, {...income,amount:'1000'}, {...income,amount:1000000000000}]) {
    assert.equal((await request('/incomes', 'POST', body)).status, 400);
  }
  for (const url of ['/incomes?month=2026-13', '/incomes?month=2026-10&date=2026-11-01', '/incomes?month=2026-10&date=invalid', '/summary?month=invalid']) assert.equal((await request(url)).status, 400);
  assert.equal((await request('/incomes/2147483648','DELETE')).status,400);
  assert.equal(calls.length, count);
});
test('summary supports negative and zero balances without applying date search to lifetime totals', async () => {
  nextRows = [{ income:100000, expense:200000, monthlyBalance:-100000, balance:-50000 }];
  let response = await request('/summary?month=2026-10&date=2026-10-16');
  assert.deepEqual(await response.json(), nextRows[0]);
  const query = calls.at(-1);
  assert.ok(query.values.every(value => value === '2026-10-01'));
  assert.match(query.statement, /income_totals\.total - expense_totals\.total/);
  assert.match(query.statement, /income_totals\.monthly - expense_totals\.monthly/);
  assert.match(query.statement, /COALESCE\(SUM\(amount\), 0\)/);
  nextRows = [{ income:0, expense:0, monthlyBalance:0, balance:0 }];
  response = await request('/summary?month=2026-11');
  assert.deepEqual(await response.json(), nextRows[0]);
});
test('income database failure hides underlying connection details', async () => {
  nextError = new Error('postgresql://private-user:private-password@private-host');
  const response = await request('/incomes?month=2026-10');
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('private-password'));
});
