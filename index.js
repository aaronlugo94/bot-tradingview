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
    const quantity = (1000 / price).toFixed(6); // Aproximado

    // Enviar mensaje a Telegram
    const telegramMessage = `
📡 Señal recibida de TradingView:

${side === 'BUY' ? '🟢' : '🔴'} ${side} - ${symbol} a ${price} en 1

📈 Ejecutando orden:
- Tipo: ${side}
- Símbolo: ${symbol}
- Precio: $${price}
- Cantidad: ${quantity} (1000 USDT)
    `;

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
    const apiKey = process.env.BYBIT_API_KEY;
    const secret = process.env.BYBIT_API_SECRET;
    const recvWindow = 5000;
    const timestamp = Date.now();

    const params = {
      apiKey,
      symbol,
      side,
      type: "MARKET",
      qty: quantity,
      timeInForce: "GTC",
      timestamp,
      recvWindow,
    };

    // Crear string de firma
    const orderedParams = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');

    // Generar firma
    const signature = crypto.createHmac('sha256', secret).update(orderedParams).digest('hex');

    // Agregar firma
    const finalParams = `${orderedParams}&sign=${signature}`;

    const response = await axios.post(
      `https://api-testnet.bybit.com/spot/v1/order?${finalParams}`,
      {}, // cuerpo vacío
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        }
      }
    );

    console.log("✅ Orden enviada a Bybit:", response.data);
  } catch (error) {
    console.error("❌ Error enviando orden a Bybit Testnet:", error.response?.data || error.message);
  }
};

app.listen(port, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${port}`);
});
