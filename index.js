const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());

app.post('/', async (req, res) => {
  try {
    const data = req.body;

    // Extraer datos del mensaje
    const message = data.message;
    const [_, rawSide, rawPair, rawPrice] = message.match(/(BUY|SELL) - (\w+) a ([\d.]+)/);
    const side = rawSide.toUpperCase();
    const symbol = rawPair.toUpperCase();
    const price = parseFloat(rawPrice);
    const quantity = (1000 / price).toFixed(3); // Aproximado

    // Construir mensaje para Telegram
    const telegramMessage = `
📡 Señal recibida de TradingView:

${side === 'BUY' ? '🟢' : '🔴'} ${side} - ${symbol} a ${price}

📈 Ejecutando orden:
- Tipo: ${side}
- Símbolo: ${symbol}
- Precio: $${price}
- Cantidad: ${quantity} (1000 USDT)
`;

    // Enviar a Telegram
    await sendTelegramMessage(telegramMessage);
    console.log("✅ Mensaje enviado a Telegram");

    // Enviar orden a Bybit Testnet
    await sendBybitOrder(symbol, side, quantity);

    res.status(200).send('✅ Señal procesada');
  } catch (error) {
    console.error("❌ Error procesando la señal:", error.message);
    res.status(500).send('❌ Error interno del servidor');
  }
});

const sendTelegramMessage = async (message) => {
  const telegramUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  await axios.post(telegramUrl, {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text: message,
  });
};

const sendBybitOrder = async (symbol, side, quantity) => {
  try {
    const endpoint = 'https://api-testnet.bybit.com/v2/private/order/create';
    const timestamp = Date.now();

    const params = {
      api_key: process.env.BYBIT_API_KEY,
      symbol: symbol,
      side: side,
      order_type: 'Market',
      qty: quantity,
      time_in_force: 'GoodTillCancel',
      timestamp: timestamp,
    };

    // Ordenar alfabéticamente los parámetros
    const orderedParams = Object.keys(params).sort().reduce((obj, key) => {
      obj[key] = params[key];
      return obj;
    }, {});

    const paramString = Object.entries(orderedParams).map(([key, val]) => `${key}=${val}`).join('&');

    const signature = crypto
      .createHmac('sha256', process.env.BYBIT_API_SECRET)
      .update(paramString)
      .digest('hex');

    const finalUrl = `${endpoint}?${paramString}&sign=${signature}`;

    const response = await axios.post(finalUrl);
    console.log("✅ Orden enviada a Bybit Testnet:", response.data);
  } catch (error) {
    console.error("❌ Error enviando orden a Bybit Testnet:", error.response?.data || error.message);
  }
};

app.listen(port, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${port}`);
});
