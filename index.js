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
    const message = data.message; // El mensaje enviado desde TradingView
    console.log("Mensaje recibido de TradingView:", message);

    let side = '';
    let symbol = '';
    let quantity = '';
    let price = '';

    // Verifica el tipo de señal y extrae los detalles
    if (message.includes("SELL")) {
      side = 'SELL';
      // Extraer el símbolo y el precio de la señal de venta
      [_, symbol, price] = message.match(/🔴 SELL - (.+?) a (\d+\.\d+)/);
    } else if (message.includes("BUY")) {
      side = 'BUY';
      // Extraer el símbolo y el precio de la señal de compra
      [_, symbol, price] = message.match(/🟢 BUY - (.+?) a (\d+\.\d+)/);
    }

    // Verifica que se haya procesado correctamente la señal
    if (!side || !symbol || !price) {
      throw new Error("❌ No se pudo procesar correctamente la señal");
    }

    // Calcular la cantidad basada en 100 USDT
    const usdtAmount = 100;  // Monto de la operación en USDT
    const leverage = 3;      // Leverage de 3x
    const totalAmount = usdtAmount * leverage;  // Monto total controlado
    quantity = (totalAmount / parseFloat(price)).toFixed(6); // Aproximado de la cantidad a operar

    // Enviar mensaje a Telegram
    const telegramMessage = `
📡 Señal recibida de TradingView:

${side === 'SELL' ? '🔴' : '🟢'} ${side} - ${symbol} a ${price} en 1

📈 Ejecutando orden:
- Tipo: ${side}
- Símbolo: ${symbol}
- Precio: $${price}
- Cantidad: ${quantity} (${usdtAmount} USDT, con Leverage ${leverage}x)
    `;

    await sendTelegramMessage(telegramMessage);
    console.log("✅ Mensaje enviado a Telegram");

    // Enviar orden a Binance
    await setLeverage(symbol, leverage);  // Establecer el leverage
    await sendBinanceOrder(symbol, side, quantity, price, leverage);

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
const sendBinanceOrder = async (symbol, side, quantity, price, leverage) => {
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

// Función para establecer el Leverage en Binance
const setLeverage = async (symbol, leverage) => {
  try {
    const apiKey = process.env.BINANCE_API_KEY;
    const secret = process.env.BINANCE_API_SECRET;
    const timestamp = Date.now();
    const recvWindow = 5000;

    const params = {
      symbol: symbol,
      leverage: leverage,
      timestamp: timestamp,
      recvWindow: recvWindow,
    };

    // Crear string de firma
    const orderedParams = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');

    // Generar firma
    const signature = crypto.createHmac('sha256', secret).update(orderedParams).digest('hex');

    // Agregar firma
    const finalParams = `${orderedParams}&signature=${signature}`;

    // Establecer leverage
    const response = await axios.post(
      `https://api.binance.com/api/v1/leverage?${finalParams}`,
      {}, // cuerpo vacío
      {
        headers: {
          'X-MBX-APIKEY': apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    console.log("✅ Leverage establecido:", response.data);
  } catch (error) {
    console.error("❌ Error estableciendo leverage:", error.response?.data || error.message);
  }
};

app.listen(port, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${port}`);
});
