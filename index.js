const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());

// Función para obtener la IP pública
const getPublicIP = async () => {
  try {
    const response = await axios.get('https://api.ipify.org?format=json');
    const ip = response.data.ip;
    console.log(`🌐 IP Pública del servidor: ${ip}`);

    // También enviar IP a Telegram
    await sendTelegramMessage(`🚀 Bot iniciado correctamente.\n🌐 IP pública del servidor: ${ip}`);
  } catch (error) {
    console.error('❌ No se pudo obtener la IP pública:', error.message);
  }
};

app.post('/', async (req, res) => {
  try {
    const data = req.body;

    const message = data.message;
    console.log("📨 Mensaje recibido de TradingView:", message);

    let side = '';
    let symbol = '';
    let price = '';

    if (message.includes("SELL")) {
      side = 'SELL';
      [_, symbol, price] = message.match(/🔴 SELL - (.+?) a (\d+\.\d+)/);
    } else if (message.includes("BUY")) {
      side = 'BUY';
      [_, symbol, price] = message.match(/🟢 BUY - (.+?) a (\d+\.\d+)/);
    }

    if (!side || !symbol || !price) {
      throw new Error("❌ No se pudo procesar correctamente la señal");
    }

    // Ajuste de símbolo para futuros USDT-M
    if (!symbol.endsWith("USDT")) {
      symbol = symbol + "USDT";
    }

    // Calcular la cantidad basada en 100 USDT y apalancamiento 3x
    const usdtAmount = 100; // Monto a usar
    const leverage = 3; // Apalancamiento deseado
    const totalPositionSize = usdtAmount * leverage; // 300 USDT posición total
    const quantity = (totalPositionSize / parseFloat(price)).toFixed(3); // Redondear a 3 decimales

    // Enviar mensaje a Telegram
    const telegramMessage = `
📡 Señal recibida de TradingView:

${side === 'SELL' ? '🔴' : '🟢'} ${side} - ${symbol} a ${price} en 1

📈 Ejecutando orden:
- Tipo: ${side}
- Símbolo: ${symbol}
- Precio: $${price}
- Cantidad: ${quantity} (100 USDT con 3x leverage)
    `;

    await sendTelegramMessage(telegramMessage);
    console.log("✅ Mensaje enviado a Telegram");

    // Ejecutar orden en Binance
    await sendBinanceOrder(symbol, side, quantity);

    res.status(200).send('✅ Señal procesada correctamente');
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

// Función para enviar orden a Binance Futures
const sendBinanceOrder = async (symbol, side, quantity) => {
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
      timestamp: timestamp,
      recvWindow: recvWindow,
    };

    const query = Object.keys(params).map(k => `${k}=${params[k]}`).join('&');
    const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');

    const response = await axios.post(
      `https://fapi.binance.com/fapi/v1/order?${query}&signature=${signature}`,
      {},
      {
        headers: {
          'X-MBX-APIKEY': apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    console.log("✅ Orden enviada a Binance Futures:", response.data);
  } catch (error) {
    console.error("❌ Error enviando orden a Binance:", error.response?.data || error.message);
  }
};

// Arrancar el servidor y enviar IP a Telegram
app.listen(port, async () => {
  console.log(`🚀 Servidor escuchando en el puerto ${port}`);
  await getPublicIP();
});
