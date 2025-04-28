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

// 👉 Firmar solicitudes
function sign(queryString) {
  return crypto.createHmac('sha256', BINANCE_API_SECRET)
    .update(queryString)
    .digest('hex');
}

// 👉 Enviar mensaje a Telegram
async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await axios.post(url, {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
  });
}

// 👉 Obtener la IP pública
async function getPublicIP() {
  try {
    const response = await axios.get('https://api.ipify.org?format=json');
    return response.data.ip;
  } catch (error) {
    console.error('❌ Error obteniendo la IP pública:', error.message);
    return null;
  }
}

// 👉 Obtener información del símbolo
async function getSymbolInfo(symbol) {
  const url = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
  const response = await axios.get(url);
  const symbols = response.data.symbols;
  return symbols.find(s => s.symbol === symbol);
}

// 👉 Obtener posición actual
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

// 👉 Cambiar leverage
async function setLeverage(symbol, leverage = 3) {
  const timestamp = Date.now();
  const params = `symbol=${symbol}&leverage=${leverage}&timestamp=${timestamp}`;
  const signature = sign(params);

  const url = `https://fapi.binance.com/fapi/v1/leverage?${params}&signature=${signature}`;
  const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

  await axios.post(url, {}, { headers });
}

// 👉 Mandar orden
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

// 🚀 Entrada principal
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

    symbol = symbol.replace('PERP', '');
    price = parseFloat(price);
    const orderUSDT = 200; // Ahora son 200 USDT

    // 🔥 Obtener info real del símbolo
    const symbolInfo = await getSymbolInfo(symbol);

    if (!symbolInfo) {
      throw new Error(`No se encontró información del símbolo: ${symbol}`);
    }

    const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
    const stepSize = parseFloat(lotSizeFilter.stepSize);
    const minQty = parseFloat(lotSizeFilter.minQty);

    // Calcular cantidad base
    let quantity = orderUSDT / price;

    // Redondear al múltiplo correcto (stepSize)
    quantity = Math.floor(quantity / stepSize) * stepSize;
    quantity = parseFloat(quantity.toFixed(8)); // Redondear

    if (quantity < minQty) {
      throw new Error(`La cantidad calculada (${quantity}) es menor al mínimo permitido (${minQty})`);
    }

    // 🔥 Obtener IP pública y mandar a Telegram
    const publicIP = await getPublicIP();
    if (publicIP) {
      await sendTelegram(`🌐 IP pública del servidor: ${publicIP}`);
    }

    // 🔥 Cerrar posición si hay abierta
    const position = await getPosition(symbol);

    if (position && parseFloat(position.positionAmt) !== 0) {
      const posSide = parseFloat(position.positionAmt);
      if ((posSide > 0 && side === 'SELL') || (posSide < 0 && side === 'BUY')) {
        console.log('Cerrando posición existente...');
        await closeOpposite(symbol, posSide);
      }
    }

    // 🔥 Ajustar leverage a 3x
    await setLeverage(symbol, 3);

    // 🔥 Mandar nueva orden
    const orderResult = await sendOrder(symbol, side, quantity);

    console.log("✅ Nueva orden enviada:", orderResult);

    // 🔥 Avisar a Telegram
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
