const express = require('express');
const app = express();

app.listen(3001, '0.0.0.0', () => {
    console.log('✅ Test server listening on port 3001');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});
