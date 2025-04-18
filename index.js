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

    // Extraer datos
    const message = data.message;
    const [_, rawSide, rawPair, rawPrice] = message.match(/(BUY|SELL) - (\w+) a ([\d.]+)/);
    const side = rawSide.toUpperCase();
    const symbol = rawPair.toUpperCase();
    const price = parseFloat(rawPrice);
    const quantity = 1000 / price; // Aproximado

    // Construir mensaje para Telegram
    const telegramMessage = `
📡 Señal recibida de TradingView:

${side === 'BUY' ? '🟢' : '🔴'} ${side} - ${symbol} a ${price} en 1

📈 Ejecutando orden:
- Tipo: ${side}
- Símbolo: ${symbol}
- Precio: $${price}
- Cantidad: ${quantity.toFixed(6)} (1000 USDT)
`;

    // Enviar a Telegram
    await sendTelegramMessage(telegramMessage);
    console.log("✅ Mensaje enviado a Telegram");

    // Enviar orden a Binance
    await sendBinanceOrder(symbol, side, quantity.toFixed(6));

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

const sendBinanceOrder = async (symbol, side, quantity) => {
  try {
    const timestamp = Date.now();
    const params = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${quantity}&timestamp=${timestamp}`;
    const signature = crypto
      .createHmac('sha256', process.env.BINANCE_API_SECRET)
      .update(params)
      .digest('hex');

    const url = `https://testnet.binance.vision/api/v3/order?${params}&signature=${signature}`;

    const headers = {
      'X-MBX-APIKEY': process.env.BINANCE_API_KEY,
    };

    const response = await axios.post(url, null, { headers });
    console.log("✅ Orden enviada a Binance:", response.data);
  } catch (error) {
    console.error("❌ Error enviando orden a Binance:", error.response?.data || error.message);
  }
};

// 👉 Ruta para detectar IP
app.get('/my-ip', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  res.send(`IP detectada: ${ip}`);
});

// 👂 Iniciar servidor
app.listen(port, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${port}`);
});
