require('dotenv').config();
const app = require('./app');
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`가계부: http://localhost:${port}`));
