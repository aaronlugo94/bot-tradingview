const axios = require('axios');
const crypto = require('crypto');
const express = require('express');
const app = express();
app.use(express.json());

// 📈 Tu API de Binance FUTURES
const API_KEY = 'TU_API_KEY';
const API_SECRET = 'TU_API_SECRET';
const BINANCE_API_URL = 'https://fapi.binance.com';

// 📣 Tu BOT de Telegram
const TELEGRAM_BOT_TOKEN = 'TU_TELEGRAM_BOT_TOKEN';
const TELEGRAM_CHAT_ID = 'TU_TELEGRAM_CHAT_ID';

// USDT que quieres usar en cada operación
const orderUSDT = 200;

// Función para firmar las peticiones a Binance
function sign(queryString) {
  return crypto.createHmac('sha256', API_SECRET).update(queryString).digest('hex');
}

// Función para mandar mensajes a Telegram
async function sendTelegramMessage(message) {
  const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await axios.post(telegramUrl, {
    chat_id: TELEGRAM_CHAT_ID,
    text: message
  });
}

// 🚀 Función para ajustar la cantidad automáticamente usando la Exchange Info de Binance
async function adjustQuantity(symbol, quantity) {
  try {
    const exchangeInfo = await axios.get(`${BINANCE_API_URL}/fapi/v1/exchangeInfo`);
    const symbolInfo = exchangeInfo.data.symbols.find(s => s.symbol === symbol);
    if (!symbolInfo) {
      throw new Error(`No se encontró información del símbolo: ${symbol}`);
    }

    const stepSize = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE').stepSize;
    const decimals = stepSize.indexOf('1') - 2; // Ej: stepSize = 0.001 -> decimals = 3
    return parseFloat(quantity).toFixed(decimals);
  } catch (error) {
    console.error('Error obteniendo precisión:', error);
    return parseFloat(quantity).toFixed(3); // fallback de emergencia
  }
}

// 🚀 Función principal para crear órdenes
async function createOrder(symbol, side, quantity, closePosition = false) {
  const endpoint = '/fapi/v1/order';
  const url = `${BINANCE_API_URL}${endpoint}`;

  const data = {
    symbol,
    side,
    type: 'MARKET',
    quantity,
    positionSide: 'BOTH',
    timestamp: Date.now(),
  };

  if (closePosition) {
    data.closePosition = true;
  }

  const queryString = new URLSearchParams(data).toString();
  const signature = sign(queryString);

  try {
    const response = await axios.post(`${url}?${queryString}&signature=${signature}`, {}, {
      headers: { 'X-MBX-APIKEY': API_KEY }
    });

    console.log('✅ Nueva orden enviada:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ Error enviando orden:', error.response?.data || error.message);
    throw error;
  }
}

// Función para obtener el PnL (ganancia o pérdida)
async function getPosition(symbol) {
  const endpoint = '/fapi/v2/positionRisk';
  const url = `${BINANCE_API_URL}${endpoint}?timestamp=${Date.now()}`;
  const signature = sign(`timestamp=${Date.now()}`);

  try {
    const response = await axios.get(`${url}&signature=${signature}`, {
      headers: { 'X-MBX-APIKEY': API_KEY }
    });

    const position = response.data.find(p => p.symbol === symbol);
    if (!position) throw new Error('No position found.');

    return {
      entryPrice: parseFloat(position.entryPrice),
      markPrice: parseFloat(position.markPrice),
      pnl: parseFloat(position.unRealizedProfit)
    };
  } catch (error) {
    console.error('❌ Error obteniendo posición:', error.response?.data || error.message);
    throw error;
  }
}

// 🎯 Servidor para recibir señales
app.post('/webhook', async (req, res) => {
  const body = req.body;
  console.log('Body recibido completo:', body);

  if (!body.message) {
    console.error('❌ Error: No se recibió mensaje válido.');
    return res.status(400).send('No se recibió mensaje válido.');
  }

  const message = body.message.trim();
  console.log('Mensaje recibido:', message);

  try {
    const [direction, rest] = message.split(' - ');
    const [symbol, priceText] = rest.split(' a ');
    const side = direction.includes('BUY') ? 'BUY' : 'SELL';
    const price = parseFloat(priceText);

    let quantity = orderUSDT / price;
    quantity = await adjustQuantity(symbol, quantity);

    if (direction.includes('BUY')) {
      console.log('Cerrando posición SHORT (si existe)...');
      await createOrder(symbol, 'BUY', quantity, false);
    } else if (direction.includes('SELL')) {
      console.log('Cerrando posición LONG (si existe)...');
      await createOrder(symbol, 'SELL', quantity, false);
    }

    // 🧠 Ahora mostrar el PnL en Telegram
    const position = await getPosition(symbol);
    const pnlMessage = `📈 PnL para ${symbol}:\nEntrada: ${position.entryPrice}\nPrecio actual: ${position.markPrice}\nGanancia/Perdida: ${position.pnl.toFixed(2)} USDT`;

    console.log(pnlMessage);
    await sendTelegramMessage(pnlMessage);

    res.status(200).send('Orden ejecutada exitosamente.');
  } catch (error) {
    console.error('❌ Error procesando webhook:', error.message);
    res.status(500).send('Error procesando webhook.');
  }
});

// 🚀 Lanza el servidor
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
