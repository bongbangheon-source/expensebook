require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookies = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const { neon } = require('@neondatabase/serverless');
const { createHmac, timingSafeEqual, randomBytes } = require('node:crypto');
const path = require('node:path');
const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '8kb' }));
app.use(cookies());
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: '허용되지 않는 요청입니다.' });
  if (!process.env.APP_PASSWORD) return res.status(503).json({ error: '서버에 APP_PASSWORD를 설정해 주세요.' });
  next();
});
function equal(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function sign(value) { return createHmac('sha256', process.env.APP_PASSWORD).update(value).digest('hex'); }
function authenticated(req) {
  const [expires, nonce, signature] = (req.cookies.session || '').split('.');
  return !!signature && Number(expires) > Date.now() && equal(sign(`${expires}.${nonce}`), signature);
}
const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production' || !!process.env.VERCEL, sameSite: 'strict', path: '/' };
app.post('/api/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: '시도가 너무 많습니다. 15분 후 다시 시도해 주세요.' } }), (req, res) => {
  if (typeof req.body.password !== 'string' || !equal(req.body.password, process.env.APP_PASSWORD)) return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  const value = `${Date.now() + 12 * 60 * 60 * 1000}.${randomBytes(24).toString('hex')}`;
  res.cookie('session', `${value}.${sign(value)}`, { ...cookieOptions, maxAge: 12 * 60 * 60 * 1000 }).json({ ok: true });
});
app.post('/api/logout', (req, res) => res.clearCookie('session', cookieOptions).json({ ok: true }));
app.use('/api', (req, res, next) => authenticated(req) ? next() : res.status(401).json({ error: '로그인이 필요합니다.' }));
app.get('/api/session', (req, res) => res.json({ ok: true }));
let sql, ready;
async function database() {
  if (!process.env.DATABASE_URL) { const error = new Error('DB_CONFIG'); throw error; }
  sql ||= neon(process.env.DATABASE_URL);
  ready ||= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS expenses (id SERIAL PRIMARY KEY, date DATE NOT NULL, title VARCHAR(100) NOT NULL, category VARCHAR(30) NOT NULL, amount BIGINT NOT NULL CHECK (amount > 0 AND amount <= 999999999999), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS incomes (id SERIAL PRIMARY KEY, date DATE NOT NULL, title VARCHAR(100) NOT NULL, category VARCHAR(30) NOT NULL, amount BIGINT NOT NULL CHECK (amount > 0 AND amount <= 999999999999), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  })().catch(error => { ready = null; throw error; });
  await ready;
  return sql;
}
const categories = ['식비', '카페·간식', '교통', '쇼핑', '주거·통신', '건강', '문화·여가', '기타'];
const incomeCategories = ['급여', '용돈', '부수입', '사업소득', '이자·배당', '기타'];
function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0,4)) >= 1900 && Number(value.slice(0,4)) <= 9999 && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
function validExpense(body, allowedCategories = categories) { return body && validDate(body.date) && typeof body.title === 'string' && body.title.trim().length > 0 && body.title.trim().length <= 100 && allowedCategories.includes(body.category) && Number.isSafeInteger(body.amount) && body.amount > 0 && body.amount <= 999999999999; }
function validMonth(month) { return typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && validDate(`${month}-01`); }
app.get('/api/summary', async (req, res) => {
  const { month } = req.query;
  if (!validMonth(month)) return res.status(400).json({ error: '조회 월을 확인해 주세요.' });
  const db = await database();
  const [summary] = await db`
    WITH income_totals AS (
      SELECT COALESCE(SUM(amount), 0) AS total,
        COALESCE(SUM(amount) FILTER (WHERE date >= ${month + '-01'}::date AND date < (${month + '-01'}::date + interval '1 month')), 0) AS monthly FROM incomes
    ), expense_totals AS (
      SELECT COALESCE(SUM(amount), 0) AS total,
        COALESCE(SUM(amount) FILTER (WHERE date >= ${month + '-01'}::date AND date < (${month + '-01'}::date + interval '1 month')), 0) AS monthly FROM expenses
    )
    SELECT income_totals.monthly::float8 AS income, expense_totals.monthly::float8 AS expense,
      (income_totals.monthly - expense_totals.monthly)::float8 AS "monthlyBalance",
      (income_totals.total - expense_totals.total)::float8 AS balance FROM income_totals, expense_totals`;
  res.json(summary);
});
app.get('/api/incomes', async (req, res) => {
  const { month, date } = req.query;
  if (!validMonth(month) || (date && (!validDate(date) || !date.startsWith(month)))) return res.status(400).json({ error: '조회 날짜를 확인해 주세요.' });
  const db = await database();
  const rows = await db`SELECT id, to_char(date, 'YYYY-MM-DD') AS date, title, category, amount::float8 AS amount FROM incomes WHERE date >= ${month + '-01'}::date AND date < (${month + '-01'}::date + interval '1 month') ORDER BY date DESC, id DESC`;
  res.json({ incomes: date ? rows.filter(row => row.date === date) : rows, total: rows.reduce((sum, row) => sum + row.amount, 0), count: rows.length });
});
app.post('/api/incomes', async (req, res) => {
  if (!validExpense(req.body, incomeCategories)) return res.status(400).json({ error: '날짜, 항목, 카테고리와 금액을 확인해 주세요.' });
  const { date, title, category, amount } = req.body, db = await database();
  const [row] = await db`INSERT INTO incomes (date, title, category, amount) VALUES (${date}, ${title.trim()}, ${category}, ${amount}) RETURNING id`;
  res.status(201).json(row);
});
app.put('/api/incomes/:id', async (req, res) => {
  if (!/^\d{1,10}$/.test(req.params.id) || Number(req.params.id) > 2147483647 || !validExpense(req.body, incomeCategories)) return res.status(400).json({ error: '입력값을 확인해 주세요.' });
  const { date, title, category, amount } = req.body, db = await database();
  const rows = await db`UPDATE incomes SET date=${date}, title=${title.trim()}, category=${category}, amount=${amount} WHERE id=${req.params.id} RETURNING id`;
  res.status(rows.length ? 200 : 404).json(rows.length ? { ok: true } : { error: '내역을 찾을 수 없습니다.' });
});
app.delete('/api/incomes/:id', async (req, res) => {
  if (!/^\d{1,10}$/.test(req.params.id) || Number(req.params.id) > 2147483647) return res.status(400).json({ error: '잘못된 ID입니다.' });
  const db = await database();
  const rows = await db`DELETE FROM incomes WHERE id=${req.params.id} RETURNING id`;
  res.status(rows.length ? 200 : 404).json(rows.length ? { ok: true } : { error: '내역을 찾을 수 없습니다.' });
});
app.get('/api/expenses', async (req, res) => {
  const month = req.query.month, date = req.query.date;
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !validDate(`${month}-01`) || (date && (!validDate(date) || !date.startsWith(month)))) return res.status(400).json({ error: '조회 날짜를 확인해 주세요.' });
  const db = await database();
  const rows = await db`SELECT id, to_char(date, 'YYYY-MM-DD') AS date, title, category, amount::float8 AS amount FROM expenses WHERE date >= ${month + '-01'}::date AND date < (${month + '-01'}::date + interval '1 month') ORDER BY date DESC, id DESC`;
  const totals = categories.map(category => ({ category, amount: rows.filter(row => row.category === category).reduce((sum, row) => sum + row.amount, 0) }));
  res.json({ expenses: date ? rows.filter(row => row.date === date) : rows, total: rows.reduce((sum, row) => sum + row.amount, 0), count: rows.length, categories: totals });
});
app.post('/api/expenses', async (req, res) => {
  if (!validExpense(req.body)) return res.status(400).json({ error: '날짜, 항목, 카테고리와 금액을 확인해 주세요.' });
  const { date, title, category, amount } = req.body, db = await database();
  const [row] = await db`INSERT INTO expenses (date, title, category, amount) VALUES (${date}, ${title.trim()}, ${category}, ${amount}) RETURNING id`;
  res.status(201).json(row);
});
app.put('/api/expenses/:id', async (req, res) => {
  if (!/^\d{1,10}$/.test(req.params.id) || Number(req.params.id) > 2147483647 || !validExpense(req.body)) return res.status(400).json({ error: '입력값을 확인해 주세요.' });
  const { date, title, category, amount } = req.body, db = await database();
  const rows = await db`UPDATE expenses SET date=${date}, title=${title.trim()}, category=${category}, amount=${amount} WHERE id=${req.params.id} RETURNING id`;
  res.status(rows.length ? 200 : 404).json(rows.length ? { ok: true } : { error: '내역을 찾을 수 없습니다.' });
});
app.delete('/api/expenses/:id', async (req, res) => {
  if (!/^\d{1,10}$/.test(req.params.id) || Number(req.params.id) > 2147483647) return res.status(400).json({ error: '잘못된 ID입니다.' });
  const db = await database();
  const rows = await db`DELETE FROM expenses WHERE id=${req.params.id} RETURNING id`;
  res.status(rows.length ? 200 : 404).json(rows.length ? { ok: true } : { error: '내역을 찾을 수 없습니다.' });
});
app.use('/api', (req, res) => res.status(404).json({ error: '경로를 찾을 수 없습니다.' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '잘못된 요청 형식입니다.' });
  res.status(503).json({ error: err.message === 'DB_CONFIG' ? '서버에 DATABASE_URL을 설정해 주세요.' : '요청을 처리하지 못했습니다. 데이터베이스 연결과 설정을 확인해 주세요.' });
});
module.exports = app;
