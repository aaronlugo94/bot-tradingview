const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());

// Variables de entorno
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// 🔥 Helper para firmar correctamente
function sign(queryString) {
  return crypto.createHmac('sha256', BINANCE_API_SECRET)
    .update(queryString)
    .digest('hex');
}

// 👉 Función para enviar mensaje a Telegram
async function sendTelegram(message) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
    });
  } catch (error) {
    console.error('❌ Error enviando Telegram:', error.message);
  }
}

// 👉 Consultar posiciones abiertas
async function getPosition(symbol) {
  try {
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = sign(queryString);

    const url = `https://fapi.binance.com/fapi/v2/positionRisk?${queryString}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

    const response = await axios.get(url, { headers });
    const positions = response.data;

    return positions.find(pos => pos.symbol === symbol) || null;
  } catch (error) {
    console.error('❌ Error obteniendo posición:', error.response?.data || error.message);
    return null;
  }
}

// 👉 Cambiar apalancamiento
async function setLeverage(symbol, leverage = 3) {
  try {
    const timestamp = Date.now();
    const queryString = `symbol=${symbol}&leverage=${leverage}&timestamp=${timestamp}`;
    const signature = sign(queryString);

    const url = `https://fapi.binance.com/fapi/v1/leverage?${queryString}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

    await axios.post(url, null, { headers });
  } catch (error) {
    console.error('❌ Error cambiando leverage:', error.response?.data || error.message);
  }
}

// 👉 Enviar nueva orden
async function sendOrder(symbol, side, quantity, reduceOnly = false) {
  try {
    const timestamp = Date.now();
    const query = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${quantity}&reduceOnly=${reduceOnly}&timestamp=${timestamp}`;
    const signature = sign(query);

    const url = `https://fapi.binance.com/fapi/v1/order?${query}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

    const response = await axios.post(url, null, { headers });
    return response.data;
  } catch (error) {
    console.error('❌ Error enviando orden:', error.response?.data || error.message);
    throw error;
  }
}

// 👉 Cerrar posición opuesta si existe
async function closeOpposite(symbol, currentPositionAmt, entryPrice) {
  try {
    const side = currentPositionAmt > 0 ? 'SELL' : 'BUY';
    const quantity = Math.abs(currentPositionAmt).toFixed(3);

    const orderResult = await sendOrder(symbol, side, quantity, true);

    const markPriceData = await getMarkPrice(symbol);
    const markPrice = parseFloat(markPriceData.markPrice);

    const pnl = (markPrice - entryPrice) * currentPositionAmt * (side === 'SELL' ? 1 : -1);

    await sendTelegram(`🔄 Posición anterior cerrada:
- ${side} ${symbol}
- Cantidad: ${quantity}
- Entrada: $${entryPrice}
- Precio cierre: $${markPrice.toFixed(2)}
- PnL Aproximado: ${pnl.toFixed(2)} USDT`);
  } catch (error) {
    console.error('❌ Error cerrando posición:', error.message);
  }
}

// 👉 Obtener precio de mercado
async function getMarkPrice(symbol) {
  try {
    const url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`;
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error('❌ Error obteniendo mark price:', error.message);
    throw error;
  }
}

// 🚀 Bot principal
app.post('/', async (req, res) => {
  try {
    console.log("Body recibido completo:", req.body);

    const { message } = req.body;
    if (!message) {
      throw new Error('❌ No se recibió mensaje válido.');
    }

    console.log("Mensaje recibido:", message);

    let side, rawSymbol, price;
    if (message.includes('BUY')) {
      side = 'BUY';
      [, rawSymbol, price] = message.match(/🟢 BUY - (.+?) a (\d+(\.\d+)?)/);
    } else if (message.includes('SELL')) {
      side = 'SELL';
      [, rawSymbol, price] = message.match(/🔴 SELL - (.+?) a (\d+(\.\d+)?)/);
    } else {
      throw new Error('❌ Mensaje no reconocido.');
    }

    if (!rawSymbol || !price) {
      throw new Error('❌ Error extrayendo symbol o price.');
    }

    // Limpiar símbolo, eliminar "PERP" si existe y agregar "USDT" si falta
    let symbol = rawSymbol.replace('PERP', '').replace(/[^a-zA-Z]/g, '').toUpperCase();
    if (!symbol.endsWith('USDT')) {
      symbol = symbol + 'USDT';
    }
    price = parseFloat(price);

    console.log(`🛠 Procesando orden: ${side} ${symbol} a $${price}`);

    const orderUSDT = 200; // Monto fijo en USDT
    let quantity = orderUSDT / price;
    quantity = quantity.toFixed(3); // Redondear a 3 decimales

    // Consultar posición actual
    const position = await getPosition(symbol);

    if (position && parseFloat(position.positionAmt) !== 0) {
      const posSide = parseFloat(position.positionAmt);
      const entryPrice = parseFloat(position.entryPrice);
      if ((posSide > 0 && side === 'SELL') || (posSide < 0 && side === 'BUY')) {
        console.log('Cerrando posición existente...');
        await closeOpposite(symbol, posSide, entryPrice);
      }
    }

    // Asegurar leverage correcto
    await setLeverage(symbol, 3);

    // Crear nueva orden
    const orderResult = await sendOrder(symbol, side, quantity);

    console.log("✅ Nueva orden enviada:", orderResult);

    await sendTelegram(`🚀 Nueva operación ejecutada:
- Tipo: ${side}
- Símbolo: ${symbol}
- Precio Aproximado: $${price}
- Cantidad: ${quantity}
- Order ID: ${orderResult.orderId}`);

    res.status(200).send('✅ Señal procesada correctamente.');
  } catch (error) {
    console.error("❌ Error:", error.message);
    await sendTelegram(`❌ Error procesando señal: ${JSON.stringify(error.response?.data || error.message)}`);
    res.status(500).send('❌ Error interno.');
  }
});

app.listen(port, () => {
  console.log(`🚀 Bot escuchando en puerto ${port}`);
});
