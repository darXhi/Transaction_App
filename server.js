const express = require('express');
const Database = require('better-sqlite3');
const fileSystem = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const database = new Database(path.join(__dirname, 'data', 'database.sqlite'));

database.exec(`
CREATE TABLE IF NOT EXISTS status (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id       TEXT NOT NULL,
  product_name     TEXT NOT NULL,
  amount           INTEGER NOT NULL,
  customer_name    TEXT NOT NULL,
  status           INTEGER NOT NULL REFERENCES status(id),
  transaction_date TEXT NOT NULL,   -- format: YYYY-MM-DD HH:MM:SS
  create_by        TEXT NOT NULL,
  create_on        TEXT NOT NULL
);
`);

function seedDatabaseFromJson() {
  const existingRowCount = database.prepare('SELECT COUNT(*) AS total FROM transactions').get().total;
  if (existingRowCount > 0) return;

  let rawJsonText = fileSystem.readFileSync(path.join(__dirname, 'data', 'viewData.json'), 'utf8');
  rawJsonText = rawJsonText.replace(/,\s*([\]}])/g, '$1');
  const jsonContent = JSON.parse(rawJsonText);

  const insertStatusStatement = database.prepare('INSERT OR REPLACE INTO status (id, name) VALUES (?, ?)');
  const insertTransactionStatement = database.prepare(`INSERT INTO transactions
    (id, product_id, product_name, amount, customer_name, status, transaction_date, create_by, create_on)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  database.transaction(() => {
    jsonContent.status.forEach((statusItem) => {
      insertStatusStatement.run(statusItem.id, statusItem.name);
    });
    jsonContent.data.forEach((transactionItem) => {
      insertTransactionStatement.run(
        transactionItem.id, transactionItem.productID, transactionItem.productName,
        Number(transactionItem.amount), transactionItem.customerName, transactionItem.status,
        transactionItem.transactionDate, transactionItem.createBy, transactionItem.createOn);
    });
  })();
  console.log(`Seed selesai: ${jsonContent.data.length} data dimasukkan dari viewData.json`);
}
seedDatabaseFromJson();

const SELECT_TRANSACTION_QUERY = `SELECT
  transactions.id AS id,
  transactions.product_id AS productID,
  transactions.product_name AS productName,
  transactions.amount AS amount,
  transactions.customer_name AS customerName,
  transactions.status AS status,
  status.name AS statusName,
  transactions.transaction_date AS transactionDate,
  transactions.create_by AS createBy,
  transactions.create_on AS createOn
  FROM transactions
  JOIN status ON status.id = transactions.status`;

const padWithZero = (number) => String(number).padStart(2, '0');

function getCurrentTimestamp() {
  const currentDate = new Date();
  const datePart = `${currentDate.getFullYear()}-${padWithZero(currentDate.getMonth() + 1)}-${padWithZero(currentDate.getDate())}`;
  const timePart = `${padWithZero(currentDate.getHours())}:${padWithZero(currentDate.getMinutes())}:${padWithZero(currentDate.getSeconds())}`;
  return `${datePart} ${timePart}`;
}

function validateTransactionInput(requestBody) {
  const errorMessages = [];
  const toTrimmedString = (value) => (typeof value === 'string' ? value.trim() : '');

  const cleanedData = {
    productID: toTrimmedString(requestBody.productID),
    productName: toTrimmedString(requestBody.productName),
    customerName: toTrimmedString(requestBody.customerName),
    amount: Number(requestBody.amount),
    status: Number(requestBody.status),
    transactionDate: toTrimmedString(requestBody.transactionDate),
  };

  const statusExists = database.prepare('SELECT 1 FROM status WHERE id = ?').get(cleanedData.status);
  const dateFormatIsValid = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(cleanedData.transactionDate);

  if (!cleanedData.productID) errorMessages.push('Product ID wajib diisi');
  if (!cleanedData.productName) errorMessages.push('Product Name wajib diisi');
  if (!cleanedData.customerName) errorMessages.push('Customer Name wajib diisi');
  if (!Number.isInteger(cleanedData.amount) || cleanedData.amount < 0) errorMessages.push('Amount harus angka bulat >= 0');
  if (!statusExists) errorMessages.push('Status tidak valid');
  if (!dateFormatIsValid) errorMessages.push('Transaction Date harus berformat YYYY-MM-DD HH:MM:SS');

  return { cleanedData, errorMessages };
}

function findTransactionById(transactionId) {
  return database.prepare(`${SELECT_TRANSACTION_QUERY} WHERE transactions.id = ?`).get(transactionId);
}

const application = express();
application.use(express.json());
application.use(express.static(path.join(__dirname, 'public')));

application.get('/api/status', (request, response) => {
  response.json(database.prepare('SELECT id, name FROM status ORDER BY id').all());
});

application.get('/api/transactions', (request, response) => {
  const transactionList = database
    .prepare(`${SELECT_TRANSACTION_QUERY} ORDER BY transactions.transaction_date DESC, transactions.id DESC`)
    .all();
  response.json(transactionList);
});

application.get('/api/transactions/:id', (request, response) => {
  const transaction = findTransactionById(request.params.id);
  if (!transaction) return response.status(404).json({ message: 'Data tidak ditemukan' });
  response.json(transaction);
});

application.post('/api/transactions', (request, response) => {
  const { cleanedData, errorMessages } = validateTransactionInput(request.body);
  if (errorMessages.length) return response.status(400).json({ message: errorMessages.join(', ') });

  const insertResult = database.prepare(`INSERT INTO transactions
    (product_id, product_name, amount, customer_name, status, transaction_date, create_by, create_on)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(cleanedData.productID, cleanedData.productName, cleanedData.amount, cleanedData.customerName,
      cleanedData.status, cleanedData.transactionDate, 'admin', getCurrentTimestamp());

  response.status(201).json(findTransactionById(insertResult.lastInsertRowid));
});

application.put('/api/transactions/:id', (request, response) => {
  if (!findTransactionById(request.params.id)) {
    return response.status(404).json({ message: 'Data tidak ditemukan' });
  }
  const { cleanedData, errorMessages } = validateTransactionInput(request.body);
  if (errorMessages.length) return response.status(400).json({ message: errorMessages.join(', ') });

  database.prepare(`UPDATE transactions SET product_id = ?, product_name = ?, amount = ?,
    customer_name = ?, status = ?, transaction_date = ? WHERE id = ?`)
    .run(cleanedData.productID, cleanedData.productName, cleanedData.amount, cleanedData.customerName,
      cleanedData.status, cleanedData.transactionDate, request.params.id);

  response.json(findTransactionById(request.params.id));
});

application.delete('/api/transactions/:id', (request, response) => {
  const deleteResult = database.prepare('DELETE FROM transactions WHERE id = ?').run(request.params.id);
  if (!deleteResult.changes) return response.status(404).json({ message: 'Data tidak ditemukan' });
  response.json({ message: 'Data dihapus' });
});

application.listen(PORT, () => console.log(`Aplikasi berjalan di http://localhost:${PORT}`));
