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

    // Extraer el mensaje enviado por TradingView
    const message = data.message; // La alerta enviada desde TradingView
    console.log("Mensaje recibido de TradingView:", message);

    let side = '';
    let symbol = '';
    let quantity = '';
    let price = '';

    // Verifica el tipo de señal y extrae los detalles
    if (message.includes("Buy Signal")) {
      side = 'BUY';
      [_, symbol, price] = message.match(/Buy Signal: (.+) at (\d+\.\d+)/);
      quantity = (1000 / parseFloat(price)).toFixed(6); // Aproximado
    } else if (message.includes("Sell Signal")) {
      side = 'SELL';
      [_, symbol, price] = message.match(/Sell Signal: (.+) at (\d+\.\d+)/);
      quantity = (1000 / parseFloat(price)).toFixed(6); // Aproximado
    }

    // Verifica que se haya procesado correctamente la señal
    if (!side || !symbol || !price || !quantity) {
      throw new Error("❌ No se pudo procesar correctamente la señal");
    }

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

    // Enviar orden a Binance
    await sendBinanceOrder(symbol, side, quantity, price);

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

// Función para enviar orden a Binance
const sendBinanceOrder = async (symbol, side, quantity, price) => {
  try {
    const apiKey = process.env.BINANCE_API_KEY;
    const secret = process.env.BINANCE_API_SECRET;
    const timestamp = Date.now();
    const recvWindow = 5000;

    const params = {
      symbol: symbol,
      side: side,
      type: "MARKET",
      quantity: quantity,
      price: price,
      timestamp: timestamp,
      recvWindow: recvWindow,
    };

    // Crear string de firma
    const orderedParams = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');

    // Generar firma
    const signature = crypto.createHmac('sha256', secret).update(orderedParams).digest('hex');

    // Agregar firma
    const finalParams = `${orderedParams}&signature=${signature}`;

    // Enviar orden a Binance
    const response = await axios.post(
      `https://api.binance.com/api/v3/order?${finalParams}`,
      {}, // cuerpo vacío
      {
        headers: {
          'X-MBX-APIKEY': apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    console.log("✅ Orden enviada a Binance:", response.data);
  } catch (error) {
    console.error("❌ Error enviando orden a Binance:", error.response?.data || error.message);
  }
};

app.listen(port, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${port}`);
});
