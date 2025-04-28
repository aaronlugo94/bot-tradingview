const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());

const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// 👉 Helper para firmar solicitudes a Binance
function sign(queryString) {
  return crypto.createHmac('sha256', BINANCE_API_SECRET)
    .update(queryString)
    .digest('hex');
}

// 👉 Función para enviar mensajes a Telegram
async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await axios.post(url, {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
  });
}

// 👉 Función para ajustar la cantidad (quantity) según el mínimo permitido
function adjustQuantity(symbol, quantity) {
  const minQty = {
    BTCUSDT: 0.001,
    ETHUSDT: 0.001,
    // Agrega más símbolos si quieres
  };
  const stepSize = {
    BTCUSDT: 0.001,
    ETHUSDT: 0.001,
    // Agrega más símbolos si quieres
  };

  const min = minQty[symbol] || 0.001;
  const step = stepSize[symbol] || 0.001;

  if (quantity < min) quantity = min;

  return (Math.floor(quantity / step) * step).toFixed(6);
}

// 👉 Obtener la IP pública del servidor
async function getPublicIP() {
  try {
    const response = await axios.get('https://api.ipify.org?format=json');
    return response.data.ip;
  } catch (error) {
    console.error('❌ Error obteniendo la IP pública:', error.message);
    return null;
  }
}

// 👉 Consultar posición abierta en Binance Futures
async function getPosition(symbol) {
  const timestamp = Date.now();
  const params = `timestamp=${timestamp}`;
  const signature = sign(params);

  const url = `https://fapi.binance.com/fapi/v2/positionRisk?${params}&signature=${signature}`;
  const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

  const response = await axios.get(url, { headers });
  const positions = response.data;

  return positions.find(pos => pos.symbol === symbol) || null;
}

// 👉 Cambiar leverage a 3x automáticamente
async function setLeverage(symbol, leverage = 3) {
  const timestamp = Date.now();
  const params = `symbol=${symbol}&leverage=${leverage}&timestamp=${timestamp}`;
  const signature = sign(params);

  const url = `https://fapi.binance.com/fapi/v1/leverage?${params}&signature=${signature}`;
  const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

  await axios.post(url, {}, { headers });
}

// 👉 Mandar orden a Binance Futures
async function sendOrder(symbol, side, quantity) {
  const timestamp = Date.now();
  const params = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${quantity}&timestamp=${timestamp}`;
  const signature = sign(params);

  const url = `https://fapi.binance.com/fapi/v1/order?${params}&signature=${signature}`;
  const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

  const response = await axios.post(url, {}, { headers });
  return response.data;
}

// 👉 Cerrar posición contraria
async function closeOpposite(symbol, currentPositionAmt) {
  const side = currentPositionAmt > 0 ? 'SELL' : 'BUY';
  const quantity = Math.abs(currentPositionAmt);

  await sendOrder(symbol, side, quantity);

  await sendTelegram(`🔄 Posición anterior cerrada: ${side} ${symbol} (${quantity})`);
}

// 🚀 Punto principal de entrada
app.post('/', async (req, res) => {
  try {
    const { message } = req.body;
    console.log("Mensaje recibido:", message);

    let side, symbol, price;

    if (message.includes('BUY')) {
      side = 'BUY';
      [_, symbol, price] = message.match(/🟢 BUY - (.+?) a (\d+(\.\d+)?)/);
    } else if (message.includes('SELL')) {
      side = 'SELL';
      [_, symbol, price] = message.match(/🔴 SELL - (.+?) a (\d+(\.\d+)?)/);
    } else {
      throw new Error('Mensaje no reconocido.');
    }

    // Preparar datos
    symbol = symbol.replace('PERP', '');
    price = parseFloat(price);
    const orderUSDT = 200; // ← Ahora 200 USD como pediste
    let quantity = orderUSDT / price;
    quantity = adjustQuantity(symbol, quantity);

    // Obtener la IP pública del servidor
    const publicIP = await getPublicIP();

    if (publicIP) {
      await sendTelegram(`🌐 IP pública del servidor: ${publicIP}`);
    }

    // Consultar si hay posición abierta
    const position = await getPosition(symbol);

    if (position && parseFloat(position.positionAmt) !== 0) {
      const posSide = parseFloat(position.positionAmt);
      if ((posSide > 0 && side === 'SELL') || (posSide < 0 && side === 'BUY')) {
        console.log('Cerrando posición existente...');
        await closeOpposite(symbol, posSide);
      }
    }

    // Ajustar leverage
    await setLeverage(symbol, 3);

    // Mandar nueva orden
    const orderResult = await sendOrder(symbol, side, quantity);

    console.log("✅ Nueva orden enviada:", orderResult);

    // Avisar en Telegram
    await sendTelegram(`🚀 Nueva operación ejecutada:

- Tipo: ${side}
- Símbolo: ${symbol}
- Precio Aproximado: $${price}
- Cantidad: ${quantity}
- Order ID: ${orderResult.orderId}`);

    res.status(200).send('✅ Señal procesada correctamente.');
  } catch (error) {
    console.error("❌ Error:", error.message);
    await sendTelegram(`❌ Error procesando señal: ${error.message}`);
    res.status(500).send('❌ Error interno.');
  }
});

app.listen(port, () => {
  console.log(`🚀 Bot escuchando en puerto ${port}`);
});
