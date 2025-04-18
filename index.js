const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());

// Variables de entorno
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BYBIT_API_KEY = process.env.BYBIT_API_KEY;
const BYBIT_API_SECRET = process.env.BYBIT_API_SECRET;

// Función para enviar mensaje a Telegram
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

// Función para firmar los parámetros de la orden
const signRequest = (params, secret) => {
  const orderedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  const signature = crypto
    .createHmac('sha256', secret)
    .update(orderedParams)
    .digest('hex');

  return signature;
};

// Enviar orden firmada a Bybit
const sendBybitOrder = async (symbol, side, quantity) => {
  try {
    const url = 'https://api-testnet.bybit.com/v2/private/order/create';

    const params = {
      api_key: BYBIT_API_KEY,
      symbol,
      side,
      order_type: 'Market',
      qty: quantity,
      time_in_force: 'GoodTillCancel',
      timestamp: Date.now(),
    };

    params.sign = signRequest(params, BYBIT_API_SECRET);

    const response = await axios.post(url, null, {
      params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    console.log('✅ Orden enviada a Bybit:', response.data);
  } catch (error) {
    console.error('❌ Error enviando orden a Bybit:', error.response?.data || error.message);
  }
};

// Ruta principal
app.post('/', async (req, res) => {
  const { message } = req.body;
  console.log('📨 Mensaje recibido:', message);

  if (!message) return res.status(400).send('Mensaje no recibido');

  await sendTelegramMessage(message);

  const match = message.match(/(BUY|SELL).*?([A-Z]+USDT).*?a\s([\d.]+)/i);
  if (!match) {
    console.log('❌ No se pudo extraer símbolo o precio del mensaje.');
    return res.status(200).send('Mensaje recibido sin datos válidos.');
  }

  const [, side, symbol, priceStr] = match;
  const quantityUSD = 1000;
  const price = parseFloat(priceStr);
  const quantity = (quantityUSD / price).toFixed(3);

  await sendBybitOrder(symbol, side.toUpperCase(), quantity);
  res.send('Mensaje procesado');
});

// Healthcheck
app.get('/', (req, res) => {
  res.send('👋 El bot está activo');
});

app.listen(port, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${port}`);
});
