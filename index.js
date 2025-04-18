const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BYBIT_API_KEY = process.env.BYBIT_API_KEY;
const BYBIT_API_SECRET = process.env.BYBIT_API_SECRET;

const sendTelegramMessage = async (message) => {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
    });
    console.log('✅ Mensaje enviado a Telegram');
  } catch (error) {
    console.error('❌ Error enviando mensaje a Telegram:', error.message);
  }
};

const sendBybitOrder = async (symbol, side, qty, price) => {
  try {
    const order = {
      side,
      symbol,
      order_type: 'Market',
      qty,
      time_in_force: 'GoodTillCancel',
      api_key: BYBIT_API_KEY,
      api_secret: BYBIT_API_SECRET,
    };
    const response = await axios.post('https://api.bybit.com/v2/private/order/create', order);
    console.log('✅ Orden enviada a Bybit:', response.data);
  } catch (error) {
    console.error('❌ Error enviando orden a Bybit:', error.message);
  }
};

const parseMessage = (msg) => {
  const regex = /([🔴🟢])\s?(BUY|SELL)\s-\s([A-Z]+) a ([\d.]+) en/i;
  const match = msg.match(regex);
  if (!match) return null;

  const [, , side, symbol, price] = match;
  return { side, symbol, price: parseFloat(price) };
};

app.post('/webhook', async (req, res) => {
  const msg = req.body.message;
  console.log('📨 Mensaje recibido:', msg);

  const parsed = parseMessage(msg);
  if (!parsed) {
    console.error('❌ No se pudo extraer símbolo o precio del mensaje.');
    return res.status(400).send('Formato de mensaje inválido.');
  }

  const { side, symbol, price } = parsed;

  await sendTelegramMessage(`📡 Señal: ${side} ${symbol} a ${price}`);
  await sendBybitOrder(symbol, side, 1000 / price, price);

  res.status(200).send('OK');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${port}`);
});
